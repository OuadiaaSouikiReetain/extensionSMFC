// ── Collections ───────────────────────────────────────────────────────────────

export type CollectionKey =
  | "journeys" | "automations" | "sqlQueries" | "dataExtensions"
  | "assets" | "folders" | "publicationLists" | "canvasActivities" | "errors";

export interface CachedItem {
  id?: string;
  name?: string;
  customerKey?: string;
  status?: string;
  version?: string | number | null;
  automationType?: string;
  lastRunStatus?: string;
  lastRunTime?: string | null;
  capturedAt?: number;
  source?: string;
  [key: string]: unknown;
}

export interface NetworkError {
  tabId?: number | string;
  url: string;
  fullUrl?: string;
  status: number;
  message: string;
  capturedAt: number;
}

// ── Journey ───────────────────────────────────────────────────────────────────

export interface JourneyActivity {
  id?: string;
  key?: string;
  name?: string;
  type?: string;
  stats?: {
    contactsIn?: number;
    contactsOut?: number;
    contactsError?: number;
    contactsQueued?: number;
    currentPopulation?: { count?: number };
    entered?: number;
    completed?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Journey {
  id: string;
  key?: string | null;
  name: string;
  version?: string | number | null;
  status?: string;
  activities: JourneyActivity[];
  stats: Record<string, unknown>;
  goals: unknown[];
  raw?: unknown;
  capturedAt: number;
}

export interface JourneyListItem {
  id: string;
  key?: string;
  name: string;
  status?: string;
  version?: string | number | null;
  customerKey?: string | null;
  capturedAt?: number;
}

export interface JourneyKpis {
  sent: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  bounces: number;
  unsubs: number;
}

export interface AutomationKpis {
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  successRate: number | null;       // 0–100, null when no runs known
  lastRunStatus: string;
  lastRunAt: number | null;         // epoch ms
  avgDurationSec: number | null;
  hoursSinceLastRun: number | null;
  computedAt: number;
}

// ── Alert rules (KPI monitoring) ──────────────────────────────────────────────

export type RuleMetric =
  | "bounceRate" | "openRate" | "clickRate" | "unsubRate" | "deliveryRate"
  | "bounces" | "sent" | "delivered" | "opens" | "clicks" | "unsubs";

export type RuleOperator = ">" | ">=" | "<" | "<=" | "==";

export interface AlertRule {
  id: string;
  name: string;
  scope: "all" | string;          // "all" journeys, or a specific journeyId
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  enabled: boolean;
  createdAt: number;
}

export interface AlertSettings {
  recipient: string;              // email address for alerts
  webhookUrl: string;             // optional: POST JSON here (Zapier/Make/custom)
  emailjsServiceId: string;       // optional: EmailJS service id
  emailjsTemplateId: string;      // optional: EmailJS template id
  emailjsPublicKey: string;       // optional: EmailJS public key
  notifyDesktop: boolean;         // also raise a desktop notification
  checkOnSync: boolean;           // re-evaluate rules after every Sync
  cooldownMinutes: number;        // min minutes between repeat alerts per rule+journey
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  recipient: "ahmed.ouadiaa@reetain.com",
  webhookUrl: "",
  emailjsServiceId: "",
  emailjsTemplateId: "",
  emailjsPublicKey: "",
  notifyDesktop: true,
  checkOnSync: true,
  cooldownMinutes: 60,
};

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  journeyId: string;
  journeyName: string;
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  actual: number;
  detectedAt: number;
}

// ── Journey History (POST /interaction/v1/interactions/journeyhistory/search) ─

export interface JourneyHistorySearchRequest {
  journeyId?: string;
  contactKey?: string;
  activityKey?: string;
  startDate?: string;         // ISO 8601
  endDate?: string;
  status?: JourneyHistoryStatus;
  page?: number;
  pageSize?: number;
  extras?: string[];
}

export type JourneyHistoryStatus =
  | "Waiting" | "Running" | "Completed" | "Exited" | "Error" | "GoalMet";

export interface JourneyHistoryEntry {
  contactKey?: string;
  journeyId?: string;
  journeyName?: string;
  versionNumber?: number;
  activityKey?: string;
  activityName?: string;
  activityType?: string;
  status?: JourneyHistoryStatus | string;
  enteredAt?: string;
  exitedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  [key: string]: unknown;
}

export interface JourneyHistoryResponse {
  items?: JourneyHistoryEntry[];
  count?: number;
  page?: number;
  pageSize?: number;
  totalCount?: number;
}

// ── Storage miner ─────────────────────────────────────────────────────────────

export interface UserProfile {
  userId?: string;
  userName?: string;
  userEmail?: string;
  userRoles?: string[];
  legacyMid?: string;
  stackKey?: string;
  organizationId?: string;
  enterpriseId?: string;
}

export interface BusinessUnit {
  buName?: string;
  buMid?: string;
  buTimezone?: string;
  buLocale?: string;
  parentMid?: string;
  accountType?: string;
  isEnterprise?: boolean;
}

export interface AccountSettings {
  dateFormat?: string;
  enabledModules?: string[];
  sendThrottle?: string;
}

export interface SessionMetadata {
  sessionId?: string;
  csrfPresent?: boolean;
  tokenExpiry?: number | null;
  loginTimestamp?: number | null;
  sfmcStack?: string | null;
  pageContext?: string | null;
  pageUrl?: string;
}

export interface MinerError {
  message: string;
  timestamp?: number | null;
  code?: string | null;
}

export interface AutomationRunEntry {
  id?: string;
  name?: string;
  status?: string;
  lastRunTime?: string;
  nextRunTime?: string;
}

export interface JourneyDraftEntry {
  id?: string;
  name?: string;
  savedAt?: number | null;
  status?: string;
}

export interface StorageMinerData {
  userProfile: UserProfile;
  businessUnit: BusinessUnit;
  accountSettings: AccountSettings;
  featureFlags: Record<string, boolean | string>;
  recentErrors: MinerError[];
  automationHistory: AutomationRunEntry[];
  journeyDrafts: JourneyDraftEntry[];
  sessionMetadata: SessionMetadata;
  minedAt: number;
  tabId?: number | string;
  url?: string;
  storedAt?: number;
}

// ── Tab state (from background) ───────────────────────────────────────────────

export interface TabState {
  journeys: Record<string, Journey>;
  journeyList: JourneyListItem[];
  canvas?: { activities?: Array<{ name: string; type: string; key: string }> };
  session?: SfmcSession;
  delivery?: DeliveryMetrics;
  captureStatus?: "running" | "done";
  captureMode?: string;
  captureStartedAt?: number;
  captureFinishedAt?: number;
  debug?: string[];
  traces?: NetworkTrace[];
  updatedAt?: number;
}

export interface SfmcSession {
  isSfmc: boolean;
  url?: string;
  host?: string | null;
  stack?: string | null;
  subdomain?: string | null;
  restBase?: string | null;
}

export interface DeliveryMetrics {
  sent: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  bounces: number;
  hardBounces: number;
  softBounces: number;
  unsubs: number;
  complaints: number;
  sources?: string[];
  capturedAt?: number;
}

export interface NetworkTrace {
  ts: number;
  method: string;
  url: string;
  fullUrl: string;
  postData?: string;
}

// ── App settings ──────────────────────────────────────────────────────────────

export interface AppSettings {
  journeyTimeout: number;
  pageSize: number;
  autoRefresh: boolean;
  autoInterval: number;
  lang: "fr" | "en";
}

// ── View routing ──────────────────────────────────────────────────────────────

export type View =
  | "dashboard"
  | "collection"
  | "detail"
  | "settings"
  | "analytics"
  | "utilities"
  | "journey-history"
  | "storage-miner"
  | "rules"
  | "automation-analytics"
  | "journey-analytics";
