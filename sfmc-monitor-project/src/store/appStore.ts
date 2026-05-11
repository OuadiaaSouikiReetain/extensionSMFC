import { create } from "zustand";
import type {
  View, CollectionKey, CachedItem, JourneyListItem, Journey,
  JourneyKpis, AppSettings, TabState, StorageMinerData,
  JourneyHistoryEntry, JourneyHistorySearchRequest,
} from "./types";

const COLLECTIONS: CollectionKey[] = [
  "journeys","automations","sqlQueries","dataExtensions",
  "assets","folders","publicationLists","canvasActivities","errors",
];

const DEFAULT_SETTINGS: AppSettings = {
  journeyTimeout: 60, pageSize: 50, autoRefresh: false, autoInterval: 5, lang: "fr",
};

// ── Store interface ───────────────────────────────────────────────────────────

interface AppStore {
  // Navigation
  activeView: View;
  activeCollection: CollectionKey | null;
  activeObjectId: string | null;

  // Data
  cache: Record<CollectionKey, CachedItem[]>;
  updatedAt: Record<string, number>;
  journeyKpis: Record<string, JourneyKpis>;
  settings: AppSettings;
  tabState: TabState | null;
  activeTab: chrome.tabs.Tab | null;
  storageMinerData: StorageMinerData | null;

  // Journey history
  journeyHistoryResults: JourneyHistoryEntry[];
  journeyHistoryTotal: number;
  journeyHistoryLoading: boolean;
  journeyHistoryError: string | null;

  // UI
  loading: boolean;
  logs: string[];
  searchQuery: string;

  // Actions
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyCache(): Record<CollectionKey, CachedItem[]> {
  return Object.fromEntries(COLLECTIONS.map(k => [k, []])) as Record<CollectionKey, CachedItem[]>;
}

function addLogLine(logs: string[], line: string): string[] {
  const ts = new Date().toLocaleTimeString();
  return [...logs, `[${ts}] ${line}`].slice(-120);
}

async function fetchSfmc(url: string, tabId?: number): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC", url, tabId });
  if (!res?.ok) throw new Error(res?.error || "Fetch failed");
  return res.data;
}

async function fetchSfmcPost(url: string, body: unknown, tabId?: number): Promise<unknown> {
  const res = await chrome.runtime.sendMessage({ type: "FETCH_SFMC_POST", url, body, tabId });
  if (!res?.ok) throw new Error(res?.error || "POST fetch failed");
  return res.data;
}

function getStack(tabUrl: string): string | null {
  try {
    const url = new URL(tabUrl);
    const m = url.hostname.match(/\.s(\d+)\.|mc\.s(\d+)\./i);
    if (m) return `s${m[1] || m[2]}`;
    const m2 = url.hostname.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
    if (m2) return m2[1];
  } catch { /* ignore */ }
  return null;
}

function isSfmcUrl(url: string): boolean {
  return /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i.test(url);
}

function normalizeJourneyItem(item: Record<string, unknown>): CachedItem {
  return {
    ...item,
    id: String(item.id || item.definitionId || item.key || ""),
    key: String(item.key || item.definitionKey || item.id || ""),
    name: String(item.name || item.journeyName || item.key || "Untitled"),
    status: String(item.status || item.scheduledStatus || "Unknown"),
    version: item.version || item.versionNumber || null,
    customerKey: item.customerKey || item.key || null,
    capturedAt: Date.now(),
  };
}

