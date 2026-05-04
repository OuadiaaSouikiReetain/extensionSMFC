// Background service worker for Manifest V3.
// Responsibilities:
// - Persist captured Journey JSON and canvas snapshots in chrome.storage.local.
// - Relay messages between content scripts and the DevTools panel.
// - Keep data keyed by inspected tab ID so multiple SFMC tabs do not overwrite each other.

const STORAGE_KEY = "sfmcProcessMinerState";

const defaultState = {
  tabs: {},
  updatedAt: Date.now()
};

const debuggerSessions = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, data => {
    if (!data[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: defaultState });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "SFMC_CANVAS_SNAPSHOT") {
    const tabId = sender.tab?.id || message.tabId || "unknown";
    updateTabState(tabId, {
      canvas: message.payload,
      pageUrl: sender.tab?.url || message.payload?.url || null,
      lastCanvasAt: Date.now()
    }).then(() => sendResponse({ ok: true }));
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
    updateTabState(message.tabId, {
      session: message.session,
      pageUrl: message.session?.url || null,
      lastSessionAt: Date.now()
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PANEL_GET_STATE") {
    getState().then(state => {
      sendResponse({
        ok: true,
        state: state.tabs?.[message.tabId] || null
      });
    });
    return true;
  }

  if (message.type === "PANEL_CLEAR_TAB") {
    clearTab(message.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "POPUP_START_CAPTURE") {
    startNetworkCapture(message.tabId, message.mode || "journey").then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "FETCH_SFMC") {
    fetchSfmc(message).then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: error.message });
    });
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

  return false;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const session = debuggerSessions.get(tabId);
  if (!session) return;

  if (method === "Network.requestWillBeSent") {
    const url = params?.request?.url || "";
    if (shouldTraceUrl(url, session.mode)) {
      const entry = {
        ts: Date.now(),
        method: params.request.method,
        url: sanitizeHostPath(url),
        fullUrl: url,
        postData: sanitizeBody(params.request.postData || "")
      };
      appendTrace(tabId, entry);
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
    chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
      requestId: params.requestId
    }, response => {
      const err = chrome.runtime.lastError;
      if (err) {
        appendDebug(tabId, `Body unavailable: ${err.message}`);
        return;
      }
      try {
        const text = response.base64Encoded ? atob(response.body || "") : response.body || "";
        if (request.status >= 400) {
          storeNetworkError(tabId, request, text);
        }
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

async function startNetworkCapture(tabId, mode = "journey") {
  if (!tabId) throw new Error("Missing tab id");
  const target = { tabId };

  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    if (!/Another debugger is already attached/i.test(error.message || "")) throw error;
  }

  debuggerSessions.set(tabId, {
    startedAt: Date.now(),
    mode,
    requests: new Map()
  });

  await chrome.debugger.sendCommand(target, "Network.enable", {
    maxResourceBufferSize: 1024 * 1024 * 20,
    maxTotalBufferSize: 1024 * 1024 * 80
  });
  await chrome.debugger.sendCommand(target, "Page.enable");
  await updateTabState(tabId, { captureStatus: "running", captureMode: mode, captureStartedAt: Date.now(), debug: [], traces: [] });
  appendDebug(tabId, `${mode} capture started.`);
  if (mode === "journey") {
    appendDebug(tabId, "Reloading SFMC tab.");
    await chrome.tabs.reload(tabId);
  } else {
    appendDebug(tabId, "Trace is running. Perform the SQL/Data Extension action in SFMC now.");
  }

  setTimeout(() => stopNetworkCapture(tabId), mode === "sql" ? 60000 : 20000);
  return { ok: true };
}

async function fetchSfmc({ url, method = "GET", body = null }) {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    storeGlobalError({
      url: sanitizeHostPath(url),
      fullUrl: url,
      status: response.status,
      message: text.slice(0, 500),
      capturedAt: Date.now()
    });
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  return { ok: true, data, status: response.status };
}

async function stopNetworkCapture(tabId) {
  if (!debuggerSessions.has(tabId)) return;
  debuggerSessions.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The debugger may already be detached by Chrome or the user.
  }
  await updateTabState(tabId, { captureStatus: "done", captureFinishedAt: Date.now() });
  appendDebug(tabId, "Capture finished.");
}

function isJourneyInteractionUrl(url) {
  return /\/interaction\/v1\/interactions/i.test(url) &&
    /marketingcloudapis\.com|exacttargetapis\.com|marketingcloudapps\.com/i.test(url);
}

function isSfmcMetricsUrl(url) {
  return /marketingcloudapis\.com|exacttargetapis\.com|marketingcloudapps\.com/i.test(url) &&
    /interaction|journey|history|analytic|analytics|tracking|report|stat|performance|email|activity/i.test(url);
}

function shouldTraceUrl(url, mode) {
  if (!/exacttarget|marketingcloud|salesforce/i.test(url)) return false;
  if (mode === "sql") {
    return /sql|query|queries|automation|dataextension|data-extension|dataextensions|folder|asset|legacy|fuelapi|platform-internal|hub|rest|execute|run/i.test(url);
  }
  return isSfmcMetricsUrl(url);
}

async function handleInteractionPayload(tabId, url, json) {
  if (Array.isArray(json?.items)) {
    await updateJourneyList(tabId, json.items);
    appendDebug(tabId, `Journey list captured: ${json.items.length} item(s).`);
  }

  const journey = normalizeJourney(json);
  if (journey) {
    await updateJourney(tabId, journey);
    appendDebug(tabId, `Journey detail captured: ${journey.name} v${journey.version || "--"}.`);
  }

  const delivery = extractDeliverySignals(json);
  if (hasAnyDeliveryMetric(delivery)) {
    await updateDeliverySignals(tabId, delivery, url);
    appendDebug(tabId, `Delivery metrics captured from ${sanitizeHostPath(url)}.`);
  }
}

function normalizeJourney(raw) {
  if (!raw || !raw.id || !Array.isArray(raw.activities)) return null;
  return {
    id: raw.id,
    key: raw.key || raw.definitionId || null,
    name: raw.name || "Journey sans nom",
    version: raw.version || raw.versionNumber || raw.latestVersionNumber || null,
    activities: raw.activities,
    stats: raw.stats || {},
    goals: raw.goals || [],
    raw,
    capturedAt: Date.now()
  };
}

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

function extractDeliverySignals(root) {
  const metrics = emptyDeliveryMetrics();
  walk(root, (key, value) => {
    const normalized = normalizeMetricKey(key);
    if (!normalized) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    metrics[normalized] += n;
  });
  return metrics;
}

function walk(value, visitor, key = "") {
  if (value == null) return;
  if (typeof value !== "object") {
    visitor(key, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => walk(item, visitor, key));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visitor, childKey);
  }
}

