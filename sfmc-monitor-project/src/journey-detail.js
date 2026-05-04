const $ = id => document.getElementById(id);

const state = {
  journey: null,
  detail: null,
  metrics: emptyMetrics()
};

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadJourney();
  render();
});

function bindEvents() {
  $("btn-copy-sql").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("sql-output").textContent);
  });
  $("btn-auto-query").addEventListener("click", autoRunQueryStudio);
  $("btn-export").addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify({
      journey: state.journey,
      detail: state.detail,
      metrics: state.metrics
    }, null, 2));
  });
  $("btn-apply-data").addEventListener("click", () => {
    const raw = $("data-view-input").value.trim();
    if (!raw) return;
    const rows = parseInput(raw);
    state.metrics = aggregateRows(rows);
    renderDeliveryKpis();
  });
  $("btn-load-query-result").addEventListener("click", loadCapturedQueryResult);
}

async function loadJourney() {
  const journeyId = new URL(location.href).searchParams.get("journeyId");
  const data = await chrome.storage.local.get(["sfmcBuddyCache", "sfmcProcessMinerState"]);
  const journeys = data.sfmcBuddyCache?.cache?.journeys || [];
  state.journey = journeys.find(item => item.id === journeyId) || null;

  const tabs = data.sfmcProcessMinerState?.tabs || {};
  for (const tabState of Object.values(tabs)) {
    if (tabState.journeys?.[journeyId]) {
      state.detail = tabState.journeys[journeyId];
      break;
    }
  }

  state.detail = state.detail || state.journey;
}

function render() {
  const journey = state.detail || state.journey;
  if (!journey) {
    $("journey-title").textContent = "Journey not found in local cache";
    return;
  }

  $("journey-title").textContent = journey.name || journey.id;
  $("journey-meta").textContent = `ID ${journey.id || "--"} | Customer key ${journey.key || journey.customerKey || "--"}`;
  $("k-status").textContent = journey.status || "--";
  $("k-version").textContent = journey.version || journey.versionNumber || journey.latestVersionNumber || "--";
  $("k-activities").textContent = (journey.activities || []).length;
  $("k-goals").textContent = (journey.goals || []).length;
  $("steps-count").textContent = `${(journey.activities || []).length} step(s)`;
  $("sql-output").textContent = buildSql(journey);
  $("raw-json").textContent = JSON.stringify(journey, null, 2);
  renderSteps(journey.activities || []);
  renderDeliveryKpis();
}

function renderSteps(activities) {
  if (!activities.length) {
    $("steps-list").innerHTML = `<div class="empty-state">No activities in cached detail. Open the Journey in SFMC and synchronize again.</div>`;
    return;
  }
  $("steps-list").innerHTML = activities.map((activity, index) => {
    const stats = activity.stats || {};
    return `<div class="step-detail-card">
      <div>
        <strong>${escapeHtml(index + 1)}. ${escapeHtml(activity.name || activity.key || "Unnamed activity")}</strong>
        <span>${escapeHtml(activity.type || "UNKNOWN")}</span>
      </div>
      <dl>
        <dt>Key</dt><dd>${escapeHtml(activity.key || "--")}</dd>
        <dt>In</dt><dd>${formatNumber(stats.contactsIn || stats.currentPopulation?.count || 0)}</dd>
        <dt>Out</dt><dd>${formatNumber(stats.contactsOut || stats.contactsMet || 0)}</dd>
        <dt>Error</dt><dd>${formatNumber(stats.contactsError || 0)}</dd>
        <dt>Queued</dt><dd>${formatNumber(stats.contactsQueued || 0)}</dd>
      </dl>
    </div>`;
  }).join("");
}

function renderDeliveryKpis() {
  const sent = state.metrics.sent;
  const delivered = state.metrics.delivered || Math.max(0, sent - state.metrics.bounces);
  const opens = state.metrics.uniqueOpens || state.metrics.opens;
  const clicks = state.metrics.uniqueClicks || state.metrics.clicks;
  $("k-sent").textContent = formatNumber(sent);
  $("k-delivered").textContent = formatNumber(delivered);
  $("k-opens").textContent = formatNumber(opens);
  $("k-clicks").textContent = formatNumber(clicks);
  $("k-open-rate").textContent = formatPct(ratio(opens, delivered || sent));
  $("k-ctr").textContent = formatPct(ratio(clicks, delivered || sent));
  $("k-ctor").textContent = formatPct(ratio(clicks, opens));
  $("k-bounce-rate").textContent = formatPct(ratio(state.metrics.bounces, sent));
}

async function autoRunQueryStudio() {
  const journey = state.detail || state.journey;
  if (!journey?.id) return;
  await chrome.storage.local.set({
    sfmcBuddyPendingQuery: {
      journeyId: journey.id,
      sql: $("sql-output").textContent,
      createdAt: Date.now()
    }
  });
  chrome.tabs.create({ url: "https://querystudio.herokuapp.com/" });
}

async function loadCapturedQueryResult() {
  const journey = state.detail || state.journey;
  const data = await chrome.storage.local.get(["sfmcBuddyQueryResults"]);
  const results = (data.sfmcBuddyQueryResults || [])
    .filter(item => !journey?.id || item.journeyId === journey.id)
    .sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0));
  const latest = results[0];
  if (!latest?.body) return;
  $("data-view-input").value = latest.body;
  const rows = parseInput(latest.body);
  state.metrics = aggregateRows(rows);
  renderDeliveryKpis();
}

function buildSql(journey) {
  const id = String(journey.id || "").replace(/'/g, "''");
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
WHERE j.JourneyID = '${id}'
  AND s.EventDate >= DATEADD(day, -180, GETDATE())
GROUP BY j.JourneyID, j.JourneyName, ja.ActivityName, ja.ActivityType`;
}

function parseInput(raw) {
  if (/<table|<thead|<tbody/i.test(raw)) return parseHtmlTable(raw);
  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCsv(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
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

function splitCsv(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function aggregateRows(rows) {
  const metrics = emptyMetrics();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const metric = normalizeKey(key);
      if (!metric) continue;
      const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(n)) metrics[metric] += n;
    }
  }
  return metrics;
}

function emptyMetrics() {
  return { sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0, bounces: 0, unsubs: 0 };
}

function normalizeKey(key) {
  const k = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  return {
    sent: "sent",
    delivered: "delivered",
    opens: "opens",
    uniqueopens: "uniqueOpens",
    clicks: "clicks",
    uniqueclicks: "uniqueClicks",
    bounces: "bounces",
    unsubs: "unsubs",
    unsubscribes: "unsubs"
  }[k];
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
