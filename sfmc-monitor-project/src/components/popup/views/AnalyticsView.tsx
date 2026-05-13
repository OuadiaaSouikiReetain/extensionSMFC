import React, { useMemo } from "react";
import { useAppStore } from "../../../store/appStore";
import { MetricCard } from "../../common/MetricCard";
import { Badge } from "../../common/Badge";
import { Button } from "../../common/Button";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, statusVariant } from "../../../utils/formatters";
import type { CollectionKey } from "../../../store/types";

const LABELS: Record<CollectionKey, string> = {
  journeys: "Journeys",
  automations: "Automations",
  sqlQueries: "SQL Queries",
  dataExtensions: "Data Extensions",
  assets: "Assets",
  folders: "Folders",
  publicationLists: "Publication Lists",
  canvasActivities: "Canvas Activities",
  errors: "Errors",
};

export function AnalyticsView() {
  const { cache, updatedAt, setView } = useAppStore();

  const rows = useMemo(
    () =>
      (Object.keys(LABELS) as CollectionKey[]).map((key) => ({
        key,
        label: LABELS[key],
        count: cache[key]?.length ?? 0,
        updatedAt: updatedAt[key] ?? 0,
      })),
    [cache, updatedAt],
  );

  const totalItems = rows.reduce((sum, row) => sum + row.count, 0);
  const readyCollections = rows.filter((row) => row.count > 0).length;
  const mostRecent = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0);
  const topRow = [...rows].sort((a, b) => b.count - a.count)[0];

  if (!totalItems) {
    return (
      <div className="buddy-content">
        <EmptyState
          title="No analytics yet"
          message="Run Sync all collections first to build the analytics overview."
          action={<Button variant="primary" onClick={() => setView("dashboard")}>Back to dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <div className="buddy-content">
      <div className="analytics-grid">
        <MetricCard label="Total cached items" value={formatNumber(totalItems)} variant="brand" sub="Across the popup cache" />
        <MetricCard label="Ready collections" value={formatNumber(readyCollections)} sub={`${rows.length} monitored collections`} />
        <MetricCard label="Strongest inventory" value={topRow?.label || "-"} sub={topRow ? `${formatNumber(topRow.count)} items` : "No data"} />
        <MetricCard label="Last refresh" value={mostRecent ? relativeTime(mostRecent) : "Never"} variant={mostRecent ? "success" : "warning"} sub="Most recent collection update" />
      </div>

      <div className="section-header" style={{ marginTop: 18 }}>
        <span className="section-title">Collection performance</span>
      </div>
      <div className="analytics-list">
        {rows
          .sort((a, b) => b.count - a.count)
          .map((row) => (
            <button key={row.key} className="analytics-row" onClick={() => setView("collection", row.key)}>
              <div>
                <div className="session-title">{row.label}</div>
                <div className="session-subtitle">{row.updatedAt ? `Updated ${relativeTime(row.updatedAt)}` : "Not synced yet"}</div>
              </div>
              <div className="analytics-row-right">
                <Badge variant={statusVariant(row.count > 0 ? "active" : "waiting")}>
                  {row.count > 0 ? "Ready" : "Empty"}
                </Badge>
                <div className="analytics-row-value">{formatNumber(row.count)}</div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