function normalizeMetricKey(key) {
  const k = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const map = {
    sent: "sent", sends: "sent", totalsent: "sent", emailsent: "sent", emailssent: "sent",
    delivered: "delivered", deliveries: "delivered", totaldelivered: "delivered",
    opens: "opens", open: "opens", totalopens: "opens",
    uniqueopens: "uniqueOpens", uniqueopen: "uniqueOpens",
    clicks: "clicks", click: "clicks", totalclicks: "clicks",
    uniqueclicks: "uniqueClicks", uniqueclick: "uniqueClicks",
    bounces: "bounces", bounce: "bounces", totalbounces: "bounces",
    hardbounces: "hardBounces", hardbounce: "hardBounces",
    softbounces: "softBounces", softbounce: "softBounces",
    unsubscribes: "unsubs", unsubscribe: "unsubs", unsubs: "unsubs", totalunsubscribes: "unsubs",
    complaints: "complaints", complaint: "complaints", spamcomplaints: "complaints"
  };
  return map[k] || null;
}

function emptyDeliveryMetrics() {
  return {
    sent: 0,
    delivered: 0,
    opens: 0,
    uniqueOpens: 0,
    clicks: 0,
    uniqueClicks: 0,
    bounces: 0,
    hardBounces: 0,
    softBounces: 0,
    unsubs: 0,
    complaints: 0
  };
}

function mergeDeliveryMetrics(a, b) {
  const merged = emptyDeliveryMetrics();
  for (const key of Object.keys(merged)) {
    merged[key] = Math.max(Number(a?.[key] || 0), Number(b?.[key] || 0));
  }
  merged.sources = a?.sources || [];
  return merged;
}

function hasAnyDeliveryMetric(metrics) {
  return Object.entries(metrics).some(([key, value]) => key !== "sources" && Number(value) > 0);
}

function sanitizeHostPath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return String(rawUrl || "").slice(0, 160);
  }
}

function sanitizeBody(body) {
  return String(body || "")
    .replace(/("?(?:token|auth|sid|session|jwt|key|secret|code|password)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .slice(0, 3000);
}

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || defaultState;
}

async function setState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function updateTabState(tabId, patch) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  state.tabs[key] = {
    journeys: {},
    journeyList: [],
    ...state.tabs[key],
    ...patch,
    updatedAt: Date.now()
  };
  await setState(state);
}

