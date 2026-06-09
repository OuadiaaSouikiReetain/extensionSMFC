import type { JourneyKpis } from "../store/types";

export function journeyStatusGroup(status: string): "running" | "draft" | "stopped" | "paused" | "other" {
  const s = String(status || "").toLowerCase();
  if (/running|published|active/.test(s) && !/unpublished/.test(s)) return "running";
  if (/draft|unpublished|notpublished/.test(s)) return "draft";
  if (/stopped|deleted|finish/.test(s)) return "stopped";
  if (/paused|scheduled/.test(s)) return "paused";
  return "other";
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function statOf(j: Record<string, unknown>, key: string): number {
  const s = j.stats as Record<string, unknown> | undefined;
  return num(s?.[key]);
}
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export interface JourneyAnalytics {
  total: number; running: number; draft: number; stopped: number; paused: number; other: number;
  totalEntered: number; currentlyActive: number; goalsMet: number; exitMet: number;
  avgGoalPerf: number | null;
  byChannel: Record<string, number>;
  topByVolume: { id: string; name: string; entered: number; status: string }[];
  // Email KPIs (from on-demand Data Views fetches; sparse).
  emailCovered: number;
  sent: number; delivered: number; opens: number; clicks: number; bounces: number; unsubs: number;
  openRate: number | null; clickRate: number | null; bounceRate: number | null;
  unsubRate: number | null; deliveryRate: number | null;
}

export function aggregateJourneyAnalytics(
  journeys: Record<string, unknown>[],
  kpis: Record<string, JourneyKpis>,
): JourneyAnalytics {
  let running = 0, draft = 0, stopped = 0, paused = 0, other = 0;
  let totalEntered = 0, currentlyActive = 0, goalsMet = 0, exitMet = 0;
  let perfSum = 0, perfCount = 0;
  const byChannel: Record<string, number> = {};
  const vol: { id: string; name: string; entered: number; status: string }[] = [];

  for (const j of journeys) {
    const grp = journeyStatusGroup(String(j.status || ""));
    if (grp === "running") running++; else if (grp === "draft") draft++;
    else if (grp === "stopped") stopped++; else if (grp === "paused") paused++; else other++;

    const entered = statOf(j, "cumulativePopulation");
    totalEntered += entered;
    currentlyActive += statOf(j, "currentPopulation");
    goalsMet += statOf(j, "metGoal");
    exitMet += statOf(j, "metExitCriteria");
    const perf = statOf(j, "goalPerformance");
    if (entered > 0) { perfSum += perf; perfCount++; }

    const ch = String(j.channel || j.definitionType || "—");
    byChannel[ch] = (byChannel[ch] || 0) + 1;

    vol.push({ id: String(j.id || ""), name: String(j.name || j.id || ""), entered, status: String(j.status || "") });
  }

  // Email KPIs from whatever per-journey Data Views fetches exist.
  let sent = 0, delivered = 0, opens = 0, clicks = 0, bounces = 0, unsubs = 0, emailCovered = 0;
  for (const k of Object.values(kpis || {})) {
    if (!k) continue;
    const s = num(k.sent);
    if (s <= 0 && num(k.opens) <= 0 && num(k.bounces) <= 0) continue;
    emailCovered++;
    sent += s;
    delivered += num(k.delivered) || s; // delivered often not tracked; fall back to sent
    opens += num(k.uniqueOpens) || num(k.opens);
    clicks += num(k.uniqueClicks) || num(k.clicks);
    bounces += num(k.bounces);
    unsubs += num(k.unsubs);
  }
  const deliveredBase = delivered || sent;

  return {
    total: journeys.length, running, draft, stopped, paused, other,
    totalEntered, currentlyActive, goalsMet, exitMet,
    avgGoalPerf: perfCount > 0 ? Math.round((perfSum / perfCount) * 10) / 10 : null,
    byChannel,
    topByVolume: vol.sort((a, b) => b.entered - a.entered).slice(0, 6),
    emailCovered, sent, delivered, opens, clicks, bounces, unsubs,
    openRate: pct(opens, deliveredBase), clickRate: pct(clicks, deliveredBase),
    bounceRate: pct(bounces, sent), unsubRate: pct(unsubs, deliveredBase),
    deliveryRate: sent > 0 ? pct(delivered, sent) : null,
  };
}
