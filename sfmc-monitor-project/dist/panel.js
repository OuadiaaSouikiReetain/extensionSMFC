// DevTools panel logic.
// This file uses chrome.devtools.network.onRequestFinished to read SFMC response
// bodies from the inspected tab without replaying requests or requiring an API key.

const BOTTLENECK_THRESHOLD = 20;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

const state = {
  session: null,
  journeysData: {},
  journeyList: [],
  canvas: null,
  selectedJourneyId: null,
  requestCount: 0,
  logs: []
};

const $ = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  detectSession();
  restoreState();
  listenToStorage();
  listenToNetwork();
  log("Panel pret. Ouvre ou recharge une Journey dans Journey Builder.");
}

function bindEvents() {
  $("btn-refresh").addEventListener("click", () => {
    detectSession();
    restoreState();
    render();
  });

  $("btn-export").addEventListener("click", async () => {
    const payload = {
      session: state.session,
      selectedJourneyId: state.selectedJourneyId,
      journeysData: state.journeysData,
      journeyList: state.journeyList,
      canvas: state.canvas,
      exportedAt: new Date().toISOString()
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    log("Export JSON copie dans le presse-papiers.");
  });
}

function detectSession() {
  chrome.tabs.get(inspectedTabId, tab => {
    const err = chrome.runtime.lastError;
    const url = tab?.url;
    if (err || !url) {
      setSession(null, "Impossible de lire l'URL de l'onglet inspecte.");
      return;
    }

    const session = parseSfmcSession(url);
    if (!session.isSfmc) {
      setSession(session, "Cet onglet ne semble pas etre une page SFMC.");
      render();
      return;
    }

    setSession(session, "Session SFMC detectee.");
    chrome.runtime.sendMessage({
      type: "PANEL_UPDATE_SESSION",
      tabId: inspectedTabId,
      session
    });
    render();
  });
}

function parseSfmcSession(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const isSfmc = /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com/i.test(url.hostname) ||
      /salesforce\.com\/journey/i.test(url.hostname + url.pathname);
    const stackMatch = url.hostname.match(/mc\.s(\d+)\.exacttarget\.com/i) ||
      url.hostname.match(/\.s(\d+)\./i);
    const restMatch = url.hostname.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
    const stack = stackMatch ? `s${stackMatch[1]}` : null;
    const subdomain = restMatch?.[1] || stack || null;
    const restBase = restMatch
      ? `https://${restMatch[1]}.rest.marketingcloudapis.com`
      : stack
        ? `https://${stack}.rest.marketingcloudapis.com`
        : null;

    return {
      isSfmc,
      url: rawUrl,
      host: url.hostname,
      stack,
      subdomain,
      restBase
    };
  } catch {
    return { isSfmc: false, url: rawUrl, host: null, stack: null, subdomain: null, restBase: null };
  }
}

function setSession(session, message) {
  state.session = session;
  const dot = $("session-dot");
  const title = $("session-title");
  const subtitle = $("session-subtitle");
  dot.className = `status-dot ${session?.isSfmc ? "ok" : "bad"}`;
  title.textContent = session?.isSfmc ? "Session SFMC detectee" : "Session SFMC non detectee";
  subtitle.textContent = session?.isSfmc
    ? `${message} Stack: ${session.stack || "inconnu"} | REST: ${session.restBase || "a capturer"}`
    : message;
}

function restoreState() {
  chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: inspectedTabId }, response => {
    const saved = response?.state;
    if (!saved) {
      render();
      return;
    }
    state.journeysData = saved.journeys || {};
    state.journeyList = saved.journeyList || [];
    state.canvas = saved.canvas || null;
    if (!state.selectedJourneyId) {
      state.selectedJourneyId = Object.keys(state.journeysData)[0] || null;
    }
    render();
  });
}

function listenToStorage() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.sfmcProcessMinerState) return;
    const tabState = changes.sfmcProcessMinerState.newValue?.tabs?.[String(inspectedTabId)];
    if (!tabState) return;
    state.journeysData = tabState.journeys || state.journeysData;
    state.journeyList = tabState.journeyList || state.journeyList;
    state.canvas = tabState.canvas || state.canvas;
    if (!state.selectedJourneyId) {
      state.selectedJourneyId = Object.keys(state.journeysData)[0] || null;
    }
    render();
  });
}

function listenToNetwork() {
  chrome.devtools.network.onRequestFinished.addListener(request => {
    const url = request.request?.url || "";
    if (!isJourneyInteractionUrl(url)) return;

    state.requestCount++;
    $("request-count").textContent = `${state.requestCount} requete${state.requestCount > 1 ? "s" : ""}`;
    log(`Capture reseau: ${request.request.method} ${sanitizeUrl(url)}`);

    request.getContent((content, encoding) => {
      if (!content) {
        log("Reponse vide ou non lisible.");
        return;
      }
      try {
        const decoded = encoding === "base64" ? atob(content) : content;
        const json = JSON.parse(decoded);
        handleInteractionPayload(url, json);
      } catch (err) {
        log(`JSON malforme: ${err.message}`);
      }
    });
  });
}

