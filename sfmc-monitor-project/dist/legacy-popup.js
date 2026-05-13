const COLLECTIONS = {
  folders: { label: "Folders", columns: ["name", "id", "type"] },
  dataExtensions: { label: "Data Extensions", columns: ["name", "customerKey", "id"] },
  sqlQueries: { label: "SQL Queries", columns: ["name", "customerKey", "status"] },
  publicationLists: { label: "Publication Lists", columns: ["name", "id", "source"] },
  canvasActivities: { label: "Canvas Activities", columns: ["name", "key", "type"] },
  errors: { label: "Error Messages", columns: ["status", "url", "message"] },
  automations: { label: "Automations", columns: ["name", "status", "automationType", "lastRunStatus", "lastRunTime"] },
  assets: { label: "Assets", columns: ["name", "assetType", "id"] },
  journeys: { label: "Journeys", columns: ["name", "status", "version"] }
};

const AUTOMATIONS_ENDPOINT_PATH = "/cloud/fuelapi/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView&$page=1&$pageSize=200";
const JOURNEYS_ENDPOINT_PATH = "/fuelapi/interaction/v1/interactions";
const JOURNEYS_CLASSIC_ENDPOINT_PATH = "/cloud/fuelapi/interaction/v1/interactions";

const DEFAULT_SETTINGS = {
  journeyTimeout: 60,
  pageSize: 50,
  autoRefresh: false,
  autoInterval: 5
};

const state = {
  tab: null,
  tabState: null,
  activeCollection: null,
  activeObject: null,
  logs: [],
  cache: {
    folders: [],
    dataExtensions: [],
    sqlQueries: [],
    publicationLists: [],
    canvasActivities: [],
    errors: [],
    automations: [],
    assets: [],
    journeys: []
  },
  updatedAt: {},
  journeyKpis: {},
  journeyKpisUpdatedAt: null,
  settings: { ...DEFAULT_SETTINGS },
  autoRefreshTimer: null
};

const $ = id => document.getElementById(id);

window.addEventListener("error", event => {
  try {
    addLog(`Popup error: ${event.message}`);
  } catch {
    // Ignore logging failures during bootstrap.
  }
});

window.addEventListener("unhandledrejection", event => {
  try {
    addLog(`Promise error: ${event.reason?.message || event.reason || "unknown rejection"}`);
  } catch {
    // Ignore logging failures during bootstrap.
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    bindEvents();
    await loadActiveTab();
    await loadLocalCache();
    await loadSettings();
    await loadJourneyKpis();
    await refreshState();
    renderDashboard();
    applyLaunchContext();
    setInterval(updateHealth, 30000);
    addLog("Popup ready.");
  } catch (error) {
    addLog(`Init failed: ${error.message || error}`);
  }
});

function bindEvents() {
  $("btn-reload").addEventListener("click", synchronize);
  $("btn-update-all").addEventListener("click", synchronize);
  $("btn-copy-report").addEventListener("click", copyInventoryReport);
  $("btn-trace-sql").addEventListener("click", traceSqlExecution);
  $("btn-copy-traces").addEventListener("click", copyTraces);
  $("btn-back-dashboard").addEventListener("click", () => showDashboard());
  $("btn-back-collection").addEventListener("click", () => showCollection(state.activeCollection));
  $("btn-run-all-kpis").addEventListener("click", runAllJourneyKpis);
  $("btn-export-collection").addEventListener("click", exportCollection);
  $("btn-export-csv").addEventListener("click", exportCollectionCsv);
  $("btn-save-settings").addEventListener("click", saveSettingsFromForm);
  $("btn-generate-sql").addEventListener("click", generateSql);
  $("btn-copy-generated-sql").addEventListener("click", copyGeneratedSql);
  $("btn-open-query-studio")?.addEventListener("click", openGeneratedSqlInQueryStudio);
  $("url-inspector-input")?.addEventListener("input", renderUrlInspector);
  $("btn-export-snapshot")?.addEventListener("click", exportSnapshot);
  $("import-snapshot-file")?.addEventListener("change", importSnapshot);
  $("collection-search").addEventListener("input", () => renderCollectionTable());
  $("global-search").addEventListener("input", () => renderGlobalSearch());

  document.querySelectorAll("[data-purge]").forEach(button => {
    button.addEventListener("click", () => purgeCache(button.dataset.purge));
  });

  document.addEventListener("keydown", event => {
    if (event.ctrlKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("global-search").focus();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      synchronize();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportCollection();
    }
    if (event.key === "Escape") showDashboard();
  });

  document.querySelectorAll("[data-collection]").forEach(button => {
    button.addEventListener("click", () => handleCollectionLaunch(button.dataset.collection));
  });

  document.querySelectorAll("[data-dashboard-tab]").forEach(button => {
    button.addEventListener("click", () => setDashboardTab(button.dataset.dashboardTab));
  });

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => showStaticView(button.dataset.view));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.sfmcProcessMinerState && state.tab?.id) {
      state.tabState = changes.sfmcProcessMinerState.newValue?.tabs?.[String(state.tab.id)] || state.tabState;
      renderDebug();
    }
    if (changes.sfmcBuddyJourneyKpis) {
      state.journeyKpis = changes.sfmcBuddyJourneyKpis.newValue?.kpis || {};
      state.journeyKpisUpdatedAt = changes.sfmcBuddyJourneyKpis.newValue?.updatedAt || null;
      if (state.activeCollection === "journeys") {
        renderCollectionKpis();
        renderCollectionTable();
        addLog("KPIs journeys mis a jour depuis Query Studio.");
      }
    }
  });
}

async function loadActiveTab() {
  const tab = await resolveSfmcTab();
  state.tab = tab || null;
  renderSession();
}

async function resolveSfmcTab() {
  const querySets = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { currentWindow: true },
    {}
  ];

  for (const query of querySets) {
    const tabs = await chrome.tabs.query(query);
    const sfmcTab = pickBestSfmcTab(tabs);
    if (sfmcTab) return sfmcTab;
  }

  return null;
}

function pickBestSfmcTab(tabs) {
  const list = (tabs || []).filter(tab => Number.isInteger(tab?.id));
  if (!list.length) return null;

  const sfmcTabs = list.filter(tab => isSfmcUrl(tab.url || ""));
  if (!sfmcTabs.length) return null;

  return sfmcTabs.find(tab => tab.active) ||
    sfmcTabs.find(tab => /automationstudio|journey|exacttarget|marketingcloud/i.test(tab.url || "")) ||
    sfmcTabs[0];
}

async function loadLocalCache() {
  const data = await chrome.storage.local.get(["sfmcBuddyCache"]);
  if (data.sfmcBuddyCache) {
    state.cache = { ...state.cache, ...data.sfmcBuddyCache.cache };
    state.updatedAt = data.sfmcBuddyCache.updatedAt || {};
  }
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(["sfmcBuddySettings"]);
  state.settings = { ...DEFAULT_SETTINGS, ...data.sfmcBuddySettings };
  setValue("setting-journey-timeout", String(state.settings.journeyTimeout));
  setValue("setting-page-size", String(state.settings.pageSize));
  setValue("setting-auto-interval", String(state.settings.autoInterval));
  setValue("setting-theme", state.settings.theme || "dark");
  setValue("setting-lang", state.settings.lang || "fr");
  $("setting-auto-refresh").checked = Boolean(state.settings.autoRefresh);
  setupAutoRefresh();
}

async function saveSettingsFromForm() {
  state.settings = {
    journeyTimeout: Number($("setting-journey-timeout").value || 60),
    pageSize: Number($("setting-page-size").value || 50),
    autoRefresh: $("setting-auto-refresh").checked,
    autoInterval: Number($("setting-auto-interval").value || 5),
    theme: $("setting-theme")?.value || "dark",
    lang: $("setting-lang")?.value || "fr"
  };
  await chrome.storage.sync.set({ sfmcBuddySettings: state.settings });
  setupAutoRefresh();
  addLog("Settings saved.");
}

function setupAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  if (state.settings.autoRefresh) {
    state.autoRefreshTimer = setInterval(() => {
      if (isSfmcUrl(state.tab?.url || "")) synchronize();
    }, state.settings.autoInterval * 60000);
  }
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value;
}

async function saveLocalCache() {
  await chrome.storage.local.set({
    sfmcBuddyCache: {
      cache: state.cache,
      updatedAt: state.updatedAt,
      savedAt: Date.now()
    }
  });
}

async function loadJourneyKpis() {
  const data = await chrome.storage.local.get(["sfmcBuddyJourneyKpis"]);
  if (data.sfmcBuddyJourneyKpis) {
    state.journeyKpis = data.sfmcBuddyJourneyKpis.kpis || {};
    state.journeyKpisUpdatedAt = data.sfmcBuddyJourneyKpis.updatedAt || null;
  }
}

async function runAllJourneyKpis() {
  await chrome.storage.local.set({
    sfmcBuddyPendingQuery: {
      journeyId: "__all__",
      sql: buildGeneralKpiSql(),
      createdAt: Date.now()
    }
  });
  chrome.tabs.create({ url: "https://querystudio.herokuapp.com/" });
  addLog("Query KPIs ouverte dans Query Studio. En attente des resultats...");
}

function buildGeneralKpiSql() {
  return `SELECT
  j.JourneyID,
  j.JourneyName,
  ja.ActivityName,
  ja.ActivityType,
  COUNT(DISTINCT s.SubscriberKey) AS Sent,
  COUNT(DISTINCT CASE WHEN b.SubscriberKey IS NULL THEN s.SubscriberKey END) AS Delivered,
  COUNT(o.SubscriberKey) AS Opens,
  COUNT(DISTINCT o.SubscriberKey) AS UniqueOpens,
  COUNT(c.SubscriberKey) AS Clicks,
  COUNT(DISTINCT c.SubscriberKey) AS UniqueClicks,
  COUNT(DISTINCT b.SubscriberKey) AS Bounces,
  COUNT(DISTINCT u.SubscriberKey) AS Unsubs
FROM _Journey j
INNER JOIN _JourneyActivity ja
  ON j.VersionID = ja.VersionID
LEFT JOIN _Sent s
  ON ja.JourneyActivityObjectID = s.TriggererSendDefinitionObjectID
LEFT JOIN _Open o
  ON s.JobID = o.JobID AND s.ListID = o.ListID AND s.BatchID = o.BatchID AND s.SubscriberKey = o.SubscriberKey
LEFT JOIN _Click c
  ON s.JobID = c.JobID AND s.ListID = c.ListID AND s.BatchID = c.BatchID AND s.SubscriberKey = c.SubscriberKey
LEFT JOIN _Bounce b
  ON s.JobID = b.JobID AND s.ListID = b.ListID AND s.BatchID = b.BatchID AND s.SubscriberKey = b.SubscriberKey
LEFT JOIN _Unsubscribe u
  ON s.JobID = u.JobID AND s.ListID = u.ListID AND s.BatchID = u.BatchID AND s.SubscriberKey = u.SubscriberKey
WHERE s.EventDate >= DATEADD(day, -180, GETDATE())
GROUP BY j.JourneyID, j.JourneyName, ja.ActivityName, ja.ActivityType`;
}

async function refreshState() {
  if (!state.tab?.id) return;
  const response = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: state.tab.id });
  state.tabState = response?.state || null;
}

