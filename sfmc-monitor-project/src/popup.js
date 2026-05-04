const COLLECTIONS = {
  folders: { label: "Folders", columns: ["name", "id", "type"] },
  dataExtensions: { label: "Data Extensions", columns: ["name", "customerKey", "id"] },
  sqlQueries: { label: "SQL Queries", columns: ["name", "customerKey", "status"] },
  publicationLists: { label: "Publication Lists", columns: ["name", "id", "source"] },
  canvasActivities: { label: "Canvas Activities", columns: ["name", "key", "type"] },
  errors: { label: "Error Messages", columns: ["status", "url", "message"] },
  automations: { label: "Automations", columns: ["name", "status", "lastRunTime"] },
  assets: { label: "Assets", columns: ["name", "assetType", "id"] },
  journeys: { label: "Journeys", columns: ["name", "status", "version"] }
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
  journeyKpisUpdatedAt: null
};

const $ = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadActiveTab();
  await loadLocalCache();
  await loadJourneyKpis();
  await refreshState();
  renderDashboard();
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
  $("btn-export").addEventListener("click", exportCollection);
  $("collection-search").addEventListener("input", () => renderCollectionTable());
  $("global-search").addEventListener("input", () => renderGlobalSearch());

  document.querySelectorAll("[data-collection]").forEach(button => {
    button.addEventListener("click", () => showCollection(button.dataset.collection));
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  renderSession();
}

async function loadLocalCache() {
  const data = await chrome.storage.local.get(["sfmcBuddyCache"]);
  if (data.sfmcBuddyCache) {
    state.cache = { ...state.cache, ...data.sfmcBuddyCache.cache };
    state.updatedAt = data.sfmcBuddyCache.updatedAt || {};
  }
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
  await loadActiveTab();
  if (!state.tab?.id || !isSfmcUrl(state.tab.url)) {
    addLog("Ouvre SFMC avant de synchroniser.");
    renderSession();
    return;
  }

  setLoading(true);
  addLog("Synchronize: Journeys, Automations, capture reseau.");
  chrome.runtime.sendMessage({ type: "POPUP_START_CAPTURE", tabId: state.tab.id, mode: "journey" }).catch(() => null);

  const stack = getStackFromUrl(state.tab.url);
  if (!stack) {
    addLog("Stack SFMC introuvable.");
    setLoading(false);
    return;
  }

  const journeyBase = `https://jbinteractions.${stack}.marketingcloudapps.com`;
  state.cache.journeys = await fetchJourneys(journeyBase);
  state.updatedAt.journeys = Date.now();
  addLog(`${state.cache.journeys.length} Journeys synchronisees.`);

  state.cache.automations = await fetchAutomations(stack, journeyBase);
  state.updatedAt.automations = Date.now();
  addLog(`${state.cache.automations.length} Automations synchronisees.`);

  await saveLocalCache();
  await refreshState();
  setLoading(false);
  renderDashboard();
  renderGlobalSearch();
  if (state.activeCollection) renderCollectionTable();
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
    mode: "sql"
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

async function fetchJourneys(base) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({
      mostRecentVersionOnly: "false",
      mostRecentVersionOrRunningOnly: "true",
      "$page": String(page),
      "$pageSize": "50",
      extras: "trigger,stats,tag,activity,campaigns",
      "$orderBy": "name asc"
    });
    const data = await fetchSfmc(`${base}/fuelapi/interaction/v1/interactions/?${params}`).catch(err => {
      addLog(`Journeys page ${page}: ${err.message}`);
      return null;
    });
    const items = data?.items || [];
    all.push(...items);
    if (items.length < 50) break;
  }
  return dedupe(all, item => item.id || item.key || item.name);
}

async function fetchAutomations(stack, journeyBase) {
  const bases = [
    `https://automationstudio.${stack}.marketingcloudapps.com`,
    `https://automation.${stack}.marketingcloudapps.com`,
    `https://automationstudioshell.${stack}.marketingcloudapps.com`,
    journeyBase
  ];
  const paths = ["/fuelapi/automation/v1/automations", "/fuelapi/automation/v1/automations/", "/automation/v1/automations"];
  for (const base of bases) {
    for (const path of paths) {
      const first = await fetchAutomationPage(base, path, 1).catch(() => null);
      if (!first) continue;
      const all = [...first];
      for (let page = 2; first.length === 50 && page <= 20; page++) {
        const items = await fetchAutomationPage(base, path, page).catch(() => []);
        all.push(...items);
        if (items.length < 50) break;
      }
      return dedupe(all, item => item.id || item.objectID || item.customerKey || item.name);
    }
  }
  return [];
}

async function fetchAutomationPage(base, path, page) {
  const params = new URLSearchParams({ "$pageSize": "50", "$page": String(page) });
  const data = await fetchSfmc(`${base}${path}?${params}`);
  const items = data.items || data.entry || data.automations || [];
  if (!Array.isArray(items)) throw new Error("Automation response shape unknown");
  return items;
}

