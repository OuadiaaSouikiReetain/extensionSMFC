import type { AutomationKpis } from "../store/types";

// SFMC run-instance status (numeric id → label). Mirrors the maps in
// appStore.ts / background.js — runs report status as numbers.
const RUN_STATUS_ID: Record<string, string> = {
  "0": "Queued", "1": "Complete", "2": "Error", "3": "Running", "4": "Stopped",
  "5": "Scheduled", "6": "Paused", "7": "Skipped", "8": "InactiveTrigger",
  "9": "Building", "10": "Initializing", "100": "Complete", "200": "Error", "300": "Running",
};

const STATUS_FIELDS = [
  "status", "Status", "statusName", "StatusName", "runStatus", "RunStatus",
  "runStatusName", "RunStatusName", "automationStatus", "AutomationStatus",
  "taskStatus", "TaskStatus", "programRunStatus", "ProgramRunStatus", "state", "State",
];
const STATUS_ID_FIELDS = [
  "statusId", "StatusId", "runStatusId", "RunStatusId", "automationStatusId",
  "AutomationStatusId", "taskStatusId", "TaskStatusId", "programRunStatusId", "status_id",
];
const START_FIELDS = [
  "startTime", "startedAt", "scheduledTime", "runTime", "scheduleTime", "taskStartTime",
  "actualStartTime", "executionTime", "launchTime", "runDate", "createdDate",
  "modifiedDate", "lastRunTime", "triggerTime",
];
const END_FIELDS = [
  "endTime", "completedAt", "finishedAt", "taskEndTime", "completionTime",
  "actualEndTime", "completedTime", "endDate",
];

// Resolve a run's status to a human label (string field, numeric id, or fallback).
export function resolveRunStatus(run: Record<string, unknown>): string {
  for (const f of STATUS_FIELDS) {
    const v = run[f];
    if (v != null && v !== "" && typeof v !== "number") return String(v);
  }
  for (const f of STATUS_ID_FIELDS) {
    const id = run[f];
    if (id != null) {
      const label = RUN_STATUS_ID[String(Number(id))];
      if (label) return label;
      if (Number(id) > 0) return `Status ${id}`;
    }
  }
  return "Unknown";
}