async function synchronize() {
  try {
    addLog("Synchronize clicked.");
    await loadActiveTab();
    if (!state.tab?.id || !isSfmcUrl(state.tab.url)) {
      addLog("Ouvre SFMC avant de synchroniser.");
      renderSession();
      return;
    }

    setLoading(true);
    addLog("Synchronize: Journeys, Automations, capture reseau.");
    if (isJourneyBuilderTab(state.tab.url)) {
      const captureResponse = await chrome.runtime.sendMessage({
        type: "POPUP_START_CAPTURE",
        tabId: state.tab.id,
        mode: "journey",
        timeoutMs: Number(state.settings.journeyTimeout || 60) * 1000
      }).catch(error => ({ ok: false, error: error?.message || String(error) }));
      if (!captureResponse?.ok) {
        addLog(`Capture start failed: ${captureResponse?.error || "unknown error"}`);
      } else {
        addLog("Capture started.");
      }
    } else {
      addLog("Journey capture skipped: open a Journey Builder tab to capture network.");
    }

    const stack = getStackFromUrl(state.tab.url);
    if (!stack) {
      addLog("Stack SFMC introuvable.");
      return;
    }

    await logCookieSyncReadiness(stack);

    const journeyBase = `https://jbinteractions.${stack}.marketingcloudapps.com`;
    await syncCollection("journeys", () => fetchJourneys());
    await syncCollection("automations", () => fetchAutomations());
    await syncCollection("dataExtensions", () => fetchDataExtensions(stack, journeyBase));
    await syncCollection("sqlQueries", () => fetchSqlQueries(stack, journeyBase));
    await syncCollection("assets", () => fetchAssets(stack, journeyBase));
    await syncCollection("folders", () => fetchFolders(stack, journeyBase));

    await saveLocalCache();
    await refreshState();
    renderDashboard();
    renderGlobalSearch();
    if (state.activeCollection) renderCollectionTable();
  } catch (error) {
    addLog(`Synchronize failed: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
}

async function logCookieSyncReadiness(stack) {
  const tabs = await chrome.tabs.query({});
  const hosts = tabs
    .map(tab => safeHostname(tab.url))
    .filter(Boolean);

  if (!hosts.includes(`jbinteractions.${stack}.marketingcloudapps.com`)) {
    addLog(`Journeys cookie mode: open a tab on jbinteractions.${stack}.marketingcloudapps.com.`);
  }

  if (!hosts.some(host => /^(automationstudio|automationstudioshell|automation)\./i.test(host) && host.includes(`.${stack}.marketingcloudapps.com`))) {
    addLog(`Automations cookie mode: open an Automation Studio tab on stack ${stack}.`);
  }
}

async function syncCollection(key, loader) {
  try {
    state.cache[key] = await loader();
    state.updatedAt[key] = Date.now();
    addLog(`${state.cache[key].length} ${COLLECTIONS[key].label} synced.`);
  } catch (error) {
    addLog(`${COLLECTIONS[key].label}: ${error.message || error}`);
  }
}

async function traceSqlExecution() {
  await loadActiveTab();
  if (!state.tab?.id || !isSfmcUrl(state.tab.url)) {
    addLog("Ouvre SFMC avant de tracer.");
    return;
  }
  const res = await chrome.runtime.sendMessage({
    type: "POPUP_START_CAPTURE",
    tabId: state.tab.id,
    mode: "sql",
    timeoutMs: Number($("trace-timeout")?.value || 60) * 1000
  });
  if (!res?.ok) {
    addLog(`Trace SQL impossible: ${res?.error || "unknown error"}`);
    return;
  }
  addLog("Trace SQL actif pendant 60s. Execute/ouvre la query ou Data Extension dans SFMC.");
  await refreshState();
  renderDebug();
}

async function copyTraces() {
  const traces = state.tabState?.traces || [];
  await navigator.clipboard.writeText(JSON.stringify(traces, null, 2));
  addLog(`${traces.length} trace(s) copiee(s).`);
}

async function fetchJourneys() {
  const journeyTab = await resolveJourneyBuilderTab();
  const contextUrl = journeyTab?.url || state.tab?.url || "";
  if (!contextUrl) throw new Error("No active SFMC tab available");

  if (!journeyTab) {
    addLog("Journey Builder tab not found. Open a Journey Builder tab to improve journey sync.");
  }

  const summaryCandidates = buildJourneySummaryCandidateUrls(contextUrl);
  if (!summaryCandidates.length) throw new Error("Unable to detect SFMC stack for journeys");

  const summaryPayload = await fetchJourneySummary(summaryCandidates);
  const totalInteractions = Number(summaryPayload?.summary?.totalInteractions ?? summaryPayload?.count ?? 0);
  addLog(`Journeys summary parsed: ${totalInteractions} total interaction(s).`);

  const pageSize = Number(state.settings.pageSize || 50);
  const totalPages = Math.max(1, Math.ceil((totalInteractions || pageSize) / pageSize));
  const all = [];

  for (let page = 1; page <= totalPages; page++) {
    const candidates = buildJourneyListCandidateUrls(contextUrl, page, pageSize);
    if (!candidates.length) throw new Error(`Unable to detect journey list endpoint for page ${page}`);
    const items = await fetchSingleCollectionFromCandidates({
      label: `Journeys page ${page}`,
      candidates,
      extractItems: extractJourneyItems,
      emptyError: `No journey endpoint worked for page ${page}`
    });
    addLog(`Journeys page ${page} parsed: ${items.length} item(s).`);
    all.push(...items);
    if (items.length < pageSize) break;
  }

  const normalized = dedupe(all.map(normalizeJourneyListItem).filter(Boolean), item => item.id || item.key || item.name);
  addLog(`Journeys payload parsed: ${normalized.length} item(s).`);
  return normalized;
}

async function fetchJourneySummary(candidates) {
  const payloads = await fetchSingleCollectionFromCandidates({
    label: "Journeys summary",
    candidates,
    extractItems: data => [data],
    emptyError: "No journey summary endpoint worked"
  });
  return payloads[0] || null;
}

function buildJourneyBaseOrigins(tabUrl) {
  let parsed;
  try {
    parsed = new URL(tabUrl);
  } catch {
    return [];
  }

  const stack = getStackFromUrl(tabUrl);
  const candidates = [];
  const push = (origin, path = JOURNEYS_ENDPOINT_PATH) => {
    if (!origin) return;
    const key = `${origin}${path}`;
    if (candidates.some(item => item.origin === origin && item.path === path)) return;
    candidates.push({ origin, path });
  };

  if (/^jbinteractions\.s\d+\.marketingcloudapps\.com$/i.test(parsed.hostname)) {
    push(parsed.origin, JOURNEYS_ENDPOINT_PATH);
  }

  if (/^mc\.s\d+\.exacttarget\.com$/i.test(parsed.hostname)) {
    push(parsed.origin, JOURNEYS_CLASSIC_ENDPOINT_PATH);
  }

  if (stack && /^s\d+$/i.test(stack)) {
    push(`https://jbinteractions.${stack}.marketingcloudapps.com`, JOURNEYS_ENDPOINT_PATH);
    push(`https://mc.${stack}.exacttarget.com`, JOURNEYS_CLASSIC_ENDPOINT_PATH);
  }

  return candidates;
}

function buildJourneySummaryCandidateUrls(tabUrl) {
  return buildJourneyBaseOrigins(tabUrl).map(({ origin, path }) =>
    `${origin}${path}?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true&%24page=1&%24pageSize=1&extras=summary`
  );
}

function buildJourneyListCandidateUrls(tabUrl, page, pageSize) {
  return buildJourneyBaseOrigins(tabUrl).map(({ origin, path }) =>
    `${origin}${path}?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true&%24page=${page}&%24pageSize=${pageSize}&extras=trigger%2Cstats%2Ctag%2Cactivity%2Ccampaigns&%24orderBy=name%20asc`
  );
}

function extractJourneyItems(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const collections = [
    data.items,
    data.entry,
    data.results,
    data.data,
    data.interactions,
    data.objects,
    data.records,
    data.rows,
    data.results?.items,
    data.data?.items,
    data.payload?.items,
    data.payload?.results,
    data.value,
    data.entities
  ];
  const list = collections.find(Array.isArray);
  if (list) return list;
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length && value.every(item => item && typeof item === "object")) {
      addLog(`Journeys payload array found under key "${key}".`);
      return value;
    }
  }
  if (data.id || data.key || data.name) return [data];
  addLog(`Journeys payload keys: ${Object.keys(data).slice(0, 12).join(", ") || "none"}`);
  return [];
}

function normalizeJourneyListItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    ...item,
    id: item.id || item.definitionId || item.key,
    key: item.key || item.definitionKey || item.id,
    name: item.name || item.journeyName || item.key || "Untitled journey",
    status: item.status || item.scheduledStatus || item.publicationStatus || "Unknown",
    version: item.version || item.versionNumber || item.workflowApiVersion || null,
    customerKey: item.customerKey || item.key || null,
    capturedAt: Date.now()
  };
}

async function fetchAutomations() {
  if (!state.tab?.url) throw new Error("No active SFMC tab available");
  const candidates = buildAutomationCandidateUrls(state.tab.url);
  if (!candidates.length) throw new Error("Unable to detect SFMC stack for automations");
  const items = await fetchSingleCollectionFromCandidates({
    label: "Automations",
    candidates,
    extractItems: extractAutomationItems,
    emptyError: "No automation endpoint worked"
  });
  addLog(`Automations payload parsed: ${items.length} item(s).`);
  return dedupe(items.map(normalizeAutomationItem).filter(Boolean), item => item.id || item.customerKey || item.name);
}

async function fetchSingleCollectionFromCandidates({ label, candidates, extractItems, emptyError }) {
  let lastError = null;
  for (const url of candidates) {
    try {
      const data = await fetchCollectionPayload(url, label);
      return extractItems(data);
    } catch (error) {
      lastError = error;
      addLog(`${label} candidate failed on ${new URL(url).hostname}: ${error.message || error}`);
    }
  }
  throw lastError || new Error(emptyError);
}

async function fetchPagedCollectionFromCandidates({ label, candidates, buildUrl, extractItems, dedupeKey, emptyError }) {
  let lastError = null;
  for (const baseUrl of candidates) {
    try {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const data = await fetchCollectionPayload(buildUrl(baseUrl, page), label);
        const items = extractItems(data);
        all.push(...items);
        if (items.length < 50) break;
      }
      return dedupe(all, dedupeKey);
    } catch (error) {
      lastError = error;
      addLog(`${label} candidate failed on ${new URL(baseUrl).hostname}: ${error.message || error}`);
    }
  }
  throw lastError || new Error(emptyError);
}

async function fetchCollectionPayload(url, label) {
  try {
    const data = await fetchSfmc(url);
    addLog(`${label} fetch via background cookies succeeded on ${new URL(url).hostname}.`);
    return data;
  } catch (backgroundError) {
    addLog(`${label} background fetch failed on ${new URL(url).hostname}: ${backgroundError.message || backgroundError}`);
    return fetchJsonInActiveSfmcTab(url, label);
  }
}

