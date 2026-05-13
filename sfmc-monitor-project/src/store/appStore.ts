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
} from "./types";

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

function emptyCache(): Record<CollectionKey, CachedItem[]> {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, []])) as Record<CollectionKey, CachedItem[]>;
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
  return {
    id: String(item.id || item.definitionId || item.key || ""),
    key: String(item.key || item.definitionKey || item.id || ""),
    name: String(item.name || item.journeyName || item.key || "Untitled"),
    status: String(item.status || item.scheduledStatus || "Unknown"),
    version: item.version || item.versionNumber || null,
    customerKey: item.customerKey || item.key || null,
    categoryId: item.categoryId || null,
    modifiedDate: item.modifiedDate || null,
    lastPublishedDate: item.lastPublishedDate || null,
    capturedAt: Date.now(),
  };
}

function normalizeAutomationItem(item: Record<string, unknown>): CachedItem {
  return {
    id: String(item.id || item.objectID || item.automationId || item.customerKey || ""),
    name: String(item.name || item.automationName || item.customerKey || "Untitled"),
    customerKey: item.customerKey || item.key || null,
    status: String(item.status ?? item.statusName ?? item.automationStatus ?? "Unknown"),
    lastRunStatus: String(item.lastRunStatus ?? item.lastRunStatusName ?? ""),
    lastRunTime: String(item.lastRunTime || item.lastRunAt || item.modifiedDate || ""),
    automationType: item.automationType || item.type || null,
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

      set({ cache, updatedAt, journeyKpis, storageMinerData, activeTab, tabState, settings });
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
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions`,
          `${journeyBase}/fuelapi/interaction/v1/interactions`,
          `${classicBase}/cloud/fuelapi/interaction/v1/interactions?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true`,
          `${journeyBase}/fuelapi/interaction/v1/interactions?mostRecentVersionOnly=false&mostRecentVersionOrRunningOnly=true`,
        ];
        return fetchFromCandidates(urls, pageSize, tabId, normalizeJourneyItem);
      });

      await sync("automations", async () => {
        const urls = [
          `${classicBase}/cloud/fuelapi/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView`,
          `${classicBase}/cloud/fuelapi/automation/v1/automations`,
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

      const tabStateRes = await chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId });
      set({ cache, updatedAt, tabState: tabStateRes?.state || null, activeTab });

      try {
        await chrome.storage.local.set({
          sfmcBuddyCache: { cache, updatedAt, savedAt: Date.now() },
        });
      } catch (error: unknown) {
        addLog(`Cache persistence warning: ${(error as Error).message}`);
      }

      addLog("Sync complete.");
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