function isJourneyInteractionUrl(url) {
  return /\/interaction\/v1\/interactions/i.test(url) &&
    /marketingcloudapis\.com|exacttargetapis\.com|marketingcloudapps\.com/i.test(url);
}

function handleInteractionPayload(url, json) {
  if (Array.isArray(json?.items)) {
    state.journeyList = json.items;
    chrome.runtime.sendMessage({
      type: "PANEL_STORE_JOURNEY_LIST",
      tabId: inspectedTabId,
      journeys: json.items
    });
    log(`${json.items.length} Journey(s) detectee(s) dans la liste.`);
  }

  const journey = normalizeJourney(json);
  if (journey) {
    state.journeysData[journey.id] = journey;
    state.selectedJourneyId = journey.id;
    chrome.runtime.sendMessage({
      type: "PANEL_STORE_JOURNEY",
      tabId: inspectedTabId,
      journey
    });
    log(`Journey detail capturee: ${journey.name} v${journey.version || "--"}`);
  }

  render();
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

function render() {
  renderJourneyList();
  renderCanvas();

  const journey = state.journeysData[state.selectedJourneyId] ||
    state.journeysData[Object.keys(state.journeysData)[0]];

  if (!journey) {
    $("empty-state").hidden = false;
    $("funnel").hidden = true;
    $("journey-name").textContent = "Aucune Journey capturee";
    $("journey-meta").textContent = "Version -- | 0 activite";
    $("metric-entered").textContent = "--";
    $("metric-completed").textContent = "--";
    $("metric-completion").textContent = "--";
    $("metric-bottlenecks").textContent = "--";
    $("analysis").textContent = "Ouvre une Journey dans Journey Builder pour commencer l'analyse.";
    return;
  }

  const mining = mineJourney(journey);
  $("empty-state").hidden = true;
  $("funnel").hidden = false;
  $("journey-name").textContent = journey.name;
  $("journey-meta").textContent = `Version ${journey.version || "--"} | ${journey.activities.length} activite${journey.activities.length > 1 ? "s" : ""}`;
  $("metric-entered").textContent = formatNumber(mining.totalEntered);
  $("metric-completed").textContent = formatNumber(mining.totalCompleted);
  $("metric-completion").textContent = `${round(mining.completionRate)}%`;
  $("metric-bottlenecks").textContent = mining.steps.filter(step => step.isBottleneck).length;

  renderFunnel(mining);
  renderAnalysis(mining);
}

function mineJourney(journey) {
  const steps = (journey.activities || []).map((activity, index) => {
    const stats = activity.stats || {};
    const contactsIn = numberOr(stats.contactsIn, stats.currentPopulation?.count, stats.entered, stats.totalContactsEntered, 0);
    const contactsOut = numberOr(stats.contactsOut, stats.contactsMet, stats.completed, stats.totalContactsCompleted, contactsIn);
    const dropCount = Math.max(0, contactsIn - contactsOut);
    const dropRate = contactsIn ? (dropCount / contactsIn) * 100 : 0;
    return {
      id: activity.id || activity.key || `activity-${index + 1}`,
      key: activity.key || activity.id || `activity-${index + 1}`,
      name: activity.name || activity.key || `Activite ${index + 1}`,
      type: activity.type || inferTypeFromKey(activity.key),
      contactsIn,
      contactsOut,
      dropCount,
      dropRate,
      isBottleneck: dropRate > BOTTLENECK_THRESHOLD,
      severity: severityForDrop(dropRate)
    };
  });

  const stats = journey.stats || {};
  const totalEntered = numberOr(stats.totalContactsEntered, steps[0]?.contactsIn, 0);
  const totalCompleted = numberOr(stats.totalContactsCompleted, stats.totalContactsExited, steps.at(-1)?.contactsOut, 0);
  const completionRate = totalEntered ? (totalCompleted / totalEntered) * 100 : 0;
  const maxAbsoluteDrop = [...steps].sort((a, b) => b.dropCount - a.dropCount)[0] || null;
  const maxRelativeDrop = [...steps].sort((a, b) => b.dropRate - a.dropRate)[0] || null;

  return {
    journey,
    steps,
    totalEntered,
    totalCompleted,
    completionRate,
    maxAbsoluteDrop,
    maxRelativeDrop
  };
}

function renderFunnel(mining) {
  const max = Math.max(mining.totalEntered, ...mining.steps.map(step => step.contactsIn), 1);
  const rows = [];

  rows.push(renderFunnelStep({
    name: "Entree Journey",
    type: "ENTRY",
    contactsIn: mining.totalEntered,
    dropRate: 0,
    severity: "green"
  }, max, 100));

  mining.steps.forEach(step => {
    const pct = max ? (step.contactsIn / max) * 100 : 0;
    rows.push(renderDropLine(step));
    rows.push(renderFunnelStep(step, max, pct));
  });

  $("funnel").innerHTML = rows.join("");
}

function renderFunnelStep(step, max, pct) {
  return `
    <div class="funnel-step">
      <div class="step-head">
        <div class="step-title" title="${escapeHtml(step.name)}">
          ${escapeHtml(step.name)}
          <span class="step-type">${escapeHtml(step.type)}</span>
        </div>
        <div class="step-count">${formatNumber(step.contactsIn)} contacts | ${round(pct)}%</div>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${step.severity}" style="--bar-width:${Math.max(3, pct)}%"></div>
      </div>
    </div>`;
}

function renderDropLine(step) {
  if (!step.dropCount) return `<div class="drop-line">↓ aucun drop detecte</div>`;
  const label = step.dropRate > 30 ? "DROP CRITIQUE" : step.isBottleneck ? "BOTTLENECK" : "";
  return `
    <div class="drop-line ${step.severity === "red" ? "critical" : step.severity === "orange" ? "warning" : ""}">
      ↓ -${formatNumber(step.dropCount)} drop (-${round(step.dropRate)}%) ${label}
    </div>`;
}

function renderAnalysis(mining) {
  const critical = mining.maxRelativeDrop || mining.maxAbsoluteDrop;
  if (!critical || !critical.dropCount) {
    $("analysis").innerHTML = "Aucun drop significatif detecte dans les donnees capturees.";
    return;
  }

  const suggestions = suggestionsForType(critical.type);
  $("analysis").innerHTML = `
    <strong>Le plus grand drop relatif est sur ${escapeHtml(critical.name)}</strong>
    avec -${round(critical.dropRate)}% des contacts perdus (${formatNumber(critical.dropCount)} contacts).
    <ul>${suggestions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
}

function suggestionsForType(type) {
  const normalized = String(type || "").toUpperCase();
  if (normalized.includes("EMAIL")) {
    return [
      "Verifier le taux d'ouverture et de clic de cet email.",
      "Le sujet de l'email est peut-etre peu engageant.",
      "Verifier les bounces et unsubscribes dans les Data Views."
    ];
  }
  if (normalized.includes("WAIT")) {
    return [
      "Le delai d'attente est peut-etre trop long.",
      "Les contacts ont peut-etre atteint la goal avant cette etape.",
      "Verifier les exit criteria configures."
    ];
  }
  if (normalized.includes("SPLIT")) {
    return [
      "Verifier les conditions du split decision.",
      "Un des chemins est peut-etre mal configure.",
      "Des contacts ne remplissent peut-etre aucune condition."
    ];
  }
  return [
    "Comparer cette etape avec les donnees de tracking SFMC.",
    "Verifier les erreurs d'activite et les exits de Journey Builder.",
    "Controler les criteres d'entree, suppression et goal."
  ];
}

function renderJourneyList() {
  const list = $("journey-list");
  const items = state.journeyList.length
    ? state.journeyList
    : Object.values(state.journeysData);
  if (!items.length) {
    list.textContent = "Aucune Journey listee pour le moment.";
    return;
  }
  list.innerHTML = items.slice(0, 12).map(item => `
    <div class="list-row" data-journey-id="${escapeHtml(item.id)}">
      <span title="${escapeHtml(item.name || item.id)}">${escapeHtml(item.name || item.id)}</span>
      <small>v${escapeHtml(item.version || item.versionNumber || "--")}</small>
    </div>
  `).join("");

  list.querySelectorAll("[data-journey-id]").forEach(row => {
    row.addEventListener("click", () => {
      if (state.journeysData[row.dataset.journeyId]) {
        state.selectedJourneyId = row.dataset.journeyId;
        render();
      } else {
        log("Liste capturee, mais le detail de cette Journey n'est pas encore dans le cache. Ouvre-la dans Journey Builder.");
      }
    });
  });
}

function renderCanvas() {
  const el = $("canvas-list");
  const activities = state.canvas?.activities || [];
  if (!activities.length) {
    el.textContent = "Aucun snapshot DOM pour le moment.";
    return;
  }
  el.innerHTML = activities.slice(0, 10).map(item => `
    <div class="list-row">
      <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <small>${escapeHtml(item.type)}</small>
    </div>
  `).join("");
}

function numberOr(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function severityForDrop(dropRate) {
  if (dropRate > 30) return "red";
  if (dropRate >= 10) return "orange";
  return "green";
}

function inferTypeFromKey(key) {
  const value = String(key || "").toUpperCase();
  if (value.includes("EMAIL")) return "EMAILV2";
  if (value.includes("WAIT")) return "WAIT";
  if (value.includes("SPLIT")) return "SPLIT";
  return "UNKNOWN";
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return String(rawUrl).slice(0, 180);
  }
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  state.logs.push(line);
  state.logs = state.logs.slice(-80);
  $("log").textContent = state.logs.join("\n");
}

function formatNumber(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("fr-FR").format(n);
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
