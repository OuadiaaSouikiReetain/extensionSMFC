// SFMC Buddy v2.2.0 — Content script (injected into SFMC pages)
// New: mineStorageData() extracts monitoring data from localStorage/sessionStorage

(function () {
  "use strict";

  const SFMC_HOST_RE = /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i;
  const ACTIVITY_SELECTOR = [".activity.wait",".activity.email",".activity.split",".activity.sms",".activity.push",".activity.linearmessage",".activity.randomsplit",".activity.engagementsplit",".activity.updatecontact",".activity.dataextension",".activity.fireeventsource",".activity.custom","[class*='activity-']","[data-activity-type]"].join(", ");

  let lastSignature = "";
  let debounceTimer = null;
  let lastMineSignature = "";

  if (!SFMC_HOST_RE.test(location.hostname + location.pathname)) return;

  // ── Safe send — stops everything if extension context is invalidated ───────
  let _dead = false;
  function safeSend(msg) {
    if (_dead) return;
    try {
      if (!chrome.runtime?.id) { _dead = true; cleanup(); return; }
      chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (e) {
      if (/invalidated|Extension context/i.test(e?.message || "")) { _dead = true; cleanup(); }
    }
  }

  function cleanup() {
    observer.disconnect();
    clearInterval(_snapshotInterval);
    clearInterval(_mineInterval);
  }

  // ── Receive payloads from sfmc-hook.js (world MAIN) ───────────────────────
  // Write directly to chrome.storage — no background service worker needed.
  window.addEventListener("message", event => {
    if (!event.data?.__sfmcBuddy || event.source !== window) return;
    try {
      chrome.storage.local.get("sfmcHookQueue", data => {
        if (chrome.runtime.lastError) return;
        const queue = Array.isArray(data.sfmcHookQueue) ? data.sfmcHookQueue : [];
        queue.push({ url: event.data.url, json: event.data.json, ts: Date.now(), tabUrl: window.location.href });
        if (queue.length > 100) queue.splice(0, queue.length - 100);
        chrome.storage.local.set({ sfmcHookQueue: queue });
      });
    } catch { /* context invalidated */ }
  });

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "SFMC_BUDDY_FETCH_JSON") return false;
    const requestUrl = String(message.url || "");
    const method = String(message.method || "GET").toUpperCase();
    const body = message.body ?? null;
    const headers = buildSfmcHeaders();
    if (body !== null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json;charset=UTF-8";
    }
    fetch(requestUrl, { method, credentials: "include", headers, body: body !== null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined })
      .then(async response => {
        const text = await response.text();
        sendResponse({ ok: response.ok, status: response.status, text, url: requestUrl, authUsed: Boolean(headers.Authorization) });
      })
      .catch(error => {
        sendResponse({ ok: false, status: 0, error: error?.message || String(error), url: requestUrl, authUsed: Boolean(headers.Authorization) });
      });
    return true;
  });

  // ── Canvas snapshot ────────────────────────────────────────────────────────

  function scheduleSnapshot(reason) { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => sendSnapshot(reason), 350); }

  function sendSnapshot(reason) {
    const activities = collectCanvasActivities();
    exposeActivityKeys(activities);
    extractPublicationLists();
    const payload = { url: location.href, title: document.title, reason, stack: detectSfmcStack(location.href), activities, capturedAt: Date.now() };
    const signature = JSON.stringify({ url: payload.url, activities: activities.map(item => `${item.key}:${item.type}:${item.name}`) });
    if (signature === lastSignature) return;
    lastSignature = signature;
    safeSend({ type: "SFMC_CANVAS_SNAPSHOT", payload });
  }

  function collectCanvasActivities() {
    return [...document.querySelectorAll(ACTIVITY_SELECTOR)].map((node, index) => {
      const host = node.closest("[data-activity-key]") || node;
      const key = host.getAttribute("data-activity-key") || node.getAttribute("data-activity-key") || node.dataset.activityKey || `activity-${index + 1}`;
      return { key, name: readActivityName(node), type: inferActivityType(node), domIndex: index, classes: node.className || "" };
    });
  }

  function exposeActivityKeys(activities) {
    // Badge injection disabled — was breaking Journey Builder canvas rendering
    if (activities.length) safeSend({ type: "SFMC_BUDDY_COLLECTION", collection: "canvasActivities", items: activities, source: location.href });
  }

  function extractPublicationLists() {
    if (!/publication/i.test(location.href + " " + document.body.innerText.slice(0, 2000))) return;
    const rows = [...document.querySelectorAll("tr, [role='row'], li")];
    const lists = rows.map(row => { const text = row.textContent.replace(/\s+/g, " ").trim(); if (!text || !/\d/.test(text)) return null; const id = findId(row); if (!id) return null; const name = text.replace(String(id), "").trim().slice(0, 180); addInlineId(row, id); return { id, name: name || text, capturedAt: Date.now(), url: location.href }; }).filter(Boolean);
    const unique = dedupe(lists, item => item.id);
    if (unique.length) safeSend({ type: "SFMC_BUDDY_COLLECTION", collection: "publicationLists", items: unique, source: location.href });
  }

  // ── Storage mining (NEW) ──────────────────────────────────────────────────

  function mineStorageData() {
    const result = {
      userProfile: {},
      businessUnit: {},
      accountSettings: {},
      featureFlags: {},
      recentErrors: [],
      automationHistory: [],
      journeyDrafts: [],
      sessionMetadata: {},
      minedAt: Date.now()
    };

    const allEntries = [];
    for (const [storageObj, source] of [[window.localStorage, "local"], [window.sessionStorage, "session"]]) {
      try {
        for (let i = 0; i < storageObj.length; i++) {
          const key = storageObj.key(i);
          const raw = storageObj.getItem(key);
          if (!raw) continue;
          allEntries.push({ key, raw, source });
        }
      } catch { /* cross-origin storage blocked */ }
    }

    for (const { key, raw } of allEntries) {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      classifyEntry(key, parsed, raw, result);
    }

    // Session metadata extras
    result.sessionMetadata.sfmcStack = detectSfmcStack(location.href);
    result.sessionMetadata.pageContext = detectPageContext(location.href);
    result.sessionMetadata.pageUrl = location.href;

    // Only send if data changed
    const signature = JSON.stringify(result.userProfile) + JSON.stringify(result.businessUnit);
    if (signature === lastMineSignature) return;
    lastMineSignature = signature;

    safeSend({ type: "SFMC_BUDDY_STORAGE_MINED", payload: result, url: location.href });
  }

  function classifyEntry(key, parsed, raw, result) {
    const k = String(key || "").toLowerCase();

    // ── User profile ──────────────────────────────────────────────────────
    if (/user|profile|currentuser|loggedin|identity|account|me\b/i.test(k)) {
      if (/userid|user_id|\buid\b|\bsub\b/i.test(k)) result.userProfile.userId = safeStr(parsed);
      else if (/username|displayname|fullname|\bname\b/i.test(k)) result.userProfile.userName = safeStr(parsed);
      else if (/email|login/i.test(k) && !/emailsent/i.test(k)) result.userProfile.userEmail = safeStr(parsed);
      else if (/roles|permissions|grantedroles/i.test(k)) result.userProfile.userRoles = safeArray(parsed);
      else if (/\bmid\b|legacymid|memberid/i.test(k)) result.userProfile.legacyMid = safeStr(parsed);
      else if (/stackkey|\bstack\b/i.test(k)) result.userProfile.stackKey = safeStr(parsed);
      else if (/orgid|organizationid|sforgid/i.test(k)) result.userProfile.organizationId = safeStr(parsed);
      else if (/enterpriseid|eid|enterprise_id/i.test(k)) result.userProfile.enterpriseId = safeStr(parsed);
      else if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        // Try to extract from nested object
        extractFromObject(parsed, result.userProfile, { userId: /userId|user_id|sub|uid/, userName: /userName|displayName|fullName|name/, userEmail: /email|login/, legacyMid: /\bmid\b|legacyMid|memberId/, stackKey: /stackKey|stack/, organizationId: /orgId|organizationId/ });
      }
    }

    // ── Business Unit ─────────────────────────────────────────────────────
    if (/\bbu\b|businessunit|accountinfo|org|tenant/i.test(k)) {
      if (/buname|businessunitname|accountname|orgname/i.test(k)) result.businessUnit.buName = safeStr(parsed);
      else if (/bumid|businessunitmid/i.test(k)) result.businessUnit.buMid = safeStr(parsed);
      else if (/timezone/i.test(k)) result.businessUnit.buTimezone = safeStr(parsed);
      else if (/locale|language|\blang\b/i.test(k)) result.businessUnit.buLocale = safeStr(parsed);
      else if (/parentmid|parentid|enterprisemid/i.test(k)) result.businessUnit.parentMid = safeStr(parsed);
      else if (/accounttype|edition|packagetype/i.test(k)) result.businessUnit.accountType = safeStr(parsed);
      else if (/isenterprise|enterprise|isparentbu/i.test(k)) result.businessUnit.isEnterprise = Boolean(parsed);
      else if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        extractFromObject(parsed, result.businessUnit, { buName: /buName|businessUnitName|accountName/, buMid: /buMid|businessUnitMid/, buTimezone: /timezone/, buLocale: /locale|language/, parentMid: /parentMid|parentId/ });
      }
    }

    // ── Account settings ──────────────────────────────────────────────────
    if (/setting|preference|config|option/i.test(k)) {
      if (/dateformat/i.test(k)) result.accountSettings.dateFormat = safeStr(parsed);
      else if (/modules|enabledfeatures|products|applist/i.test(k)) result.accountSettings.enabledModules = safeArray(parsed);
      else if (/sendthrottle|maxsendrate|throttle/i.test(k)) result.accountSettings.sendThrottle = safeStr(parsed);
    }

    // ── Feature flags ─────────────────────────────────────────────────────
    if (/flag|feature|enable|toggle|experiment|variant|beta|preview|killswitch/i.test(k)) {
      if (typeof parsed === "boolean" || parsed === "true" || parsed === "false") {
        result.featureFlags[sanitizeFlagName(key)] = parsed === true || parsed === "true";
      } else if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [fk, fv] of Object.entries(parsed)) {
          if (typeof fv === "boolean" || fv === "true" || fv === "false") result.featureFlags[sanitizeFlagName(fk)] = fv === true || fv === "true";
        }
      } else if (typeof parsed === "string" && parsed.length < 64) {
        result.featureFlags[sanitizeFlagName(key)] = parsed;
      }
    }

    // ── Recent errors ─────────────────────────────────────────────────────
    if (/error|notification|alert|warning|toast/i.test(k) && !/errorcount/i.test(k)) {
      const items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      for (const item of items.slice(-10)) {
        if (!item) continue;
        const err = { message: safeStr(typeof item === "object" ? (item.message || item.msg || item.error || JSON.stringify(item).slice(0, 200)) : item), timestamp: item.timestamp || item.ts || item.time || null, code: item.code || item.errorCode || null };
        if (err.message) result.recentErrors.push(err);
      }
      result.recentErrors = result.recentErrors.slice(-20);
    }

    // ── Automation history ────────────────────────────────────────────────
    if (/automation|schedule|run|history|job/i.test(k) && !/queryautomation/i.test(k)) {
      const items = Array.isArray(parsed) ? parsed : (typeof parsed === "object" && parsed ? [parsed] : []);
      for (const item of items.slice(-10)) {
        if (!item || typeof item !== "object") continue;
        result.automationHistory.push({ id: safeStr(item.id || item.automationId || item.objectID), name: safeStr(item.name || item.automationName), status: safeStr(item.status || item.lastRunStatus), lastRunTime: safeStr(item.lastRunTime || item.lastRun || item.lastRunDate), nextRunTime: safeStr(item.nextRunTime || item.nextRun || item.scheduledTime) });
      }
      result.automationHistory = result.automationHistory.slice(-20);
    }

    // ── Journey drafts ────────────────────────────────────────────────────
    if (/journey|draft|canvas|builder/i.test(k) && !/journeyactivity/i.test(k)) {
      if (/draft|unsaved/i.test(k)) {
        const items = Array.isArray(parsed) ? parsed : (typeof parsed === "object" && parsed ? [parsed] : []);
        for (const item of items.slice(-5)) {
          if (!item || typeof item !== "object") continue;
          result.journeyDrafts.push({ id: safeStr(item.id || item.definitionId), name: safeStr(item.name || item.journeyName), savedAt: item.savedAt || item.updatedAt || null, status: safeStr(item.status) });
        }
      } else if (/recent|visited|history/i.test(k)) {
        const items = Array.isArray(parsed) ? parsed : [];
        result.journeyDrafts.push(...items.slice(-5).map(item => ({ id: safeStr(typeof item === "object" ? item.id : item), name: safeStr(typeof item === "object" ? item.name : null), savedAt: null, status: "recent" })));
      }
    }

    // ── Session metadata ──────────────────────────────────────────────────
    if (/session|csrf|fuel/i.test(k) && !/token|auth|jwt|key|secret|password/i.test(k)) {
      if (/sessionid|session_id|\bsid\b/i.test(k)) result.sessionMetadata.sessionId = safeStr(parsed)?.slice(0, 32) + "…";
      else if (/expir|exp\b|expiresat/i.test(k)) result.sessionMetadata.tokenExpiry = Number(parsed) || null;
      else if (/logintime|authenticatedat|loginat/i.test(k)) result.sessionMetadata.loginTimestamp = Number(parsed) || null;
    }

    // Flag csrf presence without storing value
    if (/csrf/i.test(k) && /token|key/i.test(k)) result.sessionMetadata.csrfPresent = true;
  }

  function extractFromObject(obj, target, patterns) {
    for (const [targetKey, pattern] of Object.entries(patterns)) {
      if (target[targetKey]) continue;
      for (const [objKey, objVal] of Object.entries(obj)) {
        if (pattern.test(objKey) && objVal && !isTokenLike(String(objVal))) {
          target[targetKey] = safeStr(objVal);
          break;
        }
      }
    }
  }

  function safeStr(val) {
    if (val === null || val === undefined) return undefined;
    if (typeof val === "object") return undefined; // don't store objects as strings
    const s = String(val).trim();
    if (!s || s === "null" || s === "undefined") return undefined;
    if (isTokenLike(s)) return "[token]";
    return s.slice(0, 256);
  }

  function safeArray(val) {
    if (Array.isArray(val)) return val.map(v => safeStr(v)).filter(Boolean).slice(0, 20);
    if (typeof val === "string") {
      try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed.map(v => safeStr(v)).filter(Boolean).slice(0, 20); } catch { /* not json */ }
      return val.split(/[,;|]/).map(v => v.trim()).filter(Boolean).slice(0, 20);
    }
    return [];
  }

  function isTokenLike(str) {
    // JWT: three base64url parts
    if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(str) && str.length > 50) return true;
    // Long random hex/base64
    if (/^[A-Za-z0-9+/=]{40,}$/.test(str)) return true;
    return false;
  }

  function sanitizeFlagName(key) { return String(key || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64); }

  function detectPageContext(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const path = url.pathname.toLowerCase();
      if (/journey|jbinteraction/i.test(url.hostname + path)) return "Journey Builder";
      if (/automation/i.test(url.hostname + path)) return "Automation Studio";
      if (/contentbuilder|asset/i.test(url.hostname + path)) return "Content Builder";
      if (/dataextension|de\//i.test(path)) return "Data Extensions";
      if (/email\/|emailstudio/i.test(url.hostname + path)) return "Email Studio";
      if (/contact|contactbuilder/i.test(url.hostname + path)) return "Contact Builder";
      if (/querystudio/i.test(url.hostname)) return "Query Studio";
      return "Marketing Cloud";
    } catch { return null; }
  }

  // ── Auth header helpers ───────────────────────────────────────────────────

  function buildSfmcHeaders() {
    const headers = { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" };
    const authHeader = findAuthorizationHeader();
    if (authHeader) headers.Authorization = authHeader;
    const csrfToken = findCsrfToken();
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    const fuelDataVersion = findFuelDataVersion();
    if (fuelDataVersion) headers["x-fueldata-version"] = fuelDataVersion;
    return headers;
  }

  function findAuthorizationHeader() {
    const directKeys = ["token","accessToken","access_token","authToken","authorization","jwt","platformAuthToken"];
    for (const key of directKeys) { const hit = readStorageValue(key); const token = extractBearerToken(hit); if (token) return `Bearer ${token}`; }
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try { for (let i = 0; i < storage.length; i++) { const key = storage.key(i); const value = storage.getItem(key); const token = extractBearerToken(value); if (token) return `Bearer ${token}`; } } catch { /* ignore */ }
    }
    return null;
  }

  function findCsrfToken() {
    const directKeys = ["x-csrf-token","csrfToken","csrf_token","_csrf","fuelCsrfToken"];
    for (const key of directKeys) { const hit = readStorageValue(key); const token = sanitizeToken(hit); if (token) return token; }
    const metaToken = document.querySelector("meta[name='csrf-token'], meta[name='x-csrf-token'], meta[name='_csrf']")?.content;
    if (sanitizeToken(metaToken)) return sanitizeToken(metaToken);
    return findTokenInStorage(/csrf/i);
  }

  function findFuelDataVersion() {
    for (const key of ["x-fueldata-version","fueldataVersion","fuelDataVersion"]) { const hit = readStorageValue(key); const version = sanitizeToken(hit); if (version) return version; }
    return "1.1";
  }

  function readStorageValue(key) { try { return window.localStorage.getItem(key) || window.sessionStorage.getItem(key); } catch { return null; } }

  function extractBearerToken(raw) {
    if (!raw) return null;
    const text = String(raw);
    const bearerMatch = text.match(/Bearer\s+([A-Za-z0-9\-_=]+(?:\.[A-Za-z0-9\-_=]+){2,})/i);
    if (bearerMatch && looksLikeJwt(bearerMatch[1])) return bearerMatch[1];
    const jwtMatch = text.match(/\b([A-Za-z0-9\-_]+(?:\.[A-Za-z0-9\-_]+){2,})\b/);
    if (jwtMatch && looksLikeJwt(jwtMatch[1])) return jwtMatch[1];
    try { const parsed = JSON.parse(text); return extractTokenFromObject(parsed); } catch { return null; }
  }

  function looksLikeJwt(token) { const parts = String(token || "").split("."); if (parts.length !== 3) return false; return parts.every(part => /^[A-Za-z0-9\-_]+$/.test(part) && part.length >= 8); }

  function extractTokenFromObject(value) {
    if (!value) return null;
    if (typeof value === "string") return extractBearerToken(value);
    if (Array.isArray(value)) { for (const item of value) { const token = extractTokenFromObject(item); if (token) return token; } return null; }
    if (typeof value !== "object") return null;
    for (const key of ["authorization","accessToken","access_token","token","jwt"]) { const token = extractTokenFromObject(value[key]); if (token) return token; }
    for (const child of Object.values(value)) { const token = extractTokenFromObject(child); if (token) return token; }
    return null;
  }

  function findTokenInStorage(pattern) {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try { for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (!pattern.test(String(key || ""))) continue; const token = sanitizeToken(storage.getItem(key)); if (token) return token; } } catch { /* ignore */ }
    }
    return null;
  }

  function sanitizeToken(raw) { const value = String(raw || "").trim(); if (!value || value === "null" || value === "undefined") return null; return value; }

  // ── Activity helpers ──────────────────────────────────────────────────────

  function readActivityName(node) {
    const candidate = node.querySelector(".activity-name, .name, [title], [aria-label]");
    const text = candidate?.textContent?.trim() || candidate?.getAttribute?.("title") || candidate?.getAttribute?.("aria-label") || node.getAttribute("title") || node.getAttribute("aria-label") || "";
    return text.replace(/\s+/g, " ").trim() || "Unnamed activity";
  }

  function inferActivityType(node) {
    const text = `${node.className || ""} ${node.dataset.activityType || ""} ${node.getAttribute("data-type") || ""}`.toLowerCase();
    if (text.includes("email")) return "EMAILV2";
    if (text.includes("wait")) return "WAIT";
    if (text.includes("randomsplit")) return "RANDOMSPLIT";
    if (text.includes("engagementsplit")) return "ENGAGEMENTSPLIT";
    if (text.includes("split")) return "DECISIONSPLIT";
    if (text.includes("sms")) return "SMSMESSAGE";
    if (text.includes("push")) return "PUSH";
    if (text.includes("updatecontact")) return "UPDATECONTACT";
    if (text.includes("dataextension")) return "DATAEXTENSION";
    if (text.includes("custom")) return "CUSTOM";
    return "UNKNOWN";
  }

  function detectSfmcStack(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const stackMatch = url.hostname.match(/\.s(\d+)\./i) || url.hostname.match(/mc\.s(\d+)\.exacttarget\.com/i);
      if (stackMatch) return `s${stackMatch[1]}`;
      const restMatch = url.hostname.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
      if (restMatch) return restMatch[1];
      return null;
    } catch { return null; }
  }

  function findId(node) {
    const attrs = ["data-id","data-listid","data-list-id","id"];
    for (const attr of attrs) { const value = node.getAttribute?.(attr); const match = String(value || "").match(/\d{2,}/); if (match) return match[0]; }
    const html = node.outerHTML || "";
    const match = html.match(/(?:listId|listID|publicationListId|publicationListID|categoryId)[^\d]{0,20}(\d{2,})/i) || html.match(/[?&](?:id|listId)=(\d{2,})/i);
    return match?.[1] || null;
  }

  function addInlineId(row, id) {
    if (row.querySelector?.(".sfmc-buddy-inline-id")) return;
    const badge = document.createElement("span");
    badge.className = "sfmc-buddy-inline-id";
    badge.textContent = `ID ${id}`;
    row.appendChild(badge);
  }

  function ensureStyle() {
    if (document.getElementById("sfmc-buddy-style")) return;
    const style = document.createElement("style");
    style.id = "sfmc-buddy-style";
    style.textContent = `.sfmc-buddy-activity-key{display:inline-flex;margin:0 0 4px 0;padding:2px 6px;border-radius:999px;background:#1e40af;color:#fff;font:700 10px/1.4 "Fira Sans",system-ui,sans-serif;z-index:9999}.sfmc-buddy-inline-id{display:inline-flex;margin-left:8px;padding:2px 6px;border-radius:999px;background:rgba(30,64,175,.12);color:#1e40af;font:700 11px/1.4 "Fira Sans",system-ui,sans-serif}`;
    document.documentElement.appendChild(style);
  }

  function dedupe(items, getKey) { const seen = new Set(); return items.filter(item => { const key = getKey(item); if (seen.has(key)) return false; seen.add(key); return true; }); }

  // ── DOM observer + triggers ───────────────────────────────────────────────

  const observer = new MutationObserver(() => { if (_dead) return; scheduleSnapshot("dom-mutated"); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-activity-key","class","title","aria-label"] });

  window.addEventListener("popstate", () => { scheduleSnapshot("navigation"); mineStorageData(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { scheduleSnapshot("visible"); mineStorageData(); } });

  scheduleSnapshot("initial-load");
  mineStorageData();
  const _snapshotInterval = setInterval(() => scheduleSnapshot("interval"), 5000);
  const _mineInterval     = setInterval(() => mineStorageData(), 30000);
})();
