import { create } from "zustand";
import type {
  View,
  CollectionKey,
  CachedItem,
  JourneyKpis,
  AppSettings,
  TabState,
  StorageMinerData,
  JourneyHistoryEntry,
  JourneyHistorySearchRequest,
  AlertRule,
  AlertSettings,
  RuleViolation,
  AutomationKpis,
} from "./types";
import { DEFAULT_ALERT_SETTINGS } from "./types";
import { deriveAutomationKpis } from "../utils/automationKpis";

const COLLECTIONS: CollectionKey[] = [
  "journeys",
  "automations",
  "sqlQueries",
  "dataExtensions",
  "assets",
  "folders",
  "publicationLists",
  "canvasActivities",
  "errors",
];

const DEFAULT_SETTINGS: AppSettings = {
  journeyTimeout: 60,
  pageSize: 50,
  autoRefresh: false,
  autoInterval: 5,
  lang: "fr",
};

interface AppStore {
  activeView: View;
  activeCollection: CollectionKey | null;
  activeObjectId: string | null;
  cache: Record<CollectionKey, CachedItem[]>;
  updatedAt: Record<string, number>;
  journeyKpis: Record<string, JourneyKpis>;
  settings: AppSettings;
  tabState: TabState | null;
  activeTab: chrome.tabs.Tab | null;
  storageMinerData: StorageMinerData | null;
  journeyHistoryResults: JourneyHistoryEntry[];
  journeyHistoryTotal: number;
  journeyHistoryLoading: boolean;
  journeyHistoryError: string | null;
  loading: boolean;
  logs: string[];
  searchQuery: string;
  rules: AlertRule[];
  alertSettings: AlertSettings;
  ruleViolations: RuleViolation[];
  ruleCheckedAt: number;
  automationKpis: Record<string, AutomationKpis>;
  automationKpiProgress: { done: number; total: number } | null;
  setView: (view: View, collectionKey?: CollectionKey, objectId?: string) => void;
  setSearchQuery: (q: string) => void;
  addLog: (line: string) => void;
  setLoading: (v: boolean) => void;
  loadAll: () => Promise<void>;
  saveSettings: (s: Partial<AppSettings>) => Promise<void>;
  synchronize: () => Promise<void>;
  purgeCache: (collection: CollectionKey | "all") => Promise<void>;
  exportSnapshot: () => object;
  importSnapshot: (data: unknown) => Promise<void>;
  searchJourneyHistory: (req: JourneyHistorySearchRequest) => Promise<void>;
  fetchJourneyDetail: (journeyId: string, version?: number | null) => Promise<void>;
  fetchAutomationDetail: (automationId: string, opts?: { silent?: boolean }) => Promise<void>;
  refreshAllAutomationKpis: (cap?: number) => Promise<void>;
  fetchQueryDetail: (queryId: string) => Promise<void>;
  fetchKpisFromDataViews: (journeyId: string, journeyName: string, tsIds: string[]) => Promise<void>;
  saveRule: (rule: AlertRule) => Promise<void>;
  deleteRule: (ruleId: string) => Promise<void>;
  toggleRule: (ruleId: string) => Promise<void>;
  saveAlertSettings: (patch: Partial<AlertSettings>) => Promise<void>;
  checkRules: (forceRuleId?: string) => Promise<void>;
  ensureKpisForScope: (scope: string) => Promise<void>;
  runRuleNow: (rule: AlertRule) => Promise<void>;
  sendTestAlert: () => Promise<void>;
}

function emptyCache(): Record<CollectionKey, CachedItem[]> {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, []])) as Record<CollectionKey, CachedItem[]>;
}

function addLogLine(logs: string[], line: string): string[] {
  const ts = new Date().toLocaleTimeString();
  return [...logs, `[${ts}] ${line}`].slice(-120);
}

async function fetchSfmc(url: string, tabId?: number, silent?: boolean): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC", url, tabId, silent: !!silent });
  if (!res?.ok) throw new Error(res?.error || "Fetch failed");
  return res.data;
}


async function fetchSfmcJb(url: string, tabId?: number, silent?: boolean): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC_JB", url, tabId, silent: !!silent });
  if (!res?.ok) throw new Error(res?.error || "JB fetch failed");
  return res.data;
}

// Fetch through the Automation Studio iframe (same-origin) — required for the
// legacy /automations/.../history endpoint (CORS-blocked from the top page).
async function fetchSfmcAs(url: string, tabId?: number, silent?: boolean): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC_AS", url, tabId, silent: !!silent });
  if (!res?.ok) throw new Error(res?.error || "AS fetch failed");
  return res.data;
}

async function fetchSfmcPost(url: string, body: unknown, tabId?: number): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC_POST", url, body, tabId });
  if (!res?.ok) throw new Error(res?.error || "POST fetch failed");
  return res.data;
}

async function fetchSfmcSoap(url: string, xmlTemplate: string, tabId?: number): Promise<string> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC_SOAP", url, xmlTemplate, tabId });
  if (!res?.ok) throw new Error(res?.error || "SOAP fetch failed");
  return String(res.data?.raw || "");
}

function getStack(tabUrl: string): string | null {
  try {
    const url = new URL(tabUrl);
    const match = url.hostname.match(/\.s(\d+)\.|mc\.s(\d+)\./i);
    if (match) return `s${match[1] || match[2]}`;
    const apiMatch = url.hostname.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
    if (apiMatch) return apiMatch[1];
  } catch {
    return null;
  }
  return null;
}

function isSfmcUrl(url: string): boolean {
  return /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i.test(url);
}

function normalizeJourneyItem(item: Record<string, unknown>): CachedItem {
  const rawStats = item.stats && typeof item.stats === "object"
    ? item.stats as Record<string, unknown>
    : null;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cumPop = num(rawStats?.cumulativePopulation ?? item.cumulativePopulation);
  // The journey list (extras=counters) returns rich stats for free — keep them all.
  const stats = {
    cumulativePopulation: cumPop,
    currentPopulation: num(rawStats?.currentPopulation),
    metGoal: num(rawStats?.metGoal),
    metExitCriteria: num(rawStats?.metExitCriteria),
    goalPerformance: num(rawStats?.goalPerformance),
  };
  return {
    id: String(item.id || item.definitionId || item.key || ""),
    definitionId: item.definitionId ? String(item.definitionId) : null,
    key: String(item.key || item.definitionKey || item.id || ""),
    name: String(item.name || item.journeyName || item.key || "Untitled"),
    status: String(item.status || item.scheduledStatus || "Unknown"),
    scheduledStatus: item.scheduledStatus ? String(item.scheduledStatus) : null,
    version: item.version || item.versionNumber || null,
    customerKey: item.customerKey || item.key || null,
    categoryId: item.categoryId || null,
    channel: item.channel ?? null,
    definitionType: item.definitionType ?? null,
    entryMode: item.entryMode ?? null,
    goalCount: Array.isArray(item.goals) ? item.goals.length : null,
    modifiedDate: item.modifiedDate || null,
    lastPublishedDate: item.lastPublishedDate || null,
    stats,
    cumulativePopulation: cumPop,
    capturedAt: Date.now(),
  };
}

// SFMC automation "program" status (statusId → label). Returned as a number by
// both /automation/v1/automations and the legacy gridView endpoint.
const AUTOMATION_STATUS_ID: Record<string, string> = {
  "-1": "Error", "0": "BuildingError", "1": "Building", "2": "Ready",
  "3": "Running", "4": "Paused", "5": "Stopped", "6": "Scheduled",
  "7": "AwaitingTrigger", "8": "InactiveTrigger",
};
// SFMC run-instance status (lastRunStatus / run history). Different enum.
const RUN_STATUS_ID: Record<string, string> = {
  "0": "Queued", "1": "Complete", "2": "Error", "3": "Running", "4": "Stopped",
  "5": "Scheduled", "6": "Paused", "7": "Skipped", "8": "InactiveTrigger",
  "9": "Building", "10": "Initializing", "100": "Complete", "200": "Error", "300": "Running",
};

// Map a status value to a human label. Strings that aren't pure numbers are kept
// as-is (already a label); numeric ids are looked up in the supplied enum.
function labelStatus(val: unknown, map: Record<string, string>): string | null {
  if (val == null || val === "") return null;
  if (typeof val === "string" && !/^-?\d+$/.test(val.trim())) return val;
  const key = String(Number(val));
  return map[key] || String(val);
}

// Map the gridView's `processes[]` (steps, each with workerCounts → activities)
// into the shape the Steps tab + activity-count aggregation expect.
function mapAutomationSteps(item: Record<string, unknown>): Record<string, unknown>[] | null {
  const processes = Array.isArray(item.processes) ? item.processes as Record<string, unknown>[] : null;
  if (!processes) return null;
  return processes.map((p, i) => ({
    stepNumber: (Number(p.sequence) || i) + 1,
    name: String(p.name || `Step ${i + 1}`),
    status: labelStatus(p.status, RUN_STATUS_ID) ?? String(p.status ?? ""),
    activities: (Array.isArray(p.workerCounts) ? p.workerCounts as Record<string, unknown>[] : []).map(w => ({
      name: String(w.name || w.activityName || ""),
      activityType: w.objectTypeId ?? w.activityType ?? null,
      objectTypeId: w.objectTypeId ?? null,
      count: w.count ?? null,
      status: w.status ?? null,
    })),
  }));
}

function normalizeAutomationItem(item: Record<string, unknown>): CachedItem {
  const status = labelStatus(
    item.status ?? item.statusId ?? item.statusName ?? item.automationStatus ?? item.programStatus,
    AUTOMATION_STATUS_ID,
  ) ?? "Unknown";
  const lastRunStatus = labelStatus(
    item.lastRunStatus ?? item.lastRunStatusId ?? item.lastRunStatusName ?? item.lastRunInstanceStatus,
    RUN_STATUS_ID,
  ) ?? "";
  const steps = mapAutomationSteps(item);
  return {
    id: String(item.id || item.objectID || item.automationId || item.customerKey || ""),
    name: String(item.name || item.automationName || item.customerKey || "Untitled"),
    customerKey: item.customerKey || item.key || null,
    status,
    lastRunStatus,
    lastRunTime: String(item.lastRunTime || item.lastRunAt || item.modifiedDate || ""),
    nextRunTime: item.nextRunTime || item.nextScheduledTime || item.scheduledTime || null,
    automationType: item.automationType ?? item.type ?? item.typeId ?? null,
    description: item.description || null,
    categoryId: item.categoryId ?? null,
    modifiedDate: item.modifiedDate || null,
    createdDate: item.createdDate || null,
    // Rich gridView fields powering the KPIs (no extra fetch needed).
    ...(steps ? { steps } : {}),
    startTime: item.startTime ?? null,
    completedTime: item.completedTime ?? null,
    scheduledTime: item.scheduledTime ?? null,
    instanceId: item.instanceId ?? null,
    schedule: typeof item.schedule === "string" ? item.schedule : (item.schedule ?? null),
    notifications: Array.isArray(item.notifications) ? item.notifications : null,
    capturedAt: Date.now(),
  };
}

function normalizeDataExtensionItem(item: Record<string, unknown>): CachedItem {
  return {
    id: String(item.id || item.objectID || item.customerKey || item.key || ""),
    name: String(item.name || item.displayName || item.customerKey || item.key || "Untitled Data Extension"),
    customerKey: String(item.customerKey || item.key || ""),
    status: String(item.isActive === false ? "Inactive" : item.isSendable ? "Sendable" : item.status || "Available"),
    categoryId: item.categoryId || null,
    categoryFullPath: item.categoryFullPath || null,
    rowCount: item.rowCount ?? null,
    fieldCount: item.fieldCount ?? null,
    ownerName: item.ownerName || null,
    modifiedDate: item.modifiedDate || null,
    capturedAt: Date.now(),
  };
}

