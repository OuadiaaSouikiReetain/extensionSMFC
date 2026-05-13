import React, { useMemo, useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { MetricCard } from "../../common/MetricCard";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, estimateCacheKb, statusVariant } from "../../../utils/formatters";
import type { CachedItem, CollectionKey } from "../../../store/types";

const COLL_META: Record<CollectionKey, { label: string; short: string }> = {
  journeys: { label: "Journeys", short: "JR" },
  automations: { label: "Automations", short: "AU" },
  sqlQueries: { label: "SQL Queries", short: "SQL" },
  dataExtensions: { label: "Data Extensions", short: "DE" },
  assets: { label: "Assets", short: "AS" },
  folders: { label: "Folders", short: "FD" },
  publicationLists: { label: "Publication Lists", short: "PL" },
  canvasActivities: { label: "Canvas Activities", short: "CV" },
  errors: { label: "Errors", short: "ER" },
};

export function DashboardView() {
  const { cache, updatedAt, activeTab, loading, synchronize, setView, purgeCache, exportSnapshot, addLog } = useAppStore();
  const [tab, setTab] = useState<"overview" | "journeys" | "automations">("overview");

  const totalItems = Object.values(cache).reduce((sum, items) => sum + items.length, 0);
  const lastSync = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const hasErrors = (cache.errors?.length ?? 0) > 0;
  const populatedCollections = useMemo(
    () => (Object.keys(COLL_META) as CollectionKey[]).filter((key) => (cache[key]?.length ?? 0) > 0),
    [cache],
  );

  async function handleExport() {
    const snap = exportSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    addLog("Snapshot copied to clipboard.");
  }

  return (
    <div className="buddy-content">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="hero-eyebrow">Live SFMC workspace</div>
          <h1 className="hero-title">Monitor journeys, inventory, and content from one responsive console.</h1>
          <p className="hero-text">
            Sezane Monitoring reuses the active SFMC session, keeps local collections fresh, and gives you direct access
            to journeys, data extensions, assets, folders, and automation activity.
          </p>
          <div className="hero-actions">
            <Button variant="primary" loading={loading} onClick={synchronize}>Sync all collections</Button>
            <Button variant="secondary" size="sm" onClick={() => setView("analytics")}>Open analytics</Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>Export snapshot</Button>
          </div>
        </div>
        <div className="hero-kpis">
          <MetricCard label="Cached items" value={formatNumber(totalItems)} variant="brand" sub="Across all local collections" />
          <MetricCard label="Collections ready" value={formatNumber(populatedCollections.length)} sub={`${Object.keys(COLL_META).length} tracked sources`} />
          <MetricCard label="Storage footprint" value={`${estimateCacheKb(cache)} KB`} sub="Local popup cache" />
          <MetricCard label="Last sync" value={lastSync ? relativeTime(lastSync) : "Never"} variant={lastSync ? "success" : "warning"} sub="Based on the active SFMC tab" />
        </div>
      </section>

      <section className="session-card">
        <div className="session-info">
          <div className="session-title">Active SFMC session</div>
          <div className="session-subtitle">{activeTab?.url || "Open an SFMC tab to activate synchronization."}</div>
        </div>
        {hasErrors ? (
          <Button variant="danger" size="sm" onClick={() => setView("collection", "errors")}>
            View {cache.errors.length} errors
          </Button>
        ) : (
          <Badge variant="success">No captured errors</Badge>
        )}
      </section>

      <div className="dashboard-tabs">
        {(["overview", "journeys", "automations"] as const).map((item) => (
          <button key={item} className={`dashboard-tab${tab === item ? " active" : ""}`} onClick={() => setTab(item)}>
            {item === "overview" ? "Overview" : item === "journeys" ? "Journey queue" : "Automation queue"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="section-header">
            <span className="section-title">Collections</span>
            <Button variant="ghost" size="xs" onClick={() => purgeCache("all")}>Clear all</Button>
          </div>
          <div className="collection-grid">
            {(Object.keys(COLL_META) as CollectionKey[]).map((key) => {
              const count = cache[key]?.length ?? 0;
              const maxCount = Math.max(1, ...Object.values(cache).map((items) => items.length));
              const pct = Math.round((count / maxCount) * 100);
              const meta = COLL_META[key];
              return (
                <div key={key} className="collection-card" onClick={() => setView("collection", key)}>
                  <div className="collection-chip">{meta.short}</div>
                  <div className="coll-label">{meta.label}</div>
                  <div className="coll-count">{formatNumber(count)}</div>
                  <div className="coll-updated">{updatedAt[key] ? relativeTime(updatedAt[key]) : "Not synced yet"}</div>
                  <div className="coll-bar-track">
                    <div className="coll-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-header" style={{ marginTop: 18 }}>
            <span className="section-title">Inventory health</span>
            <Button variant="ghost" size="xs" onClick={() => setView("analytics")}>Open analytics</Button>
          </div>
          <div className="table-scroll">
            <table className="cache-table">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Items</th>
                  <th>Last updated</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(Object.keys(COLL_META) as CollectionKey[]).map((key) => (
                  <tr key={key}>
                    <td>{COLL_META[key].label}</td>
                    <td className="text-mono">{formatNumber(cache[key]?.length ?? 0)}</td>
                    <td>{updatedAt[key] ? relativeTime(updatedAt[key]) : "Never"}</td>
                    <td>
                      <Badge variant={(cache[key]?.length ?? 0) > 0 ? "success" : "warning"}>
                        {(cache[key]?.length ?? 0) > 0 ? "Ready" : "Empty"}
                      </Badge>
                    </td>
                    <td>
                      <Button variant="ghost" size="xs" onClick={() => setView("collection", key)}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "journeys" ? (
        <QuickList
          title="Recent journeys"
          items={cache.journeys}
          columns={["name", "status", "version"]}
          onOpen={(id) => setView("detail", "journeys", id)}
        />
      ) : null}

      {tab === "automations" ? (
        <QuickList
          title="Recent automations"
          items={cache.automations}
          columns={["name", "status", "lastRunStatus", "lastRunTime"]}
          onOpen={(id) => setView("detail", "automations", id)}
        />
      ) : null}
    </div>
  );
}

function QuickList({
  title,
  items,
  onOpen,
  columns,
}: {
  title: string;
  items: CachedItem[];
  onOpen: (id: string) => void;
  columns: string[];
}) {
  if (!items.length) {
    return <EmptyState title="No data available" message="Run a synchronization from the dashboard to populate this section." />;
  }

  return (
    <>
      <div className="section-header">
        <span className="section-title">{title}</span>
      </div>
      <div className="table-scroll">
        <div className="object-table-inner">
          <div className="object-table-header" style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")}` }}>
            {columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {items.slice(0, 50).map((item, index) => (
            <div
              key={String(item.id || index)}
              className="object-row"
              style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")}` }}
              onClick={() => onOpen(String(item.id || ""))}
            >
              <span className="col-name">{String(item.name || item.id || "-")}</span>
              {columns.slice(1).map((column) => (
                <span key={column}>
                  {column === "status" || column === "lastRunStatus" ? (
                    <Badge variant={statusVariant(String(item[column] ?? ""))}>{String(item[column] ?? "-")}</Badge>
                  ) : (
                    <span className="col-mono">{String(item[column] ?? "-")}</span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
