import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatTs, statusVariant } from "../../../utils/formatters";
import type { CachedItem, CollectionKey } from "../../../store/types";

const LABELS: Record<CollectionKey, string> = {
  journeys: "Journeys", automations: "Automations", sqlQueries: "SQL Queries",
  dataExtensions: "Data Extensions", assets: "Assets", folders: "Folders",
  publicationLists: "Publication Lists", canvasActivities: "Canvas Activities", errors: "Errors",
};

const JOURNEY_ACTIVITY_TYPE_COLORS: Record<string, "blue" | "green" | "yellow" | "red" | "neutral"> = {
  EMAILV2: "blue", EMAIL: "blue", SMSSEND: "blue", PUSHSEND: "blue",
  WAIT: "yellow", WAITBYDURATION: "yellow", WAITBYATTRIBUTE: "yellow",
  MULTICRITERIADECISION: "green", RANDOMSPLIT: "green", ENGAGEMENTSPLIT: "green",
  SALESFORCECREATEOBJECT: "neutral", SALESFORCEUPDATEOBJECT: "neutral",
  EXIT: "red", GOAL: "green",
};

function activityBadge(type?: string) {
  const t = (type || "").toUpperCase();
  const variant = JOURNEY_ACTIVITY_TYPE_COLORS[t] ?? "neutral";
  const labels: Record<string, string> = {
    EMAILV2: "Email", EMAIL: "Email", SMSSEND: "SMS", PUSHSEND: "Push",
    WAIT: "Wait", WAITBYDURATION: "Wait", WAITBYATTRIBUTE: "Wait Attr",
    MULTICRITERIADECISION: "Decision", RANDOMSPLIT: "Split", ENGAGEMENTSPLIT: "Eng. Split",
    SALESFORCECREATEOBJECT: "SF Create", SALESFORCEUPDATEOBJECT: "SF Update",
    EXIT: "Exit", GOAL: "Goal",
  };
  return <Badge variant={variant}>{labels[t] ?? type ?? "—"}</Badge>;
}

function fmtNum(n: unknown): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num >= 1000 ? `${(num / 1000).toFixed(1)}k` : String(num);
}


function prettifyKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
}

// ── Journey detail ────────────────────────────────────────────────────────────

