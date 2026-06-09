import React, { useMemo } from "react";
import { useAppStore } from "../../../store/appStore";
import { MetricCard } from "../../common/MetricCard";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, statusVariant } from "../../../utils/formatters";
import { aggregateJourneyAnalytics } from "../../../utils/journeyKpis";
import type { CachedItem } from "../../../store/types";

export function JourneyAnalyticsView() {
  const { cache, journeyKpis, synchronize, loading, setView, updatedAt } = useAppStore();
  const journeys = (cache.journeys ?? []) as CachedItem[];

  const a = useMemo(
    () => aggregateJourneyAnalytics(journeys as Record<string, unknown>[], journeyKpis),
    [journeys, journeyKpis],
  );

  if (!journeys.length) {
    return (
      <div className="buddy-content">
        <EmptyState
          title="No journeys yet"
          message="Run Sync all first to load journeys and their KPIs."
          action={<Button variant="primary" loading={loading} onClick={() => { if (!loading) void synchronize(); }}>Sync now</Button>}
        />
      </div>
    );
  }

  const channels = Object.entries(a.byChannel).sort((x, y) => y[1] - x[1]);
  const maxCh = channels.length ? channels[0][1] : 1;

  return (
    <div className="buddy-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="section-header">
        <span className="section-title">Journeys Analytics</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="text-muted" style={{ fontSize: ".68rem" }}>
            {a.total} journeys{updatedAt.journeys ? ` · synced ${relativeTime(updatedAt.journeys)}` : ""}
          </span>
          <Button variant="primary" size="sm" loading={loading} onClick={() => { if (!loading) void synchronize(); }}>Sync</Button>
        </div>
      </div>

      {/* ── Status ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Status</span></div>
        <div className="analytics-grid">
          <MetricCard label="Total journeys" value={formatNumber(a.total)} variant="brand" />
          <MetricCard label="Running" value={formatNumber(a.running)} variant="success" />
          <MetricCard label="Draft" value={formatNumber(a.draft)} />
          <MetricCard label="Stopped" value={formatNumber(a.stopped)} variant={a.stopped > 0 ? "warning" : undefined} />
          <MetricCard label="Paused / scheduled" value={formatNumber(a.paused)} />
        </div>
      </div>

      {/* ── Contacts & goals ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Contacts &amp; goals</span></div>
        <div className="analytics-grid">
          <MetricCard label="Total entered" value={formatNumber(a.totalEntered)} variant="brand" sub="cumulative population" />
          <MetricCard label="Currently active" value={formatNumber(a.currentlyActive)} sub="in-journey now" />
          <MetricCard label="Goals met" value={formatNumber(a.goalsMet)} variant="success" />
          <MetricCard label="Exit criteria met" value={formatNumber(a.exitMet)} />
          <MetricCard label="Avg goal performance" value={a.avgGoalPerf != null ? `${a.avgGoalPerf}%` : "—"} />
        </div>
      </div>

      {/* ── Email KPIs ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Email KPIs{a.emailCovered > 0 ? ` (${a.emailCovered} journeys)` : ""}</span></div>
        {a.emailCovered === 0 ? (
          <div className="card"><div className="card-body"><span className="text-muted" style={{ fontSize: ".78rem" }}>
            Open a journey's detail and use “Fetch KPIs” to pull email metrics (sent/opens/clicks/bounces) from Data Views — they aggregate here.
          </span></div></div>
        ) : (
          <div className="analytics-grid">
            <MetricCard label="Sent" value={formatNumber(a.sent)} variant="brand" />
            <MetricCard label="Open rate" value={a.openRate != null ? `${a.openRate}%` : "—"} variant="success" />
            <MetricCard label="Click rate" value={a.clickRate != null ? `${a.clickRate}%` : "—"} />
            <MetricCard label="Bounce rate" value={a.bounceRate != null ? `${a.bounceRate}%` : "—"} variant={a.bounces > 0 ? "danger" : undefined} />
            <MetricCard label="Unsub rate" value={a.unsubRate != null ? `${a.unsubRate}%` : "—"} variant={a.unsubs > 0 ? "warning" : undefined} />
          </div>
        )}
      </div>

      {/* ── Top journeys by volume ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Top journeys by volume</span></div>
        <div className="card"><div className="card-body" style={{ padding: 0 }}>
          {a.topByVolume.filter(t => t.entered > 0).length === 0 ? (
            <div style={{ padding: 14 }}><span className="text-muted" style={{ fontSize: ".78rem" }}>No contact volume yet (drafts or not-yet-run journeys).</span></div>
          ) : a.topByVolume.filter(t => t.entered > 0).map(t => (
            <button
              key={t.id}
              className="analytics-row"
              style={{ width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid var(--border-subtle)" }}
              onClick={() => setView("detail", "journeys", t.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="session-title truncate">{t.name}</div>
                <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
              </div>
              <div className="analytics-row-value">{formatNumber(t.entered)}</div>
            </button>
          ))}
        </div></div>
      </div>

      {/* ── By channel/type ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>By channel / type</span></div>
        <div className="card"><div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {channels.map(([label, count]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: ".76rem", width: 150, flexShrink: 0 }}>{label}</span>
              <div className="coll-bar-track" style={{ flex: 1 }}>
                <div className="coll-bar-fill" style={{ width: `${Math.round((count / maxCh) * 100)}%` }} />
              </div>
              <span className="text-mono" style={{ fontSize: ".78rem", fontWeight: 700, width: 36, textAlign: "right" }}>{count}</span>
            </div>
          ))}
        </div></div>
      </div>

      <p className="text-muted" style={{ fontSize: ".66rem", margin: 0 }}>
        Contact &amp; goal KPIs come free from the journey list ({a.total} journeys) — no Data Views query. Email
        open/click/bounce rates are pulled per-journey on demand (Detail → Fetch KPIs) and aggregate here as coverage grows.
      </p>
    </div>
  );
}