function normalizeAutomationItem(item: Record<string, unknown>): CachedItem {
  return {
    ...item,
    id: String(item.id || item.objectID || item.automationId || item.customerKey || ""),
    name: String(item.name || item.automationName || item.customerKey || "Untitled"),
    customerKey: item.customerKey || item.key || null,
    status: String(item.status ?? item.statusName ?? item.automationStatus ?? "Unknown"),
    lastRunStatus: String(item.lastRunStatus ?? item.lastRunStatusName ?? ""),
    lastRunTime: String(item.lastRunTime || item.lastRunAt || item.modifiedDate || ""),
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

function extractArray(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const candidates = [d.items,d.entry,d.results,d.data,d.interactions,d.objects,d.records,d.rows,d.automations,d.assets,d.value,d.entities];
  const list = candidates.find(Array.isArray);
  if (list) return list as Record<string,unknown>[];
  if (d.id || d.name) return [d];
  return [];
}

// ── Store ─────────────────────────────────────────────────────────────────────

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

  setView: (view, collectionKey, objectId) =>
    set({ activeView: view, activeCollection: collectionKey ?? null, activeObjectId: objectId ?? null }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  addLog: (line) => set(s => ({ logs: addLogLine(s.logs, line) })),

  setLoading: (v) => set({ loading: v }),

  // ── loadAll ───────────────────────────────────────────────────────────────
  loadAll: async () => {
    try {
      const data = await chrome.storage.local.get([
        "sfmcBuddyCache","sfmcBuddyJourneyKpis","sfmcBuddyStorageMinerData","sfmcProcessMinerState",
      ]);

      const cache: Record<CollectionKey, CachedItem[]> = emptyCache();
      const updatedAt: Record<string, number> = {};

      if (data.sfmcBuddyCache) {
        const c = data.sfmcBuddyCache.cache || {};
        for (const k of COLLECTIONS) if (Array.isArray(c[k])) cache[k] = c[k];
        Object.assign(updatedAt, data.sfmcBuddyCache.updatedAt || {});
      }

      const journeyKpis = data.sfmcBuddyJourneyKpis?.kpis || {};
      const storageMinerData = data.sfmcBuddyStorageMinerData || null;

      // Active tab
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const sfmcTab = tabs.find(t => t.url && isSfmcUrl(t.url)) || tabs[0] || null;

      // Tab state
      let tabState: TabState | null = null;
      if (sfmcTab?.id) {
        const res = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: sfmcTab.id });
        tabState = res?.state || null;
      }

      // Settings
      const settingsData = await chrome.storage.sync.get(["sfmcBuddySettings"]);
      const settings = { ...DEFAULT_SETTINGS, ...settingsData.sfmcBuddySettings };

      set({ cache, updatedAt, journeyKpis, storageMinerData, activeTab: sfmcTab, tabState, settings });
    } catch (e: unknown) {
      get().addLog(`loadAll error: ${(e as Error).message}`);
    }
  },

  // ── saveSettings ──────────────────────────────────────────────────────────
  saveSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    await chrome.storage.sync.set({ sfmcBuddySettings: settings });
    set({ settings });
    get().addLog("Settings saved.");
  },

  // ── synchronize ───────────────────────────────────────────────────────────
  synchronize: async () => {
    const { activeTab, settings, addLog, setLoading } = get();
    if (!activeTab?.id || !activeTab.url || !isSfmcUrl(activeTab.url)) {
      addLog("Open an SFMC tab before synchronizing.");
      return;
    }
    setLoading(true);
    addLog("Synchronizing…");
    try {
      const stack = getStack(activeTab.url);
      if (!stack) { addLog("Unable to detect SFMC stack."); return; }

      const tabId = activeTab.id;
      const cache = { ...get().cache };
      const updatedAt = { ...get().updatedAt };

      const sync = async (key: CollectionKey, loader: () => Promise<CachedItem[]>) => {
        try {
          cache[key] = await loader();
          updatedAt[key] = Date.now();
          addLog(`${cache[key].length} ${key} synced.`);
        } catch (e: unknown) { addLog(`${key}: ${(e as Error).message}`); }
      };

      const pageSize = settings.pageSize;

      await sync("journeys", async () => {
        const url = `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1/interactions?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true&%24page=1&%24pageSize=${pageSize}&extras=trigger%2Cstats%2Ctag%2Cactivity`;
        const data = await fetchSfmc(url, tabId);
        return dedupe(extractArray(data).map(normalizeJourneyItem));
      });

      await sync("automations", async () => {
        const url = `https://mc.${stack}.exacttarget.com/cloud/fuelapi/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView&$page=1&$pageSize=${pageSize}`;
        const data = await fetchSfmc(url, tabId);
        return dedupe(extractArray(data).map(normalizeAutomationItem));
      });

      await sync("dataExtensions", async () => {
        const url = `https://mc.${stack}.exacttarget.com/cloud/fuelapi/data/v1/customobjectdata/types?$page=1&$pageSize=${pageSize}`;
        const data = await fetchSfmc(url, tabId);
        return dedupe(extractArray(data).map(item => ({ ...item, id: String(item.objectID || item.id || ""), name: String(item.name || item.displayName || ""), capturedAt: Date.now() })));
      });

      await sync("sqlQueries", async () => {
        const url = `https://mc.${stack}.exacttarget.com/cloud/fuelapi/automation/v1/queries/?$page=1&$pageSize=${pageSize}`;
        const data = await fetchSfmc(url, tabId);
        return dedupe(extractArray(data).map(item => ({ ...item, id: String(item.queryDefinitionId || item.id || ""), name: String(item.name || item.customerKey || ""), status: String(item.status || ""), capturedAt: Date.now() })));
      });

      // Save to storage
      await chrome.storage.local.set({ sfmcBuddyCache: { cache, updatedAt, savedAt: Date.now() } });
      set({ cache, updatedAt });
      addLog("Sync complete.");
    } catch (e: unknown) {
      addLog(`Sync failed: ${(e as Error).message}`);
    } finally { setLoading(false); }
  },

  // ── purgeCache ────────────────────────────────────────────────────────────
  purgeCache: async (collection) => {
    const cache = { ...get().cache };
    const updatedAt = { ...get().updatedAt };
    if (collection === "all") {
      for (const k of COLLECTIONS) { cache[k] = []; delete updatedAt[k]; }
    } else {
      cache[collection] = [];
      delete updatedAt[collection];
    }
    await chrome.storage.local.set({ sfmcBuddyCache: { cache, updatedAt, savedAt: Date.now() } });
    set({ cache, updatedAt });
    get().addLog(`Cache purged: ${collection}.`);
  },

  // ── exportSnapshot ────────────────────────────────────────────────────────
  exportSnapshot: () => ({
    version: "2.2.0",
    exportedAt: new Date().toISOString(),
    cache: get().cache,
    updatedAt: get().updatedAt,
    journeyKpis: get().journeyKpis,
  }),

  // ── importSnapshot ────────────────────────────────────────────────────────
  importSnapshot: async (data) => {
    try {
      const snap = data as { cache?: Record<CollectionKey, CachedItem[]>; updatedAt?: Record<string,number>; journeyKpis?: Record<string,JourneyKpis> };
      const cache: Record<CollectionKey, CachedItem[]> = emptyCache();
      const updatedAt: Record<string,number> = {};
      if (snap.cache) for (const k of COLLECTIONS) if (Array.isArray(snap.cache[k])) cache[k] = snap.cache[k];
      if (snap.updatedAt) Object.assign(updatedAt, snap.updatedAt);
      const journeyKpis = snap.journeyKpis || {};
      await chrome.storage.local.set({ sfmcBuddyCache: { cache, updatedAt }, sfmcBuddyJourneyKpis: { kpis: journeyKpis } });
      set({ cache, updatedAt, journeyKpis });
      get().addLog("Snapshot imported.");
    } catch (e: unknown) { get().addLog(`Import failed: ${(e as Error).message}`); }
  },

  // ── searchJourneyHistory ──────────────────────────────────────────────────
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
    if (req.journeyId)    body.journeyId     = req.journeyId;
    if (req.contactKey)   body.contactKey    = req.contactKey;
    if (req.activityKey)  body.activityKey   = req.activityKey;
    if (req.startDate)    body.startDate     = req.startDate;
    if (req.endDate)      body.endDate       = req.endDate;
    if (req.status)       body.status        = req.status;
    body.page     = req.page     ?? 1;
    body.pageSize = req.pageSize ?? 50;
    if (req.extras?.length) body.extras = req.extras;

    const url = `https://jbinteractions.${stack}.marketingcloudapps.com/fuelapi/interaction/v1/interactions/journeyhistory/search`;

    try {
      addLog(`Journey History search: ${url}`);
      const data = await fetchSfmcPost(url, body, activeTab.id) as {
        items?: JourneyHistoryEntry[];
        count?: number;
        totalCount?: number;
        pageSize?: number;
        page?: number;
      };

      const items: JourneyHistoryEntry[] = data?.items ?? extractArray(data as unknown) as JourneyHistoryEntry[];
      const total = data?.totalCount ?? data?.count ?? items.length;

      set({ journeyHistoryResults: items, journeyHistoryTotal: total, journeyHistoryLoading: false });
      addLog(`Journey History: ${items.length} record(s) returned (total: ${total}).`);
    } catch (e: unknown) {
      const msg = (e as Error).message || "Unknown error";
      set({ journeyHistoryLoading: false, journeyHistoryError: msg });
      addLog(`Journey History error: ${msg}`);
    }
  },
}));

// ── Storage live-sync ─────────────────────────────────────────────────────────
// Keeps store in sync when background.js writes to chrome.storage.local
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.sfmcBuddyCache) {
      const c = changes.sfmcBuddyCache.newValue?.cache || {};
      const u = changes.sfmcBuddyCache.newValue?.updatedAt || {};
      const cache = { ...useAppStore.getState().cache };
      const updatedAt = { ...useAppStore.getState().updatedAt };
      for (const k of COLLECTIONS) if (Array.isArray(c[k])) cache[k] = c[k];
      Object.assign(updatedAt, u);
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