async function fetchSfmc(url) {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC", url });
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
  for (const key of Object.keys(COLLECTIONS)) {
    const count = state.cache[key]?.length || 0;
    total += count;
    setText(`count-${key}`, formatNumber(count));
  }
  setText("cached-total", formatNumber(total));
  setText("last-sync", formatDate(Math.max(0, ...Object.values(state.updatedAt))));
  setText("storage-usage", `${estimateCacheKb()} Ko / 10 Mo`);
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
  setText("collection-eyebrow", "Cached collection");
  $("collection-search").value = "";
  $("btn-run-all-kpis").style.display = key === "journeys" ? "" : "none";
  renderCollectionKpis();
  renderCollectionTable();
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
  const rows = (state.cache[key] || []).filter(item =>
    !query || JSON.stringify(item).toLowerCase().includes(query)
  );
  setText("collection-count", `${formatNumber(rows.length)} object${rows.length > 1 ? "s" : ""}`);
  if (!rows.length) {
    $("collection-table").innerHTML = `<div class="empty-state">Aucun objet cache pour ${escapeHtml(meta.label)}.</div>`;
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
      cells = `<td>${escapeHtml(formatCell(item.name))}</td><td>${escapeHtml(formatCell(item.status))}</td>${kpiCell}`;
    } else {
      cells = meta.columns.map(column => `<td>${escapeHtml(formatCell(item[column]))}</td>`).join("");
    }
    return `<button class="object-row" data-index="${index}" type="button"><table><tr>${cells}</tr></table></button>`;
  }).join("");
  $("collection-table").querySelectorAll("[data-index]").forEach((button, index) => {
    button.addEventListener("click", () => openObject(rows[index]));
  });
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
      { label: "Scheduled", value: formatNumber(rows.filter(item => item.schedule?.scheduleTypeId || mapAutomationStatus(item.status) === "Scheduled").length) },
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
  showObjectDetail(item);
}

function showObjectDetail(item) {
  state.activeObject = item;
  showView("detail-view");
  setText("detail-title", item.name || item.customerKey || item.id || "Object detail");
  const sfmcUrl = buildOpenSfmcUrl(state.activeCollection, item);
  $("detail-content").innerHTML = `
    <div class="object-detail-card">
      <div>
        <span class="eyebrow">${escapeHtml(COLLECTIONS[state.activeCollection]?.label || "Object")}</span>
        <h3>${escapeHtml(item.name || item.customerKey || item.id || "Object detail")}</h3>
        <p>${escapeHtml(buildObjectSubtitle(item))}</p>
      </div>
      ${sfmcUrl ? `<button class="blue-link-box" data-open-sfmc type="button">Open in SFMC</button>` : ""}
    </div>
    <pre class="json-view">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
  `;
  $("detail-content").querySelector("[data-open-sfmc]")?.addEventListener("click", () => chrome.tabs.create({ url: sfmcUrl }));
  renderRelationships(item);
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
  showView("placeholder-view");
  const labels = { api: "API Settings", analytics: "Analytics", utilities: "Utilities" };
  setText("page-eyebrow", labels[view] || "Section");
  setText("page-title", labels[view] || "Section");
  setText("placeholder-text", `${labels[view]} sera une page dediee ici.`);
}

async function exportCollection() {
  const payload = state.activeCollection ? state.cache[state.activeCollection] : state.cache;
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  addLog("Collection exportee en JSON.");
}

function renderGlobalSearch() {
  const box = $("global-search");
  const target = $("global-results");
  if (!box || !target) return;
  const query = box.value.trim().toLowerCase();
  if (!query) {
    target.innerHTML = `<div class="search-empty">Search Journeys, Automations, Queries, Data Extensions, Assets and captured errors.</div>`;
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

async function copyInventoryReport() {
  const lines = [
    "SFMC Buddy inventory report",
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
  return [
    item.id,
    item.objectID,
    item.customerKey,
    item.key,
    item.name,
    item.queryDefinitionId,
    item.targetDataExtension?.customerKey,
    item.targetDataExtension?.name
  ].filter(Boolean).map(String);
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
  const mid = url.searchParams.get("mid");
  return mid ? `(${mid})` : "(536005700)";
}

function isSfmcUrl(url) {
  try {
    const parsed = new URL(url);
    return /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function getStackFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/mc\.(s\d+)\.exacttarget\.com/i) || host.match(/\.s(\d+)\./i);
    if (!match) return null;
    return match[1].startsWith("s") ? match[1] : `s${match[1]}`;
  } catch {
    return null;
  }
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
    4: "Deleted",
    5: "Active",
    6: "Running",
    7: "Stopped",
    8: "Scheduled",
    "-1": "Error",
    error: "Error"
  };
  return map[String(status)] || String(status || "Unknown");
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
