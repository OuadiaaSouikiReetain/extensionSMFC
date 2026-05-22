// SFMC Buddy v2.2.0 — Background service worker (Manifest V3)

const STORAGE_KEY = "sfmcProcessMinerState";
const defaultState = { tabs: {}, updatedAt: Date.now() };
const debuggerSessions = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, data => {
    if (!data[STORAGE_KEY]) chrome.storage.local.set({ [STORAGE_KEY]: defaultState });
  });
  chrome.alarms.create("purge", { periodInMinutes: 60 });
  purgeOldData();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("purge", { periodInMinutes: 60 });
  purgeOldData();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "purge") purgeOldData();
});

// ── SFMC hook: receive intercepted XHR/fetch payloads from sfmc-hook.js ──────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SFMC_HOOK_PAYLOAD") return false;
  const tabId = sender.tab?.id || "unknown";
  handleInteractionPayload(tabId, message.url, message.json).catch(() => null);
  sendResponse({ ok: true });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "SFMC_CANVAS_SNAPSHOT") {
    const tabId = sender.tab?.id || message.tabId || "unknown";
    updateTabState(tabId, { canvas: message.payload, pageUrl: sender.tab?.url || message.payload?.url || null, lastCanvasAt: Date.now() })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PANEL_STORE_JOURNEY") {
    updateJourney(message.tabId, message.journey).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PANEL_STORE_JOURNEY_LIST") {
    updateJourneyList(message.tabId, message.journeys || []).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PANEL_UPDATE_SESSION") {
    updateTabState(message.tabId, { session: message.session, pageUrl: message.session?.url || null, lastSessionAt: Date.now() })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PANEL_GET_STATE") {
    getState().then(state => sendResponse({ ok: true, state: state.tabs?.[message.tabId] || null }));
    return true;
  }

  if (message.type === "PANEL_CLEAR_TAB") {
    clearTab(message.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "POPUP_START_CAPTURE") {
    startNetworkCapture(message.tabId, message.mode || "journey", message.timeoutMs)
      .then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FETCH_SFMC") {
    fetchSfmcWithCookies(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FETCH_SFMC_JB") {
    fetchSfmcFromJbinteractions(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FETCH_SFMC_POST") {
    fetchSfmcPost(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "FETCH_SFMC_SOAP") {
    fetchSfmcSoap(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "QUERY_STUDIO_RESULT") {
    storeQueryStudioResult(message.payload).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "SFMC_BUDDY_COLLECTION") {
    updateBuddyCollection(message.collection, message.items || [], message.source || sender.tab?.url)
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  // NEW: localStorage/sessionStorage mining data from content.js
  if (message.type === "SFMC_BUDDY_STORAGE_MINED") {
    const tabId = sender.tab?.id || "unknown";
    chrome.storage.local.set({
      sfmcBuddyStorageMinerData: {
        ...message.payload,
        tabId,
        url: message.url,
        storedAt: Date.now()
      }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

// ── Process sfmcHookQueue written by content.js ──────────────────────────────
// Content script writes to storage (bypassing the possibly-terminated SW).
// storage.onChanged wakes the SW and lets us process each intercepted payload.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.sfmcHookQueue) return;
  const items = changes.sfmcHookQueue.newValue;
  if (!Array.isArray(items) || items.length === 0) return;
  // Clear queue immediately to avoid reprocessing
  chrome.storage.local.set({ sfmcHookQueue: [] });
  (async () => {
    const allTabs = await chrome.tabs.query({});
    const sfmcTabs = allTabs.filter(t => isSfmcTab(t));

    for (const item of items) {
      if (!item?.url || !item?.json) continue;

      let tabId = sfmcTabs[0]?.id || "hook";

      if (item.tabUrl) {
        const itemOrigin = (() => { try { return new URL(item.tabUrl).origin; } catch { return null; } })();
        // Exact match: main-frame call (mc.exacttarget.com tab visible in Chrome)
        const exactMatch = sfmcTabs.find(t => { try { return new URL(t.url).origin === itemOrigin; } catch { return false; } });
        if (exactMatch) {
          tabId = exactMatch.id;
        } else {
          // Iframe call (jbinteractions, etc.) — the visible SFMC tab is the parent.
          // Prefer the active tab, then any SFMC tab.
          const activeMatch = sfmcTabs.find(t => t.active) || sfmcTabs[0];
          if (activeMatch) tabId = activeMatch.id;
        }
      }

      await handleInteractionPayload(tabId, item.url, item.json).catch(() => null);
    }
  })();
});

// ── Debugger (network capture) ──────────────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const session = debuggerSessions.get(tabId);
  if (!session) return;

  if (method === "Network.requestWillBeSent") {
    const url = params?.request?.url || "";
    if (shouldTraceUrl(url, session.mode)) {
      appendTrace(tabId, {
        ts: Date.now(),
        method: params.request.method,
        url: sanitizeHostPath(url),
        fullUrl: url,
        postData: sanitizeBody(params.request.postData || "")
      });
    }
  }

  if (method === "Network.responseReceived") {
    const url = params?.response?.url || "";
    const mimeType = params?.response?.mimeType || "";
    if (shouldTraceUrl(url, session.mode) && /json|javascript|text/i.test(mimeType || "json")) {
      session.requests.set(params.requestId, { url, status: params.response.status });
    }
  }

  if (method === "Network.loadingFinished") {
    const request = session.requests.get(params.requestId);
    if (!request) return;
    chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId: params.requestId }, response => {
      const err = chrome.runtime.lastError;
      if (err) { appendDebug(tabId, `Body unavailable: ${err.message}`); return; }
      try {
        const text = response.base64Encoded ? atob(response.body || "") : response.body || "";
        if (request.status >= 400) storeNetworkError(tabId, request, text);
        const json = JSON.parse(text);
        handleInteractionPayload(tabId, request.url, json);
      } catch (error) {
        appendDebug(tabId, `JSON parse failed: ${error.message}`);
      }
    });
  }
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId) debuggerSessions.delete(source.tabId);
});

async function startNetworkCapture(tabId, mode = "journey", timeoutMs = null) {
  if (!tabId) throw new Error("Missing tab id");
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    if (!/Another debugger is already attached/i.test(error.message || "")) throw error;
  }
  debuggerSessions.set(tabId, { startedAt: Date.now(), mode, requests: new Map() });
  await chrome.debugger.sendCommand(target, "Network.enable", { maxResourceBufferSize: 1024 * 1024 * 20, maxTotalBufferSize: 1024 * 1024 * 80 });
  await chrome.debugger.sendCommand(target, "Page.enable");
  await updateTabState(tabId, { captureStatus: "running", captureMode: mode, captureStartedAt: Date.now(), debug: [], traces: [] });
  appendDebug(tabId, `${mode} capture started.`);
  // -1 = no timeout (auto-capture mode); null/0 = default timeout
  const duration = timeoutMs === -1 ? -1 : (Number(timeoutMs) || (mode === "sql" ? 60000 : 20000));
  if (duration > 0) setTimeout(() => stopNetworkCapture(tabId), duration);
  return { ok: true };
}

async function stopNetworkCapture(tabId) {
  if (!debuggerSessions.has(tabId)) return;
  debuggerSessions.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
  await updateTabState(tabId, { captureStatus: "done", captureFinishedAt: Date.now() });
  appendDebug(tabId, "Capture finished.");
}

// ── SFMC fetch helpers ───────────────────────────────────────────────────────

async function fetchSfmcWithCookies({ url, method = "GET", body = null, tabId, silent = false }) {
  const candidates = await findCookieTabCandidates(url, tabId);
  if (!candidates.length) throw new Error(`No open SFMC tab with cookies for ${safeHostname(url)}.`);
  let lastError = null;
  for (const candidateTabId of candidates) {
    try { return await executeFetchInTab(candidateTabId, url, method, body, silent); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Cookie fetch failed");
}

// Find the jbinteractions iframe frame within a tab using webNavigation.
// Returns null if webNavigation permission is absent or frame is not found.
async function getJbinteractionsFrame(tabId) {
  try {
    return await new Promise(resolve => {
      chrome.webNavigation.getAllFrames({ tabId }, frames => {
        const jb = (frames || []).find(f => /jbinteractions/.test(f.url || ""));
        resolve(jb || null);
      });
    });
  } catch { return null; }
}

// Fetch a jbinteractions URL using the iframe's content script (same-origin, no CORS).
// Falls back to the standard cookie-based fetch if the frame is not found.
// Pass silent=true to suppress error logging (for exploratory/optional fetches).
async function fetchSfmcFromJbinteractions({ url, tabId, silent = false }) {
  const frame = tabId ? await getJbinteractionsFrame(tabId) : null;
  if (frame) {
    try {
      const payload = await chrome.tabs.sendMessage(tabId, { type: "SFMC_BUDDY_FETCH_JSON", url }, { frameId: frame.frameId });
      if (payload && !payload.error) {
        let data;
        try { data = JSON.parse(payload.text); } catch { data = { raw: payload.text }; }
        if (!payload.ok) {
          if (!silent) storeGlobalError({ url: sanitizeHostPath(url), fullUrl: url, status: payload.status, message: String(payload.text || "").slice(0, 500), capturedAt: Date.now() });
          throw new Error(`HTTP ${payload.status}: ${String(payload.text || "").slice(0, 180)}`);
        }
        return { ok: true, data, status: payload.status };
      }
    } catch { /* fall through to regular fetch */ }
  }
  return fetchSfmcWithCookies({ url, tabId, silent });
}

// NEW: POST fetch with JSON body — used for Journey History search
async function fetchSfmcPost({ url, body, tabId }) {
  const candidates = await findCookieTabCandidates(url, tabId);
  if (!candidates.length) throw new Error(`No open SFMC tab with cookies for ${safeHostname(url)}.`);
  let lastError = null;
  for (const candidateTabId of candidates) {
    try { return await executeFetchInTab(candidateTabId, url, "POST", body); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("POST fetch failed");
}

async function fetchSfmcSoap({ url, xmlTemplate, tabId }) {
  // Inject the SOAP POST into the SFMC tab itself (same-origin → no CORS, tab has valid cookies).
  // The SW cannot reach mc.*.exacttarget.com/Service.asmx directly, but the tab can.
  const candidates = await findCookieTabCandidates(url, tabId);
  const candidateTabId = candidates[0];
  if (!candidateTabId) throw new Error("No SFMC tab found for SOAP request");

  // Extract bearer token to embed in <fueloauth>
  const tokenHeaders = await getSfmcHeadersFromTab(candidateTabId);
  const bearerToken = (tokenHeaders.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearerToken) throw new Error("Could not extract SFMC bearer token for SOAP request");

  const soapBody = String(xmlTemplate).replace("{{BEARER}}", bearerToken);

  // Run fetch inside the SFMC tab (MAIN world) — same origin, no CSP/CORS issues
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: candidateTabId },
      world: "MAIN",
      func: async (soapUrl, body) => {
        try {
          const origFetch = window.__sfmcBuddyOrigFetch || window.fetch;
          const response = await origFetch(soapUrl, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
              "SOAPAction": "Create",
            },
            body,
          });
          const text = await response.text();
          return { ok: response.ok, status: response.status, text };
        } catch (e) {
          return { ok: false, status: 0, text: "", error: String(e) };
        }
      },
      args: [url, soapBody],
    });
  } catch (injErr) {
    throw new Error(`SOAP script injection failed: ${injErr.message}`);
  }

  const result = results?.[0]?.result;
  if (!result) throw new Error("SOAP script injection returned no result");
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${result.text.slice(0, 200)}`);
  return { ok: true, data: { raw: result.text }, status: result.status };
}

const SFMC_HOST_RE = /exacttarget\.com|marketingcloudapps\.com|marketingcloudapis\.com|exacttargetapis\.com|salesforce\.com/i;
// Stricter check — only real SFMC MC instances (mc.*, jbinteractions.*, exacttarget.com, marketingcloud*).
// Excludes help.salesforce.com, trailhead.salesforce.com, etc. which match SFMC_HOST_RE but lack SFMC cookies.
const SFMC_MC_HOST_RE = /(?:^|\.)(?:mc\.|exacttarget\.com|marketingcloudapps\.com|marketingcloudapis\.com|exacttargetapis\.com)/i;

function isSfmcTab(tab) {
  try {
    const hostname = new URL(tab.url).hostname;
    return tab && Number.isInteger(tab.id) && (SFMC_MC_HOST_RE.test(hostname) || /mc\.\w/.test(hostname));
  } catch { return false; }
}

async function findCookieTabCandidates(url, preferredTabId) {
  const targetOrigin = safeOrigin(url);
  if (!targetOrigin) return [];

  // If a specific tab was requested, always try it first — it's the tab the user is looking at.
  // Don't restrict to the candidates list; the stored tabId IS the correct SFMC tab.
  if (preferredTabId) {
    const tabs = await chrome.tabs.query({});
    const isSfmcTarget = SFMC_HOST_RE.test(safeHostname(url));
    let rest;
    if (isSfmcTarget) {
      const exactMatch = tabs.filter(t => isSfmcTab(t) && safeOrigin(t.url) === targetOrigin && t.id !== preferredTabId).map(t => t.id);
      const anyMatch   = tabs.filter(t => isSfmcTab(t) && safeOrigin(t.url) !== targetOrigin && t.id !== preferredTabId).map(t => t.id);
      rest = [...exactMatch, ...anyMatch];
    } else {
      rest = tabs.filter(t => Number.isInteger(t.id) && safeOrigin(t.url) === targetOrigin && t.id !== preferredTabId).map(t => t.id);
    }
    return [preferredTabId, ...rest];
  }

  const tabs = await chrome.tabs.query({});
  const isSfmcTarget = SFMC_HOST_RE.test(safeHostname(url));
  if (isSfmcTarget) {
    const exactMatch = tabs.filter(t => isSfmcTab(t) && safeOrigin(t.url) === targetOrigin).map(t => t.id);
    const anyMatch   = tabs.filter(t => isSfmcTab(t) && safeOrigin(t.url) !== targetOrigin).map(t => t.id);
    return [...exactMatch, ...anyMatch];
  }
  return tabs.filter(t => Number.isInteger(t.id) && safeOrigin(t.url) === targetOrigin).map(t => t.id);
}

async function getSfmcHeadersFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const readStorage = key => {
        try { return window.localStorage.getItem(key) || window.sessionStorage.getItem(key); } catch { return null; }
      };
      const sanitizeToken = raw => {
        const v = String(raw || "").trim();
        return (!v || v === "null" || v === "undefined") ? null : v;
      };
      const extractBearer = raw => {
        if (!raw) return null;
        const text = String(raw);
        const bearerMatch = text.match(/Bearer\s+([A-Za-z0-9\-_=]+(?:\.[A-Za-z0-9\-_=]+){2,})/i);
        if (bearerMatch) return `Bearer ${bearerMatch[1]}`;
        const jwtMatch = text.match(/\b([A-Za-z0-9\-_]+(?:\.[A-Za-z0-9\-_]+){2,})\b/);
        if (jwtMatch) return `Bearer ${jwtMatch[1]}`;
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            for (const key of ["authorization","accessToken","access_token","token","jwt"]) {
              const candidate = parsed[key];
              if (candidate) {
                const nested = extractBearer(candidate);
                if (nested) return nested;
              }
            }
          }
        } catch {
          return null;
        }
        return null;
      };
      const findTokenInStorage = pattern => {
        for (const storage of [window.localStorage, window.sessionStorage]) {
          try {
            for (let i = 0; i < storage.length; i++) {
              const key = storage.key(i);
              if (!pattern.test(String(key || ""))) continue;
              const token = sanitizeToken(storage.getItem(key));
              if (token) return token;
            }
          } catch { }
        }
        return null;
      };
      const findAuthorizationHeader = () => {
        for (const key of ["token","accessToken","access_token","authToken","authorization","jwt","platformAuthToken"]) {
          const hit = readStorage(key);
          const token = extractBearer(hit);
          if (token) return token;
        }
        for (const storage of [window.localStorage, window.sessionStorage]) {
          try {
            for (let i = 0; i < storage.length; i++) {
              const key = storage.key(i);
              const value = storage.getItem(key);
              const token = extractBearer(value);
              if (token) return token;
            }
          } catch { }
        }
        return null;
      };
      const findCsrfToken = () => {
        for (const key of ["x-csrf-token","csrfToken","csrf_token","_csrf","fuelCsrfToken"]) {
          const hit = readStorage(key);
          const token = sanitizeToken(hit);
          if (token) return token;
        }
        const metaToken = document.querySelector("meta[name='csrf-token'], meta[name='x-csrf-token'], meta[name='_csrf']")?.content;
        if (sanitizeToken(metaToken)) return sanitizeToken(metaToken);
        return findTokenInStorage(/csrf/i);
      };
      const findFuelDataVersion = () => {
        for (const key of ["x-fueldata-version","fueldataVersion","fuelDataVersion"]) {
          const hit = readStorage(key);
          const version = sanitizeToken(hit);
          if (version) return version;
        }
        return "1.1";
      };
      return {
        authorization: findAuthorizationHeader(),
        csrfToken: findCsrfToken(),
        fuelDataVersion: findFuelDataVersion(),
      };
    }
  });
  return result?.result || {};
}

async function executeFetchInBackground(tabId, url, method, body, silent = false) {
  const tokenHeaders = await getSfmcHeadersFromTab(tabId);
  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (tokenHeaders.authorization) headers.Authorization = tokenHeaders.authorization;
  if (tokenHeaders.csrfToken) headers["x-csrf-token"] = tokenHeaders.csrfToken;
  if (tokenHeaders.fuelDataVersion) headers["x-fueldata-version"] = tokenHeaders.fuelDataVersion;
  if (body !== null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
  }
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body !== null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    if (!silent) storeGlobalError({ url: sanitizeHostPath(url), fullUrl: url, status: response.status, message: String(text || "").slice(0, 500), capturedAt: Date.now() });
    throw new Error(`HTTP ${response.status}: ${String(text || "").slice(0, 180)}`);
  }
  return { ok: true, data, status: response.status };
}

async function executeFetchInTab(tabId, url, method, body, silent = false) {
  try {
    const payload = await chrome.tabs.sendMessage(tabId, {
      type: "SFMC_BUDDY_FETCH_JSON",
      url,
      method,
      body,
    });
    if (payload && !payload.error) {
      let data;
      try { data = JSON.parse(payload.text); } catch { data = { raw: payload.text }; }
      if (!payload.ok) {
        if (!silent) storeGlobalError({ url: sanitizeHostPath(url), fullUrl: url, status: payload.status, message: String(payload.text || "").slice(0, 500), capturedAt: Date.now() });
        throw new Error(`HTTP ${payload.status}: ${String(payload.text || "").slice(0, 180)}`);
      }
      return { ok: true, data, status: payload.status };
    }
  } catch (error) {
    // Fall back to background fetch and script injection when the content-script bridge is unavailable.
  }

  try {
    return await executeFetchInBackground(tabId, url, method, body, silent);
  } catch (error) {
    // If the background fetch cannot resolve the request, fall back to a page-context fetch.
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (fetchUrl, fetchMethod, fetchBody) => {
      try {
        const readStorage = key => { try { return window.localStorage.getItem(key) || window.sessionStorage.getItem(key); } catch { return null; } };
        const sanitizeToken = raw => { const v = String(raw || "").trim(); return (!v || v === "null" || v === "undefined") ? null : v; };
        const findToken = pattern => {
          for (const storage of [window.localStorage, window.sessionStorage]) {
            try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (!pattern.test(String(k || ""))) continue; const t = sanitizeToken(storage.getItem(k)); if (t) return t; } } catch { /* ignore */ }
          }
          return null;
        };
        const extractBearer = raw => {
          if (!raw) return null;
          const text = String(raw);
          const m = text.match(/Bearer\s+([A-Za-z0-9\-_.]+)/i);
          if (m) return `Bearer ${m[1]}`;
          const j = text.match(/\b([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\b/);
          if (j && j[1].length > 40) return `Bearer ${j[1]}`;
          try { const p = JSON.parse(text); for (const k of ["authorization","accessToken","access_token","token","jwt"]) { const r = extractBearer(p?.[k]); if (r) return r; } } catch { /* */ }
          return null;
        };
        const headers = { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" };
        // Authorization
        for (const k of ["token","accessToken","access_token","authToken","authorization","jwt","platformAuthToken"]) { const tok = extractBearer(readStorage(k)); if (tok) { headers.Authorization = tok; break; } }
        if (!headers.Authorization) { for (const storage of [window.localStorage, window.sessionStorage]) { try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); const tok = extractBearer(storage.getItem(k)); if (tok) { headers.Authorization = tok; break; } } } catch { /* */ } if (headers.Authorization) break; } }
        const csrf = sanitizeToken(readStorage("x-csrf-token")) || sanitizeToken(readStorage("csrfToken")) ||
          sanitizeToken(document.querySelector("meta[name='csrf-token']")?.content) || findToken(/csrf/i);
        if (csrf) headers["x-csrf-token"] = csrf;
        const fuelVer = sanitizeToken(readStorage("x-fueldata-version")) || "1.1";
        if (fuelVer) headers["x-fueldata-version"] = fuelVer;
        if (fetchBody !== null) headers["Content-Type"] = "application/json";
        // Use the original unpatched fetch if available (avoids sfmc-hook wrapper issues)
        const fetchFn = window.__sfmcBuddyOrigFetch || window.fetch;
        const response = await fetchFn(fetchUrl, { method: fetchMethod, credentials: "include", headers, body: fetchBody !== null ? JSON.stringify(fetchBody) : undefined });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: "", error: String(e?.message || e) };
      }
    },
    args: [url, method, body]
  });
  if (!result?.result) {
    const scriptErr = result?.error ? String(result.error.message || result.error) : "unknown";
    throw new Error(`Script injection failed: ${scriptErr}`);
  }
  if (result.result.error && !result.result.ok) {
    if (!silent) storeGlobalError({ url: sanitizeHostPath(url), fullUrl: url, status: 0, message: result.result.error, capturedAt: Date.now() });
    throw new Error(`Script fetch error: ${result.result.error}`);
  }
  const { ok, status, text } = result.result;
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!ok) { if (!silent) storeGlobalError({ url: sanitizeHostPath(url), fullUrl: url, status, message: text.slice(0, 500), capturedAt: Date.now() }); throw new Error(`HTTP ${status}: ${text.slice(0, 180)}`); }
  return { ok: true, data, status };
}

// ── Payload handlers ─────────────────────────────────────────────────────────

function isJourneyInteractionUrl(url) {
  return /\/interaction\/v1\/interactions/i.test(url) && /marketingcloudapis\.com|exacttargetapis\.com|marketingcloudapps\.com/i.test(url);
}

function isSfmcMetricsUrl(url) {
  return /marketingcloudapis\.com|exacttargetapis\.com|marketingcloudapps\.com/i.test(url) &&
    /interaction|journey|automation|query|sql|dataextension|data-extension|asset|folder|category|history|analytic|analytics|tracking|report|stat|performance|email|activity/i.test(url);
}

function shouldTraceUrl(url, mode) {
  if (!/exacttarget|marketingcloud|salesforce/i.test(url)) return false;
  if (mode === "sql") return /sql|query|queries|automation|dataextension|data-extension|dataextensions|folder|asset|legacy|fuelapi|platform-internal|hub|rest|execute|run/i.test(url);
  return isSfmcMetricsUrl(url);
}

async function handleInteractionPayload(tabId, url, json) {
  await storeCapturedCollection(url, json);
  if (isJourneyInteractionUrl(url) && Array.isArray(json?.items)) {
    await updateJourneyList(tabId, json.items);
    appendDebug(tabId, `Journey list captured: ${json.items.length} item(s).`);
  }
  const journey = normalizeJourney(json);
  if (journey) {
    await updateJourney(tabId, journey);
    appendDebug(tabId, `Journey detail captured: ${journey.name} v${journey.version || "--"}.`);
    notify("Journey captured", `${journey.name} v${journey.version || "--"}`);
  }
  const delivery = extractDeliverySignals(json);
  if (hasAnyDeliveryMetric(delivery)) {
    await updateDeliverySignals(tabId, delivery, url);
    appendDebug(tabId, `Delivery metrics captured from ${sanitizeHostPath(url)}.`);
  }
}

async function storeCapturedCollection(url, json) {
  const collection = inferCollectionFromUrl(url);
  if (!collection) return;
  const items = extractItems(json).map(item => normalizeCollectionItem(collection, item)).filter(Boolean);
  if (!items.length) return;
  await updateBuddyCollection(collection, items, sanitizeHostPath(url));
}

function inferCollectionFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (/\/interaction\/v1\/interactions/.test(u)) return "journeys";
  if (/\/interaction\/v1\/definitiontemplates/.test(u)) return "journeyTemplates";
  if (/automation\/v1\/automations|automationstudio/.test(u)) return "automations";
  if (/automation\/v1\/queries|querydefinition|queryactivity|sql/.test(u)) return "sqlQueries";
  if (/dataextensions|dataextension|data-extension/.test(u)) return "dataExtensions";
  if (/asset\/v1\/content\/assets|contentbuilder/.test(u)) return "assets";
  if (/asset\/v1\/content\/categories|folder|category/.test(u)) return "folders";
  return null;
}

function extractItems(json) {
  const candidates = [json?.items, json?.entry, json?.results, json?.data, json?.automations, json?.assets, json?.categories, json?.templates];
  const list = candidates.find(Array.isArray);
  if (list) return list;
  if (json && typeof json === "object" && (json.id || json.key || json.customerKey || json.objectID || json.name)) return [json];
  return [];
}

function normalizeCollectionItem(collection, item) {
  if (!item || typeof item !== "object") return null;
  const normalized = { ...item, id: item.id || item.objectID || item.automationId || item.queryDefinitionId || item.key || item.customerKey, name: item.name || item.displayName || item.assetName || item.categoryName || item.definitionName || item.key || item.customerKey || "Untitled", customerKey: item.customerKey || item.key || item.externalKey || null, status: item.status || item.statusName || item.state || item.programStatus || null, capturedAt: Date.now() };
  if (collection === "journeys") normalized.version = item.version || item.versionNumber || item.latestVersionNumber || null;
  if (collection === "automations") normalized.lastRunTime = item.lastRunTime || item.lastRunDate || item.lastRun || item.modifiedDate || null;
  return normalized.id || normalized.name ? normalized : null;
}

function normalizeJourney(raw) {
  if (!raw || !raw.id || !Array.isArray(raw.activities)) return null;
  return { id: raw.id, key: raw.key || raw.definitionId || null, name: raw.name || "Journey sans nom", version: raw.version || raw.versionNumber || raw.latestVersionNumber || null, activities: raw.activities, stats: raw.stats || {}, goals: raw.goals || [], raw, capturedAt: Date.now() };
}

// ── Delivery signals ─────────────────────────────────────────────────────────

function extractDeliverySignals(root) {
  const metrics = emptyDeliveryMetrics();
  walk(root, (key, value) => { const normalized = normalizeMetricKey(key); if (!normalized) return; const n = Number(value); if (!Number.isFinite(n)) return; metrics[normalized] += n; });
  return metrics;
}

function walk(value, visitor, key = "") {
  if (value == null) return;
  if (typeof value !== "object") { visitor(key, value); return; }
  if (Array.isArray(value)) { value.forEach(item => walk(item, visitor, key)); return; }
  for (const [childKey, childValue] of Object.entries(value)) walk(childValue, visitor, childKey);
}

function normalizeMetricKey(key) {
  const k = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const map = { sent: "sent", sends: "sent", totalsent: "sent", emailsent: "sent", delivered: "delivered", deliveries: "delivered", totaldelivered: "delivered", opens: "opens", open: "opens", totalopens: "opens", uniqueopens: "uniqueOpens", uniqueopen: "uniqueOpens", clicks: "clicks", click: "clicks", totalclicks: "clicks", uniqueclicks: "uniqueClicks", uniqueclick: "uniqueClicks", bounces: "bounces", bounce: "bounces", totalbounces: "bounces", hardbounces: "hardBounces", hardbounce: "hardBounces", softbounces: "softBounces", softbounce: "softBounces", unsubscribes: "unsubs", unsubscribe: "unsubs", unsubs: "unsubs", totalunsubscribes: "unsubs", complaints: "complaints", complaint: "complaints" };
  return map[k] || null;
}

function emptyDeliveryMetrics() { return { sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0, bounces: 0, hardBounces: 0, softBounces: 0, unsubs: 0, complaints: 0 }; }
function mergeDeliveryMetrics(a, b) { const merged = emptyDeliveryMetrics(); for (const key of Object.keys(merged)) merged[key] = Math.max(Number(a?.[key] || 0), Number(b?.[key] || 0)); merged.sources = a?.sources || []; return merged; }
function hasAnyDeliveryMetric(metrics) { return Object.entries(metrics).some(([key, value]) => key !== "sources" && Number(value) > 0); }

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getState() { const data = await chrome.storage.local.get(STORAGE_KEY); return data[STORAGE_KEY] || defaultState; }
async function setState(state) { state.updatedAt = Date.now(); await chrome.storage.local.set({ [STORAGE_KEY]: state }); }

async function updateTabState(tabId, patch) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  state.tabs[key] = { journeys: {}, journeyList: [], ...state.tabs[key], ...patch, updatedAt: Date.now() };
  await setState(state);
}

async function updateJourney(tabId, journey) {
  if (!journey || !journey.id) return;
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  tabState.journeys = tabState.journeys || {};
  // Store under main id (always latest captured version)
  tabState.journeys[journey.id] = { ...tabState.journeys[journey.id], ...journey, capturedAt: Date.now() };
  // Also store a versioned copy so older versions aren't lost when a newer one is captured.
  // fetchJourneyDetail Step 1 will look for the version with the most contacts.
  if (journey.version != null) {
    const vKey = `${journey.id}_v${journey.version}`;
    tabState.journeys[vKey] = { ...journey, capturedAt: Date.now() };
  }
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function updateJourneyList(tabId, journeys) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  tabState.journeyList = journeys.map(item => ({ id: item.id, name: item.name, version: item.version || item.versionNumber || item.latestVersionNumber || null, status: item.status || null, capturedAt: Date.now() })).filter(item => item.id);
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function clearTab(tabId) { const key = String(tabId || "unknown"); const state = await getState(); if (state.tabs) delete state.tabs[key]; await setState(state); }

async function appendDebug(tabId, line) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  const debug = tabState.debug || [];
  debug.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  tabState.debug = debug.slice(-80);
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function appendTrace(tabId, entry) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  const traces = tabState.traces || [];
  const exists = traces.some(item => item.method === entry.method && item.fullUrl === entry.fullUrl && item.postData === entry.postData);
  if (!exists) traces.push(entry);
  tabState.traces = traces.slice(-200);
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function updateDeliverySignals(tabId, delivery, url) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  const current = tabState.delivery || {};
  tabState.delivery = mergeDeliveryMetrics(current, delivery);
  tabState.delivery.sources = [...new Set([...(current.sources || []), sanitizeHostPath(url)])].slice(-20);
  tabState.delivery.capturedAt = Date.now();
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function updateBuddyCollection(collection, items, source) {
  if (!collection || !Array.isArray(items)) return;
  const data = await chrome.storage.local.get(["sfmcBuddyCache"]);
  const current = data.sfmcBuddyCache || { cache: {}, updatedAt: {} };
  const existing = current.cache?.[collection] || [];
  const merged = mergeItems(existing, items.map(item => ({ ...item, source })));
  current.cache = { ...current.cache, [collection]: merged };
  current.updatedAt = { ...current.updatedAt, [collection]: Date.now() };
  await chrome.storage.local.set({ sfmcBuddyCache: current });
}

async function storeQueryStudioResult(payload) {
  const data = await chrome.storage.local.get(["sfmcBuddyQueryResults", "sfmcBuddyPendingQuery"]);
  const results = data.sfmcBuddyQueryResults || [];
  const journeyId = data.sfmcBuddyPendingQuery?.journeyId || null;
  results.push({ ...payload, journeyId, storedAt: Date.now() });
  const updates = { sfmcBuddyQueryResults: results.slice(-20) };
  if (journeyId === "__all__" && payload?.body) {
    const kpis = groupKpisByJourney(payload.body);
    if (Object.keys(kpis).length > 0) updates.sfmcBuddyJourneyKpis = { kpis, updatedAt: Date.now() };
  }
  await chrome.storage.local.set(updates);
}

function groupKpisByJourney(raw) {
  try {
    let rows;
    const trimmed = String(raw || "").trim();
    if (/<table|<thead|<tbody/i.test(trimmed)) rows = parseHtmlTable(trimmed);
    else if (trimmed.startsWith("[") || trimmed.startsWith("{")) { const parsed = JSON.parse(trimmed); rows = Array.isArray(parsed) ? parsed : [parsed]; }
    else { const lines = trimmed.split(/\r?\n/).filter(Boolean); if (lines.length < 2) return {}; const headers = splitCsvLine(lines[0]); rows = lines.slice(1).map(line => { const values = splitCsvLine(line); return headers.reduce((row, header, i) => { row[header] = values[i] || ""; return row; }, {}); }); }
    const result = {};
    for (const row of rows) {
      const jid = row.JourneyID || row.journeyid || row.JOURNEYID || "";
      if (!jid) continue;
      if (!result[jid]) result[jid] = { sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0, bounces: 0, unsubs: 0 };
      for (const [key, value] of Object.entries(row)) { const metric = normalizeMetricKey(key); if (metric && result[jid][metric] !== undefined) result[jid][metric] += Number(String(value).replace(/[^\d.-]/g, "")) || 0; }
    }
    return result;
  } catch { return {}; }
}

function parseHtmlTable(html) {
  const getTitleValues = fragment => { const out = []; const re = /class="slds-truncate"[^>]*title="([^"]*)"|title="([^"]*)"[^>]*class="slds-truncate"/gi; let m; while ((m = re.exec(fragment)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]); return out; };
  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(html); if (!theadMatch) return [];
  const headers = getTitleValues(theadMatch[1]); if (!headers.length) return [];
  const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html); if (!tbodyMatch) return [];
  const allValues = getTitleValues(tbodyMatch[1]);
  const rows = []; const n = headers.length;
  for (let i = 0; i + n <= allValues.length; i += n) { const row = {}; headers.forEach((h, j) => { row[h] = allValues[i + j] || ""; }); rows.push(row); }
  return rows;
}

function splitCsvLine(line) {
  const result = []; let current = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (char === '"') { quoted = !quoted; }
    else if (char === "," && !quoted) { result.push(current.trim()); current = ""; }
    else { current += char; }
  }
  result.push(current.trim());
  return result;
}

async function storeNetworkError(tabId, request, body) {
  notify("SFMC network error", `${request.status} ${sanitizeHostPath(request.url)}`);
  await storeGlobalError({ tabId, url: sanitizeHostPath(request.url), fullUrl: request.url, status: request.status, message: body.slice(0, 800), capturedAt: Date.now() });
}

async function storeGlobalError(error) {
  const data = await chrome.storage.local.get(["sfmcBuddyCache"]);
  const current = data.sfmcBuddyCache || { cache: {}, updatedAt: {} };
  const errors = current.cache?.errors || [];
  current.cache = { ...current.cache, errors: [error, ...errors].slice(0, 200) };
  current.updatedAt = { ...current.updatedAt, errors: Date.now() };
  await chrome.storage.local.set({ sfmcBuddyCache: current });
}

async function purgeOldData() {
  const state = await getState();
  const cutoff = Date.now() - 86400000;
  for (const [tabId, tabState] of Object.entries(state.tabs || {})) {
    if ((tabState.updatedAt || 0) < cutoff) { delete state.tabs[tabId]; continue; }
    if (tabState.traces?.length > 100) tabState.traces = tabState.traces.slice(-100);
    if (tabState.debug?.length > 50) tabState.debug = tabState.debug.slice(-50);
  }
  await setState(state);
}

function mergeItems(existing, incoming) {
  const map = new Map();
  for (const item of [...existing, ...incoming]) { const key = item.id || item.key || item.name || item.url || JSON.stringify(item).slice(0, 80); map.set(key, item); }
  return [...map.values()];
}

function notify(title, message) {
  try { chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icons/icon48.png"), title: `Sezane Monitoring - ${title}`, message: String(message || "").slice(0, 180) }); } catch { /* ignore */ }
}

function sanitizeHostPath(rawUrl) { try { const url = new URL(rawUrl); return `${url.hostname}${url.pathname}`; } catch { return String(rawUrl || "").slice(0, 160); } }
function safeOrigin(rawUrl) { try { return new URL(rawUrl).origin; } catch { return null; } }
function safeHostname(rawUrl) { try { return new URL(rawUrl).hostname; } catch { return "unknown host"; } }
function sanitizeBody(body) { return String(body || "").replace(/("?(?:token|auth|sid|session|jwt|key|secret|code|password)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3").slice(0, 3000); }