function buildAutomationCandidateUrls(tabUrl) {
  let parsed;
  try {
    parsed = new URL(tabUrl);
  } catch {
    return [];
  }

  const stack = getStackFromUrl(tabUrl);
  const urls = [];
  const push = value => {
    if (!value || urls.includes(value)) return;
    urls.push(value);
  };

  if (/^mc\.s\d+\.exacttarget\.com$/i.test(parsed.hostname)) {
    push(`${parsed.origin}${AUTOMATIONS_ENDPOINT_PATH}`);
  }

  if (/\.marketingcloudapps\.com$/i.test(parsed.hostname)) {
    push(`${parsed.origin}${AUTOMATIONS_ENDPOINT_PATH}`);
  }

  if (stack && /^s\d+$/i.test(stack)) {
    push(`https://mc.${stack}.exacttarget.com${AUTOMATIONS_ENDPOINT_PATH}`);
    push(`https://mc.${stack}.marketingcloudapps.com${AUTOMATIONS_ENDPOINT_PATH}`);
    push(`https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView&$page=1&$pageSize=200`);
    push(`https://mc.${stack}.marketingcloudapps.com/AutomationStudioFuel3/fuelapi/legacy/v1/beta/automations/automation/definition/?$top=200&$skip=0&$sort=lastRunTime%20desc&view=gridView`);
  }

  return urls;
}

async function fetchJsonInActiveSfmcTab(url, label = "Collection") {
  const fetchTabId = await findBestSfmcFetchTabId(url);
  if (!fetchTabId) throw new Error(`No open SFMC tab can fetch ${new URL(url).hostname}`);

  const payload = await chrome.tabs.sendMessage(fetchTabId, {
    type: "SFMC_BUDDY_FETCH_JSON",
    url
  });
  if (!payload) throw new Error("No content-script response");
  if (payload.error) throw new Error(payload.error);
  addLog(`${label} fetch response: HTTP ${payload.status}, auth header ${payload.authUsed ? "present" : "missing"}.`);

  let data;
  try {
    data = JSON.parse(payload.text);
  } catch {
    throw new Error(`${label} response is not valid JSON (${payload.status})`);
  }

  if (!payload.ok) {
    const message = typeof data === "object" ? JSON.stringify(data).slice(0, 180) : String(payload.text || "").slice(0, 180);
    throw new Error(`HTTP ${payload.status}: ${message}`);
  }

  return data;
}

async function resolveJourneyBuilderTab() {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(tab => Number.isInteger(tab?.id) && isSfmcUrl(tab.url || ""));
  return candidates.find(tab => isJourneyBuilderTab(tab.url || "")) || null;
}

async function findBestSfmcFetchTabId(url) {
  const targetOrigin = safeOrigin(url);
  const tabs = await chrome.tabs.query({});
  const sameOriginTab = tabs.find(tab => Number.isInteger(tab?.id) && safeOrigin(tab.url) === targetOrigin);
  if (sameOriginTab?.id) return sameOriginTab.id;

  const journeyTab = tabs.find(tab => Number.isInteger(tab?.id) && isJourneyBuilderTab(tab.url || ""));
  if (journeyTab?.id) return journeyTab.id;

  return state.tab?.id || null;
}

function extractAutomationItems(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const collections = [
    data.items,
    data.entry,
    data.results,
    data.data,
    data.automations,
    data.objects,
    data.records,
    data.rows,
    data.results?.items,
    data.data?.items,
    data.payload?.items,
    data.payload?.results,
    data.value,
    data.entities
  ];
  const list = collections.find(Array.isArray);
  if (list) return list;
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length && value.every(item => item && typeof item === "object")) {
      addLog(`Automations payload array found under key "${key}".`);
      return value;
    }
  }
  if (data.id || data.objectID || data.automationId || data.name) return [data];
  addLog(`Automations payload keys: ${Object.keys(data).slice(0, 12).join(", ") || "none"}`);
  return [];
}

function normalizeAutomationItem(item) {
  if (!item || typeof item !== "object") return null;
  const status = mapAutomationStatus(
    item.status ??
    item.statusName ??
    item.automationStatus ??
    item.programStatus ??
    item.scheduleStatus
  );
  const automationType = inferAutomationType(item);
  return {
    ...item,
    id: item.id || item.objectID || item.automationId || item.programId || item.customerKey || item.key,
    name: item.name || item.automationName || item.programName || item.customerKey || item.key || "Untitled automation",
    customerKey: item.customerKey || item.key || item.externalKey || null,
    status,
    automationType,
    lastRunStatus: formatAutomationRunStatus(
      item.lastRunStatus ??
      item.lastRunStatusName ??
      item.lastRun?.status ??
      item.lastRun?.statusName ??
      item.lastRunInstanceStatus
    ),
    lastRunTime: item.lastRunTime || item.lastRun?.lastRunTime || item.lastRun?.startTime || item.lastRunAt || item.modifiedDate || null,
    capturedAt: Date.now()
  };
}

async function fetchSfmc(url) {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC", url, tabId: state.tab?.id });
  if (!res?.ok) throw new Error(res?.error || "Fetch failed");
  return res.data;
}

function renderDashboard() {
  showView("dashboard-view");
  setNav("dashboard");
  renderSession();
  renderCounts();
  renderCacheTable();
  renderGlobalSearch();
  setDashboardTab(document.querySelector(".dashboard-tab.active")?.dataset.dashboardTab || "global");
  renderDebug();
}

function setDashboardTab(tab) {
  document.querySelectorAll("[data-dashboard-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.dashboardTab === tab);
  });
  document.querySelectorAll("[data-tab-group]").forEach(card => {
    card.hidden = tab !== "global" && card.dataset.tabGroup !== tab;
  });
}

function renderCounts() {
  let total = 0;
  const counts = {};
  for (const key of Object.keys(COLLECTIONS)) {
    const count = state.cache[key]?.length || 0;
    counts[key] = count;
    total += count;
    setText(`count-${key}`, formatNumber(count));
    setText(`updated-${key}`, relativeTime(state.updatedAt[key]));
  }
  const max = Math.max(1, ...Object.values(counts));
  for (const [key, count] of Object.entries(counts)) {
    const bar = $(`bar-${key}`);
    if (bar) bar.style.width = `${Math.round((count / max) * 100)}%`;
  }
  setText("cached-total", formatNumber(total));
  setText("last-sync", relativeTime(Math.max(0, ...Object.values(state.updatedAt))));
  setText("storage-usage", `${estimateCacheKb()} KB`);
  updateHealth();
}

function renderCacheTable() {
  $("cache-table-body").innerHTML = Object.entries(COLLECTIONS).map(([key, meta]) => {
    const rows = state.cache[key] || [];
    return `<tr>
      <td>${escapeHtml(meta.label)}</td>
      <td>${formatNumber(rows.length)}</td>
      <td>${estimateKb(rows)}</td>
      <td>${formatDate(state.updatedAt[key])}</td>
    </tr>`;
  }).join("");
}

function showCollection(key) {
  state.activeCollection = key;
  state.activeObject = null;
  showView("collection-view");
  setNav("dashboard");
  setText("collection-title", COLLECTIONS[key].label);
  setText("collection-eyebrow", key === "automations" ? "Automation Studio" : key === "journeys" ? "Journey Builder" : "Cached collection");
  $("collection-search").value = "";
  $("collection-search").placeholder = key === "automations"
    ? "Rechercher une automation par nom"
    : key === "journeys"
      ? "Rechercher un journey par nom"
      : "Filter objects";
  $("btn-run-all-kpis").style.display = key === "journeys" ? "" : "none";
  renderCollectionKpis();
  renderCollectionTable();
  if (key === "journeys") {
    refreshJourneysCollection();
  }
  if (key === "automations") {
    refreshAutomationsCollection();
  }
}

function isPopupContext() {
  try {
    return new URLSearchParams(location.search).get("mode") !== "tab";
  } catch {
    return true;
  }
}

function buildExtensionCollectionUrl(collection, objectId = "") {
  const url = new URL(chrome.runtime.getURL("legacy-popup.html"));
  url.searchParams.set("mode", "tab");
  url.searchParams.set("collection", collection);
  if (objectId) url.searchParams.set("objectId", objectId);
  return url.toString();
}

function handleCollectionLaunch(collection) {
  if (!collection) return;
  if ((collection === "journeys" || collection === "automations" || collection === "sqlQueries") && isPopupContext()) {
    chrome.tabs.create({ url: buildExtensionCollectionUrl(collection) });
    return;
  }
  showCollection(collection);
}

function applyLaunchContext() {
  const params = new URLSearchParams(location.search);
  document.body.classList.toggle("tab-mode", params.get("mode") === "tab");
  document.body.classList.toggle("popup-mode", params.get("mode") !== "tab");
  const collection = params.get("collection");
  const objectId = params.get("objectId");
  if (!collection || !COLLECTIONS[collection]) return;
  showCollection(collection);
  if (objectId) {
    const item = (state.cache[collection] || []).find(row => getStableObjectId(row) === objectId || String(row.id || "") === objectId);
    if (item) showObjectDetail(item);
  }
}

function renderCollectionKpis() {
  const key = state.activeCollection;
  const kpis = computeCollectionKpis(key, state.cache[key] || []);
  $("collection-kpis").innerHTML = kpis.map(kpi => `
    <div class="collection-kpi">
      <span>${escapeHtml(kpi.label)}</span>
      <strong>${escapeHtml(kpi.value)}</strong>
    </div>
  `).join("");
}

function renderCollectionTable() {
  const key = state.activeCollection;
  const meta = COLLECTIONS[key];
  const query = $("collection-search").value.trim().toLowerCase();
  const rows = (state.cache[key] || []).filter(item => {
    if (!query) return true;
    if (key === "automations") return String(item.name || "").toLowerCase().includes(query);
    return JSON.stringify(item).toLowerCase().includes(query);
  });
  setText("collection-count", key === "automations"
    ? `${formatNumber(rows.length)} automations trouvées`
    : key === "journeys"
      ? `${formatNumber(rows.length)} journeys trouves`
    : `${formatNumber(rows.length)} object${rows.length > 1 ? "s" : ""}`);
  if (!rows.length) {
    $("collection-table").innerHTML = `<div class="empty-state">Aucun objet cache pour ${escapeHtml(meta.label)}.</div>`;
    return;
  }
  if (key === "journeys") {
    $("collection-table").innerHTML = renderJourneysTable(rows);
    $("collection-table").querySelectorAll("[data-index]").forEach((button, index) => {
      button.addEventListener("click", () => openObject(rows[index]));
    });
    return;
  }
  if (key === "automations") {
    $("collection-table").innerHTML = renderAutomationsTable(rows);
    $("collection-table").querySelectorAll("[data-index]").forEach((button, index) => {
      button.addEventListener("click", () => openObject(rows[index]));
    });
    return;
  }
  if (key === "sqlQueries") {
    $("collection-table").innerHTML = renderSqlQueriesTable(rows);
    $("collection-table").querySelectorAll("[data-index]").forEach((button, index) => {
      button.addEventListener("click", () => openObject(rows[index]));
    });
    return;
  }
  const hasKpis = key === "journeys" && Object.keys(state.journeyKpis).length > 0;
  $("collection-table").innerHTML = rows.map((item, index) => {
    let cells;
    if (hasKpis) {
      const m = state.journeyKpis[item.id];
      const sent = m?.sent || 0;
      const opens = m?.uniqueOpens || m?.opens || 0;
      const clicks = m?.uniqueClicks || m?.clicks || 0;
      const kpiCell = m
        ? `<td style="font-size:11px;line-height:1.6">` +
          `Sends: ${formatNumber(sent)}<br>` +
          `Opens: ${formatNumber(opens)} (${formatPct(ratio(opens, sent))})<br>` +
          `Clicks: ${formatNumber(clicks)} (${formatPct(ratio(clicks, sent))})` +
          `</td>`
        : `<td style="color:var(--text-muted)">—</td>`;
      cells = `<td>${escapeHtml(formatCell(item.name))}</td><td>${statusBadge(item.status)}</td>${kpiCell}`;
    } else {
      cells = meta.columns.map(column => `<td>${escapeHtml(formatCell(item[column]))}</td>`).join("");
    }
    return `<button class="object-row" data-index="${index}" type="button"><table><tr>${cells}</tr></table></button>`;
  }).join("");
  $("collection-table").querySelectorAll("[data-index]").forEach((button, index) => {
    button.addEventListener("click", () => openObject(rows[index]));
  });
}