// Parse ISO strings, WCF "/Date(ms)/", or epoch-ms numbers → epoch ms (or null).
function parseDate(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1_000_000_000_000 ? v : null;
  const s = String(v);
  const wcf = s.match(/\/Date\((\d+)/);
  if (wcf) return Number(wcf[1]);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function resolveDate(run: Record<string, unknown>, fields: string[]): number | null {
  for (const k of fields) {
    const direct = parseDate(run[k]);
    if (direct != null) return direct;
    const pascal = k.charAt(0).toUpperCase() + k.slice(1);
    const p = parseDate(run[pascal]);
    if (p != null) return p;
  }
  return null;
}

export function isSuccessStatus(s: string): boolean { return /complet|success|finished|done/i.test(s); }
export function isErrorStatus(s: string): boolean { return /error|fail/i.test(s); }

// Build a single synthetic "run" from a gridView automation item's last-run
// fields (status + start/complete time). Used when full run history isn't
// available (which is the normal case — see sfmc-automation-backend memory).
export function lastRunRows(item: Record<string, unknown>): Record<string, unknown>[] {
  const status = item.lastRunStatus ?? item.status;
  const start = item.startTime ?? item.lastRunTime;
  const end = item.completedTime;
  if ((status == null || status === "") && (start == null || start === "")) return [];
  return [{ status: String(status || ""), startTime: start ?? null, endTime: end ?? null }];
}

// Effective run history: real captured history if present, else the single
// last-run synthesized from the gridView item.
export function effectiveRuns(item: Record<string, unknown>): Record<string, unknown>[] {
  const rh = item.runHistory;
  if (Array.isArray(rh) && rh.length) return rh as Record<string, unknown>[];
  return lastRunRows(item);
}

// Derive aggregate KPIs from a run-history array. `fallback` supplies last-run
// info from the list cache when run history isn't available yet.
export function deriveAutomationKpis(
  runHistory: Record<string, unknown>[] | null | undefined,
  fallback?: { lastRunStatus?: string | null; lastRunTime?: string | null },
): AutomationKpis {
  const runs = Array.isArray(runHistory) ? runHistory : [];
  const totalRuns = runs.length;

  let successRuns = 0;
  let errorRuns = 0;
  let durSum = 0;
  let durCount = 0;
  for (const r of runs) {
    const st = resolveRunStatus(r);
    if (isSuccessStatus(st)) successRuns++;
    else if (isErrorStatus(st)) errorRuns++;
    const start = resolveDate(r, START_FIELDS);
    const end = resolveDate(r, END_FIELDS);
    if (start != null && end != null && end > start) { durSum += (end - start) / 1000; durCount++; }
  }

  // Runs are returned newest-first by SFMC; index 0 is the most recent.
  const last = runs[0];
  const lastRunStatus = last ? resolveRunStatus(last) : (fallback?.lastRunStatus || "");
  const lastRunAt = (last ? resolveDate(last, START_FIELDS) : null) ?? parseDate(fallback?.lastRunTime ?? null);

  return {
    totalRuns,
    successRuns,
    errorRuns,
    successRate: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 1000) / 10 : null,
    lastRunStatus,
    lastRunAt,
    avgDurationSec: durCount > 0 ? Math.round(durSum / durCount) : null,
    hoursSinceLastRun: lastRunAt != null ? Math.round(((Date.now() - lastRunAt) / 3_600_000) * 10) / 10 : null,
    computedAt: Date.now(),
  };
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// ── Status grouping ──────────────────────────────────────────────────────────
const ACTIVE_STATUSES = /running|ready|scheduled|awaitingtrigger/i;
const DISABLED_STATUSES = /paused|stopped|inactivetrigger/i;
export function automationStatusGroup(status: string): "active" | "disabled" | "other" {
  const s = String(status || "");
  if (ACTIVE_STATUSES.test(s)) return "active";
  if (DISABLED_STATUSES.test(s)) return "disabled";
  return "other";
}

// ── Activity classification (steps[].activities[]) ───────────────────────────
const ACTIVITY_TYPE: Record<string, string> = {
  "42": "Send Email", "73": "Send Email", "43": "Report", "45": "Data Extract",
  "53": "Filter", "300": "SQL Query", "303": "SQL Query", "423": "Script", "425": "Script",
  "467": "Verification", "484": "Wait", "725": "File Transfer", "726": "Data Factory",
  "733": "Fire Event", "749": "Import File", "783": "Refresh Group",
  "952": "Refresh MobileFilteredList", "1010": "Refresh Predictive", "1101": "Journeys Audience",
};
export function classifyActivity(act: Record<string, unknown>): string {
  const raw = act.activityType ?? act.type ?? act.objectTypeId ?? act.activityObjectTypeId;
  if (raw == null || raw === "") return "Other";
  const s = String(raw);
  if (ACTIVITY_TYPE[s]) return ACTIVITY_TYPE[s];
  if (!/^-?\d+$/.test(s)) return s; // already a readable string
  return `Type ${s}`;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface AutomationAnalytics {
  total: number; active: number; disabled: number; other: number;
  noRunSince7d: number;
  analysed: number;                 // automations with run history available
  totalRuns: number; successRuns: number; errorRuns: number; warningRuns: number;
  successRate: number | null; failRate: number | null;
  avgDurationSec: number | null; maxDurationSec: number | null; minDurationSec: number | null;
  durationTodaySec: number; durationWeekSec: number; durationMonthSec: number;
  topFailing: { id: string; name: string; errorRuns: number; totalRuns: number }[];
  abnormal: { id: string; name: string; avgSec: number }[];
  activityCounts: Record<string, number>;
}

// Aggregate fleet-wide automation analytics from the list (status/lastRun/steps)
// and any run history present on the cached items.
export function aggregateAutomationAnalytics(
  automations: Record<string, unknown>[],
  kpis: Record<string, { lastRunAt?: number | null }>,
): AutomationAnalytics {
  const now = Date.now();
  const WEEK = 7 * 86_400_000;
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  let active = 0, disabled = 0, other = 0, noRunSince7d = 0;
  let totalRuns = 0, successRuns = 0, errorRuns = 0, warningRuns = 0, analysed = 0;
  let durToday = 0, durWeek = 0, durMonth = 0;
  const allDurations: number[] = [];
  const perAuto: { id: string; name: string; errorRuns: number; totalRuns: number; avgSec: number }[] = [];
  const activityCounts: Record<string, number> = {};

  for (const a of automations) {
    const id = String(a.id || "");
    const name = String(a.name || id);
    const grp = automationStatusGroup(String(a.status || ""));
    if (grp === "active") active++; else if (grp === "disabled") disabled++; else other++;

    const lastRunAt = kpis[id]?.lastRunAt ?? parseDate(a.lastRunTime);
    if (lastRunAt == null || now - lastRunAt > WEEK) noRunSince7d++;

    // Activity counts from configured steps.
    const steps = Array.isArray(a.steps) ? (a.steps as Record<string, unknown>[]) : [];
    for (const st of steps) {
      const acts = Array.isArray(st.activities) ? (st.activities as Record<string, unknown>[]) : [];
      for (const act of acts) {
        const label = classifyActivity(act);
        activityCounts[label] = (activityCounts[label] || 0) + 1;
      }
    }

    // Run-based metrics: real captured history if present, else the gridView's
    // last-run sample so every automation still contributes.
    const runs = effectiveRuns(a);
    if (!runs.length) continue;
    analysed++;
    let autoErr = 0, autoDurSum = 0, autoDurCount = 0;
    for (const r of runs) {
      const st = resolveRunStatus(r);
      totalRuns++;
      if (isSuccessStatus(st)) successRuns++;
      else if (isErrorStatus(st)) { errorRuns++; autoErr++; }
      else if (/skip/i.test(st)) warningRuns++;
      const start = resolveDate(r, START_FIELDS);
      const end = resolveDate(r, END_FIELDS);
      if (start != null && end != null && end > start) {
        const sec = (end - start) / 1000;
        allDurations.push(sec);
        autoDurSum += sec; autoDurCount++;
        if (start >= dayStart) durToday += sec;
        if (now - start <= WEEK) durWeek += sec;
        if (start >= monthStart) durMonth += sec;
      }
    }
    perAuto.push({ id, name, errorRuns: autoErr, totalRuns: runs.length, avgSec: autoDurCount ? autoDurSum / autoDurCount : 0 });
  }

  const med = median(perAuto.map(p => p.avgSec).filter(v => v > 0));
  const abnormal = perAuto
    .filter(p => med > 0 && p.avgSec > med * 2)
    .sort((a, b) => b.avgSec - a.avgSec)
    .slice(0, 5)
    .map(p => ({ id: p.id, name: p.name, avgSec: Math.round(p.avgSec) }));
  const topFailing = perAuto
    .filter(p => p.errorRuns > 0)
    .sort((a, b) => b.errorRuns - a.errorRuns)
    .slice(0, 5)
    .map(p => ({ id: p.id, name: p.name, errorRuns: p.errorRuns, totalRuns: p.totalRuns }));

  return {
    total: automations.length, active, disabled, other, noRunSince7d, analysed,
    totalRuns, successRuns, errorRuns, warningRuns,
    successRate: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 1000) / 10 : null,
    failRate: totalRuns > 0 ? Math.round((errorRuns / totalRuns) * 1000) / 10 : null,
    avgDurationSec: allDurations.length ? Math.round(allDurations.reduce((s, v) => s + v, 0) / allDurations.length) : null,
    maxDurationSec: allDurations.length ? Math.round(Math.max(...allDurations)) : null,
    minDurationSec: allDurations.length ? Math.round(Math.min(...allDurations)) : null,
    durationTodaySec: Math.round(durToday), durationWeekSec: Math.round(durWeek), durationMonthSec: Math.round(durMonth),
    topFailing, abnormal, activityCounts,
  };
}
