import React, { useMemo, useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { MetricCard } from "../../common/MetricCard";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { relativeTime } from "../../../utils/formatters";
import { aggregateAutomationAnalytics, formatDuration } from "../../../utils/automationKpis";
import type { CachedItem } from "../../../store/types";

export function AutomationAnalyticsView() {
  const { cache, automationKpis, synchronize, loading, setView, updatedAt } = useAppStore();
  const automations = (cache.automations ?? []) as CachedItem[];

  const a = useMemo(
    () => aggregateAutomationAnalytics(automations as Record<string, unknown>[], automationKpis),
    [automations, automationKpis],
  );

  const handleRefresh = () => { if (!loading) void synchronize(); };

  if (!automations.length) {
    return (
      <div className="buddy-content">
        <EmptyState
          title="No automations yet"
          message="Run Sync all first to load automations and their KPIs."
          action={<Button variant="primary" loading={loading} onClick={handleRefresh}>Sync now</Button>}
        />
      </div>
    );
  }

  const activityRows = Object.entries(a.activityCounts).sort((x, y) => y[1] - x[1]);
  const maxActivity = activityRows.length ? activityRows[0][1] : 1;

  return (
    <div className="buddy-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div className="section-header">
        <span className="section-title">Automations Analytics</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="text-muted" style={{ fontSize: ".68rem" }}>
            {a.analysed}/{a.total} with run data{updatedAt.automations ? ` · synced ${relativeTime(updatedAt.automations)}` : ""}
          </span>
          <Button variant="primary" size="sm" loading={loading} onClick={handleRefresh}>Sync</Button>
        </div>
      </div>

      {/* ── Execution ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Execution</span></div>
        <div className="analytics-grid">
          <MetricCard label="Total automations" value={String(a.total)} variant="brand" />
          <MetricCard label="Active" value={String(a.active)} variant="success" />
          <MetricCard label="Disabled" value={String(a.disabled)} variant="warning" />
          <MetricCard label="Runs analysed" value={String(a.totalRuns)} sub={`${a.analysed} automations`} />
          <MetricCard label="Success rate" value={a.successRate != null ? `${a.successRate}%` : "—"} variant="success" />
          <MetricCard label="Failure rate" value={a.failRate != null ? `${a.failRate}%` : "—"} variant={a.errorRuns > 0 ? "danger" : undefined} />
          <MetricCard label="Errors" value={String(a.errorRuns)} variant={a.errorRuns > 0 ? "danger" : undefined} />
          <MetricCard label="Warnings (skipped)" value={String(a.warningRuns)} sub="SFMC has no warning state" />
        </div>
      </div>

      {/* ── Performance ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Performance</span></div>
        <div className="analytics-grid">
          <MetricCard label="Avg duration" value={formatDuration(a.avgDurationSec)} />
          <MetricCard label="Max duration" value={formatDuration(a.maxDurationSec)} />
          <MetricCard label="Min duration" value={formatDuration(a.minDurationSec)} />
          <MetricCard label="Total today" value={formatDuration(a.durationTodaySec || null)} />
          <MetricCard label="Total this week" value={formatDuration(a.durationWeekSec || null)} />
          <MetricCard label="Total this month" value={formatDuration(a.durationMonthSec || null)} />
        </div>
      </div>

      {/* ── Reliability ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Reliability</span></div>
        <div className="responsive-grid-3" style={{ marginBottom: 12 }}>
          <MetricCard label="No run in 7 days" value={String(a.noRunSince7d)} variant={a.noRunSince7d > 0 ? "warning" : undefined} sub="from last-run time" />
          <MetricCard label="Most-failing" value={a.topFailing.length ? a.topFailing[0].name.slice(0, 18) : "—"} sub={a.topFailing.length ? `${a.topFailing[0].errorRuns} errors` : "none"} />
          <MetricCard label="Abnormal duration" value={String(a.abnormal.length)} sub="> 2× median avg" />
        </div>

        {a.topFailing.length > 0 && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="card-header"><span className="card-title">Top failing automations</span></div>
            <div className="card-body" style={{ padding: 0 }}>
              {a.topFailing.map((t) => (
                <button
                  key={t.id}
                  className="analytics-row"
                  style={{ width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid var(--border-subtle)" }}
                  onClick={() => setView("detail", "automations", t.id)}
                >
                  <div className="session-title">{t.name}</div>
                  <div className="analytics-row-right">
                    <Badge variant="danger">{t.errorRuns} err</Badge>
                    <span className="text-muted" style={{ fontSize: ".7rem" }}>/ {t.totalRuns} runs</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {a.abnormal.length > 0 && (
          <div className="card">
            <div className="card-header"><span className="card-title">Abnormally long automations</span></div>
            <div className="card-body" style={{ padding: 0 }}>
              {a.abnormal.map((t) => (
                <button
                  key={t.id}
                  className="analytics-row"
                  style={{ width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid var(--border-subtle)" }}
                  onClick={() => setView("detail", "automations", t.id)}
                >
                  <div className="session-title">{t.name}</div>
                  <div className="analytics-row-value">{formatDuration(t.avgSec)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Activity breakdown ── */}
      <div>
        <div className="section-header"><span className="section-title" style={{ fontSize: ".74rem" }}>Activities (configured)</span></div>
        {activityRows.length === 0 ? (
          <div className="card"><div className="card-body"><span className="text-muted" style={{ fontSize: ".78rem" }}>Refresh KPIs to load automation steps.</span></div></div>
        ) : (
          <div className="card"><div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activityRows.map(([label, count]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: ".76rem", width: 150, flexShrink: 0 }}>{label}</span>
                <div className="coll-bar-track" style={{ flex: 1 }}>
                  <div className="coll-bar-fill" style={{ width: `${Math.round((count / maxActivity) * 100)}%` }} />
                </div>
                <span className="text-mono" style={{ fontSize: ".78rem", fontWeight: 700, width: 36, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div></div>
        )}
      </div>

      <p className="text-muted" style={{ fontSize: ".66rem", margin: 0 }}>
        KPIs are computed from each automation's <b>latest run</b> (status + duration) and its configured steps, taken
        from the automation list — covering {a.analysed}/{a.total} automation(s). SFMC restricts full multi-run history
        to its own UI, so success-rate/durations reflect the most recent run per automation. Not exposed by SFMC at all:
        per-activity <b>execution time</b>, run <b>retries</b>, and a true <b>warning</b> status (shown as N/A).
      </p>
    </div>
  );
}