function renderAutomationsTable(rows) {
  const head = `
    <div class="object-table-head automation-grid">
      <span>Name</span>
      <span>Status</span>
      <span>Type</span>
      <span>Last Run Status</span>
      <span>Last Run Time</span>
    </div>
  `;
  const body = rows.map((item, index) => `
    <button class="object-row automation-row automation-grid" data-index="${index}" type="button">
      <span class="automation-name" title="${escapeHtml(item.name || "")}">${escapeHtml(item.name || "Untitled automation")}</span>
      <span class="automation-cell">${automationStatusBadge(item.status)}</span>
      <span class="automation-cell">${escapeHtml(item.automationType || "unknown")}</span>
      <span class="automation-cell">${escapeHtml(formatCell(item.lastRunStatus))}</span>
      <span class="automation-cell">${escapeHtml(formatAutomationDate(item.lastRunTime))}</span>
    </button>
  `).join("");
  return head + body;
}

function renderJourneysTable(rows) {
  const head = `
    <div class="object-table-head automation-grid">
      <span>Name</span>
      <span>Status</span>
      <span>Version</span>
      <span>Entry Mode</span>
      <span>Modified Date</span>
    </div>
  `;
  const body = rows.map((item, index) => `
    <button class="object-row automation-row automation-grid" data-index="${index}" type="button">
      <span class="automation-name" title="${escapeHtml(item.name || "")}">${escapeHtml(item.name || "Untitled journey")}</span>
      <span class="automation-cell">${statusBadge(item.status)}</span>
      <span class="automation-cell">${escapeHtml(formatCell(item.version))}</span>
      <span class="automation-cell">${escapeHtml(formatCell(item.entryMode || item.definitionType || "—"))}</span>
      <span class="automation-cell">${escapeHtml(formatAutomationDate(item.modifiedDate || item.lastPublishedDate || item.createdDate))}</span>
    </button>
  `).join("");
  return head + body;
}

function renderSqlQueriesTable(rows) {
  const head = `
    <div class="object-table-head sql-grid">
      <span>Name</span>
      <span>Target</span>
      <span>Action</span>
      <span>Source</span>
      <span>Modified</span>
    </div>
  `;
  const body = rows.map((item, index) => {
    const sql = getSqlText(item);
    const sources = extractSqlReferences(sql);
    const sourceLabel = sources.slice(0, 2).join(", ") || "--";
    const target = item.targetName || item.targetDataExtensionName || item.targetKey || item.targetId || "--";
    const action = item.targetUpdateTypeName || item.dataAction || item.targetUpdateType || item.updateType || item.status || "--";
    const modified = formatAutomationDate(item.modifiedDate || item.lastModifiedDate || item.updatedDate);
    return `
      <button class="object-row automation-row sql-grid" data-index="${index}" type="button">
        <span class="automation-name" title="${escapeHtml(item.name || "")}">${escapeHtml(item.name || "Untitled query")}</span>
        <span class="automation-cell" title="${escapeHtml(String(target))}">${escapeHtml(String(target))}</span>
        <span class="automation-cell">${escapeHtml(String(action))}</span>
        <span class="automation-cell" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</span>
        <span class="automation-cell">${escapeHtml(modified)}</span>
      </button>
    `;
  }).join("");
  return head + body;
}

function computeCollectionKpis(key, rows) {
  const total = rows.length;
  const base = [
    { label: "Total", value: formatNumber(total) },
    { label: "Cache size", value: `${estimateKb(rows)} KB` },
    { label: "Last sync", value: formatDate(state.updatedAt[key]) }
  ];

  if (key === "journeys") {
    const counts = countBy(rows, item => normalizeJourneyStatus(item.status));
    const baseCounts = [
      ...base,
      { label: "Published", value: formatNumber(counts.Published || 0) },
      { label: "Draft", value: formatNumber(counts.Draft || 0) },
      { label: "Stopped", value: formatNumber(counts.Stopped || 0) },
      { label: "Paused", value: formatNumber(counts.Paused || 0) }
    ];
    const kpiEntries = Object.values(state.journeyKpis);
    if (kpiEntries.length > 0) {
      const totals = kpiEntries.reduce((acc, m) => ({
        sent: acc.sent + (m.sent || 0),
        opens: acc.opens + (m.uniqueOpens || m.opens || 0),
        clicks: acc.clicks + (m.uniqueClicks || m.clicks || 0),
        bounces: acc.bounces + (m.bounces || 0)
      }), { sent: 0, opens: 0, clicks: 0, bounces: 0 });
      return [
        ...baseCounts,
        { label: "Total Sends", value: formatNumber(totals.sent) },
        { label: "Unique Opens", value: formatNumber(totals.opens) },
        { label: "Unique Clicks", value: formatNumber(totals.clicks) },
        { label: "Open Rate", value: formatPct(ratio(totals.opens, totals.sent)) },
        { label: "Click Rate", value: formatPct(ratio(totals.clicks, totals.sent)) },
        { label: "KPIs at", value: formatDate(state.journeyKpisUpdatedAt) }
      ];
    }
    return baseCounts;
  }

  if (key === "automations") {
    const counts = countBy(rows, item => mapAutomationStatus(item.status));
    const ran24h = rows.filter(item => item.lastRunTime && Date.now() - new Date(item.lastRunTime).getTime() <= 86400000).length;
    const stale = rows.filter(item => !item.lastRunTime || Date.now() - new Date(item.lastRunTime).getTime() > 7 * 86400000).length;
    return [
      ...base,
      { label: "Scheduled", value: formatNumber(rows.filter(item => mapAutomationStatus(item.status) === "Scheduled").length) },
      { label: "Awaiting Trigger", value: formatNumber(rows.filter(item => mapAutomationStatus(item.status) === "AwaitingTrigger").length) },
      { label: "Running", value: formatNumber(counts.Running || 0) },
      { label: "Ran 24h", value: formatNumber(ran24h) },
      { label: "Stale >7d", value: formatNumber(stale) }
    ];
  }

  if (key === "assets") {
    const counts = countBy(rows, item => item.assetType?.name || item.assetType || "Unknown");
    const topType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return [
      ...base,
      { label: "Asset types", value: formatNumber(Object.keys(counts).length) },
      { label: "Top type", value: topType ? `${topType[0]} (${topType[1]})` : "—" }
    ];
  }

  if (key === "dataExtensions") {
    const sendable = rows.filter(item => item.isSendable || item.sendableDataExtensionField || item.sendableSubscriberField).length;
    return [
      ...base,
      { label: "Sendable", value: formatNumber(sendable) },
      { label: "Non-sendable", value: formatNumber(Math.max(0, total - sendable)) }
    ];
  }

  if (key === "sqlQueries") {
    const active = rows.filter(item => /active|running|ready/i.test(String(item.status || item.queryStatus || ""))).length;
    return [
      ...base,
      { label: "Active/Ready", value: formatNumber(active) },
      { label: "Inactive/Other", value: formatNumber(Math.max(0, total - active)) }
    ];
  }

  if (key === "folders") {
    const counts = countBy(rows, item => item.contentType || item.type || "Unknown");
    return [
      ...base,
      { label: "Folder types", value: formatNumber(Object.keys(counts).length) }
    ];
  }

  if (key === "publicationLists") {
    const categories = countBy(rows, item => item.categoryId || "Unknown");
    return [
      ...base,
      { label: "Categories", value: formatNumber(Object.keys(categories).length) }
    ];
  }

  if (key === "canvasActivities") {
    const counts = countBy(rows, item => item.type || "Unknown");
    const email = counts.EMAILV2 || counts.EMAIL || 0;
    return [
      ...base,
      { label: "Email steps", value: formatNumber(email) },
      { label: "Types", value: formatNumber(Object.keys(counts).length) }
    ];
  }

  if (key === "errors") {
    const statusCounts = countBy(rows, item => item.status || "Unknown");
    const latest = rows[0]?.capturedAt;
    return [
      ...base,
      { label: "Statuses", value: formatNumber(Object.keys(statusCounts).length) },
      { label: "Latest", value: formatDate(latest) }
    ];
  }

  return base;
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row) || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizeJourneyStatus(status) {
  const value = String(status || "Unknown");
  if (/publish/i.test(value)) return "Published";
  if (/draft/i.test(value)) return "Draft";
  if (/stop/i.test(value)) return "Stopped";
  if (/pause/i.test(value)) return "Paused";
  if (/sent/i.test(value)) return "Sent";
  return value || "Unknown";
}

function openObject(item) {
  if (state.activeCollection === "journeys" && item?.id) {
    const url = chrome.runtime.getURL(`journey-detail.html?journeyId=${encodeURIComponent(item.id)}`);
    chrome.tabs.create({ url });
    return;
  }
  if (state.activeCollection === "automations" && item) {
    chrome.tabs.create({ url: buildExtensionCollectionUrl("automations", getStableObjectId(item)) });
    return;
  }
  showObjectDetail(item);
}

function showObjectDetail(item) {
  state.activeObject = item;
  showView("detail-view");
  setText("detail-title", item.name || item.customerKey || item.id || "Object detail");
  const sfmcUrl = buildOpenSfmcUrl(state.activeCollection, item);
  const detailBody = state.activeCollection === "sqlQueries"
    ? renderSqlQueryDetail(item, sfmcUrl)
    : state.activeCollection === "dataExtensions"
      ? renderDataExtensionDetail(item, sfmcUrl)
      : `<pre class="json-view">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`;
  $("detail-content").innerHTML = `
    <div class="object-detail-card">
      <div>
        <span class="eyebrow">${escapeHtml(COLLECTIONS[state.activeCollection]?.label || "Object")}</span>
        <h3>${escapeHtml(item.name || item.customerKey || item.id || "Object detail")}</h3>
        <p>${escapeHtml(buildObjectSubtitle(item))}</p>
      </div>
      ${sfmcUrl ? `<button class="blue-link-box" data-open-sfmc type="button">Open in SFMC</button>` : ""}
    </div>
    ${detailBody}
  `;
  $("detail-content").querySelector("[data-open-sfmc]")?.addEventListener("click", () => chrome.tabs.create({ url: sfmcUrl }));
  if (state.activeCollection === "sqlQueries") {
    bindSqlQueryDetailEvents(item);
  }
  if (state.activeCollection === "dataExtensions") {
    bindDataExtensionDetailEvents(item);
  }
  renderRelationships(item);
}