function normalizeSqlQueryItem(item: Record<string, unknown>): CachedItem {
  return {
    id: String(item.queryDefinitionId || item.id || item.objectID || item.customerKey || item.key || ""),
    name: String(item.name || item.customerKey || item.key || "Untitled Query"),
    customerKey: String(item.customerKey || item.key || ""),
    status: String(item.status || item.statusName || item.queryStatus || "Unknown"),
    modifiedDate: item.modifiedDate || null,
    categoryId: item.categoryId || null,
    capturedAt: Date.now(),
  };
}

function normalizeAssetItem(item: Record<string, unknown>): CachedItem {
  const assetType = item.assetType as Record<string, unknown> | undefined;
  const status = item.status as Record<string, unknown> | string | undefined;
  return {
    id: String(item.id || item.objectID || item.customerKey || item.key || ""),
    name: String(item.name || item.customerKey || "Untitled Asset"),
    customerKey: String(item.customerKey || item.key || ""),
    status: String(typeof status === "object" ? status?.name || "Available" : status || "Available"),
    assetType: assetType?.name || assetType?.displayName || item.contentType || null,
    contentType: item.contentType || null,
    categoryId: (item.category as Record<string, unknown> | undefined)?.id || item.categoryId || null,
    categoryName: (item.category as Record<string, unknown> | undefined)?.name || null,
    modifiedDate: item.modifiedDate || null,
    ownerName: (item.owner as Record<string, unknown> | undefined)?.name || null,
    capturedAt: Date.now(),
  };
}

function normalizeFolderItem(item: Record<string, unknown>): CachedItem {
  return {
    id: String(item.id || item.categoryId || item.objectID || item.key || ""),
    name: String(item.name || item.categoryName || item.key || "Untitled Folder"),
    customerKey: String(item.customerKey || item.key || ""),
    status: String(item.categoryType || item.type || item.objectType || "Folder"),
    type: item.categoryType || item.type || item.objectType || "Folder",
    parentId: item.parentId || null,
    hasChildren: item.hasChildren ?? null,
    modifiedDate: item.lastUpdated || item.modifiedDate || null,
    capturedAt: Date.now(),
  };
}

function dedupe<T extends CachedItem>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = String(item.id || item.key || item.name || item.customerKey || Math.random());
    map.set(key, item);
  }
  return [...map.values()];
}

function buildPagedUrl(rawUrl: string, page: number, pageSize: number): string {
  const url = new URL(rawUrl);
  url.searchParams.set("$page", String(page));
  url.searchParams.set("$pageSize", String(pageSize));
  return url.toString();
}

function extractArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];
  const source = data as Record<string, unknown>;
  const candidates = [
    source.items,
    source.entry,
    source.results,
    source.data,
    source.list,       // Fuel3 history response: { list: [...], count: N }
    source.history,    // Some endpoints use "history" key
    source.runs,       // Some endpoints use "runs" key
    source.interactions,
    source.objects,
    source.records,
    source.rows,
    source.automations,
    source.assets,
    source.categories,
    source.value,
    source.entities,
    (source.results as Record<string, unknown> | undefined)?.items,
    (source.data as Record<string, unknown> | undefined)?.items,
    (source.payload as Record<string, unknown> | undefined)?.items,
    (source.payload as Record<string, unknown> | undefined)?.results,
  ];
  const list = candidates.find(Array.isArray);
  if (list) return list as Record<string, unknown>[];
  for (const value of Object.values(source)) {
    if (Array.isArray(value) && value.every((item) => item && typeof item === "object")) {
      return value as Record<string, unknown>[];
    }
  }
  if (source.id || source.name) return [source];
  return [];
}

async function resolveSfmcTab(): Promise<chrome.tabs.Tab | null> {
  const querySets: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { currentWindow: true },
    {},
  ];

  for (const query of querySets) {
    const tabs = await chrome.tabs.query(query);
    const eligible = tabs.filter((tab) => Number.isInteger(tab.id));
    const sfmcTabs = eligible.filter((tab) => tab.url && isSfmcUrl(tab.url));
    if (!sfmcTabs.length) continue;
    return (
      sfmcTabs.find((tab) => tab.active) ||
      sfmcTabs.find((tab) => /automationstudio|journey|exacttarget|marketingcloud/i.test(tab.url || "")) ||
      sfmcTabs[0] ||
      null
    );
  }

  return null;
}