function JourneyDetail({ item }: { item: CachedItem }) {
  const [tab, setTab] = useState<"activities" | "goals" | "stats" | "raw">("activities");
  const { fetchJourneyDetail, fetchKpisFromDataViews, journeyKpis } = useAppStore();
  const [fetching, setFetching] = useState(false);
  const [dvFetching, setDvFetching] = useState(false);

  const handleFetchDetail = async () => {
    setFetching(true);
    await fetchJourneyDetail(String(item.id), null);
    setFetching(false);
  };

  const activities: any[] = Array.isArray(item.activities) ? item.activities : [];

  // Extract triggered send IDs from email activities for Data Views query
  const emailTsIds: string[] = activities
    .filter(a => /EMAILV2|EMAIL$/i.test(String(a.type || "")))
    .map(a => {
      const cfg = a.configurationArguments as Record<string, unknown> | undefined;
      return String(cfg?.triggeredSendId || cfg?.triggeredSendDefinitionObjectID || "");
    })
    .filter(Boolean);

  const dvKpis = journeyKpis[String(item.id)] ?? null;

  const handleFetchDvKpis = async () => {
    setDvFetching(true);
    await fetchKpisFromDataViews(String(item.id), String(item.name || ""), emailTsIds);
    setDvFetching(false);
  };
  const goals: any[] = Array.isArray(item.goals) ? item.goals : [];
  const stats: Record<string, unknown> = (item.stats && typeof item.stats === "object") ? item.stats as Record<string, unknown> : {};
  const raw: any = item.raw ?? item;

  // allVersions — deduplicated by version number, from item only (no raw combination)
  const rawAllVersionsArr: Array<{ version: number | null; status: string; cumulativePopulation: number; lastPublishedDate?: string }> =
    Array.isArray(item.allVersions) ? item.allVersions as any[] : [];
  const seenVers = new Set<string>();
  const allVersions = rawAllVersionsArr.filter(v => {
    const k = String(v.version ?? "null");
    if (seenVers.has(k)) return false;
    seenVers.add(k);
    return true;
  });

  // Auto-fetch when no activities yet. Use a ref to prevent concurrent fetches.
  const fetchingRef = useRef(false);
  useEffect(() => {
    if (activities.length > 0 || fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    // Prefer the published version with the most contacts over a Draft.
    // allVersions is already populated from the collection sync cache.
    const bestPublished = allVersions
      .filter(v => !/draft/i.test(v.status) && v.cumulativePopulation > 0)
      .sort((a, b) => b.cumulativePopulation - a.cumulativePopulation)[0];
    const autoVersion = (bestPublished && bestPublished.version !== Number(item.version))
      ? bestPublished.version
      : null;
    fetchJourneyDetail(String(item.id), autoVersion).finally(() => {
      fetchingRef.current = false;
      setFetching(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Top-level KPIs from stats
  const statEntries = Object.entries(stats).filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object");

  // Journey contact counts — check stats, top-level field, allVersions best
  const rawStats: Record<string, unknown> = (raw?.stats && typeof raw.stats === "object") ? raw.stats as Record<string, unknown> : {};
  const statsCumPop = stats.cumulativePopulation ?? stats.totalContacts ?? stats.entered ?? stats.contactsIn
    ?? rawStats.cumulativePopulation ?? rawStats.totalContacts ?? rawStats.entered
    ?? (item as Record<string,unknown>).cumulativePopulation ?? (raw as Record<string,unknown>).cumulativePopulation ?? null;
  const bestVersionContacts = allVersions.reduce((max, v) => Math.max(max, Number(v?.cumulativePopulation ?? 0)), 0);
  // Pick the highest available contact count across all sources
  const cumPopNum = Math.max(
    Number(statsCumPop ?? 0),
    bestVersionContacts
  );
  const cumPop: number | null = cumPopNum > 0 ? cumPopNum : (statsCumPop !== null ? Number(statsCumPop) : null);

  // Active Now: prefer journey-level currentPopulation, fall back to sum of activity-level currentPopulation
  // (SFMC canvas bubbles show activity-level currentPopulation, e.g. "9" in Decision Split)
  const journeyCurPop = stats.currentPopulation ?? stats.activeContacts ?? stats.inProgress ?? null;
  const actCurPop = activities.reduce((sum, a: any) => {
    const s: any = a.stats || {};
    const cur = s.currentPopulation;
    if (cur === null || cur === undefined) return sum;
    const n = typeof cur === "object" ? Number((cur as any)?.count ?? 0) : Number(cur);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const curPop = journeyCurPop !== null ? journeyCurPop : (actCurPop > 0 ? actCurPop : null);
  const goalMet = stats.goalPercentage       ?? stats.goalsAchieved ?? null;

  const tabs = ["activities", "goals", "stats", "info", "raw"] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 10 }}>
        {[
          { label: "Version",    value: item.version ?? "—",        title: `Status: ${item.status || "—"}` },
          { label: "Total In",   value: cumPop !== null ? fmtNum(cumPop) : "—", title: "Cumulative contacts entered" },
          { label: "Active Now", value: curPop !== null ? fmtNum(curPop) : "—", title: "Contacts currently in the journey" },
        ].map(({ label, value, title }) => (
          <div key={label} className="card" style={{ padding: "10px 14px", textAlign: "center" }} title={title}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--brand)" }}>{String(value)}</div>
            <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Version picker — shown when multiple versions are known */}
      {allVersions.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <span style={{ fontSize: ".7rem", color: "var(--text-muted)", marginRight: 2 }}>Versions:</span>
          {allVersions.map((v) => {
            const isActive = String(item.version) === String(v.version);
            const isDraft  = /draft/i.test(v.status);
            return (
              <button
                key={v.version}
                disabled={fetching || isActive}
                onClick={() => {
                  if (!isActive) {
                    setFetching(true);
                    fetchJourneyDetail(String(item.id), v.version).finally(() => setFetching(false));
                  }
                }}
                title={`${v.status}${v.cumulativePopulation > 0 ? ` · ${v.cumulativePopulation} contacts` : ""}`}
                style={{
                  padding: "3px 9px", borderRadius: 12,
                  border: `1px solid ${isActive ? "var(--brand)" : "var(--border-subtle)"}`,
                  background: isActive ? "var(--brand)" : "var(--bg-elevated)",
                  color: isActive ? "#fff" : isDraft ? "var(--text-muted)" : "var(--text)",
                  cursor: isActive || fetching ? "default" : "pointer",
                  fontSize: ".72rem", fontWeight: isActive ? 700 : 400,
                  opacity: fetching && !isActive ? 0.5 : 1,
                }}
              >
                v{v.version}
                {isDraft ? " Draft" : ""}
                {v.cumulativePopulation > 0 ? ` · ${fmtNum(v.cumulativePopulation)}` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", border: "none", background: "none", cursor: "pointer",
            fontSize: ".78rem", fontWeight: tab === t ? 700 : 400, textTransform: "capitalize",
            color: tab === t ? "var(--brand)" : "var(--text-muted)",
            borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
          }}>
            {t === "activities" ? `Activities (${activities.length})` : t === "goals" ? `Goals (${goals.length})` : t === "stats" ? `Stats` : t === "info" ? "Info" : "Raw"}
          </button>
        ))}
        <button onClick={handleFetchDetail} disabled={fetching} title="Fetch full journey detail from API" style={{
          marginLeft: "auto", padding: "3px 10px", border: "1px solid var(--border-subtle)", borderRadius: 4,
          background: "none", cursor: "pointer", fontSize: ".72rem", color: "var(--text-muted)",
        }}>
          {fetching ? "…" : "↻"}
        </button>
        <button
          onClick={handleFetchDvKpis}
          disabled={dvFetching}
          title="Fetch email KPIs from Data Views via Query Studio"
          style={{
            marginLeft: 6, padding: "3px 10px", border: "1px solid var(--brand)", borderRadius: 4,
            background: dvKpis ? "var(--brand)" : "none", cursor: dvFetching ? "wait" : "pointer",
            fontSize: ".72rem", color: dvKpis ? "#fff" : "var(--brand)", fontWeight: 600,
            opacity: dvFetching ? 0.6 : 1,
          }}
        >
          {dvFetching ? "⏳ DV…" : dvKpis ? "📊 DV ✓" : "📊 DV"}
        </button>
      </div>

      {/* Activities tab */}
      {tab === "activities" && (
        activities.length === 0
          ? <div style={{ textAlign: "center", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>No activities captured yet.</div>
              <Button variant="primary" size="sm" onClick={handleFetchDetail} disabled={fetching}>
                {fetching ? "Fetching…" : "Fetch Activities"}
              </Button>
            </div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Contact Flow Summary */}
              <div className="card" style={{ background: "var(--bg-elevated)", padding: "10px 14px" }}>
                <div style={{ fontSize: ".75rem", color: "var(--text-muted)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>Contact Flow Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                  {[
                    { label: "Total In", key: "totalIn", color: "var(--brand)" },
                    { label: "Total Out", key: "totalOut", color: "var(--green)" },
                    { label: "Errors", key: "totalErr", color: "var(--red)" },
                    { label: "Queued", key: "totalQ", color: "var(--yellow)" },
                  ].map(({ label, key, color }) => {
                    const total = activities.reduce((sum, a: any) => {
                      const cnt: any = a.counters || {};
                      const s: any = a.stats || {};
                      const cs: any = a.contactStats || {};
                      let val = 0;
                      if (key === "totalIn") {
                        val = (cnt.entered as any)?.count ?? cs.contactsIn ?? s.contactsIn ?? s.entered ?? 0;
                      } else if (key === "totalOut") {
                        val = (cnt.exited as any)?.count ?? (cnt.completed as any)?.count ?? cs.contactsOut ?? s.contactsOut ?? s.completed ?? 0;
                      } else if (key === "totalErr") {
                        val = (cnt.errored as any)?.count ?? (cnt.error as any)?.count ?? cs.contactsError ?? s.contactsError ?? s.error ?? 0;
                      } else if (key === "totalQ") {
                        val = (cnt.waiting as any)?.count ?? (cnt.queued as any)?.count ?? cs.contactsQueued ?? s.contactsQueued ?? 0;
                      }
                      return sum + Number(val || 0);
                    }, 0);
                    return (
                      <div key={key} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1rem", fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{fmtNum(total)}</div>
                        <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Activities Table */}
              <div className="card">
              <table style={{ width: "100%", fontSize: ".76rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-elevated)" }}>
                    {["Name", "Type", "In", "Out", "Error", "Queued"].map(h => (
                      <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a: any, i: number) => {
                    const s: Record<string, unknown> = (a.stats && typeof a.stats === "object") ? a.stats as Record<string, unknown> : {};
                    const cs: Record<string, unknown> = (a.contactStats && typeof a.contactStats === "object") ? a.contactStats as Record<string, unknown> : {};
                    const meta: Record<string, unknown> = (a.metaData && typeof a.metaData === "object") ? a.metaData as Record<string, unknown> : {};
                    const ea: Record<string, unknown> = (a.emailAnalytics && typeof a.emailAnalytics === "object") ? a.emailAnalytics as Record<string, unknown> : {};
                    // SFMC also uses a "counters" object: { entered: {count:N}, waiting: {count:N}, errored: {count:N} }
                    const cnt: Record<string, unknown> = (a.counters && typeof a.counters === "object") ? a.counters as Record<string, unknown> : {};
                    const cntIn  = (cnt.entered  as Record<string,unknown> | undefined)?.count;
                    const cntOut = (cnt.exited   as Record<string,unknown> | undefined)?.count ?? (cnt.completed as Record<string,unknown> | undefined)?.count;
                    const cntErr = (cnt.errored  as Record<string,unknown> | undefined)?.count ?? (cnt.error as Record<string,unknown> | undefined)?.count;
                    const cntQ   = (cnt.waiting  as Record<string,unknown> | undefined)?.count ?? (cnt.queued as Record<string,unknown> | undefined)?.count;
                    const isEmail = /EMAIL|SMS|PUSH|LINEARMESSAGE/i.test(String(a.type || ""));

                    // Contact flow stats — checked in all locations SFMC uses across API versions
                    const cIn   = s.contactsIn   ?? cs.contactsIn   ?? s.entered   ?? s.in   ?? cntIn  ?? meta.statsContactsIn   ?? meta.contactsIn;
                    const cOut  = s.contactsOut  ?? cs.contactsOut  ?? s.completed ?? s.out  ?? cntOut ?? meta.statsContactsOut  ?? meta.contactsOut;
                    const cErr  = s.contactsError ?? cs.contactsError ?? s.error ?? s.errors ?? cntErr ?? meta.statsContactsError ?? meta.contactsError;
                    const cQ    = s.contactsQueued ?? cs.contactsQueued ?? s.currentPopulation?.count ?? s.queued ?? cntQ ?? meta.statsContactsQueued ?? meta.contactsQueued;

                    // Email delivery KPIs — read from every possible location SFMC might put them:
                    // ea = emailAnalytics (Step B), s = stats, cnt = counters (jbinteractions enrichment),
                    // cs = contactStats, meta = metaData
                    // counters object uses {key: {count: N}} format — unwrap the .count
                    const cntV = (k: string) => {
                      const v = cnt[k];
                      if (v === null || v === undefined) return undefined;
                      if (typeof v === "object") return (v as Record<string,unknown>).count;
                      return v;
                    };
                    const sent      = ea.sent ?? ea.totalSent
                      ?? s.sent ?? s.totalSent ?? s.NumberSent ?? s.numberSent
                      ?? cntV("sent") ?? cntV("totalSent") ?? cntV("emailSent") ?? cntV("Sent")
                      ?? cs.sent ?? meta.statsSent ?? meta.sent
                      // Fallback: contacts-In = emails sent (every contact entering email activity gets sent an email)
                      // Also try currentPopulation (canvas bubble = contacts currently at this step, ≈ sent for fresh journeys)
                      ?? (isEmail ? (s.contactsIn ?? cs.contactsIn ?? s.entered ?? cntIn ?? meta.statsContactsIn
                        ?? (typeof s.currentPopulation === "object" ? (s.currentPopulation as Record<string,unknown>)?.count : s.currentPopulation)
                        ?? meta.currentPopulation) : undefined);
                    const delivered = ea.delivered ?? ea.totalDelivered
                      ?? s.delivered ?? s.totalDelivered ?? s.NumberDelivered
                      ?? cntV("delivered") ?? cntV("totalDelivered") ?? cntV("emailDelivered") ?? cntV("Delivered")
                      ?? cs.delivered ?? meta.statsDelivered ?? meta.delivered;
                    const opens     = ea.uniqueOpens ?? ea.opens ?? ea.totalOpens
                      ?? s.uniqueOpens ?? s.opens ?? s.totalOpens ?? s.NumberOpened ?? s.NumberUniqueOpens
                      ?? cntV("opens") ?? cntV("uniqueOpens") ?? cntV("emailOpens") ?? cntV("Opens") ?? cntV("totalOpens")
                      ?? cs.opens ?? meta.statsOpens ?? meta.opens;
                    const clicks    = ea.uniqueClicks ?? ea.clicks ?? ea.totalClicks
                      ?? s.uniqueClicks ?? s.clicks ?? s.totalClicks ?? s.NumberClicked ?? s.NumberUniqueClicks
                      ?? cntV("clicks") ?? cntV("uniqueClicks") ?? cntV("emailClicks") ?? cntV("Clicks") ?? cntV("totalClicks")
                      ?? cs.clicks ?? meta.statsClicks ?? meta.clicks;
                    const bounces   = ea.bounces ?? ea.totalBounces
                      ?? s.bounces ?? s.totalBounces ?? s.hardBounces ?? s.NumberBounced
                      ?? cntV("bounces") ?? cntV("totalBounces") ?? cntV("emailBounces") ?? cntV("Bounces")
                      ?? cs.bounces ?? meta.statsBounces ?? meta.bounces;
                    const unsubs    = ea.unsubscribes ?? ea.totalUnsubscribes
                      ?? s.unsubscribes ?? s.totalUnsubscribes ?? s.NumberUnsubscribed
                      ?? cntV("unsubscribes") ?? cntV("unsubs") ?? cntV("OptOutCount")
                      ?? cs.unsubscribes ?? meta.statsUnsubs ?? meta.unsubscribes;

                    // Email KPI row — native stats first, dvKpis as fallback
                    const hasEmailKpis = isEmail;
                    const usingDv = isEmail && dvKpis != null
                      && sent == null && opens == null && clicks == null;
                    const emailKpiValues: [string, unknown, string][] = [
                      ["Sent",      sent      ?? dvKpis?.sent,                           "var(--text)"],
                      ["Delivered", delivered ?? (dvKpis ? Math.max(0, (dvKpis.sent ?? 0) - (dvKpis.bounces ?? 0)) : null), "var(--green)"],
                      ["Opens",     opens     ?? dvKpis?.uniqueOpens ?? dvKpis?.opens,   "var(--brand)"],
                      ["Clicks",    clicks    ?? dvKpis?.uniqueClicks ?? dvKpis?.clicks, "var(--brand)"],
                      ["Bounces",   bounces   ?? dvKpis?.bounces,                        "var(--red)"],
                      ["Unsubs",    unsubs    ?? dvKpis?.unsubs,                         "var(--text-muted)"],
                    ];

                    return (
                      <React.Fragment key={a.key ?? i}>
                        <tr style={{ borderBottom: hasEmailKpis ? "none" : "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "6px 10px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name || a.activityName || "—"}</td>
                          <td style={{ padding: "6px 10px" }}>{activityBadge(a.type || a.activityType)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(cIn)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(cOut)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", color: Number(cErr) > 0 ? "var(--red)" : undefined }}>{fmtNum(cErr)}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(cQ)}</td>
                        </tr>
                        {hasEmailKpis && (
                          <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                            <td colSpan={6} style={{ padding: "4px 10px 8px 24px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Email Performance</span>
                                {usingDv && <span style={{ fontSize: ".6rem", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "var(--brand-surface)", color: "var(--brand)" }}>📊 DV</span>}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "4px 8px" }}>
                                {emailKpiValues.map(([label, val, color]) => (
                                  <div key={label as string} style={{ display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: ".62rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label as string}</span>
                                    <span style={{ fontSize: ".82rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: (val !== undefined && val !== null) ? color as string : "var(--text-muted)" }}>
                                      {(val !== undefined && val !== null) ? fmtNum(val) : "—"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            </div>
      )}

      {/* Goals tab */}
      {tab === "goals" && (
        goals.length === 0
          ? <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: ".8rem" }}>No goals defined for this journey.</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {goals.map((g: any, i: number) => (
                <div key={i} className="card">
                  <div className="card-body" style={{ padding: "12px 14px" }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{g.name || `Goal ${i + 1}`}</div>
                    {g.metPercentage !== undefined && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ flex: 1, height: 6, background: "var(--bg-elevated)", borderRadius: 3 }}>
                          <div style={{ width: `${Math.min(100, Number(g.metPercentage) || 0)}%`, height: "100%", background: "var(--green)", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: ".75rem", fontFamily: "var(--font-mono)", color: "var(--green)" }}>{Number(g.metPercentage || 0).toFixed(1)}%</span>
                      </div>
                    )}
                    {g.description && <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>{g.description}</div>}
                    {g.filter && <pre style={{ fontSize: ".7rem", margin: "6px 0 0", background: "var(--bg-elevated)", padding: 6, borderRadius: 4, overflow: "auto" }}>{JSON.stringify(g.filter, null, 2)}</pre>}
                  </div>
                </div>
              ))}
            </div>
      )}

      {/* Stats tab */}
      {tab === "stats" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Contacts summary */}
          {cumPop !== null && (
            <div className="card" style={{ background: "var(--bg-elevated)", padding: "10px 14px", borderLeft: "3px solid var(--brand)" }}>
              <div style={{ fontSize: ".7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>Contacts</div>
              <span style={{ fontSize: ".85rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--brand)" }}>
                {fmtNum(cumPop)} entered
              </span>
            </div>
          )}

          {/* Main stats grid */}
          {statEntries.length > 0 ? (
            <div className="card">
              <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "4px 16px", padding: "10px 14px" }}>
                {statEntries.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{prettifyKey(k)}</span>
                    <span style={{ fontSize: ".82rem", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: ".8rem" }}>No stats available for this journey.</div>
          )}
        </div>
      )}

      {/* Info tab — meta fields + goal progress */}
      {tab === "info" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {goalMet !== null && (
            <div className="card" style={{ padding: "10px 14px" }}>
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Goal Progress</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: "var(--bg-elevated)", borderRadius: 3 }}>
                  <div style={{ width: `${Math.min(100, Number(goalMet) || 0)}%`, height: "100%", background: "var(--green)", borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: ".78rem", color: "var(--green)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", fontWeight: 700 }}>
                  {Number(goalMet).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", padding: "10px 14px" }}>
              {(["id","key","customerKey","status","entryMode","definitionType","createdDate","modifiedDate","lastPublishedDate","capturedAt"] as const).map(k => {
                const val = item[k];
                if (val === undefined || val === null || val === "") return null;
                return (
                  <div key={k} style={{ display: "flex", flexDirection: "column", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{prettifyKey(k)}</span>
                    <span style={{ fontSize: ".78rem", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                      {k === "capturedAt" || k === "createdDate" || k === "modifiedDate" || k === "lastPublishedDate" ? formatTs(val as string | number) : String(val)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Raw tab */}
      {tab === "raw" && (
        <pre className="code-block" style={{ maxHeight: 280, overflow: "auto", fontSize: ".72rem" }}>
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Automation detail ─────────────────────────────────────────────────────────

const AUTO_TYPE_LABEL: Record<string, string> = {
  "0": "Scheduled", "1": "Triggered", "2": "File Drop",
  "scheduled": "Scheduled", "triggered": "Triggered", "filedrop": "File Drop",
};

// SFMC automation activity objectTypeId → label (Steps tab). Falls back to the
// raw string activityType/type when not a known id.
const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  "42": "Send Email", "43": "Report", "45": "Data Extract", "53": "Filter",
  "73": "Send Email", "300": "SQL Query", "303": "SQL Query", "423": "Script",
  "425": "Script", "467": "Verification", "484": "Wait", "725": "File Transfer",
  "726": "Data Factory Utility", "733": "Fire Event", "749": "Import File",
  "783": "Refresh Group", "952": "Refresh MobileFilteredList", "1010": "Refresh Predictive",
  "1101": "Journeys Audience",
};

function activityTypeLabel(act: Record<string, unknown>): string {
  const raw = act.activityType ?? act.type ?? act.objectTypeId ?? act.activityObjectTypeId;
  if (raw == null || raw === "") return "Activity";
  const s = String(raw);
  if (ACTIVITY_TYPE_LABEL[s]) return ACTIVITY_TYPE_LABEL[s];
  // already a readable string (not a bare number) → title-case lightly
  if (!/^-?\d+$/.test(s)) return s;
  return `Type ${s}`;
}

// SFMC automation run statusId → label (legacy API returns numeric ids)
const RUN_STATUS_ID: Record<number, string> = {
  0: "Queued",
  1: "Complete", 2: "Error", 3: "Running", 4: "Stopped",
  5: "Scheduled", 6: "Paused", 7: "Skipped", 8: "InactiveTrigger",
  9: "Building", 10: "Initializing",
  100: "Complete", 200: "Error", 300: "Running",
};

// All possible SFMC field names for status (camelCase, PascalCase, legacy, snake_case)
const STATUS_FIELD_NAMES = [
  "status", "Status",
  "statusName", "StatusName",
  "runStatus", "RunStatus",
  "runStatusName", "RunStatusName",
  "automationStatus", "AutomationStatus",
  "automationRunStatus", "AutomationRunStatus",
  "taskStatus", "TaskStatus",
  "programRunStatus", "ProgramRunStatus",
  "state", "State",
];
// All possible SFMC field names for numeric statusId
const STATUS_ID_FIELD_NAMES = [
  "statusId", "StatusId",
  "runStatusId", "RunStatusId",
  "automationStatusId", "AutomationStatusId",
  "automationRunStatusId", "AutomationRunStatusId",
  "taskStatusId", "TaskStatusId",
  "programRunStatusId", "ProgramRunStatusId",
  "status_id",
];

function resolveRunStatus(run: Record<string, unknown>): string {
  // 1. Try any string-valued status field (never return a bare number)
  for (const f of STATUS_FIELD_NAMES) {
    const v = run[f];
    if (v != null && v !== "" && typeof v !== "number") return String(v);
  }
  // 2. Try NAMED numeric statusId fields only (never scan all numeric fields —
  //    that would accidentally pick up sequential IDs like automationRunId: 1,2,3,4)
  for (const f of STATUS_ID_FIELD_NAMES) {
    const id = run[f];
    if (id != null) {
      const label = RUN_STATUS_ID[Number(id)];
      if (label) return label;
      // Even if not in our map, prefer a named status field over "Unknown"
      if (Number(id) > 0) return `Status ${id}`;
    }
  }
  return "Unknown";
}

// All possible SFMC date field name stems (we try both camelCase and PascalCase)
function resolveRunField(run: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (run[k] != null && run[k] !== "") return run[k];
    // PascalCase: capitalize first letter
    const pascal = k.charAt(0).toUpperCase() + k.slice(1);
    if (run[pascal] != null && run[pascal] !== "") return run[pascal];
    // ALL_CAPS snake_case variant
    const snake = k.replace(/([A-Z])/g, "_$1").toUpperCase();
    if (run[snake] != null && run[snake] !== "") return run[snake];
  }
  return null;
}

// Returns true for ISO strings, WCF /Date(ms)/ strings, or epoch-ms numbers
function isDateValue(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "number") return v > 1_000_000_000_000; // epoch ms
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}/.test(v) || /\/Date\(\d+/.test(v);
}

// Scan all fields of a run and find the best start-time date
function findAnyDate(run: Record<string, unknown>): string | null {
  // Try known start-time field names (resolveRunField handles camelCase + PascalCase)
  const known = resolveRunField(run,
    "startTime", "startedAt", "scheduledTime", "runTime", "scheduleTime",
    "taskStartTime", "actualStartTime", "executionTime", "launchTime",
    "runDate", "createdDate", "modifiedDate", "lastRunTime", "triggerTime",
  );
  if (known != null) return String(known);
  // Fallback: any field that looks like a date (ISO or WCF)
  for (const [, v] of Object.entries(run)) {
    if (isDateValue(v)) return String(v);
  }
  return null;
}

function findAnyEndDate(run: Record<string, unknown>): string | null {
  const known = resolveRunField(run,
    "endTime", "completedAt", "finishedAt", "taskEndTime", "completionTime",
    "actualEndTime", "completedTime", "endDate",
  );
  if (known != null) return String(known);
  // Fallback: find a date field different from startTime
  const startVal = findAnyDate(run);
  for (const [k, v] of Object.entries(run)) {
    if (isDateValue(v) && String(v) !== startVal && /end|complet|finish/i.test(k)) {
      return String(v);
    }
  }
  return null;
}

function runStatusVariant(s: string): "success" | "warning" | "danger" | "neutral" | "info" {
  const l = s.toLowerCase();
  if (/complet|success/.test(l))   return "success";
  if (/error|fail/.test(l))        return "danger";
  if (/running|executing/.test(l)) return "info";
  if (/skip|paused|waiting|stop/.test(l)) return "warning";
  return "neutral";
}

function fmtDuration(startRaw: unknown, endRaw: unknown): string {
  if (!startRaw || !endRaw) return "—";
  try {
    const s = new Date(String(startRaw)).getTime();
    const e = new Date(String(endRaw)).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return "—";
    const sec = Math.round((e - s) / 1000);
    if (sec < 60)   return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  } catch { return "—"; }
}

function RunRow({ run, idx }: { run: Record<string, unknown>; idx: number }) {
  const [expanded, setExpanded] = useState(false);

  const status  = resolveRunStatus(run);
  const isError = /error|fail/i.test(status);

  const startRaw = findAnyDate(run);
  const endRaw   = findAnyEndDate(run);
  const errCode  = resolveRunField(run, "errorCode", "errorCodeId", "errorId", "taskErrorCode", "TaskErrorCode");
  const errMsg   = resolveRunField(run, "errorMessage", "message", "description", "errorDetail", "errorDescription", "taskErrorMessage", "TaskErrorMessage");

  const steps: any[] = Array.isArray(run.steps) ? run.steps
    : Array.isArray(run.Steps) ? run.Steps as any[]
    : [];
  const failedSteps = steps.filter((st: any) =>
    /error|fail/i.test(String(st.status || st.Status || st.statusName || ""))
  );

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: isError ? "rgba(239,68,68,.03)" : undefined,
      }}
    >
      {/* Main row — always clickable to expand raw fields */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 14px", cursor: "pointer",
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <Badge variant={runStatusVariant(status)}>{status}</Badge>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".78rem", fontFamily: "var(--font-mono)", color: "var(--text)" }}>
            {startRaw ? formatTs(startRaw as string) : `Run #${idx + 1}`}
          </div>
          {errMsg && !expanded && (
            <div style={{ fontSize: ".7rem", color: "var(--red)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {String(errMsg)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span style={{ fontSize: ".72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {fmtDuration(startRaw, endRaw)}
          </span>
          {endRaw != null && endRaw !== "" && (
            <span style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>
              {formatTs(endRaw as string)}
            </span>
          )}
        </div>

        <span style={{ color: "var(--text-muted)", fontSize: ".75rem", marginLeft: 2 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded error details */}
      {expanded && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Error box */}
          {(errCode || errMsg) && (
            <div style={{
              background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)",
              borderRadius: 6, padding: "10px 12px",
            }}>
              <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--red)", textTransform: "uppercase", marginBottom: 4 }}>
                Error Details
              </div>
              {errCode && (
                <div style={{ fontSize: ".75rem", marginBottom: 2 }}>
                  <span style={{ color: "var(--text-muted)" }}>Code: </span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--red)" }}>{String(errCode)}</span>
                </div>
              )}
              {errMsg && (
                <div style={{ fontSize: ".75rem", color: "var(--text)", wordBreak: "break-word" }}>{String(errMsg)}</div>
              )}
            </div>
          )}

          {/* Failed step details */}
          {failedSteps.length > 0 && (
            <div>
              <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                Failed Steps
              </div>
              {failedSteps.map((st: any, si: number) => (
                <div key={si} style={{
                  fontSize: ".75rem", padding: "6px 10px", marginBottom: 4,
                  background: "var(--bg-elevated)", borderRadius: 4,
                  borderLeft: "3px solid var(--red)",
                }}>
                  <span style={{ fontWeight: 600 }}>{st.name || st.stepName || `Step ${st.stepNumber ?? si + 1}`}</span>
                  {st.errorMessage && <div style={{ color: "var(--red)", marginTop: 2 }}>{String(st.errorMessage)}</div>}
                  {st.activityName && <div style={{ color: "var(--text-muted)", marginTop: 1 }}>Activity: {st.activityName}</div>}
                </div>
              ))}
            </div>
          )}

          {/* All steps grid (if available and no failed-only filter needed) */}
          {steps.length > 0 && failedSteps.length === 0 && (
            <div>
              {steps.map((st: any, si: number) => (
                <div key={si} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: ".74rem", padding: "4px 8px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}>
                  <Badge variant={runStatusVariant(String(st.status || st.Status || ""))}>{String(st.status || st.Status || "?")}</Badge>
                  <span>{st.name || st.stepName || st.StepName || `Step ${st.stepNumber ?? st.StepNumber ?? si + 1}`}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: ".68rem" }}>
                    {fmtDuration(st.startTime || st.StartTime, st.endTime || st.EndTime)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* All run fields — shows every non-null field from the SFMC API response */}
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
              All Run Fields
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
              {Object.entries(run)
                .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
                .map(([k, v]) => (
                  <div key={k} style={{ fontSize: ".72rem", borderBottom: "1px solid var(--border-subtle)", padding: "3px 0" }}>
                    <span style={{ color: "var(--text-muted)", marginRight: 4 }}>{k}:</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                      {(/time|date|Time|Date/i.test(k) && isDateValue(v))
                        ? formatTs(typeof v === "string" ? v : Number(v))
                        : String(v)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AutomationDetail({ item }: { item: CachedItem }) {
  const { fetchAutomationDetail } = useAppStore();
  const [tab, setTab]       = useState<"runs" | "steps" | "info" | "raw">("runs");
  const [fetching, setFetching] = useState(false);
  const fetchingRef = useRef(false);

  // Detect stale: step objects {id, step:N} with ≤5 fields and no status field
  const rawRunHistory = Array.isArray(item.runHistory)
    ? (item.runHistory as Record<string, unknown>[])
    : [];
  const isStale = rawRunHistory.length > 0 && rawRunHistory.every(r =>
    typeof r.step === "number" &&
    Object.keys(r).length <= 5 &&
    !Object.keys(r).some(k => /status/i.test(k) && r[k] != null)
  );
  const runHistory: Record<string, unknown>[] = isStale ? [] : rawRunHistory;

  const steps: any[]         = Array.isArray(item.steps) ? item.steps : [];
  const schedule: any        = item.schedule || item.scheduleObject || null;
  const notifications: any[] = Array.isArray(item.notifications) ? item.notifications : [];

  const allStepActivities: { stepName: string; activity: any }[] = steps.flatMap((st: any) =>
    (Array.isArray(st.activities) ? st.activities : []).map((a: any) => ({
      stepName: st.name || `Step ${st.stepNumber ?? "?"}`,
      activity: a,
    }))
  );

  // Auto-fetch on first open if no valid run history
  useEffect(() => {
    if (runHistory.length > 0 || fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    fetchAutomationDetail(String(item.id)).finally(() => {
      fetchingRef.current = false;
      setFetching(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const handleRefresh = () => {
    if (fetching) return;
    setFetching(true);
    fetchAutomationDetail(String(item.id)).finally(() => setFetching(false));
  };

  // ── Run stats ──────────────────────────────────────────────────────────────
  const totalRuns   = runHistory.length;
  const errorRuns   = runHistory.filter(r => /error|fail/i.test(resolveRunStatus(r))).length;
  const successRuns = runHistory.filter(r => /complet|success/i.test(resolveRunStatus(r))).length;
  const lastRunStart = findAnyDate(runHistory[0] ?? {});
  // Fallback last-run date from list cache (always available)
  const lastRunDisplay = lastRunStart
    ? formatTs(lastRunStart)
    : (item.lastRunTime ? formatTs(item.lastRunTime as string) : "—");
  // Status label for "last run" KPI — from list cache
  const lastStatus = (item as Record<string,unknown>).lastRunStatus as string | undefined;

  const tabs = ["runs", "steps", "info", "raw"] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
        {[
          { label: "Total Runs", value: totalRuns > 0 ? String(totalRuns) : (fetching ? "…" : "—"), color: "var(--brand)" },
          { label: "Success",    value: totalRuns > 0 ? String(successRuns) : "—",  color: "var(--green)" },
          { label: "Errors",     value: totalRuns > 0 ? String(errorRuns)   : "—",  color: errorRuns > 0 ? "var(--red)" : "var(--text-muted)" },
          { label: "Last Run",   value: lastRunDisplay, color: "var(--text)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: ".82rem", fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 13px", border: "none", background: "none", cursor: "pointer",
            fontSize: ".78rem", fontWeight: tab === t ? 700 : 400, textTransform: "capitalize",
            color: tab === t ? "var(--brand)" : "var(--text-muted)",
            borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
          }}>
            {t === "runs"  ? `Runs${totalRuns > 0 ? ` (${totalRuns})` : ""}` :
             t === "steps" ? `Steps${allStepActivities.length > 0 ? ` (${allStepActivities.length})` : ""}` :
             t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "runs" && errorRuns > 0 && (
              <span style={{
                marginLeft: 5, padding: "1px 5px", borderRadius: 8, fontSize: ".65rem",
                background: "rgba(239,68,68,.15)", color: "var(--red)", fontWeight: 700,
              }}>{errorRuns} err</span>
            )}
          </button>
        ))}
        <button
          onClick={handleRefresh}
          disabled={fetching}
          title="Refresh from API"
          style={{
            marginLeft: "auto", padding: "3px 10px",
            border: "1px solid var(--border-subtle)", borderRadius: 4,
            background: "none", cursor: "pointer", fontSize: ".72rem", color: "var(--text-muted)",
          }}
        >
          {fetching ? "…" : "↻"}
        </button>
      </div>

      {/* ── Runs tab ── */}
      {tab === "runs" && (
        runHistory.length === 0
          ? (
            <div style={{ textAlign: "center", padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>
                {fetching ? "Fetching run history…" : "No run history available."}
              </div>
              {!fetching && (
                <Button variant="primary" size="sm" onClick={handleRefresh}>
                  Fetch Run History
                </Button>
              )}
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {runHistory.map((run, i) => (
                <RunRow key={String(run.id || i)} run={run} idx={i} />
              ))}
            </div>
          )
      )}

      {/* ── Steps tab ── */}
      {tab === "steps" && (
        allStepActivities.length === 0
          ? (
            <div style={{ textAlign: "center", padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>
                {fetching ? "Fetching…" : "No step details yet."}
              </div>
              {!fetching && <Button variant="primary" size="sm" onClick={handleRefresh}>Fetch Steps</Button>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {steps.map((step: any, si: number) => {
                const stepActs: any[] = Array.isArray(step.activities) ? step.activities : [];
                return (
                  <div key={si} className="card" style={{ overflow: "hidden" }}>
                    <div style={{
                      padding: "8px 14px", background: "var(--bg-elevated)",
                      borderBottom: "1px solid var(--border-subtle)",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span style={{
                        fontSize: ".65rem", fontWeight: 700, textTransform: "uppercase",
                        padding: "2px 7px", borderRadius: 8,
                        background: "var(--brand-surface)", color: "var(--brand)",
                      }}>
                        Step {step.stepNumber ?? si + 1}
                      </span>
                      <span style={{ fontSize: ".8rem", fontWeight: 600 }}>{step.name || "Unnamed Step"}</span>
                      {stepActs.length > 0 && (
                        <span style={{ marginLeft: "auto", fontSize: ".68rem", color: "var(--text-muted)" }}>
                          {stepActs.length} activit{stepActs.length === 1 ? "y" : "ies"}
                        </span>
                      )}
                    </div>
                    {stepActs.map((act: any, ai: number) => (
                      <div key={ai} style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: ".8rem", fontWeight: 600, marginBottom: 3 }}>
                            {act.name || act.activityName || `Activity ${ai + 1}`}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <Badge variant="neutral">{activityTypeLabel(act)}</Badge>
                            {act.targetDataExtensionName && (
                              <span style={{ fontSize: ".68rem", color: "var(--text-muted)" }}>
                                → {act.targetDataExtensionName}
                              </span>
                            )}
                            {act.queryText && (
                              <span style={{ fontSize: ".68rem", color: "var(--text-muted)" }}>SQL</span>
                            )}
                          </div>
                          {act.queryText && (
                            <pre style={{
                              marginTop: 6, padding: "6px 8px", borderRadius: 4,
                              background: "var(--bg-elevated)", fontSize: ".68rem",
                              overflow: "auto", maxHeight: 100, whiteSpace: "pre-wrap",
                            }}>
                              {String(act.queryText).slice(0, 400)}{String(act.queryText).length > 400 ? "…" : ""}
                            </pre>
                          )}
                        </div>
                        <div style={{ fontSize: ".65rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", minWidth: 0, textAlign: "right" }}>
                          {act.activityObjectId || act.objectID || ""}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Schedule */}
              {schedule && (
                <div className="card">
                  <div className="card-header"><span className="card-title">Schedule</span></div>
                  <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", padding: "10px 14px" }}>
                    {Object.entries(schedule)
                      .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
                      .map(([k, v]) => (
                        <div key={k} style={{ display: "flex", flexDirection: "column", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                          <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{prettifyKey(k)}</span>
                          <span style={{ fontSize: ".78rem", fontFamily: "var(--font-mono)" }}>{String(v)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )
      )}

      {/* ── Info tab ── */}
      {tab === "info" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", padding: "10px 14px" }}>
              {([
                ["ID",              item.id],
                ["Customer Key",    item.customerKey],
                ["Status",          item.status],
                ["Last Run Status", item.lastRunStatus],
                ["Last Run Time",   item.lastRunTime ? formatTs(item.lastRunTime as string) : null],
                ["Next Run Time",   (item as any).nextRunTime ? formatTs((item as any).nextRunTime as string) : null],
                ["Type",            item.automationType !== undefined ? (AUTO_TYPE_LABEL[String(item.automationType)] ?? item.automationType) : null],
                ["Modified",        item.modifiedDate ? formatTs(item.modifiedDate as string) : null],
                ["Created",         (item as any).createdDate ? formatTs((item as any).createdDate as string) : null],
                ["Category",        (item as any).categoryName || (item as any).categoryId || null],
                ["Description",     (item as any).description || null],
              ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                <div key={k} style={{ display: "flex", flexDirection: "column", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k}</span>
                  <span style={{ fontSize: ".78rem", fontFamily: "var(--font-mono)" }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Notifications */}
          {notifications.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-title">Notifications</span></div>
              <div className="card-body" style={{ padding: "8px 14px" }}>
                {notifications.map((n: any, i: number) => (
                  <div key={i} style={{ fontSize: ".78rem", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge variant={/error/i.test(n.notificationType || "") ? "danger" : "neutral"}>
                      {n.notificationType || "Info"}
                    </Badge>
                    <span style={{ color: "var(--text-muted)" }}>{n.address || n.email || JSON.stringify(n)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Raw tab ── */}
      {tab === "raw" && (
        <pre className="code-block" style={{ maxHeight: 340, overflow: "auto", fontSize: ".7rem" }}>
          {JSON.stringify(item, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Generic detail ────────────────────────────────────────────────────────────

function GenericDetail({ item }: { item: CachedItem }) {
  const scalarEntries = Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object").slice(0, 20);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", padding: "10px 14px" }}>
          {scalarEntries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: ".68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{prettifyKey(k)}</span>
              <span style={{ fontSize: ".78rem", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{k.toLowerCase().includes("time") || k === "capturedAt" ? formatTs(v as string | number) : String(v)}</span>
            </div>
          ))}
        </div>
      </div>
      <pre className="code-block" style={{ maxHeight: 240, overflow: "auto", fontSize: ".72rem" }}>{JSON.stringify(item, null, 2)}</pre>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function DetailView() {
  const { activeCollection, activeObjectId, cache, setView } = useAppStore();
  const collection = activeCollection as CollectionKey | null;
  const item = collection
    ? cache[collection]?.find(e => String(e.id || "") === String(activeObjectId || ""))
    : null;

  if (!collection || !item) {
    return (
      <div className="buddy-content">
        <EmptyState
          title="No record selected"
          message="Open a collection and choose an item to inspect its details."
          action={<Button variant="primary" onClick={() => setView("dashboard")}>Back to dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <div className="buddy-content">
      {/* Header */}
      <div className="detail-panel-head" style={{ marginBottom: 16 }}>
        <div>
          <div className="topbar-eyebrow">{LABELS[collection] ?? collection}</div>
          <div className="detail-panel-title">{String(item.name || item.id || "Record")}</div>
          {item.customerKey && <div className="detail-panel-subtitle">{String(item.customerKey)}</div>}
        </div>
        <div className="detail-panel-actions">
          {item.status && <Badge variant={statusVariant(String(item.status))}>{String(item.status)}</Badge>}
          <Button variant="ghost" size="sm" onClick={() => setView("collection", collection)}>← Back</Button>
        </div>
      </div>

      {collection === "journeys"     && <JourneyDetail item={item} />}
      {collection === "automations"  && <AutomationDetail item={item} />}
      {collection !== "journeys" && collection !== "automations" && <GenericDetail item={item} />}
    </div>
  );
}
