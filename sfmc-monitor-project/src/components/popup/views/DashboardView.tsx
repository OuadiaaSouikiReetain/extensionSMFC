import React, { useMemo, useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, statusVariant } from "../../../utils/formatters";
import type { CachedItem, CollectionKey } from "../../../store/types";

const COLL_META: Record<CollectionKey, { label: string; short: string }> = {
  journeys:         { label: "Journeys",          short: "JR"  },
  automations:      { label: "Automations",        short: "AU"  },
  sqlQueries:       { label: "SQL Queries",        short: "SQL" },
  dataExtensions:   { label: "Data Extensions",    short: "DE"  },
  assets:           { label: "Assets",             short: "AS"  },
  folders:          { label: "Folders",            short: "FD"  },
  publicationLists: { label: "Publication Lists",  short: "PL"  },
  canvasActivities: { label: "Canvas Activities",  short: "CV"  },
  errors:           { label: "Errors",             short: "ER"  },
};

export function DashboardView() {
  const { cache, updatedAt, activeTab, loading, synchronize, setView, purgeCache, exportSnapshot, addLog } = useAppStore();
  const [tab, setTab] = useState<"collections" | "journeys" | "automations">("collections");

  const totalItems  = Object.values(cache).reduce((sum, items) => sum + items.length, 0);
  const lastSync    = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const hasErrors   = (cache.errors?.length ?? 0) > 0;
  const populatedCollections = useMemo(
    () => (Object.keys(COLL_META) as CollectionKey[]).filter((key) => (cache[key]?.length ?? 0) > 0),
    [cache],
  );

  const hostname = (() => {
    try { return activeTab?.url ? new URL(activeTab.url).hostname : null; } catch { return null; }
  })();

  async function handleExport() {
    const snap = exportSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    addLog("Snapshot copied to clipboard.");
  }

  return (
    <div className="buddy-content" style={{ display: "flex", flexDirection: "column", gap: 0, padding: "10px 16px", overflowY: "hidden" }}>

      {/* ── Sync bar ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 12px", marginBottom: 10,
        background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xs)",
        flexShrink: 0,
      }}>
        {/* Session dot */}
        <div className={`status-dot ${hostname ? "ok" : "unknown"}`} />

        {/* BU info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hostname ?? "No SFMC tab detected"}
          </div>
          <div style={{ fontSize: ".65rem", color: "var(--text-muted)", marginTop: 1 }}>
            {totalItems > 0
              ? `${formatNumber(totalItems)} items · ${populatedCollections.length}/${Object.keys(COLL_META).length} collections`
              : "Not synced yet"
            }
            {lastSync > 0 && <span style={{ marginLeft: 6, color: "var(--success)" }}>· {relativeTime(lastSync)}</span>}
          </div>
        </div>

        {hasErrors && (
          <button
            onClick={() => setView("collection", "errors")}
            style={{
              padding: "3px 10px", borderRadius: "var(--radius-pill)",
              background: "var(--danger-surface)", color: "var(--danger)",
              border: "1px solid var(--danger-border)", cursor: "pointer",
              fontSize: ".7rem", fontWeight: 600, whiteSpace: "nowrap",
            }}
          >
            {cache.errors.length} errors
          </button>
        )}

        <Button variant="ghost" size="sm" onClick={handleExport} title="Copy snapshot to clipboard">Export</Button>
        <Button variant="primary" size="sm" loading={loading} onClick={synchronize}>Sync all</Button>
      </div>

      {/* ── Tab nav ────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", marginBottom: 10, flexShrink: 0 }}>
        {(["collections", "journeys", "automations"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", border: "none", background: "none", cursor: "pointer",
            fontSize: ".78rem", fontWeight: tab === t ? 700 : 400,
            color: tab === t ? "var(--brand)" : "var(--text-muted)",
            borderBottom: tab === t ? "2px solid var(--brand)" : "2px solid transparent",
            marginBottom: -1, whiteSpace: "nowrap",
          }}>
            {t === "collections"
              ? "Collections"
              : t === "journeys"
                ? `Journeys${(cache.journeys?.length ?? 0) > 0 ? ` (${cache.journeys.length})` : ""}`
                : `Automations${(cache.automations?.length ?? 0) > 0 ? ` (${cache.automations.length})` : ""}`}
          </button>
        ))}
        <button
          onClick={() => setView("analytics")}
          style={{
            marginLeft: "auto", padding: "6px 12px", border: "none", background: "none",
            cursor: "pointer", fontSize: ".72rem", color: "var(--text-muted)",
          }}
        >
          Analytics →
        </button>
      </div>

      {/* ── Collections grid ───────────────────────────────────── */}
      {tab === "collections" && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexShrink: 0 }}>
            <span style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              {populatedCollections.length} / {Object.keys(COLL_META).length} synced
            </span>
            <Button variant="ghost" size="xs" onClick={() => purgeCache("all")}>Clear all</Button>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
            gap: 8,
          }}>
            {(Object.keys(COLL_META) as CollectionKey[]).map((key) => {
              const count    = cache[key]?.length ?? 0;
              const maxCount = Math.max(1, ...Object.values(cache).map((items) => items.length));
              const pct      = Math.round((count / maxCount) * 100);
              const meta     = COLL_META[key];
              return (
                <div
                  key={key}
                  className="collection-card"
                  style={{ padding: "9px 11px", cursor: "pointer" }}
                  onClick={() => setView("collection", key)}
                >
                  <div style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 32, height: 32, padding: "0 8px", borderRadius: 9,
                    background: "var(--brand-surface)", color: "var(--brand)",
                    fontSize: ".62rem", fontWeight: 700, fontFamily: "var(--font-mono)",
                    marginBottom: 6,
                  }}>{meta.short}</div>
                  <div className="coll-label" style={{ fontSize: ".7rem" }}>{meta.label}</div>
                  <div className="coll-count" style={{ fontSize: "1.1rem" }}>{formatNumber(count)}</div>
                  <div className="coll-updated" style={{ fontSize: ".6rem" }}>{updatedAt[key] ? relativeTime(updatedAt[key]) : "Not synced"}</div>
                  <div className="coll-bar-track" style={{ marginTop: 6 }}>
                    <div className="coll-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Journey quick list ─────────────────────────────────── */}
      {tab === "journeys" && (
        <QuickList
          items={cache.journeys}
          columns={["name", "status", "version"]}
          onOpen={(id) => setView("detail", "journeys", id)}
          emptyMessage="No journeys cached. Run Sync all to fetch them."
        />
      )}

      {/* ── Automation quick list ──────────────────────────────── */}
      {tab === "automations" && (
        <QuickList
          items={cache.automations}
          columns={["name", "status", "lastRunStatus", "lastRunTime"]}
          onOpen={(id) => setView("detail", "automations", id)}
          emptyMessage="No automations cached. Run Sync all to fetch them."
        />
      )}
    </div>
  );
}

function QuickList({
  items,
  onOpen,
  columns,
  emptyMessage,
}: {
  items: CachedItem[];
  onOpen: (id: string) => void;
  columns: string[];
  emptyMessage: string;
}) {
  if (!items.length) {
    return <EmptyState title="No data" message={emptyMessage} />;
  }

  return (
    <div className="table-scroll">
      <div className="object-table-inner">
        <div
          className="object-table-header"
          style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")}` }}
        >
          {columns.map((col) => <span key={col}>{col}</span>)}
        </div>
        {items.slice(0, 60).map((item, index) => (
          <div
            key={String(item.id || index)}
            className="object-row"
            style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")}` }}
            onClick={() => onOpen(String(item.id || ""))}
          >
            <span className="col-name">{String(item.name || item.id || "—")}</span>
            {columns.slice(1).map((col) => (
              <span key={col}>
                {col === "status" || col === "lastRunStatus" ? (
                  <Badge variant={statusVariant(String(item[col] ?? ""))}>{String(item[col] ?? "—")}</Badge>
                ) : (
                  <span className="col-mono">{String(item[col] ?? "—")}</span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