async function fetchFromCandidates<T extends CachedItem>(
  urls: string[],
  pageSize: number,
  tabId: number,
  normalizer: (item: Record<string, unknown>) => T,
): Promise<T[]> {
  let lastError: Error | null = null;

  for (const rawUrl of urls) {
    try {
      const all: T[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const data = await fetchSfmc(buildPagedUrl(rawUrl, page, pageSize), tabId);
        const items = extractArray(data);

        if (!items.length && page === 1 && typeof data === "object" && data) {
          const single = normalizer(data as Record<string, unknown>);
          if (single.id || single.name) return [single];
        }

        all.push(...items.map(normalizer));
        if (items.length < pageSize) break;
      }

      const filtered = all.filter((item) => item.id || item.name);
      if (filtered.length) return dedupe(filtered);
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError || new Error("No endpoint worked");
}

export const useAppStore = create<AppStore>((set, get) => ({
  activeView: "dashboard",
  activeCollection: null,
  activeObjectId: null,
  cache: emptyCache(),
  updatedAt: {},
  journeyKpis: {},
  settings: DEFAULT_SETTINGS,
  tabState: null,
  activeTab: null,
  storageMinerData: null,
  journeyHistoryResults: [],
  journeyHistoryTotal: 0,
  journeyHistoryLoading: false,
  journeyHistoryError: null,
  loading: false,
  logs: [],
  searchQuery: "",
  rules: [],
  alertSettings: DEFAULT_ALERT_SETTINGS,
  ruleViolations: [],
  ruleCheckedAt: 0,
  automationKpis: {},
  automationKpiProgress: null,

  setView: (view, collectionKey, objectId) =>
    set({
      activeView: view,
      activeCollection: collectionKey ?? null,
      activeObjectId: objectId ?? null,
    }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  addLog: (line) => set((state) => ({ logs: addLogLine(state.logs, line) })),

  setLoading: (v) => set({ loading: v }),

  loadAll: async () => {
    try {
      const data = await chrome.storage.local.get([
        "sfmcBuddyCache",
        "sfmcBuddyJourneyKpis",
        "sfmcBuddyStorageMinerData",
        "sfmcProcessMinerState",
        "sfmcBuddyRules",
        "sfmcBuddyAlertSettings",
        "sfmcBuddyRuleState",
        "sfmcBuddyAutomationKpis",
      ]);

      const cache: Record<CollectionKey, CachedItem[]> = emptyCache();
      const updatedAt: Record<string, number> = {};

      if (data.sfmcBuddyCache) {
        const storedCache = data.sfmcBuddyCache.cache || {};
        for (const key of COLLECTIONS) {
          if (Array.isArray(storedCache[key])) cache[key] = storedCache[key];
        }
        Object.assign(updatedAt, data.sfmcBuddyCache.updatedAt || {});
      }

      const journeyKpis = data.sfmcBuddyJourneyKpis?.kpis || {};
      const storageMinerData = data.sfmcBuddyStorageMinerData || null;
      const activeTab = await resolveSfmcTab();

      let tabState: TabState | null = null;
      if (activeTab?.id) {
        const res = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: activeTab.id });
        tabState = res?.state || null;
      }

      const settingsData = await chrome.storage.sync.get(["sfmcBuddySettings"]);
      const settings = { ...DEFAULT_SETTINGS, ...settingsData.sfmcBuddySettings };

      const rules = Array.isArray(data.sfmcBuddyRules?.rules) ? data.sfmcBuddyRules.rules : [];
      const alertSettings = { ...DEFAULT_ALERT_SETTINGS, ...(data.sfmcBuddyAlertSettings || {}) };
      const ruleViolations = Array.isArray(data.sfmcBuddyRuleState?.violations) ? data.sfmcBuddyRuleState.violations : [];
      const ruleCheckedAt = data.sfmcBuddyRuleState?.checkedAt || 0;
      const automationKpis = data.sfmcBuddyAutomationKpis?.kpis || {};

      set({ cache, updatedAt, journeyKpis, storageMinerData, activeTab, tabState, settings, rules, alertSettings, ruleViolations, ruleCheckedAt, automationKpis });
    } catch (error: unknown) {
      get().addLog(`loadAll error: ${(error as Error).message}`);
    }
  },

  saveSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    await chrome.storage.sync.set({ sfmcBuddySettings: settings });
    set({ settings });
    get().addLog("Settings saved.");
  },

  saveRule: async (rule) => {
    const existing = get().rules.filter((r) => r.id !== rule.id);
    const rules = [...existing, rule].sort((a, b) => a.createdAt - b.createdAt);
    await chrome.storage.local.set({ sfmcBuddyRules: { rules } });
    set({ rules });
    get().addLog(`Rule "${rule.name}" saved.`);
    // Evaluate immediately: refresh KPIs for the rule's scope, then check + alert.
    if (rule.enabled) await get().runRuleNow(rule);
  },

  // Make sure journey KPIs exist for a rule scope, fetching them from Data Views
  // when missing. For "all", cap the fetch fan-out to keep it fast.
  ensureKpisForScope: async (scope) => {
    const { cache, journeyKpis, addLog } = get();
    const journeys = scope === "all"
      ? cache.journeys
      : cache.journeys.filter((j) => String(j.id) === String(scope));
    if (!journeys.length) {
      addLog("⚠️ No cached journeys — run Sync all first so rules have data to check.");
      return;
    }
    const hasKpis = (id: string) => {
      const k = journeyKpis[id];
      return !!k && Object.values(k).some((v) => Number(v) > 0);
    };
    const missing = journeys.filter((j) => !hasKpis(String(j.id)));
    if (!missing.length) return;
    const CAP = 10;
    const targets = scope === "all" ? missing.slice(0, CAP) : missing;
    if (scope === "all" && missing.length > CAP) {
      addLog(`KPI fetch capped at ${CAP} journeys (${missing.length} without KPIs). Others will be covered by later checks.`);
    }
    addLog(`Fetching KPIs for ${targets.length} journey(s)…`);
    for (const j of targets) {
      const id = String(j.id);
      let acts: Record<string, unknown>[] = Array.isArray(j.activities) ? (j.activities as Record<string, unknown>[]) : [];
      // A specific-journey rule deserves a full detail fetch to get activities.
      if (!acts.length && scope !== "all") {
        await get().fetchJourneyDetail(id, null);
        const fresh = get().cache.journeys.find((x) => String(x.id) === id);
        acts = Array.isArray(fresh?.activities) ? (fresh!.activities as Record<string, unknown>[]) : [];
      }
      const tsIds = acts
        .filter((a) => /EMAILV2|EMAIL$/i.test(String(a.type || "")))
        .map((a) => {
          const cfg = a.configurationArguments as Record<string, unknown> | undefined;
          return String(cfg?.triggeredSendId || cfg?.triggeredSendDefinitionObjectID || "");
        })
        .filter(Boolean);
      try {
        await get().fetchKpisFromDataViews(id, String(j.name || ""), tsIds);
      } catch { /* logged inside */ }
    }
  },

  // Refresh KPIs for the rule's scope, evaluate ALL rules, and alert immediately
  // for this rule (bypasses the cooldown so a brand-new rule always notifies).
  runRuleNow: async (rule) => {
    const { addLog } = get();
    addLog(`Evaluating rule "${rule.name}" now…`);
    await get().ensureKpisForScope(rule.scope);
    await get().checkRules(rule.id);
    const hits = get().ruleViolations.filter((v) => v.ruleId === rule.id);
    if (hits.length > 0) {
      addLog(`🚨 ${hits.length} journey(s) violate "${rule.name}" — see delivery status above.`);
    } else {
      addLog(`✓ No violation for "${rule.name}".`);
    }
  },

  deleteRule: async (ruleId) => {
    const rules = get().rules.filter((r) => r.id !== ruleId);
    await chrome.storage.local.set({ sfmcBuddyRules: { rules } });
    set({ rules });
    get().addLog("Rule deleted.");
  },

  toggleRule: async (ruleId) => {
    const rules = get().rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
    await chrome.storage.local.set({ sfmcBuddyRules: { rules } });
    set({ rules });
  },

  saveAlertSettings: async (patch) => {
    const alertSettings = { ...get().alertSettings, ...patch };
    await chrome.storage.local.set({ sfmcBuddyAlertSettings: alertSettings });
    set({ alertSettings });
    get().addLog("Alert settings saved.");
  },

  checkRules: async (forceRuleId) => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "CHECK_RULES", forceRuleId: forceRuleId || null });
      if (res?.ok) {
        const violations: RuleViolation[] = Array.isArray(res.violations) ? res.violations : [];
        const delivery: Array<{ channel: string; ok: boolean; status?: number; error?: string }> =
          Array.isArray(res.delivery) ? res.delivery : [];
        const alerted: number = Number(res.alerted) || 0;
        set({ ruleViolations: violations, ruleCheckedAt: Date.now() });
        get().addLog(`Rules checked — ${violations.length} violation(s).`);

        if (violations.length > 0 && alerted === 0) {
          get().addLog("ℹ️ All violations within cooldown — no new alert sent (use Run on a rule to force).");
        }
        if (alerted > 0) {
          const emailCh = delivery.filter((r) => r.channel === "emailjs" || r.channel === "webhook" || r.channel === "formsubmit");
          if (emailCh.length === 0) {
            get().addLog("⚠️ Alert sent as desktop notification ONLY — no email. Configure EmailJS (or webhook) in Alert delivery.");
          } else {
            for (const r of emailCh) {
              get().addLog(r.ok
                ? `✓ EMAIL sent via ${r.channel} (HTTP ${r.status ?? "?"}) — check inbox/spam.`
                : `✗ ${r.channel} FAILED: ${r.error || `HTTP ${r.status ?? "?"}`}`);
            }
          }
        }
      } else {
        get().addLog(`Rule check failed: ${res?.error || "unknown"}`);
      }
    } catch (error: unknown) {
      get().addLog(`Rule check error: ${(error as Error).message}`);
    }
  },

  sendTestAlert: async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "SEND_TEST_ALERT" });
      if (res?.ok) {
        const results: Array<{ channel: string; ok: boolean; status?: number; error?: string; info?: string }> =
          Array.isArray(res.results) ? res.results : [];
        const emailCh = results.filter((r) => r.channel === "emailjs" || r.channel === "webhook" || r.channel === "formsubmit");
        if (emailCh.length === 0) {
          get().addLog("⚠️ No EMAIL sent — only desktop notification. Set a recipient email in Alert delivery.");
        } else {
          for (const r of emailCh) {
            get().addLog(r.ok
              ? `✓ ${r.channel} delivered (HTTP ${r.status ?? "?"})${r.info ? ` — ${r.info}` : ""} — check inbox/spam.`
              : `✗ ${r.channel} FAILED: ${r.error || `HTTP ${r.status ?? "?"}`}`);
          }
        }
      } else {
        get().addLog(`Test alert failed: ${res?.error || "unknown"}`);
      }
    } catch (error: unknown) {
      get().addLog(`Test alert error: ${(error as Error).message}`);
    }
  },

  synchronize: async () => {
    const { settings, addLog, setLoading } = get();
    const activeTab = await resolveSfmcTab();

    if (!activeTab?.id || !activeTab.url || !isSfmcUrl(activeTab.url)) {
      addLog("Open an SFMC tab before synchronizing.");
      return;
    }

    set({ activeTab });
    setLoading(true);
    addLog("Synchronizing...");

    try {
      const stack = getStack(activeTab.url);
      if (!stack) {
        addLog("Unable to detect SFMC stack.");
        return;
      }

      const tabId = activeTab.id;
      const pageSize = settings.pageSize;
      const journeyBase = `https://jbinteractions.${stack}.marketingcloudapps.com`;
      const classicBase = `https://mc.${stack}.exacttarget.com`;
      const cache = { ...get().cache };
      const updatedAt = { ...get().updatedAt };

      const sync = async (key: CollectionKey, loader: () => Promise<CachedItem[]>) => {
        try {
          const items = dedupe((await loader()).filter((item) => item.id || item.name));
          cache[key] = items;
          updatedAt[key] = Date.now();
          addLog(`${items.length} ${key} synced.`);
        } catch (error: unknown) {
          addLog(`${key}: ${(error as Error).message}`);
        }
      };

      await sync("journeys", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions?extras=counters`,
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions?extras=all`,
          `${journeyBase}/fuelapi/interaction/v1/interactions?extras=counters`,
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions`,
          `${journeyBase}/fuelapi/interaction/v1/interactions`,
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true`,
          `${journeyBase}/fuelapi/interaction/v1/interactions?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true`,
        ];
        const freshItems = await fetchFromCandidates(urls, pageSize, tabId, normalizeJourneyItem);

        // The mc proxy returns the journey list but its `extras=counters` stats come
        // back as 0. jbinteractions returns the REAL counters — fetch its list once
        // and build an id/definitionId → stats map to enrich the population numbers.
        const jbStatsById = new Map<string, Record<string, number>>();
        try {
          const jbUrl = `${journeyBase}/fuelapi/interaction/v1/interactions?extras=counters&mostRecentVersionOnly=false&$pageSize=${Math.max(pageSize, 200)}`;
          const jbData = await fetchSfmcJb(jbUrl, tabId, true);
          for (const li of extractArray(jbData)) {
            const st = li.stats as Record<string, unknown> | undefined;
            if (!st) continue;
            const entry = {
              cumulativePopulation: Number(st.cumulativePopulation ?? 0),
              currentPopulation: Number(st.currentPopulation ?? 0),
              metGoal: Number(st.metGoal ?? 0),
              metExitCriteria: Number(st.metExitCriteria ?? 0),
              goalPerformance: Number(st.goalPerformance ?? 0),
            };
            for (const k of [li.id, li.definitionId, li.key]) if (k) jbStatsById.set(String(k), entry);
          }
          if (jbStatsById.size) addLog(`Journey counters from jbinteractions: ${jbStatsById.size} entries.`);
        } catch { /* jbinteractions unavailable — fall back to proxy/cached values */ }

        // Preserve allVersions/activities from prior detail fetches; merge best stats.
        const prevJourneys = cache["journeys"];
        return freshItems.map(item => {
          const jb = jbStatsById.get(String(item.id))
            || jbStatsById.get(String((item as Record<string, unknown>).definitionId || ""))
            || jbStatsById.get(String(item.key || ""));
          const prev = prevJourneys.find(p => String(p.id) === String(item.id)) as Record<string, unknown> | undefined;
          const itemStats = item.stats as Record<string, unknown> || {};
          const existingCum = Math.max(
            Number((prev?.stats as Record<string, unknown> | undefined)?.cumulativePopulation ?? 0),
            Number(prev?.cumulativePopulation ?? 0),
            Number((prev?.allVersions as Array<{ cumulativePopulation: number }> | undefined)
              ?.reduce((m, v) => Math.max(m, v.cumulativePopulation || 0), 0) ?? 0)
          );
          const bestCum = Math.max(existingCum, Number(itemStats.cumulativePopulation ?? 0), jb?.cumulativePopulation ?? 0);
          // jbinteractions stats win when present (proxy gives zeros), then proxy, then prev.
          const mergedStats = {
            ...itemStats,
            ...(jb ? jb : {}),
            cumulativePopulation: bestCum,
          };
          return {
            ...item,
            ...(prev?.allVersions ? { allVersions: prev.allVersions } : {}),
            ...(prev?.activities ? { activities: prev.activities } : {}),
            stats: mergedStats,
            cumulativePopulation: bestCum,
          };
        });
      });

      await sync("automations", async () => {
        const asBase = `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi`;
        const urls = [
          // Confirmed-working endpoint (mc.exacttarget.com gridView) — primary.
          `${classicBase}/cloud/fuelapi/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView`,
          `${classicBase}/cloud/fuelapi/automation/v1/automations`,
          // Fallbacks for stacks where the proxy path is unavailable.
          `${asBase}/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView`,
          `${asBase}/automation/v1/automations`,
          `${journeyBase}/fuelapi/automation/v1/automations`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeAutomationItem);
      });

      await sync("dataExtensions", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/data-internal/v1/customobjects?retrievalType=1&includeFilterActivity=true&includeImportActivity=true&includeFullPath=true&%24search=A%25`,
          `${classicBase}/cloud/fuelapi/data-internal/v1/customobjects`,
          `${classicBase}/cloud/fuelapi/data/v1/customobjectdata/types`,
          `https://dataextension.${stack}.marketingcloudapps.com/fuelapi/data/v1/async/dataextensions`,
          `${journeyBase}/fuelapi/hub/v1/dataevents`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeDataExtensionItem);
      });

      await sync("sqlQueries", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/automation/v1/queries`,
          `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi/automation/v1/queries`,
          `https://automation.${stack}.marketingcloudapps.com/fuelapi/automation/v1/queries`,
          `${journeyBase}/fuelapi/automation/v1/queries`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeSqlQueryItem);
      });

      await sync("assets", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/asset/v1/assets?scope=ours`,
          `https://asset.${stack}.marketingcloudapps.com/fuelapi/asset/v1/content/assets`,
          `${journeyBase}/fuelapi/asset/v1/content/assets`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeAssetItem);
      });

      await sync("folders", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/automation/v1/folders/?%24filter=categoryType+eq+email`,
          `${classicBase}/cloud/fuelapi/automation/v1/folders`,
          `https://asset.${stack}.marketingcloudapps.com/fuelapi/asset/v1/content/categories`,
          `${journeyBase}/fuelapi/asset/v1/content/categories`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeFolderItem);
      });

      // Refresh automation KPIs' last-run fields from the freshly synced list,
      // preserving run-derived metrics (totalRuns, durations…) from detail fetches.
      const akpis = { ...get().automationKpis };
      for (const a of cache["automations"]) {
        const id = String(a.id);
        const fresh = deriveAutomationKpis([], { lastRunStatus: a.lastRunStatus as string, lastRunTime: a.lastRunTime as string });
        const prev = akpis[id];
        akpis[id] = prev && prev.totalRuns > 0
          ? { ...prev, lastRunStatus: fresh.lastRunStatus || prev.lastRunStatus, lastRunAt: fresh.lastRunAt ?? prev.lastRunAt, hoursSinceLastRun: fresh.hoursSinceLastRun ?? prev.hoursSinceLastRun, computedAt: Date.now() }
          : fresh;
      }

      const tabStateRes = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId });
      set({ cache, updatedAt, tabState: tabStateRes?.state || null, activeTab, automationKpis: akpis });

      try {
        await chrome.storage.local.set({
          sfmcBuddyCache: { cache, updatedAt, savedAt: Date.now() },
          sfmcBuddyAutomationKpis: { kpis: akpis, savedAt: Date.now() },
        });
      } catch (error: unknown) {
        addLog(`Cache persistence warning: ${(error as Error).message}`);
      }

      addLog("Sync complete.");

      // Re-evaluate KPI alert rules against the freshly synced data.
      if (get().alertSettings.checkOnSync) {
        await get().checkRules();
      }
    } catch (error: unknown) {
      addLog(`Sync failed: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  },

  purgeCache: async (collection) => {
    const cache = { ...get().cache };
    const updatedAt = { ...get().updatedAt };

    if (collection === "all") {
      for (const key of COLLECTIONS) {
        cache[key] = [];
        delete updatedAt[key];
      }
    } else {
      cache[collection] = [];
      delete updatedAt[collection];
    }

    await chrome.storage.local.set({ sfmcBuddyCache: { cache, updatedAt, savedAt: Date.now() } });
    set({ cache, updatedAt });
    get().addLog(`Cache purged: ${collection}.`);
  },

  exportSnapshot: () => ({
    version: "2.2.0",
    exportedAt: new Date().toISOString(),
    cache: get().cache,
    updatedAt: get().updatedAt,
    journeyKpis: get().journeyKpis,
  }),

  importSnapshot: async (data) => {
    try {
      const snap = data as {
        cache?: Record<CollectionKey, CachedItem[]>;
        updatedAt?: Record<string, number>;
        journeyKpis?: Record<string, JourneyKpis>;
      };
      const cache: Record<CollectionKey, CachedItem[]> = emptyCache();
      const updatedAt: Record<string, number> = {};

      if (snap.cache) {
        for (const key of COLLECTIONS) {
          if (Array.isArray(snap.cache[key])) cache[key] = snap.cache[key];
        }
      }

      if (snap.updatedAt) Object.assign(updatedAt, snap.updatedAt);

      const journeyKpis = snap.journeyKpis || {};
      await chrome.storage.local.set({
        sfmcBuddyCache: { cache, updatedAt },
        sfmcBuddyJourneyKpis: { kpis: journeyKpis },
      });
      set({ cache, updatedAt, journeyKpis });
      get().addLog("Snapshot imported.");
    } catch (error: unknown) {
      get().addLog(`Import failed: ${(error as Error).message}`);
    }
  },

  fetchJourneyDetail: async (journeyId, version) => {
    const { activeTab, addLog, cache } = get();
    if (!activeTab?.id || !activeTab.url || !isSfmcUrl(activeTab.url)) {
      addLog("No active SFMC tab — open SFMC first.");
      return;
    }
    const stack = getStack(activeTab.url);
    if (!stack) { addLog("Cannot detect SFMC stack."); return; }

    const tabId = activeTab.id;
    const base = `https://mc.${stack}.exacttarget.com/cloud/fuelapi`;

    // ── Step 1: check hook-captured data from jbinteractions XHR interception ──
    // Always re-fetch tabState fresh from the service worker so we see the most
    // recent XHR-intercepted data even if it arrived after the popup was opened.
    let freshTabState = get().tabState;
    try {
      const res = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId });
      if (res?.state) {
        freshTabState = res.state;
        set({ tabState: freshTabState });
      }
    } catch { /* use cached tabState */ }

    // Collect all versioned hook captures (background stores {id}_v{n} for each captured version).
    // We scan v1–v20; empty slots are silently skipped.
    const hookVersionedEntries: Record<string, unknown>[] = [];
    for (let v = 20; v >= 1; v--) {
      const hv = freshTabState?.journeys?.[`${journeyId}_v${v}`] as Record<string, unknown> | undefined;
      if (hv?.id) hookVersionedEntries.push(hv);
    }

    // Pick the best hook journey to show:
    // - If a specific version was requested, prefer that version's hook data
    // - Otherwise prefer the version with the highest cumulativePopulation
    const pickHookJourney = (): Record<string, unknown> | undefined => {
      if (version != null) {
        return (freshTabState?.journeys?.[`${journeyId}_v${version}`] as Record<string, unknown> | undefined)
          || (freshTabState?.journeys?.[journeyId] as Record<string, unknown> | undefined);
      }
      const withContacts = hookVersionedEntries.find(h =>
        Number((h.stats as Record<string, unknown> | undefined)?.cumulativePopulation) > 0
      );
      return withContacts || (freshTabState?.journeys?.[journeyId] as Record<string, unknown> | undefined);
    };

    const hookJourney = pickHookJourney();
    const hookActivities: Record<string,unknown>[] = Array.isArray(hookJourney?.activities)
      ? hookJourney!.activities as Record<string,unknown>[]
      : [];
    const hookStats = hookJourney?.stats && typeof hookJourney.stats === "object"
      ? hookJourney.stats as Record<string,unknown>
      : null;
    const hookCumPop = Number(hookStats?.cumulativePopulation ?? 0);
    const hookHasStats = hookActivities.some(a => {
      const m = a.metaData as Record<string,unknown> | undefined;
      const cnt = a.counters as Record<string,unknown> | undefined;
      const cntEntered = (cnt?.entered as Record<string,unknown> | undefined)?.count;
      const s = a.stats as Record<string,unknown> | undefined;
      return Number(m?.statsContactsIn) > 0 || Number(m?.contactsIn) > 0
        || Number(s?.contactsIn) > 0 || Number(s?.entered) > 0
        || Number(cntEntered) > 0;
    });

    // Build allVersions from versioned hook captures (so the version picker is populated even on early return).
    const hookAllVersions = hookVersionedEntries
      .map(h => ({
        version: Number(h.version) || null,
        status: String(h.status || ""),
        cumulativePopulation: Number((h.stats as Record<string, unknown> | undefined)?.cumulativePopulation ?? 0),
        lastPublishedDate: String(h.lastPublishedDate || ""),
      }))
      .filter(h => h.version !== null)
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));

    if (hookActivities.length > 0 && (hookCumPop > 0 || hookHasStats)) {
      addLog(`Journey ${journeyId}: using hook-captured data (v${hookJourney!.version}, ${hookCumPop} contacts).`);
      const existing = get().cache["journeys"].find(j => String(j.id) === journeyId)
        || cache["journeys"].find(j => String(j.id) === journeyId)
        || {};
      // Merge hook-derived version list with what's already cached — never discard known versions.
      type VersionEntry = { version: number | null; status: string; cumulativePopulation: number; lastPublishedDate?: string };
      const existingAllVersions = ((existing as Record<string,unknown>).allVersions as VersionEntry[] | undefined) || [];
      const hookVerMap = new Map<number, VersionEntry>();
      for (const v of existingAllVersions) { if (v.version !== null) hookVerMap.set(v.version, v); }
      for (const v of hookAllVersions) {
        if (v.version === null) continue;
        const prev = hookVerMap.get(v.version);
        hookVerMap.set(v.version, { ...v, cumulativePopulation: Math.max(v.cumulativePopulation, prev?.cumulativePopulation ?? 0) });
      }
      const mergedAllVersions = [...hookVerMap.values()].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
      const exStep1 = existing as Record<string, unknown>;
      const existingCumPopStep1 = Math.max(
        Number(exStep1?.stats?.cumulativePopulation ?? 0),
        Number(exStep1?.cumulativePopulation ?? 0),
        Number((exStep1.allVersions as Array<{cumulativePopulation:number}> | undefined)
          ?.reduce((m, v) => Math.max(m, v.cumulativePopulation || 0), 0) ?? 0)
      );
      const bestCumPopStep1 = Math.max(hookCumPop, existingCumPopStep1);
      const hookStatsMerged = bestCumPopStep1 > hookCumPop
        ? { ...(hookStats || {}), cumulativePopulation: bestCumPopStep1 }
        : (hookStats || {});
      const existingActivitiesStep1 = ((existing as Record<string,unknown>).activities as Record<string,unknown>[] | undefined) || [];
      const finalActivitiesStep1 = hookActivities.length > 0 ? hookActivities : existingActivitiesStep1;
      addLog(`Step1 hook: ${hookActivities.length} hook acts, ${existingActivitiesStep1.length} cached acts → writing ${finalActivitiesStep1.length}.`);
      const merged = {
        ...existing,
        ...(hookJourney as Record<string,unknown>),
        id: journeyId,
        activities: finalActivitiesStep1,
        stats: hookStatsMerged,
        goals: Array.isArray(hookJourney!.goals) ? hookJourney!.goals : (existing as Record<string,unknown>).goals || [],
        allVersions: mergedAllVersions,
        raw: hookJourney!.raw ?? hookJourney,
        capturedAt: Date.now(),
      } as import("./types").CachedItem;

      const newCache = { ...cache };
      const idx = newCache["journeys"].findIndex(j => String(j.id) === journeyId);
      if (idx >= 0) newCache["journeys"] = newCache["journeys"].map((j, i) => i === idx ? merged : j);
      else newCache["journeys"] = [merged, ...newCache["journeys"]];

      const updatedAt = { ...get().updatedAt, journeys: Date.now() };
      await chrome.storage.local.set({ sfmcBuddyCache: { cache: newCache, updatedAt, savedAt: Date.now() } });
      set({ cache: newCache, updatedAt });
      return;
    }

    // ── Step 2: fetch from mc.exacttarget.com/cloud/fuelapi ───────────────────
    // SFMC Journey API has TWO different IDs:
    //   id          — the URL identifier used to GET a specific journey
    //   definitionId — the journey-definition UUID shared across ALL versions
    // ?version=N ONLY works with the definitionId, not with the version-instance id.
    // We check the cache for the stored definitionId, fall back to journeyId.
    const existingForDefId = cache["journeys"].find(j => String(j.id) === journeyId);
    const knownDefId = String(
      (existingForDefId as Record<string,unknown>)?.definitionId ||
      journeyId
    );

    // jbinteractions returns full stats (cumulativePopulation, activity counters).
    // The mc.exacttarget.com proxy does not. Always try jbinteractions first.
    // NOTE: jbBase already includes /fuelapi — do NOT add /fuelapi again in URLs.
    const jbBase = `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi`;
    // Valid SFMC extras: activities, counters, goals, tags — "all" is NOT valid.
    const jbUrlsToTry = version != null
      ? [
          `${jbBase}/interaction/v1/interactions/${journeyId}?version=${version}&extras=activities,counters,goals`,
          `${jbBase}/interaction/v1/interactions/${journeyId}?version=${version}&extras=activities,counters`,
          `${jbBase}/interaction/v1/interactions/${journeyId}?version=${version}`,
        ]
      : [
          `${jbBase}/interaction/v1/interactions/${journeyId}?extras=activities,counters,goals`,
          `${jbBase}/interaction/v1/interactions/${journeyId}?extras=activities,counters`,
          `${jbBase}/interaction/v1/interactions/${journeyId}`,
        ];
    const proxyUrlsToTry = version != null
      ? [
          `${base}/interaction/v1/interactions/${journeyId}?version=${version}&extras=activities,counters`,
          `${base}/interaction/v1/interactions/${journeyId}?version=${version}`,
        ]
      : [
          `${base}/interaction/v1/interactions/${journeyId}?extras=activities,counters,goals`,
          `${base}/interaction/v1/interactions/${journeyId}?extras=activities,counters`,
          `${base}/interaction/v1/interactions/${journeyId}`,
        ];

    addLog(`Fetching journey detail: ${journeyId}${version != null ? ` v${version}` : ""}…`);
    let detail: Record<string, unknown> | null = null;

    // Try jbinteractions first — it returns real contact stats.
    for (const url of jbUrlsToTry) {
      try {
        const data = await fetchSfmcJb(url, tabId);
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          if (d.id) {
            detail = d;
            if (Array.isArray(d.activities) && (d.activities as unknown[]).length > 0) break;
          }
        }
      } catch { /* fall through to proxy */ }
    }
    // Fall back to proxy if jbinteractions returned nothing OR returned a detail without activities.
    for (const url of proxyUrlsToTry) {
      // Skip proxy only if jbinteractions already gave us activities
      const jbHasActs = detail && Array.isArray(detail.activities) && (detail.activities as unknown[]).length > 0;
      if (jbHasActs) break;
      try {
        const data = await fetchSfmc(url, tabId);
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          if (d.id) {
            const hasActs = Array.isArray(d.activities) && (d.activities as unknown[]).length > 0;
            const st = d.stats as Record<string,unknown> | undefined;
            const hasCum = Number(st?.cumulativePopulation ?? 0) > 0;
            if (!detail) detail = d;
            if (hasActs) { detail = d; if (hasCum) break; }
          }
        }
      } catch { /* try next url */ }
    }

    if (!detail) { addLog(`Journey detail fetch failed for ${journeyId}.`); return; }

    const activities: Record<string, unknown>[] = Array.isArray(detail.activities)
      ? (detail.activities as Record<string, unknown>[])
      : [];
    addLog(`Detail fetched: ${activities.length} activities, id=${String(detail.id || "?").slice(0,8)}…`);
    const detailVersion = detail.version;
    const detailStatus  = String(detail.status || detail.scheduledStatus || "");
    const st = detail.stats as Record<string,unknown> | undefined;
    const cumPop = Number(st?.cumulativePopulation ?? 0);

    // Update definitionId now that we have the full detail response
    const detailDefId = detail.definitionId ? String(detail.definitionId) : null;
    const effectiveDefId = detailDefId || knownDefId;

    // ── Fetch real cumulativePopulation from jbinteractions LIST endpoint ─────
    // The detail endpoint (/interactions/{id}) always returns cumulativePopulation=0.
    // The LIST endpoint with ?extras=counters returns the real cumulative count.
    // IMPORTANT: ?definitionId={id} is always the correct query — even when definitionId==id.
    // Do NOT use detail.key (the customerKey) here; that's a different field.
    let jbListCumPop = 0;
    const jbListUrlsForCumPop: string[] = [
      // Primary: definitionId query — works for all journeys (single or multi-version)
      `${jbBase}/interaction/v1/interactions?definitionId=${effectiveDefId}&extras=counters&mostRecentVersionOnly=false&$pageSize=50`,
      // Fallback: direct ID lookup
      `${jbBase}/interaction/v1/interactions?id=${journeyId}&extras=counters&mostRecentVersionOnly=false&$pageSize=50`,
      // Proxy fallback if jbinteractions is unavailable
      `${base}/interaction/v1/interactions?definitionId=${effectiveDefId}&extras=counters&mostRecentVersionOnly=false&$pageSize=50`,
    ];
    for (const jbListUrl of jbListUrlsForCumPop) {
      if (jbListCumPop > 0) break;
      const isJb = jbListUrl.startsWith(jbBase);
      try {
        const jbListData = (isJb
          ? await fetchSfmcJb(jbListUrl, tabId)
          : await fetchSfmc(jbListUrl, tabId)) as Record<string, unknown>;
        const jbListItems = extractArray(jbListData);
        for (const li of jbListItems) {
          const liId = String(li.id || "");
          const liDefId = String(li.definitionId || "");
          // Match if this list item belongs to our journey (by id or definitionId)
          if (liId !== journeyId && liDefId !== effectiveDefId && liId !== effectiveDefId) continue;
          const liSt = li.stats as Record<string, unknown> | undefined;
          const liCum = Number(liSt?.cumulativePopulation ?? li.cumulativePopulation ?? 0);
          if (liCum > jbListCumPop) jbListCumPop = liCum;
        }
        if (jbListCumPop > 0) addLog(`List extras=counters: ${jbListCumPop} contacts (${isJb ? "jb" : "proxy"}).`);
      } catch { /* silently skip */ }
    }

    addLog(`Journey v${detailVersion} (${detailStatus}): ${activities.length} activities, ${Math.max(cumPop, jbListCumPop)} contacts. defId=${effectiveDefId.slice(0,8)}…`);

    // Per-version explicit fetch: build allVersions list without changing the displayed version.
    // Always use journeyId (not definitionId) in the URL path — definitionId causes 30003 errors.
    // Dedup by the returned version number: if the proxy ignores ?version=, the same version comes back
    // every time and we break early, so we never show duplicates.
    const seenVersionNums = new Set<number>();
    const allVersionsList: Array<{ version: number | null; status: string; cumulativePopulation: number; lastPublishedDate?: string }> = [];
    const currentVerNum = Number(detailVersion) || 1;
    seenVersionNums.add(currentVerNum);
    allVersionsList.push({
      version: currentVerNum,
      status: detailStatus,
      cumulativePopulation: Math.max(cumPop, jbListCumPop),
      lastPublishedDate: String(detail.lastPublishedDate || ""),
    });

    if (version == null) {
      for (let v = currentVerNum - 1; v >= 1; v--) {
        try {
          const vd = await fetchSfmc(
            `${base}/interaction/v1/interactions/${journeyId}?version=${v}&extras=activities,counters`,
            tabId
          ) as Record<string, unknown>;
          if (!vd?.id) continue;
          const vVer = Number(vd.version) || v;
          if (seenVersionNums.has(vVer)) break; // proxy returned same version → no older versions exist
          seenVersionNums.add(vVer);
          const vSt = vd.stats as Record<string, unknown> | undefined;
          const vCum = Number(vSt?.cumulativePopulation ?? 0);
          const vStatus = String(vd.status || vd.scheduledStatus || "");
          allVersionsList.push({
            version: vVer,
            status: vStatus,
            cumulativePopulation: vCum,
            lastPublishedDate: String(vd.lastPublishedDate || ""),
          });
          addLog(`Found v${vVer} (${vStatus}): ${vCum} contacts.`);
        } catch { break; }
      }
    }

    // Supplemental: use definitionId list query to find versions not reached by the count-down loop above.
    if (version == null) {
      const suppDefId = effectiveDefId;
      try {
        const listData = await fetchSfmc(
          `${base}/interaction/v1/interactions?definitionId=${suppDefId}&mostRecentVersionOnly=false&$pageSize=50&extras=counters`,
          tabId
        ) as Record<string, unknown>;
        const listItems = extractArray(listData);
        for (const li of listItems) {
          const liVer = Number(li.version) || null;
          if (liVer === null || seenVersionNums.has(liVer)) continue;
          seenVersionNums.add(liVer);
          const liSt = li.stats as Record<string, unknown> | undefined;
          const liCum = Number(liSt?.cumulativePopulation ?? 0);
          allVersionsList.push({
            version: liVer,
            status: String(li.status || li.scheduledStatus || ""),
            cumulativePopulation: liCum,
            lastPublishedDate: String(li.lastPublishedDate || ""),
          });
        }
        if (listItems.length > 0) addLog(`List API found ${listItems.length} version entry(ies) for this journey.`);
      } catch { /* supplemental only — ignore errors */ }
    }

    // ── Step A: enrich activity-level stats (counters / currentPopulation) ──────
    // Strategy: re-fetch the journey with extras=activities,counters from both
    // jbinteractions and the proxy, then merge any counters/stats into our activities.
    // We also try the SFMC statistics endpoint which some orgs expose.
    const alreadyHasCounters = activities.some(a => {
      const cnt = a.counters as Record<string,unknown> | undefined;
      return cnt && Object.keys(cnt).length > 0;
    });
    if (!alreadyHasCounters && activities.length > 0) {
      const statsSourceUrls: Array<{ url: string; useJb: boolean }> = [
        { url: `${jbBase}/interaction/v1/interactions/${journeyId}?extras=activities,counters`, useJb: true },
        { url: `${base}/interaction/v1/interactions/${journeyId}?extras=activities,counters`, useJb: false },
        ...(version != null ? [
          { url: `${jbBase}/interaction/v1/interactions/${journeyId}?version=${version}&extras=activities,counters`, useJb: true },
          { url: `${base}/interaction/v1/interactions/${journeyId}?version=${version}&extras=activities,counters`, useJb: false },
        ] : []),
      ];
      for (const { url: statsUrl, useJb } of statsSourceUrls) {
        try {
          const statsData = (useJb
            ? await fetchSfmcJb(statsUrl, tabId)
            : await fetchSfmc(statsUrl, tabId)) as Record<string, unknown>;
          const richActivities: Record<string,unknown>[] = Array.isArray(statsData?.activities)
            ? statsData.activities as Record<string,unknown>[]
            : extractArray(statsData).filter(a => (a as Record<string,unknown>).key);
          if (richActivities.length > 0) {
            const statsMap = new Map(richActivities.map(a => [String(a.key || a.activityKey || ""), a]));
            let merged = 0;
            for (const act of activities) {
              const s = statsMap.get(String(act.key || ""));
              if (!s) continue;
              if (s.counters) act.counters = s.counters;
              if (s.stats && typeof s.stats === "object") {
                act.stats = { ...(act.stats as Record<string,unknown> || {}), ...(s.stats as Record<string,unknown>) };
              }
              if (s.currentPopulation !== undefined) {
                act.stats = { ...(act.stats as Record<string,unknown> || {}), currentPopulation: s.currentPopulation };
              }
              merged++;
            }
            if (merged > 0) {
              addLog(`Activity counters enriched for ${merged} activities (${useJb ? "jb" : "proxy"}).`);
              // Dump counter keys for email activities so we can see what's available
              for (const act of activities) {
                if (!/EMAIL/i.test(String(act.type || ""))) continue;
                const cnt = act.counters as Record<string,unknown> | undefined;
                const st = act.stats as Record<string,unknown> | undefined;
                const cntKeys = cnt ? Object.keys(cnt).join(",") : "none";
                const stKeys = st ? Object.keys(st).join(",") : "none";
                addLog(`Email "${String(act.name||act.key)}" counters: [${cntKeys}] stats: [${stKeys}]`);
              }
              break;
            }
          }
        } catch { /* not available */ }
      }
    }

    // ── Step B: fetch email KPIs using triggeredSendId / triggeredSendKey ────────
    // Each EMAILV2 activity has configurationArguments.triggeredSendId (UUID) and
    // triggeredSendKey / triggeredSendDefinitionObjectID in configurationArguments.
    // Use these to fetch email send stats from the messaging API.
    if (activities.length > 0) {
      const emailActivities = activities.filter(a => /EMAILV2|EMAIL$/i.test(String(a.type || "")));
      for (const act of emailActivities) {
        const cfg = act.configurationArguments as Record<string,unknown> | undefined;
        if (!cfg) continue;
        const ea: any = act.emailAnalytics || {};
        if (ea.sent !== undefined || ea.totalSent !== undefined) continue; // already have data

        // SFMC uses several field names for the triggered send identifier
        const tsId  = String(cfg.triggeredSendId  || cfg.triggeredSendDefinitionObjectID || "");
        const tsKey = String(cfg.triggeredSendKey || cfg.triggeredSendDefinitionKey || cfg.triggeredSendDefinitionId || "");

        const actKey = String(act.key || act.activityKey || "");

        if (!tsId && !tsKey && !actKey) {
          addLog(`No identifiers for email activity ${String(act.name || act.key || "")}`);
          continue;
        }
        addLog(`Email KPIs: ${String(act.name || act.key)} tsId=${tsId.slice(0,8)||"—"} tsKey=${tsKey||"—"} actKey=${actKey.slice(0,8)||"—"}`);

        // ── Step B: REST API summary endpoints ────────────────────────────────────
        // Note: ENT._ system DEs (ENT._Sent, ENT._Open, etc.) are not accessible
        //       via this API path (errorcode 30003). Skipped to keep Errors tab clean.
        const emailStatsUrls: Array<{ url: string; useJb: boolean }> = [];
        // 1. jbinteractions per-activity stats endpoint (JB internal, returns counters)
        if (actKey) {
          emailStatsUrls.push({ url: `${jbBase}/interaction/v1/interactions/${journeyId}/activities/${actKey}/stats`, useJb: true });
          emailStatsUrls.push({ url: `${jbBase}/interaction/v1/interactions/${journeyId}/activities/${actKey}/stats?extras=emailStats`, useJb: true });
        }
        // 2. JB journey-level metrics (may include per-activity email stats)
        emailStatsUrls.push({ url: `${jbBase}/interaction/v1/interactions/${journeyId}/metrics`, useJb: true });
        // 3. Triggered send definition stats via tsId (UUID format)
        if (tsId) {
          emailStatsUrls.push({ url: `${base}/messaging/v1/messageDefinitions/${tsId}`, useJb: false });
          emailStatsUrls.push({ url: `${jbBase}/messaging/v1/messageDefinitions/${tsId}`, useJb: true });
          emailStatsUrls.push({ url: `${base}/messaging/v1/messageDefinitionSends/${tsId}/summaries`, useJb: false });
        }
        // 4. Only use tsKey if it looks like a GUID/CustomerKey (not a plain integer)
        if (tsKey && !/^\d+$/.test(tsKey)) {
          emailStatsUrls.push({ url: `${base}/messaging/v1/messageDefinitions/key:${tsKey}`, useJb: false });
          emailStatsUrls.push({ url: `${base}/messaging/v1/messageDefinitionSends/key:${tsKey}/summaries`, useJb: false });
        }

        for (const { url: emailUrl, useJb } of emailStatsUrls) {
          try {
            // Use silent=true to prevent 404s from cluttering the Errors tab
            const emailData = (useJb
              ? await fetchSfmcJb(emailUrl, tabId, true)
              : await fetchSfmc(emailUrl, tabId, true)) as Record<string, unknown>;
            if (!emailData || typeof emailData !== "object") continue;
            const items = extractArray(emailData);
            const emailObj = Array.isArray(emailData) ? (emailData[0] as Record<string,unknown>) : emailData;
            const src = items.length > 0 ? items[0] as Record<string,unknown> : emailObj;
            if (!src || typeof src !== "object") continue;
            const rawKeys = Object.keys(src).join(",");
            const kpiMap: Record<string, string[]> = {
              sent:      ["sent","totalSent","Sent","TotalSent","totalSentCount","SendCount","NumberSent","numberSent"],
              delivered: ["delivered","totalDelivered","Delivered","TotalDelivered","DeliveredCount","NumberDelivered"],
              opens:     ["uniqueOpens","opens","UniqueOpens","Opens","totalOpens","OpenCount","NumberOpened","NumberUniqueOpens"],
              clicks:    ["uniqueClicks","clicks","UniqueClicks","Clicks","totalClicks","ClickCount","NumberClicked","NumberUniqueClicks"],
              bounces:   ["bounces","totalBounces","Bounces","TotalBounces","hardBounces","BounceCount","NumberBounced"],
              unsubs:    ["unsubscribes","totalUnsubscribes","Unsubscribes","unsubs","OptOutCount","NumberUnsubscribed"],
            };
            const merged: Record<string,unknown> = {};
            for (const [stdKey, candidates] of Object.entries(kpiMap)) {
              for (const c of candidates) {
                if (src[c] !== undefined && src[c] !== null) { merged[stdKey] = src[c]; break; }
              }
            }
            if (Object.keys(merged).length > 0) {
              act.emailAnalytics = { ...(act.emailAnalytics as Record<string,unknown> || {}), ...merged };
              addLog(`Email KPIs (REST): sent=${merged.sent ?? "—"} opens=${merged.opens ?? "—"} clicks=${merged.clicks ?? "—"}`);
              break;
            } else {
              addLog(`Email KPIs: no match at ${emailUrl.split("/").slice(-3).join("/")} — keys: ${rawKeys.slice(0,100)}`);
            }
          } catch { /* try next url */ }
        }
      }
    }

    // Merge hook activities into API activities — always copy any stats/counters the hook captured.
    // The hook intercepts jbinteractions XHRs and stores contact counts (the canvas bubbles).
    if (hookActivities.length > 0 && activities.length > 0) {
      const hookActMap = new Map(hookActivities.map(a => [String(a.key || a.id || ""), a]));
      for (const act of activities) {
        const h = hookActMap.get(String(act.key || "")) || hookActMap.get(String(act.id || ""));
        if (!h) continue;
        // Merge metaData (statsContactsIn etc.) from hook unconditionally — never discard
        const hMeta = h.metaData as Record<string,unknown> | undefined;
        if (hMeta && Object.keys(hMeta).length > 0) {
          act.metaData = { ...(hMeta), ...(act.metaData as Record<string,unknown> || {}) };
        }
        // Merge stats — prefer existing non-zero values but fill missing ones from hook
        const hStats = h.stats as Record<string,unknown> | undefined;
        if (hStats && Object.keys(hStats).length > 0) {
          const aStats = act.stats as Record<string,unknown> || {};
          const merged: Record<string,unknown> = { ...hStats };
          // Keep existing values that are non-null/non-zero
          for (const [k, v] of Object.entries(aStats)) {
            if (v !== null && v !== undefined && v !== 0) merged[k] = v;
          }
          act.stats = merged;
        }
        // Merge counters from hook if activity doesn't already have them
        const hCnt = h.counters as Record<string,unknown> | undefined;
        if (hCnt && Object.keys(hCnt).length > 0 && !act.counters) {
          act.counters = hCnt;
        }
        // Merge currentPopulation from hook (canvas bubble value)
        const hCurPop = (h.stats as Record<string,unknown> | undefined)?.currentPopulation
          ?? (h as Record<string,unknown>).currentPopulation;
        if (hCurPop !== undefined && hCurPop !== null) {
          act.stats = { ...(act.stats as Record<string,unknown> || {}), currentPopulation: hCurPop };
        }
      }
    }

    // Use the CURRENT store cache (not the stale captured snapshot) so we see
    // data written by a sync or a previous fetchJourneyDetail since this call started.
    const liveJourneys = get().cache["journeys"];
    const existing = liveJourneys.find(j => String(j.id) === journeyId)
      || cache["journeys"].find(j => String(j.id) === journeyId)
      || {};
    const ex = existing as Record<string, unknown>;
    const existingCumPop = Math.max(
      Number(ex?.stats?.cumulativePopulation ?? 0),
      Number(ex?.cumulativePopulation ?? 0),
      Number((ex.allVersions as Array<{cumulativePopulation:number}> | undefined)
        ?.reduce((m, v) => Math.max(m, v.cumulativePopulation || 0), 0) ?? 0)
    );

    // Prefer the highest contact count seen across API, jb list, hook, and previous cache — never go back to 0.
    const apiCumPop = Number((detail.stats as Record<string,unknown> | undefined)?.cumulativePopulation ?? 0);
    const bestCumPop = Math.max(apiCumPop, jbListCumPop, hookCumPop, existingCumPop);
    const baseStats = hookCumPop > 0 && hookCumPop >= apiCumPop
      ? hookStats!
      : (detail.stats && typeof detail.stats === "object" ? detail.stats as Record<string,unknown> : {});
    const mergedStats = bestCumPop > apiCumPop
      ? { ...baseStats, cumulativePopulation: bestCumPop }
      : baseStats;

    // Merge new allVersionsList with what was previously cached.
    // Always take the max cumulativePopulation per version — the API may return 0 after returning real data.
    type VersionEntry = { version: number | null; status: string; cumulativePopulation: number; lastPublishedDate?: string };
    const existingAllVersions = ((existing as Record<string,unknown>).allVersions as VersionEntry[] | undefined) || [];
    const verMap = new Map<number, VersionEntry>();
    for (const v of existingAllVersions) { if (v.version !== null) verMap.set(v.version, v); }
    for (const v of allVersionsList) {
      if (v.version === null) continue;
      const prev = verMap.get(v.version);
      verMap.set(v.version, { ...v, cumulativePopulation: Math.max(v.cumulativePopulation, prev?.cumulativePopulation ?? 0) });
    }
    const allVersions = [...verMap.values()].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));

    // Never overwrite activities with an empty array — always keep whatever was fetched
    const existingActivities = (ex.activities as Record<string,unknown>[] | undefined) || [];
    const finalActivities = activities.length > 0 ? activities : existingActivities;
    addLog(`Writing ${finalActivities.length} activities to cache (fetched=${activities.length}, existing=${existingActivities.length}).`);

    const merged = {
      ...existing,
      ...detail,
      id: journeyId,
      definitionId: effectiveDefId !== journeyId ? effectiveDefId : ((existing as Record<string,unknown>).definitionId ?? null),
      activities: finalActivities,
      goals: Array.isArray(detail.goals) ? detail.goals : (existing as Record<string, unknown>).goals || [],
      stats: mergedStats,
      allVersions,
      raw: detail,
      capturedAt: Date.now(),
    } as import("./types").CachedItem;

    const newCache = { ...get().cache };
    const idx = newCache["journeys"].findIndex(j => String(j.id) === journeyId);
    if (idx >= 0) newCache["journeys"] = newCache["journeys"].map((j, i) => i === idx ? merged : j);
    else newCache["journeys"] = [merged, ...newCache["journeys"]];

    const updatedAt = { ...get().updatedAt, journeys: Date.now() };
    await chrome.storage.local.set({ sfmcBuddyCache: { cache: newCache, updatedAt, savedAt: Date.now() } });
    set({ cache: newCache, updatedAt });
  },

  fetchAutomationDetail: async (automationId, opts) => {
    const { addLog, cache } = get();
    const dbg = (m: string) => { if (!opts?.silent) addLog(m); };
    // Always resolve a fresh tab — the stored activeTab may be stale
    const resolvedTab = await resolveSfmcTab() || get().activeTab;
    if (!resolvedTab?.id || !resolvedTab.url || !isSfmcUrl(resolvedTab.url)) {
      addLog("No active SFMC tab — open SFMC first.");
      return;
    }
    if (resolvedTab !== get().activeTab) set({ activeTab: resolvedTab });

    const stack = getStack(resolvedTab.url);
    if (!stack) { addLog("Cannot detect SFMC stack."); return; }

    const tabId      = resolvedTab.id;
    const mcBase     = `https://mc.${stack}.exacttarget.com`;           // direct (no /cloud/fuelapi prefix)
    const base       = `${mcBase}/cloud/fuelapi`;                        // proxied (most endpoints)
    const asBase     = `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi`;

    const existing   = cache["automations"].find(a => String(a.id) === automationId) || {};
    const ex         = existing as Record<string, unknown>;
    const customerKey = String(ex.customerKey || "");

    dbg(`Fetching automation detail: ${automationId}…`);

    // ── Full automation detail (steps, schedule, notifications) ──────────────
    let detail: Record<string, unknown> | null = null;
    const detailUrls = [
      `${base}/automation/v1/automations/${automationId}`,
      `${asBase}/automation/v1/automations/${automationId}`,
      ...(customerKey ? [
        `${base}/automation/v1/automations/key:${customerKey}`,
        `${asBase}/automation/v1/automations/key:${customerKey}`,
      ] : []),
      `${base}/legacy/v1/beta/automations/automation/definition/${automationId}`,
    ];
    for (const url of detailUrls) {
      try {
        const data = await fetchSfmc(url, tabId) as Record<string, unknown>;
        if (data?.id || data?.name || Array.isArray(data?.steps)) {
          detail = data;
          dbg(`Automation detail fetched from ${url.split("/").slice(-3).join("/")}`);
          dbg(`detail keys: ${Object.keys(data).join(", ")}`);
          break;
        }
      } catch { /* try next */ }
    }

    // ── Run history ───────────────────────────────────────────────────────────
    const detailObjectId = detail ? String(detail.id || detail.objectID || automationId) : automationId;
    const detailKey      = detail ? String(detail.customerKey || detail.key || customerKey) : customerKey;
    const altId  = detailObjectId !== automationId ? detailObjectId : null;
    const altKey = detailKey && detailKey !== automationId ? detailKey : null;

    let runs: Record<string, unknown>[] = [];
    // FETCH_SFMC now uses direct background service-worker fetch first (no CORS restriction,
    // reaches ALL SFMC domains) then falls back to executeScript.  All run attempts silent=true.
    const asDirectBase = `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi`;
    const runUrls: string[] = [
      // ── automationstudio (direct bg fetch, bypasses CSP) ─────────────────────
      `${asDirectBase}/legacy/v1/beta/automations/automation/definition/${automationId}/history?$pageSize=100`,
      ...(altId  ? [`${asDirectBase}/legacy/v1/beta/automations/automation/definition/${altId}/history?$pageSize=100`] : []),
      ...(altKey ? [`${asDirectBase}/legacy/v1/beta/automations/automation/definition/key:${altKey}/history?$pageSize=100`] : []),
      `${asDirectBase}/automation/v1/automations/${automationId}/runs?$pageSize=100`,
      // ── mc.exacttarget.com direct (no /cloud/fuelapi) ────────────────────────
      `${mcBase}/legacy/v1/beta/automations/automation/definition/${automationId}/history?$pageSize=100`,
      ...(altId  ? [`${mcBase}/legacy/v1/beta/automations/automation/definition/${altId}/history?$pageSize=100`] : []),
      // ── mc.exacttarget.com proxied (/cloud/fuelapi) ───────────────────────────
      `${base}/legacy/v1/beta/automations/automation/definition/${automationId}/history?$pageSize=100`,
      ...(altId  ? [`${base}/legacy/v1/beta/automations/automation/definition/${altId}/history?$pageSize=100`] : []),
      ...(altKey ? [`${base}/legacy/v1/beta/automations/automation/definition/key:${altKey}/history?$pageSize=100`] : []),
      `${base}/automation/v1/automations/${automationId}/runs?$pageSize=100`,
      ...(altId  ? [`${base}/automation/v1/automations/${altId}/runs?$pageSize=100`] : []),
      `${base}/automation/v1/automations/${automationId}/runhistory?$pageSize=100`,
      `${base}/legacy/v1/beta/automations/runs?automationId=${automationId}&$pageSize=100`,
    ];

    dbg(`Runs: ${runUrls.length} candidates for ${automationId.slice(0,8)}…`);
    for (const url of runUrls) {
      const tag = url.replace(/^https?:\/\/[^/]+\/cloud\/fuelapi\//, "").split("?")[0];
      try {
        // automationstudio host must go through its iframe (same-origin) — a direct
        // fetch from the mc.exacttarget.com page is CORS-blocked ("Failed to fetch").
        const useAs = url.startsWith(asDirectBase);
        const data = await (useAs ? fetchSfmcAs(url, tabId, true) : fetchSfmc(url, tabId, true)) as unknown;
        const raw  = data as Record<string, unknown>;
        let items  = extractArray(data);
        if (!items.length && Array.isArray(raw?.runs))    items = raw.runs    as Record<string, unknown>[];
        if (!items.length && Array.isArray(raw?.history)) items = raw.history as Record<string, unknown>[];
        if (items.length > 0) {
          runs = items as Record<string, unknown>[];
          dbg(`✓ ${runs.length} runs ← ${tag}`);
          dbg(`fields: ${Object.keys(runs[0]).join(" | ")}`);
          dbg(`sample: ${JSON.stringify(runs[0]).slice(0, 400)}`);
          break;
        }
        dbg(`○ 0 items ← ${tag} [${Object.keys(raw).slice(0,5).join(",")}]`);
      } catch (err) {
        dbg(`✗ ${tag}: ${(err as Error).message?.slice(0, 60)}`);
      }
    }

    // Reject pure automation-step objects (sparse: {id, step:N, activities?}) stored as runs.
    const isStepItem = (r: Record<string, unknown>) =>
      typeof r.step === "number" &&
      Object.keys(r).length <= 5 &&
      !Object.keys(r).some(k => /status/i.test(k) && r[k] != null);
    const validRuns = runs.filter(r => !isStepItem(r));
    dbg(`valid runs: ${validRuns.length}/${runs.length}`);

    const exRunHistory = (existing as Record<string, unknown>).runHistory;
    const existingIsStale = Array.isArray(exRunHistory) &&
      (exRunHistory as Record<string, unknown>[]).length > 0 &&
      (exRunHistory as Record<string, unknown>[]).every(isStepItem);
    const finalRunHistory = validRuns.length > 0
      ? validRuns
      : existingIsStale ? []
      : (Array.isArray(exRunHistory) ? exRunHistory : []);

    // ── Persist ───────────────────────────────────────────────────────────────
    // The detail response spreads numeric status/type back in — re-label them so
    // the UI keeps showing readable values (and never regresses to bare numbers).
    const d = (detail || {}) as Record<string, unknown>;
    const mergedStatus = labelStatus(
      d.status ?? d.statusId ?? d.programStatus ?? (existing as Record<string, unknown>).status,
      AUTOMATION_STATUS_ID,
    ) ?? String((existing as Record<string, unknown>).status ?? "Unknown");
    const mergedLastRunStatus = labelStatus(
      d.lastRunStatus ?? d.lastRunStatusId ?? (existing as Record<string, unknown>).lastRunStatus,
      RUN_STATUS_ID,
    ) ?? String((existing as Record<string, unknown>).lastRunStatus ?? "");
    const merged = {
      ...existing,
      ...d,
      id: automationId,
      status: mergedStatus,
      lastRunStatus: mergedLastRunStatus,
      automationType: d.type ?? d.typeId ?? (existing as Record<string, unknown>).automationType ?? null,
      runHistory: finalRunHistory,
      capturedAt: Date.now(),
    } as import("./types").CachedItem;

    const newCache = { ...get().cache };
    const idx = newCache["automations"].findIndex(a => String(a.id) === automationId);
    if (idx >= 0) newCache["automations"] = newCache["automations"].map((a, i) => i === idx ? merged : a);
    else newCache["automations"] = [merged, ...newCache["automations"]];

    // Derive & persist full per-automation KPIs from the resolved run history.
    const kpi = deriveAutomationKpis(finalRunHistory, {
      lastRunStatus: mergedLastRunStatus,
      lastRunTime: String(merged.lastRunTime || ""),
    });
    const automationKpis = { ...get().automationKpis, [automationId]: kpi };

    const updatedAt = { ...get().updatedAt, automations: Date.now() };
    await chrome.storage.local.set({
      sfmcBuddyCache: { cache: newCache, updatedAt, savedAt: Date.now() },
      sfmcBuddyAutomationKpis: { kpis: automationKpis, savedAt: Date.now() },
    });
    set({ cache: newCache, updatedAt, automationKpis });
    dbg(`Automation "${String(detail?.name || automationId)}" — ${kpi.totalRuns} run(s), ${kpi.successRate ?? "—"}% success, last ${kpi.lastRunStatus || "—"}.`);
  },

  refreshAllAutomationKpis: async (cap = 25) => {
    const { addLog } = get();
    const list = get().cache["automations"];
    if (!list.length) { addLog("No automations cached — run Sync all first."); return; }
    const targets = list.slice(0, cap);
    if (list.length > cap) addLog(`Refreshing KPIs for first ${cap} of ${list.length} automations…`);
    else addLog(`Refreshing KPIs for ${targets.length} automation(s)…`);
    set({ automationKpiProgress: { done: 0, total: targets.length } });
    for (let i = 0; i < targets.length; i++) {
      try { await get().fetchAutomationDetail(String(targets[i].id), { silent: true }); } catch { /* skip */ }
      set({ automationKpiProgress: { done: i + 1, total: targets.length } });
    }
    set({ automationKpiProgress: null });
    addLog(`Automation KPIs refreshed for ${targets.length} automation(s).`);
  },

  // Fetch the real SQL text + target Data Extension for a query activity.
  fetchQueryDetail: async (queryId) => {
    const { addLog, cache } = get();
    const resolvedTab = await resolveSfmcTab() || get().activeTab;
    if (!resolvedTab?.id || !resolvedTab.url || !isSfmcUrl(resolvedTab.url)) {
      addLog("No active SFMC tab — open SFMC first.");
      return;
    }
    if (resolvedTab !== get().activeTab) set({ activeTab: resolvedTab });
    const stack = getStack(resolvedTab.url);
    if (!stack) { addLog("Cannot detect SFMC stack."); return; }

    const tabId = resolvedTab.id;
    const base   = `https://mc.${stack}.exacttarget.com/cloud/fuelapi`;
    const asBase = `https://automationstudio.${stack}.marketingcloudapps.com/fuelapi`;
    const existing = cache["sqlQueries"].find(q => String(q.id) === queryId) || {};
    const ex = existing as Record<string, unknown>;
    const customerKey = String(ex.customerKey || "");

    const urls = [
      `${base}/automation/v1/queries/${queryId}`,
      `${asBase}/automation/v1/queries/${queryId}`,
      ...(customerKey ? [
        `${base}/automation/v1/queries/key:${customerKey}`,
        `${asBase}/automation/v1/queries/key:${customerKey}`,
      ] : []),
    ];

    addLog(`Fetching SQL query detail: ${queryId.slice(0, 8)}…`);
    let detail: Record<string, unknown> | null = null;
    for (const url of urls) {
      try {
        const data = await fetchSfmc(url, tabId, true) as Record<string, unknown>;
        if (data && (data.queryText || data.queryDefinitionId || data.name)) { detail = data; break; }
      } catch { /* try next */ }
    }
    if (!detail) { addLog(`Query detail fetch failed for ${queryId.slice(0, 8)}.`); return; }

    const merged = {
      ...existing,
      ...detail,
      id: queryId,
      queryText: (detail.queryText ?? ex.queryText ?? null) as string | null,
      targetName: (detail.targetName ?? detail.targetKey ?? ex.targetName ?? null) as string | null,
      targetUpdateType: (detail.targetUpdateTypeName ?? detail.targetUpdateType ?? ex.targetUpdateType ?? null) as string | null,
      capturedAt: Date.now(),
    } as import("./types").CachedItem;

    const newCache = { ...get().cache };
    const idx = newCache["sqlQueries"].findIndex(q => String(q.id) === queryId);
    if (idx >= 0) newCache["sqlQueries"] = newCache["sqlQueries"].map((q, i) => i === idx ? merged : q);
    else newCache["sqlQueries"] = [merged, ...newCache["sqlQueries"]];

    const updatedAt = { ...get().updatedAt, sqlQueries: Date.now() };
    await chrome.storage.local.set({ sfmcBuddyCache: { cache: newCache, updatedAt, savedAt: Date.now() } });
    set({ cache: newCache, updatedAt });
    addLog(`Query "${String(detail.name || queryId)}" — ${detail.queryText ? `${String(detail.queryText).length} chars SQL` : "no SQL returned"}.`);
  },

  fetchKpisFromDataViews: async (journeyId, journeyName, tsIds) => {
    const { addLog, activeTab } = get();
    addLog(`📊 DV KPIs: fetching for "${journeyName}"…`);

    // 1. Resolve SFMC tab
    if (!activeTab?.id || !activeTab.url || !isSfmcUrl(activeTab.url)) {
      addLog("⚠️ DV KPIs: no active SFMC tab found.");
      return;
    }
    const tabId = activeTab.id;
    const stack = getStack(activeTab.url);
    if (!stack) {
      addLog("⚠️ DV KPIs: could not detect SFMC stack from tab URL.");
      return;
    }

    const base = `https://mc.${stack}.exacttarget.com/cloud/fuelapi`;

    // 2. Build SQL
    const safeId = journeyId.replace(/'/g, "''");
    let whereClause: string;
    const isFullGuid = (id: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (tsIds.filter(Boolean).length > 0) {
      const parts     = tsIds.filter(Boolean);
      const fullGuids = parts.filter(isFullGuid);
      const partials  = parts.filter(id => !isFullGuid(id));
      const conditions: string[] = [];
      if (fullGuids.length > 0) {
        // _Job stores GUIDs uppercase; SFMC SQL is case-sensitive — always uppercase.
        const inList = fullGuids.map(id => `'${id.toUpperCase().replace(/'/g, "''")}'`).join(", ");
        conditions.push(`j.TriggererSendDefinitionObjectID IN (${inList})`);
      }
      if (partials.length > 0) {
        // Journey API sometimes returns only the first 8-char segment of the GUID
        // e.g. "d6b296fb" instead of "D6B296FB-CF1B-F111-BA67-F40343E97C48"
        // Use LIKE + uppercase so it matches the full uppercase GUID in _Job.
        const likeList = partials
          .map(id => `j.TriggererSendDefinitionObjectID LIKE '%${id.toUpperCase().replace(/'/g, "''")}%'`)
          .join(" OR ");
        conditions.push(likeList);
      }
      whereClause = conditions.join(" OR ");
    } else {
      const safeName = journeyName.replace(/'/g, "''");
      whereClause = `j.EmailName LIKE '%${safeName}%'`;
    }

    const sql = [
      `SELECT '${safeId}' AS JourneyID,`,
      `  COUNT(DISTINCT s.SubscriberKey) AS Sent,`,
      `  COUNT(DISTINCT CASE WHEN o.IsUnique = 1 THEN o.SubscriberKey ELSE NULL END) AS UniqueOpens,`,
      `  COUNT(DISTINCT CASE WHEN c.IsUnique = 1 THEN c.SubscriberKey ELSE NULL END) AS UniqueClicks,`,
      `  COUNT(DISTINCT b.SubscriberKey) AS Bounces,`,
      `  COUNT(DISTINCT u.SubscriberKey) AS Unsubscribes`,
      `FROM _Sent s`,
      `JOIN _Job j ON s.JobID = j.JobID`,
      `LEFT JOIN _Open o ON s.JobID = o.JobID AND s.SubscriberKey = o.SubscriberKey`,
      `LEFT JOIN _Click c ON s.JobID = c.JobID AND s.SubscriberKey = c.SubscriberKey`,
      `LEFT JOIN _Bounce b ON s.JobID = b.JobID AND s.SubscriberKey = b.SubscriberKey`,
      `LEFT JOIN _Unsubscribe u ON s.JobID = u.JobID AND s.SubscriberKey = u.SubscriberKey`,
      `WHERE ${whereClause}`,
    ].join(" ");
    addLog(`📊 DV KPIs: SQL WHERE → ${whereClause}`);

    // DE key — existing DE provided by user, no auto-creation needed
    const tempKey  = "D11D3D3C-5F65-46BE-9742-E691E7B504FC";
    const queryKey = `SezMon_Q_${Date.now()}`;
    addLog(`📊 DV KPIs: target DE="${tempKey}", stack=${stack}`);

    try {
      // 3a. Resolve a valid categoryId from an existing query (required by this SFMC instance)
      let categoryId: number | undefined;
      try {
        const cached = get().cache["sqlQueries"] as Array<Record<string, unknown>>;
        const withCat = cached?.find(q => q.categoryId != null && Number(q.categoryId) > 0);
        if (withCat) {
          categoryId = Number(withCat.categoryId);
          addLog(`📊 DV KPIs: using cached categoryId=${categoryId}`);
        } else {
          const list = await fetchSfmc(
            `${base}/automation/v1/queries?$page=1&$pageSize=1`, tabId, true
          ) as Record<string, unknown>;
          const items = (list?.items || list?.definitions || []) as Array<Record<string, unknown>>;
          if (items.length > 0 && items[0].categoryId != null) {
            categoryId = Number(items[0].categoryId);
            addLog(`📊 DV KPIs: resolved categoryId=${categoryId} from API`);
          }
        }
      } catch { /* proceed without categoryId */ }

      // 3b. Create Query Activity — target DE exists (user-provided key)
      const createPayload: Record<string, unknown> = {
        name: queryKey,
        key: queryKey,
        description: "SFMC Monitor extension temp query",
        queryText: sql,
        targetKey: tempKey,
        targetName: tempKey,
        targetUpdateTypeId: 0,
      };
      if (categoryId !== undefined && categoryId > 0) createPayload.categoryId = categoryId;

      const created = await fetchSfmcPost(`${base}/automation/v1/queries`, createPayload, tabId) as Record<string, unknown>;
      const queryId = String(created?.queryDefinitionId || created?.id || "");
      if (!queryId) {
        addLog(`⚠️ DV KPIs: failed to create query — ${JSON.stringify(created).slice(0, 200)}`);
        return;
      }
      addLog(`📊 DV KPIs: query created, id=${queryId}`);

      // 3c. Purge stale rows from the target DE before starting.
      //     targetUpdateTypeId=0 (overwrite) only clears the DE AFTER the new query
      //     finishes — old rows from a previous run remain during execution.
      //     By deleting rows now, any row we find while polling is guaranteed fresh.
      const rowsetUrl = `${base}/data/v1/customobjectdata/key/${tempKey}/rowset`;
      try {
        await chrome.runtime.sendMessage({
          type: "FETCH_SFMC", url: rowsetUrl, method: "DELETE", tabId, silent: true,
        });
        addLog("📊 DV KPIs: DE cleared (stale rows removed).");
      } catch { /* ignore — DE was already empty */ }

      // 4. Start the query
      await fetchSfmcPost(`${base}/automation/v1/queries/${queryId}/actions/start`, {}, tabId);
      addLog("📊 DV KPIs: query started — polling DE for results (up to 2 min)…");

      // 5. Poll the target DE directly for rows (24 × 5 s = 120 s max).
      //    Since we cleared the DE above, any row appearing here is from the new query.
      let rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const rowsetData = await fetchSfmc(rowsetUrl, tabId, true) as Record<string, unknown>;
          const found = (rowsetData?.items || rowsetData?.rows || []) as Array<Record<string, unknown>>;
          addLog(`📊 DV KPIs: poll ${i + 1}/24 — DE has ${found.length} row(s)`);
          if (found.length > 0) { rows = found; break; }
        } catch { /* keep retrying on transient errors */ }
      }

      if (!rows.length) {
        addLog("⚠️ DV KPIs: no rows in DE after 2 min — this journey may have no email sends recorded in Data Views.");
        return;
      }

      // Parse row values.
      // data/v1/customobjectdata rowset returns items shaped as:
      //   { keys: {}, values: { Sent: "35", UniqueOpens: "18", ... } }  ← values is an OBJECT
      // Some older endpoints return an array of {name, value} pairs instead.
      const row = rows[0] as Record<string, unknown>;
      const vals: Record<string, string> = {};
      const rawValues = row?.values;
      if (Array.isArray(rawValues)) {
        // Array of {name, value} pairs
        for (const v of rawValues as Array<{name: string; value: unknown}>) {
          vals[String(v.name ?? "").toLowerCase()] = String(v.value ?? "0");
        }
      } else if (rawValues && typeof rawValues === "object") {
        // Plain object: { FieldName: "value", ... }
        for (const [k, v] of Object.entries(rawValues as Record<string, unknown>)) {
          vals[k.toLowerCase()] = String(v ?? "0");
        }
      } else {
        // Flat row (no nested values key) — iterate row directly
        for (const [k, v] of Object.entries(row)) {
          vals[k.toLowerCase()] = String(v ?? "0");
        }
      }
      addLog(`📊 DV KPIs: parsed vals → ${JSON.stringify(vals).slice(0, 200)}`);

      const kpis: import("./types").JourneyKpis = {
        sent:         parseInt(vals["sent"] || "0", 10),
        delivered:    Math.max(0, parseInt(vals["sent"] || "0", 10) - parseInt(vals["bounces"] || "0", 10)),
        opens:        parseInt(vals["uniqueopens"] || vals["opens"] || "0", 10),
        uniqueOpens:  parseInt(vals["uniqueopens"] || "0", 10),
        clicks:       parseInt(vals["uniqueclicks"] || vals["clicks"] || "0", 10),
        uniqueClicks: parseInt(vals["uniqueclicks"] || "0", 10),
        bounces:      parseInt(vals["bounces"] || "0", 10),
        unsubs:       parseInt(vals["unsubscribes"] || vals["unsubs"] || "0", 10),
      };

      const updated = { ...get().journeyKpis, [journeyId]: kpis };
      set({ journeyKpis: updated });
      await chrome.storage.local.set({ sfmcBuddyJourneyKpis: { kpis: updated, savedAt: Date.now() } });
      addLog(`✅ DV KPIs: sent=${kpis.sent} opens=${kpis.uniqueOpens} clicks=${kpis.uniqueClicks} bounces=${kpis.bounces} unsubs=${kpis.unsubs}`);

    } catch (err) {
      addLog(`⚠️ DV KPIs error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Cleanup — delete the temp query activity (best effort)
      try {
        await chrome.runtime.sendMessage({ type: "FETCH_SFMC", url: `${base}/automation/v1/queries/key:${queryKey}`, method: "DELETE", tabId, silent: true });
      } catch { /* ignore */ }
    }
  },

  searchJourneyHistory: async (req) => {
    const { activeTab, addLog } = get();
    if (!activeTab?.id || !activeTab.url || !isSfmcUrl(activeTab.url)) {
      set({ journeyHistoryError: "No active SFMC tab found. Open SFMC in a tab first." });
      return;
    }

    const stack = getStack(activeTab.url);
    if (!stack) {
      set({ journeyHistoryError: "Unable to detect SFMC stack from current tab URL." });
      return;
    }

    set({ journeyHistoryLoading: true, journeyHistoryError: null });

    const body: Record<string, unknown> = {};
    if (req.journeyId) body.journeyId = req.journeyId;
    if (req.contactKey) body.contactKey = req.contactKey;
    if (req.activityKey) body.activityKey = req.activityKey;
    if (req.startDate) body.startDate = req.startDate;
    if (req.endDate) body.endDate = req.endDate;
    if (req.status) body.status = req.status;
    body.page = req.page ?? 1;
    body.pageSize = req.pageSize ?? 50;
    if (req.extras?.length) body.extras = req.extras;

    const url = `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1/interactions/journeyhistory/search`;

    try {
      addLog(`Journey History search: ${url}`);
      const data = (await fetchSfmcPost(url, body, activeTab.id)) as {
        items?: JourneyHistoryEntry[];
        count?: number;
        totalCount?: number;
      };

      const items: JourneyHistoryEntry[] = data?.items ?? (extractArray(data as unknown) as JourneyHistoryEntry[]);
      const total = data?.totalCount ?? data?.count ?? items.length;

      set({
        journeyHistoryResults: items,
        journeyHistoryTotal: total,
        journeyHistoryLoading: false,
      });
      addLog(`Journey History: ${items.length} record(s) returned (total: ${total}).`);
    } catch (error: unknown) {
      const msg = (error as Error).message || "Unknown error";
      set({ journeyHistoryLoading: false, journeyHistoryError: msg });
      addLog(`Journey History error: ${msg}`);
    }
  },
}));

if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.sfmcBuddyCache) {
      const storedCache = changes.sfmcBuddyCache.newValue?.cache || {};
      const storedUpdatedAt = changes.sfmcBuddyCache.newValue?.updatedAt || {};
      const cache = { ...useAppStore.getState().cache };
      const updatedAt = { ...useAppStore.getState().updatedAt };

      for (const key of COLLECTIONS) {
        if (Array.isArray(storedCache[key])) cache[key] = storedCache[key];
      }

      Object.assign(updatedAt, storedUpdatedAt);
      useAppStore.setState({ cache, updatedAt });
    }

    if (changes.sfmcBuddyJourneyKpis) {
      useAppStore.setState({ journeyKpis: changes.sfmcBuddyJourneyKpis.newValue?.kpis || {} });
    }

    if (changes.sfmcBuddyStorageMinerData) {
      useAppStore.setState({ storageMinerData: changes.sfmcBuddyStorageMinerData.newValue || null });
    }

    if (changes.sfmcProcessMinerState) {
      const tabId = useAppStore.getState().activeTab?.id;
      if (tabId) {
        const tabState = changes.sfmcProcessMinerState.newValue?.tabs?.[String(tabId)] || null;
        if (tabState) useAppStore.setState({ tabState });
      }
    }
  });
}