function renderSqlQueryDetail(item, sfmcUrl) {
  const sql = getSqlText(item);
  const target = resolveSqlTarget(item);
  const sources = resolveSqlSourceDataExtensions(item, sql);
  const linkedAutomations = findAutomationsForQuery(item);
  const dependencyCounts = {
    total: sources.length + (target ? 1 : 0) + linkedAutomations.length,
    dataExtensions: sources.length + (target ? 1 : 0),
    automations: linkedAutomations.length,
    journeys: 0,
    unresolved: 0
  };
  const rawJsonId = `sql-raw-${escapeHtml(getStableObjectId(item))}`;

  return `
    <div class="relation-card">
      <div class="sql-actions">
        ${sfmcUrl ? `<button class="blue-link-box" data-open-automation-studio type="button">Open in Automation Studio</button>` : ""}
        ${target ? `<button class="btn secondary" data-open-target-de type="button">Open target DE</button>` : ""}
        <button class="btn secondary" data-copy-query-sql type="button">Copy query</button>
        <button class="btn secondary" data-toggle-sql-raw type="button">Show raw JSON</button>
      </div>
      <div class="de-meta-grid sql-meta-grid">
        ${renderMetaRow("ID", item.id || item.queryDefinitionId || "--")}
        ${renderMetaRow("Name", item.name || item.customerKey || item.key || "--")}
        ${renderMetaRow("Key", item.customerKey || item.key || "--")}
        ${renderMetaRow("Data Action", item.targetUpdateTypeName || item.dataAction || item.targetUpdateType || item.updateType || "--")}
        ${renderMetaRow("Target", target?.name || item.targetName || "--")}
        ${renderMetaRow("Target ID", target?.id || item.targetId || item.targetDataExtensionId || "--")}
        ${renderMetaRow("Folder path", item.categoryPath || item.folderPath || item.r__folder_Path || item.categoryName || "Query")}
        ${renderMetaRow("Sources (FROM)", sources.length ? sources.map(source => source.name).join(", ") : "--")}
        ${renderMetaRow("Modified", formatDate(item.modifiedDate || item.lastModifiedDate || item.updatedDate))}
      </div>
    </div>

    <div class="relation-card">
      <h3>SQL query</h3>
      <pre class="json-view sql-query-block">${escapeHtml(sql || "--")}</pre>
    </div>

    <div class="relation-card">
      <h3>Dependencies</h3>
      <div class="de-dependency-grid">
        ${renderDependencyCard("Dependencies", dependencyCounts.total)}
        ${renderDependencyCard("DE", dependencyCounts.dataExtensions)}
        ${renderDependencyCard("Automation", dependencyCounts.automations)}
        ${renderDependencyCard("Journey", dependencyCounts.journeys)}
        ${renderDependencyCard("Unresolved", dependencyCounts.unresolved)}
      </div>
    </div>

    <div class="relation-card">
      <h3>Target DE</h3>
      ${target ? `
        <button class="relation-row sql-linked-card" data-open-target-de type="button">
          <span>Output</span>
          <strong>${escapeHtml(target.name || "--")}</strong>
          <span>${escapeHtml(target.path || target.subtitle || "Data Extension")}</span>
        </button>
      ` : `<div class="empty-state">No target Data Extension detected in the current cache.</div>`}
    </div>

    <div class="relation-card">
      <h3>Source DE</h3>
      ${sources.length ? sources.map(source => `
        <button class="relation-row sql-linked-card" data-open-source-de type="button" data-de-id="${escapeHtml(source.refId)}">
          <span>Input</span>
          <strong>${escapeHtml(source.name)}</strong>
          <span>${escapeHtml(source.path || source.subtitle || "Data Extension")}</span>
        </button>
      `).join("") : `<div class="empty-state">No source Data Extension detected from the SQL text.</div>`}
    </div>

    <div class="relation-card">
      <h3>Linked automations</h3>
      <p>${linkedAutomations.length}</p>
      ${linkedAutomations.length ? linkedAutomations.map(automation => `
        <button class="relation-row sql-linked-card" data-open-linked-automation type="button" data-automation-id="${escapeHtml(getStableObjectId(automation))}">
          <span>Automation</span>
          <strong>${escapeHtml(automation.name || automation.key || automation.id || "Unnamed automation")}</strong>
          <span>${escapeHtml(buildObjectSubtitle(automation))}</span>
        </button>
      `).join("") : `<div class="empty-state">No automation currently references this query.</div>`}
    </div>

    <pre id="${rawJsonId}" class="json-view hidden">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
  `;
}

function bindSqlQueryDetailEvents(item) {
  $("detail-content").querySelector("[data-open-automation-studio]")?.addEventListener("click", () => {
    const url = buildOpenSfmcUrl("sqlQueries", item);
    if (url) chrome.tabs.create({ url });
  });
  $("detail-content").querySelectorAll("[data-copy-query-sql]").forEach(button => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(getSqlText(item) || "");
      addLog(`SQL copied for query ${item.name || item.customerKey || item.id}.`);
    });
  });
  $("detail-content").querySelectorAll("[data-toggle-sql-raw]").forEach(button => {
    button.addEventListener("click", event => {
      const raw = $("detail-content").querySelector(".json-view.hidden, .json-view:not(.hidden):not(.sql-query-block)");
      if (!raw) return;
      raw.classList.toggle("hidden");
      event.currentTarget.textContent = raw.classList.contains("hidden") ? "Show raw JSON" : "Hide raw JSON";
    });
  });
  $("detail-content").querySelectorAll("[data-open-target-de]").forEach(button => {
    button.addEventListener("click", () => {
      const target = resolveSqlTarget(item);
      if (!target?.item) return;
      state.activeCollection = "dataExtensions";
      openObject(target.item);
    });
  });
  $("detail-content").querySelectorAll("[data-open-source-de]").forEach(button => {
    button.addEventListener("click", () => {
      const de = (state.cache.dataExtensions || []).find(row => getStableObjectId(row) === button.dataset.deId);
      if (!de) return;
      state.activeCollection = "dataExtensions";
      openObject(de);
    });
  });
  $("detail-content").querySelectorAll("[data-open-linked-automation]").forEach(button => {
    button.addEventListener("click", () => {
      const automation = (state.cache.automations || []).find(row => getStableObjectId(row) === button.dataset.automationId);
      if (!automation) return;
      state.activeCollection = "automations";
      openObject(automation);
    });
  });
}

function renderDataExtensionDetail(item, sfmcUrl) {
  const linkedQueries = findRelatedQueriesForDataExtension(item);
  const dependencyCounts = getDataExtensionDependencyCounts(item, linkedQueries);
  const sql = buildDataExtensionSql(item);
  const fields = Array.isArray(item.fields) ? item.fields : [];
  const rawJsonId = `de-raw-${escapeHtml(String(item.id || item.customerKey || item.key || "raw"))}`;
  return `
    <div class="relation-card">
      <div class="de-actions">
        ${sfmcUrl ? `<button class="blue-link-box" data-open-contact-builder type="button">Open in Contact Builder</button>` : ""}
        <button class="btn secondary" data-copy-de-sql type="button">Copy SQL</button>
        <button class="btn secondary" data-toggle-de-raw type="button">Show raw JSON</button>
      </div>
      <div class="de-meta-grid">
        ${renderMetaRow("Alias", item.key || "--")}
        ${renderMetaRow("ent. prefix?", /^ent\./i.test(item.name || "") || /^ent\./i.test(item.key || "") ? "Yes" : "No")}
        ${renderMetaRow("ID", item.id || "--")}
        ${renderMetaRow("Name", item.name || "--")}
        ${renderMetaRow("Key", item.customerKey || item.key || "--")}
        ${renderMetaRow("Rows", formatNumber(item.rowCount || 0))}
        ${renderMetaRow("Path", formatPath(item.categoryFullPath))}
        ${renderMetaRow("Category", item.categoryId || "--")}
        ${renderMetaRow("Created by", item.createdByName || item.ownerName || "--")}
        ${renderMetaRow("Created", formatDate(item.createdDate))}
        ${renderMetaRow("Modified by", item.modifiedByName || item.ownerName || "--")}
        ${renderMetaRow("Modified", formatDate(item.modifiedDate))}
      </div>
    </div>

    <div class="relation-card">
      <h3>Fields</h3>
      <input class="de-field-filter" data-de-field-filter type="search" placeholder="Filter fields">
      ${fields.length ? `
        <div class="de-fields-table" data-de-fields-table>
          <div class="de-fields-head">
            <span>Name</span><span>Type</span><span>Length</span><span>Key</span><span>Nullable</span><span>Default value</span>
          </div>
          ${fields.map(field => renderDataExtensionFieldRow(field)).join("")}
        </div>
      ` : `
        <div class="empty-state">Field details are not in the current cache yet. Field count detected: ${formatNumber(item.fieldCount || 0)}.</div>
      `}
    </div>

    <div class="relation-card">
      <h3>Related queries</h3>
      <p>${linkedQueries.length} related query(ies) detected</p>
      ${linkedQueries.length ? linkedQueries.map(query => `
        <div class="relation-row de-related-query" data-related-query-id="${escapeHtml(getStableObjectId(query))}">
          <span>Query</span>
          <strong>${escapeHtml(query.name || query.key || "Unnamed query")}</strong>
          <span>Modified ${escapeHtml(formatDate(query.modifiedDate))}</span>
          <span>Writes to this DE</span>
          <span>Target: ${escapeHtml(query.targetName || item.name || "--")}</span>
          <button class="btn secondary" data-open-related-query type="button" data-related-query-id="${escapeHtml(getStableObjectId(query))}">Open in Automation Studio</button>
        </div>
      `).join("") : `<div class="empty-state">No related query detected in local cache.</div>`}
    </div>

    <div class="relation-card">
      <h3>Dependencies</h3>
      <div class="de-dependency-grid">
        ${renderDependencyCard("Dependencies", dependencyCounts.total)}
        ${renderDependencyCard("Queries", dependencyCounts.queries)}
        ${renderDependencyCard("Automation", dependencyCounts.automations)}
        ${renderDependencyCard("Journey", dependencyCounts.journeys)}
        ${renderDependencyCard("Unresolved", dependencyCounts.unresolved)}
      </div>
    </div>

    <pre id="${rawJsonId}" class="json-view hidden">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
    <textarea class="hidden" data-de-sql-copy>${escapeHtml(sql)}</textarea>
  `;
}