async function updateJourney(tabId, journey) {
  if (!journey || !journey.id) return;
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  tabState.journeys = tabState.journeys || {};
  tabState.journeys[journey.id] = {
    ...tabState.journeys[journey.id],
    ...journey,
    capturedAt: Date.now()
  };
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function updateJourneyList(tabId, journeys) {
  const key = String(tabId || "unknown");
  const state = await getState();
  state.tabs = state.tabs || {};
  const tabState = state.tabs[key] || { journeys: {}, journeyList: [] };
  tabState.journeyList = journeys.map(item => ({
    id: item.id,
    name: item.name,
    version: item.version || item.versionNumber || item.latestVersionNumber || null,
    status: item.status || null,
    capturedAt: Date.now()
  })).filter(item => item.id);
  tabState.updatedAt = Date.now();
  state.tabs[key] = tabState;
  await setState(state);
}

async function clearTab(tabId) {
  const key = String(tabId || "unknown");
  const state = await getState();
  if (state.tabs) delete state.tabs[key];
  await setState(state);
}

async function storeQueryStudioResult(payload) {
  const data = await chrome.storage.local.get(["sfmcBuddyQueryResults", "sfmcBuddyPendingQuery"]);
  const results = data.sfmcBuddyQueryResults || [];
  const journeyId = data.sfmcBuddyPendingQuery?.journeyId || null;
  results.push({ ...payload, journeyId, storedAt: Date.now() });

  const updates = { sfmcBuddyQueryResults: results.slice(-20) };

  if (journeyId === "__all__" && payload?.body) {
    const kpis = groupKpisByJourney(payload.body);
    if (Object.keys(kpis).length > 0) {
      updates.sfmcBuddyJourneyKpis = { kpis, updatedAt: Date.now() };
    }
  }

  await chrome.storage.local.set(updates);
}

function groupKpisByJourney(raw) {
  try {
    let rows;
    const trimmed = String(raw || "").trim();
    if (/<table|<thead|<tbody/i.test(trimmed)) {
      rows = parseHtmlTable(trimmed);
    } else if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      const lines = trimmed.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return {};
      const headers = splitCsvLine(lines[0]);
      rows = lines.slice(1).map(line => {
        const values = splitCsvLine(line);
        return headers.reduce((row, header, i) => { row[header] = values[i] || ""; return row; }, {});
      });
    }
    const result = {};
    for (const row of rows) {
      const jid = row.JourneyID || row.journeyid || row.JOURNEYID || "";
      if (!jid) continue;
      if (!result[jid]) result[jid] = { sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0, bounces: 0, unsubs: 0 };
      for (const [key, value] of Object.entries(row)) {
        const metric = normalizeMetricKey(key);
        if (metric && result[jid][metric] !== undefined) {
          result[jid][metric] += Number(String(value).replace(/[^\d.-]/g, "")) || 0;
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseHtmlTable(html) {
  const getTitleValues = fragment => {
    const out = [];
    const re = /class="slds-truncate"[^>]*title="([^"]*)"|title="([^"]*)"[^>]*class="slds-truncate"/gi;
    let m;
    while ((m = re.exec(fragment)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  };
  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(html);
  if (!theadMatch) return [];
  const headers = getTitleValues(theadMatch[1]);
  if (!headers.length) return [];
  const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html);
  if (!tbodyMatch) return [];
  const allValues = getTitleValues(tbodyMatch[1]);
  const rows = [];
  const n = headers.length;
  for (let i = 0; i + n <= allValues.length; i += n) {
    const row = {};
    headers.forEach((h, j) => { row[h] = allValues[i + j] || ""; });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
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

async function storeNetworkError(tabId, request, body) {
  await storeGlobalError({
    tabId,
    url: sanitizeHostPath(request.url),
    fullUrl: request.url,
    status: request.status,
    message: body.slice(0, 800),
    capturedAt: Date.now()
  });
}

async function storeGlobalError(error) {
  const data = await chrome.storage.local.get(["sfmcBuddyCache"]);
  const current = data.sfmcBuddyCache || { cache: {}, updatedAt: {} };
  const errors = current.cache?.errors || [];
  current.cache = {
    ...current.cache,
    errors: [error, ...errors].slice(0, 200)
  };
  current.updatedAt = { ...current.updatedAt, errors: Date.now() };
  await chrome.storage.local.set({ sfmcBuddyCache: current });
}

function mergeItems(existing, incoming) {
  const map = new Map();
  for (const item of [...existing, ...incoming]) {
    const key = item.id || item.key || item.name || item.url || JSON.stringify(item).slice(0, 80);
    map.set(key, item);
  }
  return [...map.values()];
}
