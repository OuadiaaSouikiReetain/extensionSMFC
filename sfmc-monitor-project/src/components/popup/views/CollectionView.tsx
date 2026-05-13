import React, { useDeferredValue, useMemo, useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, relativeTime, statusVariant } from "../../../utils/formatters";
import type { CollectionKey, CachedItem } from "../../../store/types";

const COLS: Record<CollectionKey, string[]> = {
  journeys: ["name", "status", "version"],
  automations: ["name", "status", "lastRunStatus", "lastRunTime"],
  sqlQueries: ["name", "customerKey", "status"],
  dataExtensions: ["name", "customerKey", "id"],
  assets: ["name", "assetType", "status"],
  folders: ["name", "type", "id"],
  publicationLists: ["name", "id"],
  canvasActivities: ["name", "key", "type"],
  errors: ["status", "url", "message"],
};

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

export function CollectionView() {
  const { cache, updatedAt, activeCollection, setView, purgeCache, addLog } = useAppStore();
  const key = (activeCollection || "journeys") as CollectionKey;
  const items: CachedItem[] = cache[key] ?? [];
  const columns = COLS[key] ?? ["name"];
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    if (!deferredSearch.trim()) return items;
    const query = deferredSearch.toLowerCase();
    return items.filter((item) =>
      Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(query)),
    );
  }, [items, deferredSearch]);

  async function handleExportCsv() {
    const header = columns.join(",");
    const rows = filtered.map((item) =>
      columns.map((column) => `"${String(item[column] ?? "").replace(/"/g, "\"\"")}"`).join(","),
    );
    await navigator.clipboard.writeText([header, ...rows].join("\n"));
    addLog(`CSV (${filtered.length} rows) copied to clipboard.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="buddy-topbar">
        <Button variant="ghost" size="sm" onClick={() => setView("dashboard")}>Back</Button>
        <div>
          <div className="topbar-eyebrow">Collection</div>
          <div className="topbar-title">{LABELS[key]}</div>
        </div>
        <div className="topbar-actions">
          <Badge variant="neutral">{formatNumber(filtered.length)} / {formatNumber(items.length)}</Badge>
          <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>
            {updatedAt[key] ? relativeTime(updatedAt[key]) : "Not synced"}
          </span>
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => purgeCache(key)}>Clear</Button>
        </div>
      </div>

      <div className="collection-header-band">
        <div className="search-wrap collection-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM15 15l-3.5-3.5" />
          </svg>
          <input
            className="input search-input"
            placeholder={`Search ${LABELS[key]}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="collection-header-meta">
          <div className="collection-chip">{key.toUpperCase().slice(0, 3)}</div>
          <div>
            <div className="metric-label">Collection focus</div>
            <div className="session-title">{LABELS[key]}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {!filtered.length ? (
          <EmptyState
            title="No items available"
            message={search ? "No items match this search." : "Run Sync all collections from the dashboard first."}
          />
        ) : (
          <div className="table-scroll">
            <div className="object-table-inner">
              <div className="object-table-header" style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")} 32px` }}>
                {columns.map((column) => <span key={column}>{column}</span>)}
                <span />
              </div>
              {filtered.map((item, index) => (
                <div
                  key={String(item.id || index)}
                  className="object-row"
                  style={{ gridTemplateColumns: `1fr ${columns.slice(1).map(() => "140px").join(" ")} 32px` }}
                  onClick={() => setView("detail", key, String(item.id || ""))}
                >
                  <span className="col-name">{String(item.name || item.id || "-")}</span>
                  {columns.slice(1).map((column) => (
                    <span key={column}>
                      {column === "status" || column === "lastRunStatus" ? (
                        <Badge variant={statusVariant(String(item[column] ?? ""))}>{String(item[column] ?? "-")}</Badge>
                      ) : (
                        <span className="col-mono truncate">{String(item[column] ?? "-")}</span>
                      )}
                    </span>
                  ))}
                  <span style={{ color: "var(--text-muted)", fontSize: ".75rem" }}>{">"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