function bindDataExtensionDetailEvents(item) {
  $("detail-content").querySelector("[data-open-contact-builder]")?.addEventListener("click", () => {
    const sfmcUrl = buildOpenSfmcUrl("dataExtensions", item);
    if (sfmcUrl) chrome.tabs.create({ url: sfmcUrl });
  });
  $("detail-content").querySelector("[data-copy-de-sql]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(buildDataExtensionSql(item));
    addLog(`SQL copied for Data Extension ${item.name || item.customerKey || item.id}.`);
  });
  $("detail-content").querySelector("[data-toggle-de-raw]")?.addEventListener("click", event => {
    const raw = $("detail-content").querySelector(".json-view.hidden, .json-view:not(.hidden)");
    if (!raw) return;
    raw.classList.toggle("hidden");
    event.currentTarget.textContent = raw.classList.contains("hidden") ? "Show raw JSON" : "Hide raw JSON";
  });
  $("detail-content").querySelectorAll("[data-open-related-query]").forEach(button => {
    button.addEventListener("click", () => {
      const query = (state.cache.sqlQueries || []).find(row => getStableObjectId(row) === button.dataset.relatedQueryId);
      if (!query) return;
      const url = buildOpenSfmcUrl("sqlQueries", query);
      if (url) chrome.tabs.create({ url });
    });
  });
  $("detail-content").querySelector("[data-de-field-filter]")?.addEventListener("input", event => {
    const query = String(event.currentTarget.value || "").trim().toLowerCase();
    $("detail-content").querySelectorAll("[data-de-field-row]").forEach(row => {
      row.hidden = query && !row.dataset.fieldSearch.includes(query);
    });
  });
}

function renderMetaRow(label, value) {
  return `<div class="de-meta-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? "--"))}</strong></div>`;
}

function renderDependencyCard(label, value) {
  return `<div class="collection-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumber(value || 0))}</strong></div>`;
}

function renderDataExtensionFieldRow(field) {
  const name = field.name || field.displayName || field.key || "--";
  const type = field.fieldType || field.type || field.dataType || "--";
  const length = field.maxLength || field.length || field.scale || "--";
  const isKey = field.isPrimaryKey || field.isKey ? "Yes" : "—";
  const nullable = field.isRequired === true ? "No" : "Yes";
  const defaultValue = field.defaultValue || field.default || "—";
  const search = [name, type, length, isKey, nullable, defaultValue].join(" ").toLowerCase();
  return `
    <div class="de-fields-row" data-de-field-row data-field-search="${escapeHtml(search)}">
      <span>${escapeHtml(name)}</span>
      <span>${escapeHtml(String(type))}</span>
      <span>${escapeHtml(String(length))}</span>
      <span>${escapeHtml(String(isKey))}</span>
      <span>${escapeHtml(String(nullable))}</span>
      <span>${escapeHtml(String(defaultValue))}</span>
    </div>
  `;
}

function buildDataExtensionSql(item) {
  const deName = item.name || item.customerKey || item.key || "DataExtension";
  return `SELECT TOP 1000 *\nFROM [${deName.replace(/]/g, "]]")}]`;
}

function resolveSqlTarget(item) {
  const candidates = [
    item.targetName,
    item.targetDataExtensionName,
    item.targetDataExtension?.name,
    item.target,
    item.targetDataExtension?.customerKey,
    item.targetKey,
    item.targetCustomerKey,
    item.targetId,
    item.targetDataExtensionId
  ].filter(Boolean);

  const rows = state.cache.dataExtensions || [];
  const matched = rows.find(row => {
    const rowTokens = buildComparableTokens([
      row.name,
      row.customerKey,
      row.key,
      row.id
    ].filter(Boolean).join(" "));
    return candidates.some(candidate => rowTokens.includes(String(candidate).toLowerCase()) || buildComparableTokens(candidate).some(token => rowTokens.includes(token)));
  });

  if (!matched) {
    return candidates[0] ? {
      name: String(candidates[0]),
      id: item.targetId || item.targetDataExtensionId || "--",
      path: item.categoryPath || item.folderPath || ""
    } : null;
  }

  return {
    item: matched,
    refId: getStableObjectId(matched),
    name: matched.name || matched.customerKey || matched.id || "--",
    id: matched.id || matched.customerKey || matched.key || "--",
    path: formatPath(matched.categoryFullPath)
  };
}

function resolveSqlSourceDataExtensions(item, sql) {
  const refs = extractSqlReferences(sql);
  const rows = state.cache.dataExtensions || [];
  const sources = refs.map(ref => {
    const match = rows.find(row => buildComparableTokens([row.name, row.customerKey, row.key, row.id].filter(Boolean).join(" ")).includes(String(ref).toLowerCase()));
    if (!match) {
      return {
        name: ref,
        refId: "",
        path: ""
      };
    }
    return {
      item: match,
      refId: getStableObjectId(match),
      name: match.name || match.customerKey || match.id || ref,
      path: formatPath(match.categoryFullPath),
      subtitle: match.customerKey || match.id || ""
    };
  });
  return dedupe(sources, source => source.refId || source.name);
}

function findAutomationsForQuery(item) {
  const refs = buildRelationships("sqlQueries", item).filter(ref => ref.collection === "automations");
  return refs.map(ref => (state.cache.automations || []).find(row => getStableObjectId(row) === ref.id)).filter(Boolean);
}

function formatPath(value) {
  return String(value || "--").replace(/\\/g, "/");
}

function findRelatedQueriesForDataExtension(item) {
  const rows = state.cache.sqlQueries || [];
  const rawTokens = [
    String(item.name || ""),
    String(item.customerKey || ""),
    String(item.key || ""),
    String(item.id || "")
  ].filter(Boolean);
  const tokens = new Set(rawTokens.flatMap(buildComparableTokens));

  return rows.filter(query => {
    const sql = getSqlText(query);
    const sqlTokens = new Set(buildComparableTokens(sql));
    const targetTokens = [
      query.targetName,
      query.targetKey,
      query.targetId,
      query.name,
      query.key
    ].filter(Boolean).flatMap(buildComparableTokens);
    return [...tokens].some(token => targetTokens.includes(token) || sqlTokens.has(token));
  });
}

function buildComparableTokens(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const lowered = text.toLowerCase();
  const compact = lowered.replace(/[\[\]`"'().,;:\\/]/g, " ").replace(/\s+/g, " ").trim();
  const merged = compact.replace(/\s+/g, "");
  const tokens = new Set([lowered, compact, merged]);
  compact.split(" ").filter(Boolean).forEach(part => tokens.add(part));
  return [...tokens].filter(Boolean);
}

function getDataExtensionDependencyCounts(item, linkedQueries = []) {
  const refs = buildRelationships("dataExtensions", item);
  const automations = refs.filter(ref => ref.collection === "automations").length;
  const journeys = refs.filter(ref => ref.collection === "journeys").length;
  const queries = linkedQueries.length;
  const unresolved = Math.max(0, refs.length - automations - journeys);
  return {
    total: refs.length + queries,
    queries,
    automations,
    journeys,
    unresolved
  };
}

function showDashboard() {
  state.activeCollection = null;
  renderDashboard();
}

function showStaticView(view) {
  setNav(view);
  if (view === "dashboard") {
    renderDashboard();
    return;
  }
  const viewMap = { api: "api-view", analytics: "analytics-view", utilities: "utilities-view" };
  showView(viewMap[view] || "placeholder-view");
  const labels = { api: "API Settings", analytics: "Analytics", utilities: "Utilities" };
  setText("page-eyebrow", labels[view] || "Section");
  setText("page-title", labels[view] || "Section");
  if (view === "analytics") renderAnalytics();
}

async function fetchDataExtensions(stack, journeyBase) {
  const items = await fetchPaged([
    `https://mc.${stack}.exacttarget.com/cloud/fuelapi/data-internal/v1/customobjects?retrievalType=1&includeFilterActivity=true&includeImportActivity=true&includeFullPath=true&%24search=A%25`,
    `https://dataextension.${stack}.marketingcloudapps.com/fuelapi/data/v1/async/dataextensions`,
    `${journeyBase}/fuelapi/hub/v1/dataevents`
  ], item => item.id || item.customerKey || item.key || item.name);
  return items.map(normalizeDataExtensionItem).filter(Boolean);
}


async function fetchSqlQueries(stack, journeyBase) {
  return fetchPaged([
    `https://mc.${stack}.exacttarget.com/cloud/fuelapi/automation/v1/queries`,
    `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi/automation/v1/queries`,
    `https://automation.${stack}.marketingcloudapps.com/fuelapi/automation/v1/queries`,
    `${journeyBase}/fuelapi/automation/v1/queries`
  ], item => item.id || item.queryDefinitionId || item.customerKey || item.key || item.name);
}

async function fetchAssets(stack, journeyBase) {
  const items = await fetchPaged([
    `https://mc.${stack}.exacttarget.com/cloud/fuelapi/asset/v1/assets?scope=ours`,
    `https://asset.${stack}.marketingcloudapps.com/fuelapi/asset/v1/content/assets`,
    `${journeyBase}/fuelapi/asset/v1/content/assets`
  ], item => item.id || item.customerKey || item.key || item.name);
  return items.map(normalizeAssetItem).filter(Boolean);
}

async function fetchFolders(stack, journeyBase) {
  return fetchPaged([
    `https://asset.${stack}.marketingcloudapps.com/fuelapi/asset/v1/content/categories`,
    `${journeyBase}/fuelapi/asset/v1/content/categories`
  ], item => item.id || item.categoryId || item.name);
}

async function fetchPaged(urls, getKey) {
  let lastError = null;
  for (const url of urls) {
    try {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const data = await fetchSfmc(buildPagedUrl(url, page, state.settings.pageSize || 50));
        const items = data.items || data.entry || data.results || data.data || data.assets || data.categories || [];
        if (!Array.isArray(items)) throw new Error("Response shape unknown");
        all.push(...items);
        if (items.length < (state.settings.pageSize || 50)) break;
      }
      return dedupe(all, getKey);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No endpoint worked");
}

function buildPagedUrl(rawUrl, page, pageSize) {
  const url = new URL(rawUrl);
  url.searchParams.set("$page", String(page));
  url.searchParams.set("$pageSize", String(pageSize));
  return url.toString();
}

function normalizeDataExtensionItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || item.objectID || item.customerKey || item.key || null,
    name: item.name || item.customerKey || item.key || "Untitled Data Extension",
    customerKey: item.customerKey || item.key || null,
    key: item.key || item.customerKey || null,
    description: item.description || "",
    categoryId: item.categoryId || item.category?.id || null,
    categoryFullPath: item.categoryFullPath || item.category?.fullPath || item.r__folder_Path || null,
    isActive: item.isActive ?? null,
    isSendable: item.isSendable ?? null,
    rowCount: item.rowCount ?? null,
    fieldCount: item.fieldCount ?? null,
    createdDate: item.createdDate || null,
    modifiedDate: item.modifiedDate || null,
    ownerName: item.ownerName || item.owner?.name || null,
    partnerApiObjectTypeName: item.partnerApiObjectTypeName || null
  };
}

function normalizeAssetItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || item.objectID || item.customerKey || null,
    customerKey: item.customerKey || item.legacy?.legacyKey || null,
    objectID: item.objectID || null,
    name: item.name || item.customerKey || "Untitled Asset",
    description: item.description || "",
    contentType: item.contentType || null,
    assetType: item.assetType || null,
    status: item.status?.name || item.status || null,
    category: item.category ? {
      id: item.category.id || null,
      name: item.category.name || null,
      parentId: item.category.parentId || null
    } : null,
    createdDate: item.createdDate || null,
    modifiedDate: item.modifiedDate || null,
    owner: item.owner ? {
      id: item.owner.id || null,
      name: item.owner.name || null,
      email: item.owner.email || null
    } : null,
    legacy: item.legacy ? {
      legacyId: item.legacy.legacyId || null,
      legacyKey: item.legacy.legacyKey || null,
      legacyType: item.legacy.legacyType || null,
      legacyCategoryId: item.legacy.legacyCategoryId || null
    } : null,
    thumbnailUrl: item.thumbnailUrl || null
  };
}

