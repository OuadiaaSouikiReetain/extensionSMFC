import React, { useState, useMemo } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, statusVariant } from "../../../utils/formatters";
import type { CollectionKey, CachedItem } from "../../../store/types";

const COLS: Record<CollectionKey, string[]> = {
  journeys:         ["name","status","version"],
  automations:      ["name","status","lastRunStatus","lastRunTime"],
  sqlQueries:       ["name","customerKey","status"],
  dataExtensions:   ["name","customerKey","id"],
  assets:           ["name","id"],
  folders:          ["name","id"],
  publicationLists: ["name","id"],
  canvasActivities: ["name","key","type"],
  errors:           ["status","url","message"],
};

const LABELS: Record<CollectionKey, string> = {
  journeys:"Journeys", automations:"Automations", sqlQueries:"SQL Queries",
  dataExtensions:"Data Extensions", assets:"Assets", folders:"Folders",
  publicationLists:"Publication Lists", canvasActivities:"Canvas Activities", errors:"Errors",
};

export function CollectionView() {
  const { cache, updatedAt, activeCollection, setView, purgeCache, addLog } = useAppStore();
  const key = activeCollection as CollectionKey;
  const items: CachedItem[] = cache[key] ?? [];
  const columns = COLS[key] ?? ["name"];
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      columns.some(c => String((item as Record<string,unknown>)[c] ?? "").toLowerCase().includes(q))
    );
  }, [items, search, columns]);

  async function handleExportCsv() {
    const header = columns.join(",");
    const rows = filtered.map(item =>
      columns.map(c => `"${String((item as Record<string,unknown>)[c] ?? "").replace(/"/g,'""')}"`).join(",")
    );
    const csv = [header, ...rows].join("\n");
    await navigator.clipboard.writeText(csv);
    addLog(`CSV (${filtered.length} rows) copied to clipboard.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Topbar */}
      <div className="buddy-topbar">
        <Button variant="ghost" size="sm" onClick={() => setView("dashboard")}>← Back</Button>
        <div>
          <div className="topbar-eyebrow">Collection</div>
          <div className="topbar-title">{LABELS[key]}</div>
        </div>
        <div className="topbar-actions">
          <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>
            {formatNumber(filtered.length)}/{formatNumber(items.length)} · {updatedAt[key] ? relativeTime(updatedAt[key]) : "—"}
          </span>
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>⬇ CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => purgeCache(key)}>🗑 Clear</Button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
        <div className="search-wrap">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM15 15l-3.5-3.5"/></svg>
          <input className="input search-input" placeholder={`Search ${LABELS[key]}…`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0
          ? <EmptyState title="No items" message={search ? "No results for this search." : "Run Sync to populate this collection."} />
          : (
            <>
              <div className="object-table-header"
                style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "130px").join(" ")} 32px` }}>
                {columns.map(c => <span key={c}>{c}</span>)}
                <span />
              </div>
              {filtered.map((item, i) => (
                <div key={String(item.id || i)} className="object-row"
                  style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "130px").join(" ")} 32px` }}
                  onClick={() => setView("detail", key, String(item.id || ""))}>
                  <span className="col-name">{String(item.name || item.id || "—")}</span>
                  {columns.slice(1).map(c => (
                    <span key={c}>
                      {c === "status" || c === "lastRunStatus"
                        ? <Badge variant={statusVariant(String((item as Record<string,unknown>)[c] ?? ""))}>{String((item as Record<string,unknown>)[c] ?? "—")}</Badge>
                        : <span className="col-mono truncate">{String((item as Record<string,unknown>)[c] ?? "—")}</span>
                      }
                    </span>
                  ))}
                  <span style={{ color: "var(--text-muted)", fontSize: ".75rem" }}>›</span>
                </div>
              ))}
            </>
          )
        }
      </div>
    </div>
  );
}
