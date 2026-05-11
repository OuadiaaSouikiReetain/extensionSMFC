import React, { useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { MetricCard } from "../../common/MetricCard";
import { Badge } from "../../common/Badge";
import { formatNumber, relativeTime, estimateCacheKb, statusVariant } from "../../../utils/formatters";
import type { CollectionKey } from "../../../store/types";

const COLL_META: Record<CollectionKey, { label: string; icon: string }> = {
  journeys:        { label: "Journeys",        icon: "🗺" },
  automations:     { label: "Automations",     icon: "⚡" },
  sqlQueries:      { label: "SQL Queries",     icon: "🗃" },
  dataExtensions:  { label: "Data Extensions", icon: "📋" },
  assets:          { label: "Assets",          icon: "🖼" },
  folders:         { label: "Folders",         icon: "📁" },
  publicationLists:{ label: "Pub. Lists",      icon: "📬" },
  canvasActivities:{ label: "Canvas",          icon: "🎨" },
  errors:          { label: "Errors",          icon: "⚠" },
};

export function DashboardView() {
  const { cache, updatedAt, activeTab, loading, synchronize, setView, purgeCache, exportSnapshot, addLog } = useAppStore();
  const [activeTab2, setActiveTab2] = useState<"global" | "journeys" | "automations">("global");

  const totalItems = Object.values(cache).reduce((s, a) => s + a.length, 0);
  const lastSync   = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const hasErrors  = (cache.errors?.length ?? 0) > 0;

  async function handleExport() {
    const snap = exportSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    addLog("Snapshot copied to clipboard.");
  }

  return (
    <div className="buddy-content">
      {/* Sync panel */}
      <div className="sync-panel">
        <div className="sync-stats">
          <div>
            <div className="sync-stat-label">Cached items</div>
            <div className="sync-stat-value">{formatNumber(totalItems)}</div>
          </div>
          <div>
            <div className="sync-stat-label">Last sync</div>
            <div className="sync-stat-value">{lastSync ? relativeTime(lastSync) : "—"}</div>
          </div>
          <div>
            <div className="sync-stat-label">Storage</div>
            <div className="sync-stat-value">{estimateCacheKb(cache)} KB</div>
          </div>
        </div>
        <div className="sync-actions">
          <Button variant="primary" loading={loading} onClick={synchronize}>↻ Sync all</Button>
          <Button variant="secondary" size="sm" onClick={handleExport}>⬇ Export</Button>
          {hasErrors && (
            <Button variant="danger" size="sm" onClick={() => setView("collection", "errors")}>
              ⚠ {cache.errors.length} errors
            </Button>
          )}
        </div>
        {activeTab && (
          <div style={{ marginTop: 8, fontSize: ".7rem", color: "var(--text-muted)" }}>
            Tab: <span style={{ fontFamily: "var(--font-mono)" }}>{activeTab.url?.slice(0, 60)}…</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="dashboard-tabs">
        {(["global","journeys","automations"] as const).map(t => (
          <button key={t} className={`dashboard-tab${activeTab2 === t ? " active" : ""}`} onClick={() => setActiveTab2(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Global tab */}
      {activeTab2 === "global" && (
        <>
          <div className="section-header"><span className="section-title">Collections</span></div>
          <div className="collection-grid">
            {(Object.keys(COLL_META) as CollectionKey[]).map(key => {
              const meta = COLL_META[key];
              const count = cache[key]?.length ?? 0;
              const maxCount = Math.max(1, ...Object.values(cache).map(a => a.length));
              const pct = Math.round((count / maxCount) * 100);
              return (
                <div key={key} className="collection-card" onClick={() => setView("collection", key)}>
                  <div className="coll-icon">{meta.icon}</div>
                  <div className="coll-label">{meta.label}</div>
                  <div className="coll-count">{formatNumber(count)}</div>
                  <div className="coll-updated">{updatedAt[key] ? relativeTime(updatedAt[key]) : "—"}</div>
                  <div className="coll-bar-track">
                    <div className="coll-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cache table */}
          <div className="section-header" style={{ marginTop: 18 }}>
            <span className="section-title">Cache inventory</span>
            <Button variant="ghost" size="xs" onClick={() => purgeCache("all")}>Clear all</Button>
          </div>
          <table className="cache-table">
            <thead>
              <tr><th>Collection</th><th>Items</th><th>Last updated</th><th></th></tr>
            </thead>
            <tbody>
              {(Object.keys(COLL_META) as CollectionKey[]).map(key => (
                <tr key={key}>
                  <td>{COLL_META[key].label}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{formatNumber(cache[key]?.length ?? 0)}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: ".72rem" }}>{updatedAt[key] ? relativeTime(updatedAt[key]) : "—"}</td>
                  <td><Button variant="ghost" size="xs" onClick={() => purgeCache(key)}>Clear</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Journeys tab */}
      {activeTab2 === "journeys" && (
        <QuickList
          items={cache.journeys}
          onOpen={id => setView("detail", "journeys", id)}
          columns={["name","status","version"]}
        />
      )}

      {/* Automations tab */}
      {activeTab2 === "automations" && (
        <QuickList
          items={cache.automations}
          onOpen={id => setView("detail", "automations", id)}
          columns={["name","status","lastRunStatus","lastRunTime"]}
        />
      )}
    </div>
  );
}

function QuickList({ items, onOpen, columns }: { items: unknown[]; onOpen: (id: string) => void; columns: string[] }) {
  const list = items as Record<string, unknown>[];
  if (!list.length) return (
    <div className="empty-state"><div className="empty-state-title">No data — run Sync first</div></div>
  );
  return (
    <div>
      <div className="object-table-header" style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "120px").join(" ")}` }}>
        {columns.map(c => <span key={c}>{c}</span>)}
      </div>
      {list.slice(0, 50).map((item, i) => (
        <div key={String(item.id || i)} className="object-row"
          style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "120px").join(" ")}` }}
          onClick={() => onOpen(String(item.id || ""))}>
          <span className="col-name">{String(item.name || item.id || "—")}</span>
          {columns.slice(1).map(c => (
            <span key={c}>
              {c === "status" || c === "lastRunStatus"
                ? <Badge variant={statusVariant(String(item[c] ?? ""))}>{String(item[c] ?? "—")}</Badge>
                : <span className="col-mono">{String(item[c] ?? "—")}</span>
              }
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