async function exportCollection() {
  const payload = state.activeCollection ? state.cache[state.activeCollection] : state.cache;
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  addLog("Collection exportee en JSON.");
}

async function exportCollectionCsv() {
  const key = state.activeCollection;
  const rows = state.cache[key] || [];
  if (!key || !rows.length) {
    addLog("Aucune collection active a exporter en CSV.");
    return;
  }
  const columns = COLLECTIONS[key].columns;
  const header = columns.join(",");
  const lines = rows.map(row => columns.map(col => `"${String(readPath(row, col) ?? "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sfmc-${key}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function refreshAutomationsCollection() {
  if (state.activeCollection === "automations") {
    $("collection-table").innerHTML = `<div class="empty-state">Chargement des automations...</div>`;
  }
  try {
    await loadActiveTab();
    if (!state.tab?.id || !isSfmcUrl(state.tab.url)) {
      throw new Error("Ouvre une page SFMC avant de charger les automations.");
    }
    const rows = await fetchAutomations();
    state.cache.automations = rows;
    state.updatedAt.automations = Date.now();
    await saveLocalCache();
    renderCounts();
    renderCacheTable();
    renderCollectionKpis();
    renderCollectionTable();
    addLog(`${rows.length} automation(s) chargee(s) depuis ${new URL(state.tab.url).origin}.`);
  } catch (error) {
    addLog(`Automations: ${error.message || error}`);
    if (state.activeCollection === "automations") {
      $("collection-table").innerHTML = `<div class="empty-state">Impossible de charger les automations. ${escapeHtml(error.message || String(error))}</div>`;
    }
  }
}

async function refreshJourneysCollection() {
  if (state.activeCollection === "journeys") {
    $("collection-table").innerHTML = `<div class="empty-state">Chargement des journeys...</div>`;
  }
  try {
    await loadActiveTab();
    if (!state.tab?.id || !isSfmcUrl(state.tab.url)) {
      throw new Error("Ouvre une page SFMC avant de charger les journeys.");
    }
    const rows = await fetchJourneys();
    state.cache.journeys = rows;
    state.updatedAt.journeys = Date.now();
    await saveLocalCache();
    renderCounts();
    renderCacheTable();
    renderCollectionKpis();
    renderCollectionTable();
    addLog(`${rows.length} journey(s) charge(s) depuis ${new URL(state.tab.url).origin}.`);
  } catch (error) {
    addLog(`Journeys: ${error.message || error}`);
    if (state.activeCollection === "journeys") {
      $("collection-table").innerHTML = `<div class="empty-state">Impossible de charger les journeys. ${escapeHtml(error.message || String(error))}</div>`;
    }
  }
}

function generateSql() {
  const table = $("sql-table").value;
  const days = Number($("sql-days").value || 30);
  const journeyId = $("sql-journey-id").value.trim().replace(/'/g, "''");
  const filters = [`EventDate >= DATEADD(day, -${days}, GETDATE())`];
  if (journeyId) filters.push(`JourneyID = '${journeyId}'`);
  $("sql-generated").textContent = `SELECT TOP 1000 *\nFROM ${table}\nWHERE ${filters.join("\n  AND ")}\nORDER BY EventDate DESC`;
}

async function copyGeneratedSql() {
  await navigator.clipboard.writeText($("sql-generated").textContent || "");
  addLog("Generated SQL copied.");
}

function renderGlobalSearch() {
  const box = $("global-search");
  const target = $("global-results");
  if (!box || !target) return;
  const query = box.value.trim().toLowerCase();
  target.classList.toggle("hidden", !query);
  if (!query) {
    target.innerHTML = "";
    return;
  }

  const results = [];
  Object.entries(COLLECTIONS).forEach(([collection, meta]) => {
    (state.cache[collection] || []).forEach(item => {
      const haystack = [
        item.name,
        item.customerKey,
        item.key,
        item.id,
        item.objectID,
        item.url,
        item.status,
        item.type,
        item.assetType?.name,
        item.queryText,
        item.targetUpdateTypeName
      ].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(query)) {
        results.push({ collection, label: meta.label, item });
      }
    });
  });

  if (!results.length) {
    target.innerHTML = `<div class="search-empty">No cached object found for "${escapeHtml(query)}".</div>`;
    return;
  }

  target.innerHTML = results.slice(0, 24).map((result, index) => `
    <button class="search-result" data-result-index="${index}" type="button">
      <span>${escapeHtml(result.label)}</span>
      <strong>${escapeHtml(result.item.name || result.item.customerKey || result.item.key || result.item.id || "Untitled")}</strong>
      <small>${escapeHtml(buildObjectSubtitle(result.item))}</small>
    </button>
  `).join("");

  target.querySelectorAll("[data-result-index]").forEach(button => {
    button.addEventListener("click", () => {
      const result = results[Number(button.dataset.resultIndex)];
      state.activeCollection = result.collection;
      openObject(result.item);
    });
  });
}

function safeHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

async function copyInventoryReport() {
  const lines = [
    "Sezane Monitoring inventory report",
    `Generated: ${new Date().toLocaleString("fr-FR")}`,
    `Business unit: ${$("bu-name")?.textContent || "Unknown"} ${$("bu-mid")?.textContent || ""}`,
    "",
    "Object inventory"
  ];

  Object.entries(COLLECTIONS).forEach(([key, meta]) => {
    const rows = state.cache[key] || [];
    lines.push(`- ${meta.label}: ${rows.length} object(s), ${estimateKb(rows)} KB, last updated ${formatDate(state.updatedAt[key])}`);
  });

  lines.push("", "Highlights");
  lines.push(`- Published Journeys: ${computeCollectionKpis("journeys", state.cache.journeys).find(kpi => kpi.label === "Published")?.value || "0"}`);
  lines.push(`- Automations ran in 24h: ${computeCollectionKpis("automations", state.cache.automations).find(kpi => kpi.label === "Ran 24h")?.value || "0"}`);
  lines.push(`- Captured SQL/Data Extension traces: ${state.tabState?.traces?.length || 0}`);

  await navigator.clipboard.writeText(lines.join("\n"));
  addLog("Inventory report copied.");
}

function renderRelationships(item) {
  const panel = $("relationship-panel");
  if (!panel) return;
  const refs = buildRelationships(state.activeCollection, item);
  const sqlReferences = state.activeCollection === "sqlQueries" ? extractSqlReferences(getSqlText(item)) : [];
  const automationSteps = state.activeCollection === "automations" ? extractAutomationSteps(item) : [];

  const blocks = [];
  if (refs.length) {
    blocks.push(`
      <div class="relation-card">
        <h3>Connected objects</h3>
        ${refs.slice(0, 16).map(ref => `
          <button class="relation-row" data-rel="${escapeHtml(ref.collection)}" data-ref-id="${escapeHtml(ref.id)}" type="button">
            <span>${escapeHtml(COLLECTIONS[ref.collection]?.label || ref.collection)}</span>
            <strong>${escapeHtml(ref.name)}</strong>
          </button>
        `).join("")}
      </div>
    `);
  }

  if (sqlReferences.length) {
    blocks.push(`
      <div class="relation-card">
        <h3>SQL Data Extension references</h3>
        ${sqlReferences.map(name => `<div class="pill-row">${escapeHtml(name)}</div>`).join("")}
      </div>
    `);
  }

  if (automationSteps.length) {
    blocks.push(`
      <div class="relation-card">
        <h3>Automation activities</h3>
        ${automationSteps.map(step => `
          <div class="automation-step">
            <strong>${escapeHtml(step.name)}</strong>
            <span>${escapeHtml(step.type)}</span>
          </div>
        `).join("")}
      </div>
    `);
  }

  panel.innerHTML = blocks.join("") || `
    <div class="relation-card">
      <h3>Connected objects</h3>
      <p>No relationship found in the local snapshot yet. Synchronize, then trace/open Queries, Data Extensions or Automations in SFMC.</p>
    </div>
  `;

  panel.querySelectorAll("[data-rel]").forEach(button => {
    button.addEventListener("click", () => {
      const collection = button.dataset.rel;
      const itemId = button.dataset.refId;
      const next = (state.cache[collection] || []).find(row => getStableObjectId(row) === itemId);
      if (!next) return;
      state.activeCollection = collection;
      openObject(next);
    });
  });
}

function buildRelationships(collection, item) {
  const tokens = getObjectTokens(item);
  if (!tokens.length) return [];
  const refs = [];
  Object.entries(state.cache).forEach(([otherCollection, rows]) => {
    if (otherCollection === collection) return;
    rows.forEach(row => {
      const text = JSON.stringify(row).toLowerCase();
      const matched = tokens.some(token => token.length > 3 && text.includes(token.toLowerCase()));
      if (matched) {
        refs.push({
          collection: otherCollection,
          id: getStableObjectId(row),
          name: row.name || row.customerKey || row.key || row.id || "Untitled"
        });
      }
    });
  });
  return dedupe(refs, ref => `${ref.collection}:${ref.id}`);
}

function getObjectTokens(item) {
  const tokens = [
    item.id,
    item.objectID,
    item.customerKey,
    item.key,
    item.name,
    item.queryDefinitionId,
    item.targetDataExtension?.customerKey,
    item.targetDataExtension?.name
  ];

  if (Array.isArray(item.activities)) {
    for (const act of item.activities) {
      const cfg = act.configurationArguments || {};
      tokens.push(
        cfg.dataExtensionId,
        cfg.dataExtensionKey,
        cfg.targetDataExtensionId,
        cfg.targetKey,
        cfg.contactsDataExtension,
        cfg.dataExtension?.id,
        cfg.dataExtension?.key,
        cfg.dataExtension?.name,
        act.id,
        act.key
      );
    }
  }

  return [...new Set(tokens.filter(Boolean).map(String))];
}

function getStableObjectId(item) {
  return String(item.id || item.objectID || item.customerKey || item.key || item.name || JSON.stringify(item).slice(0, 80));
}

function getSqlText(item) {
  return item.queryText || item.query || item.sql || item.text || item.category?.queryText || "";
}

function extractSqlReferences(sql) {
  if (!sql) return [];
  const refs = new Set();
  const patterns = [
    /\b(?:from|join|update|into)\s+([_\w.\[\]-]+)/gi,
    /\btarget(?:DataExtension)?\s*[:=]\s*['"]?([_\w.-]+)/gi
  ];
  patterns.forEach(pattern => {
    let match = pattern.exec(sql);
    while (match) {
      refs.add(match[1].replace(/[\[\]]/g, ""));
      match = pattern.exec(sql);
    }
  });
  return Array.from(refs).filter(Boolean);
}

function extractAutomationSteps(item) {
  const candidates = [
    item.steps,
    item.activities,
    item.automationActivities,
    item.workflow?.activities,
    item.program?.activities
  ].find(Array.isArray) || [];
  return candidates.map(step => ({
    name: step.name || step.activityObjectName || step.displayName || step.key || "Unnamed activity",
    type: step.type || step.activityType || step.objectType || "Activity"
  }));
}

function buildOpenSfmcUrl(collection, item) {
  const base = getSfmcCloudBase();
  if (!base) return null;
  if (collection === "journeys") return chrome.runtime.getURL(`journey-detail.html?journeyId=${encodeURIComponent(item.id || "")}`);
  if (collection === "automations") return `${base}/cloud/#app/Automation%20Studio`;
  if (collection === "assets") return `${base}/cloud/#app/Content%20Builder`;
  if (collection === "dataExtensions") return `${base}/cloud/#app/Contact%20Builder`;
  if (collection === "sqlQueries") return `${base}/cloud/#app/Automation%20Studio`;
  return state.tab?.url || base;
}

function getSfmcCloudBase() {
  try {
    const url = new URL(state.tab?.url || "");
    if (/mc\.s\d+\.exacttarget\.com/i.test(url.hostname)) return `${url.protocol}//${url.hostname}`;
    const stack = getStackFromUrl(state.tab?.url || "");
    return stack ? `https://mc.${stack}.exacttarget.com` : null;
  } catch {
    return null;
  }
}

function buildObjectSubtitle(item) {
  const parts = [
    item.status && `Status ${item.status}`,
    item.automationType && `Type ${item.automationType}`,
    item.lastRunStatus && `Last run ${item.lastRunStatus}`,
    item.version && `Version ${item.version}`,
    item.customerKey && `Key ${item.customerKey}`,
    item.key && `Key ${item.key}`,
    item.id && `ID ${item.id}`,
    item.type && `Type ${item.type}`,
    item.assetType?.name && `Type ${item.assetType.name}`
  ].filter(Boolean);
  return parts.slice(0, 3).join(" | ") || "Cached SFMC object";
}

function showView(id) {
  document.querySelectorAll(".buddy-view").forEach(view => view.classList.remove("active"));
  $(id).classList.add("active");
  if (id === "dashboard-view") {
    setText("page-eyebrow", "Dashboard");
    setText("page-title", "Local SFMC snapshot");
  }
}

function setNav(view) {
  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function renderSession() {
  const ok = isSfmcUrl(state.tab?.url || "");
  $("session-dot").className = `status-dot ${ok ? "ok" : "bad"}`;
  setText("session-title", ok ? "Session online" : "Session offline");
  if (state.tab?.url) {
    try {
      const url = new URL(state.tab.url);
      setText("bu-mid", getMidLabel(url));
    } catch {
      // Keep default MID text.
    }
  }
}

function renderDebug() {
  const debug = state.tabState?.debug || [];
  $("capture-status").textContent = state.tabState?.captureStatus || "idle";
  $("log").textContent = [...debug, ...state.logs].slice(-70).join("\n") || "Waiting...";
  renderTraces();
}

function renderTraces() {
  const traces = state.tabState?.traces || [];
  if (!traces.length) {
    $("trace-log").textContent = "No traces yet.";
    return;
  }
  $("trace-log").textContent = traces.slice(-80).map(trace => {
    const body = trace.postData ? `\nBODY ${trace.postData}` : "";
    return `[${new Date(trace.ts).toLocaleTimeString()}] ${trace.method} ${trace.url}${body}`;
  }).join("\n\n");
}

function getMidLabel(url) {
  const mid = url.searchParams.get("mid") || url.searchParams.get("businessUnit") || url.searchParams.get("eid");
  if (mid) return `MID: ${mid}`;
  if (/mc\.s\d+\.exacttarget\.com/i.test(url.hostname)) return "Stack BU";
  return "";
}

function isSfmcUrl(url) {
  try {
    const parsed = new URL(url);
    return /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isJourneyBuilderTab(url) {
  try {
    const parsed = new URL(url);
    return /jbinteractions\.|journey|interaction/i.test(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return false;
  }
}

function getStackFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const classic = host.match(/mc\.(s\d+)\.exacttarget\.com/i);
    if (classic) return classic[1];
    const short = host.match(/\.(s\d+)\./i);
    if (short) return short[1];
    const rest = host.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
    if (rest) return rest[1];
    return null;
  } catch {
    return null;
  }
}

function renderAnalytics() {
  const target = $("analytics-grid");
  if (!target) return;
  const journeyCounts = countBy(state.cache.journeys || [], item => normalizeJourneyStatus(item.status));
  const automationCounts = countBy(state.cache.automations || [], item => mapAutomationStatus(item.status));
  $("chart-journey-status").innerHTML = renderBarSvg(journeyCounts);
  $("chart-automation-activity").innerHTML = renderBarSvg(automationCounts);
  const top = Object.entries(state.journeyKpis).map(([id, m]) => ({ id, rate: ratio(m.uniqueOpens || m.opens || 0, m.sent || 0) || 0 })).sort((a, b) => b.rate - a.rate).slice(0, 5);
  $("chart-top-journeys").innerHTML = top.length ? top.map(row => `<div class="top-row"><span>${escapeHtml(row.id)}</span><strong>${formatPct(row.rate)}</strong></div>`).join("") : `<div class="empty-state">Run KPIs in Query Studio to populate this chart.</div>`;
}

function readPath(obj, path) {
  return String(path || "").split(".").reduce((acc, part) => acc?.[part], obj);
}

function renderBarSvg(counts) {
  const entries = Object.entries(counts).slice(0, 6);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return entries.map(([label, value], index) => {
    const x = 18 + index * 78;
    const h = Math.max(4, (value / max) * 100);
    const y = 128 - h;
    return `<rect x="${x}" y="${y}" width="46" height="${h}" rx="5" fill="#4da3ff"></rect><text x="${x}" y="148" fill="#8a9bbf" font-size="10">${escapeHtml(label.slice(0, 8))}</text><text x="${x}" y="${y - 6}" fill="#e8eef8" font-size="11">${value}</text>`;
  }).join("");
}

function updateHealth() {
  const ok = isSfmcUrl(state.tab?.url || "");
  const last = Math.max(0, ...Object.values(state.updatedAt));
  const age = last ? Date.now() - last : Infinity;
  const status = ok && age < 5 * 60000 && state.tabState?.captureStatus !== "error" ? "ok" : ok && age < 30 * 60000 ? "warn" : "bad";
  $("health-dot").className = `health-dot ${status}`;
  setText("health-label", status === "ok" ? "Monitoring OK" : status === "warn" ? "Data aging" : "Needs attention");
  setText("health-sub", last ? `Data fresh ${relativeTime(last)}` : "No snapshot yet");
}

async function openGeneratedSqlInQueryStudio() {
  const sql = $("sql-generated").textContent || "";
  await chrome.storage.local.set({ sfmcBuddyPendingQuery: { journeyId: null, sql, createdAt: Date.now() } });
  chrome.tabs.create({ url: "https://querystudio.herokuapp.com/" });
}

function renderUrlInspector() {
  const raw = $("url-inspector-input").value.trim();
  if (!raw) {
    $("url-inspector-result").textContent = "";
    return;
  }
  try {
    const url = new URL(raw);
    $("url-inspector-result").innerHTML = `<div>Host: <strong>${escapeHtml(url.hostname)}</strong></div><div>Stack: <strong>${escapeHtml(getStackFromUrl(raw) || "--")}</strong></div><div>MID: <strong>${escapeHtml(getMidLabel(url) || "--")}</strong></div><div>SFMC: <strong>${isSfmcUrl(raw) ? "yes" : "no"}</strong></div>`;
  } catch {
    $("url-inspector-result").textContent = "Invalid URL";
  }
}

async function purgeCache(collection) {
  if (collection === "all") {
    state.cache = Object.fromEntries(Object.keys(COLLECTIONS).map(key => [key, []]));
    state.updatedAt = {};
  } else if (state.cache[collection]) {
    state.cache[collection] = [];
    delete state.updatedAt[collection];
  }
  await saveLocalCache();
  renderDashboard();
}

async function exportSnapshot() {
  const blob = new Blob([JSON.stringify({ cache: state.cache, updatedAt: state.updatedAt }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sfmc-buddy-snapshot-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSnapshot(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const parsed = JSON.parse(String(reader.result || "{}"));
    state.cache = { ...state.cache, ...parsed.cache };
    state.updatedAt = parsed.updatedAt || state.updatedAt;
    await saveLocalCache();
    renderDashboard();
  };
  reader.readAsText(file);
}

function setLoading(on) {
  $("btn-reload").textContent = on ? "Synchronizing..." : "Synchronize";
  $("btn-reload").disabled = on;
  $("btn-update-all").disabled = on;
}

function addLog(line) {
  state.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  state.logs = state.logs.slice(-50);
  renderDebug();
}

function dedupe(items, getKey) {
  const seen = new Set();
  return items.filter((item, index) => {
    const key = getKey(item) || `row-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateKb(value) {
  return (JSON.stringify(value || []).length / 1024).toFixed(1);
}

function estimateCacheKb() {
  return (JSON.stringify(state.cache).length / 1024).toFixed(1);
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR");
}

function relativeTime(value) {
  if (!value) return "--";
  const diff = Math.max(0, Date.now() - Number(value));
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} h ago`;
  return new Date(value).toLocaleDateString("fr-FR");
}

function formatCell(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function mapAutomationStatus(status) {
  const map = {
    1: "Building",
    2: "Ready",
    3: "Paused",
    PausedSchedule: "PausedSchedule",
    4: "Deleted",
    5: "Active",
    6: "Running",
    7: "Stopped",
    8: "Scheduled",
    "-1": "Error",
    error: "Error"
  };
  const value = String(status || "Unknown");
  if (/pausedschedule/i.test(value)) return "PausedSchedule";
  if (/awaitingtrigger/i.test(value)) return "AwaitingTrigger";
  if (/inactivetrigger/i.test(value)) return "InactiveTrigger";
  return map[value] || value;
}

function statusBadge(status) {
  const value = String(status || "Unknown");
  const cls = /publish|active|ready|running/i.test(value)
    ? "badge-success"
    : /draft|build/i.test(value)
      ? "badge-neutral"
      : /stop|pause|error|fail/i.test(value)
        ? "badge-danger"
        : "badge-warning";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function automationStatusBadge(status) {
  const value = mapAutomationStatus(status);
  const cls = value === "Scheduled"
    ? "badge-success"
    : /PausedSchedule|Ready/i.test(value)
      ? "badge-warning"
      : /InactiveTrigger|Error/i.test(value)
        ? "badge-danger"
        : /AwaitingTrigger/i.test(value)
          ? "badge-info"
          : "badge-neutral";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function inferAutomationType(item) {
  const text = JSON.stringify([
    item.type,
    item.automationType,
    item.scheduleType,
    item.schedule,
    item.fileTrigger,
    item.startSource,
    item.triggerType
  ]).toLowerCase();
  if (/trigger|filedrop|fired|event/i.test(text)) return "triggered";
  return "scheduled";
}

function formatAutomationRunStatus(status) {
  if (status == null || status === "") return "—";
  if (typeof status === "string") return status;
  const map = {
    1: "Scheduled",
    2: "Running",
    3: "Completed",
    4: "Stopped",
    5: "Error",
    "-1": "Error"
  };
  return map[String(status)] || String(status);
}

function formatAutomationDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR");
}

function ratio(a, b) {
  return b ? a / b : null;
}

function formatPct(value) {
  return value == null ? "--" : `${Math.round(value * 1000) / 10}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
