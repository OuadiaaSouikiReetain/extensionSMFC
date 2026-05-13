import React from "react";
import { useAppStore } from "../../store/appStore";
import type { View, CollectionKey } from "../../store/types";
import { StatusDot } from "../common/StatusDot";
import { formatNumber, relativeTime } from "../../utils/formatters";

interface NavItem {
  id: View;
  label: string;
  short: string;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", short: "DS" },
  { id: "analytics", label: "Analytics", short: "AN" },
  { id: "journey-history", label: "Journey History", short: "JH" },
  { id: "storage-miner", label: "Storage Insights", short: "SI" },
  { id: "utilities", label: "Utilities", short: "UT" },
  { id: "settings", label: "Settings", short: "ST" },
];

const COLLECTIONS: { key: CollectionKey; label: string; short: string }[] = [
  { key: "journeys", label: "Journeys", short: "JR" },
  { key: "automations", label: "Automations", short: "AU" },
  { key: "sqlQueries", label: "SQL Queries", short: "SQL" },
  { key: "dataExtensions", label: "Data Extensions", short: "DE" },
  { key: "assets", label: "Assets", short: "AS" },
  { key: "folders", label: "Folders", short: "FD" },
  { key: "publicationLists", label: "Publication Lists", short: "PL" },
  { key: "canvasActivities", label: "Canvas Activities", short: "CV" },
  { key: "errors", label: "Errors", short: "ER" },
];

function NavGlyph({ short }: { short: string }) {
  return <span className="nav-glyph">{short}</span>;
}

export function Sidebar() {
  const { activeView, activeCollection, setView, cache, updatedAt, storageMinerData, loading } = useAppStore();
  const miner = storageMinerData;
  const buName = miner?.businessUnit?.buName || miner?.userProfile?.userName || "Unknown BU";
  const buMid = miner?.userProfile?.legacyMid || miner?.businessUnit?.buMid || "-";
  const lastSync = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const totalItems = Object.values(cache).reduce((sum, items) => sum + items.length, 0);

  return (
    <aside className="buddy-sidebar">
      <div className="brand-block">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#0066cc" />
          <path d="M6 8h8M6 12h12M6 16h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div>
          <div className="brand-name">Sezane Monitoring</div>
          <div className="brand-version">v2.2.0</div>
        </div>
        {loading ? <span className="spinner" style={{ marginLeft: "auto", width: 14, height: 14 }} /> : null}
      </div>

      <div className="bu-card">
        <div className="bu-card-label">Business Unit</div>
        <div className="bu-card-name">{buName}</div>
        <div className="bu-card-mid">MID {buMid}</div>
      </div>

      <nav className="buddy-nav">
        <div className="nav-section-label">Workspace</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${activeView === item.id && !activeCollection ? " active" : ""}`}
            onClick={() => setView(item.id)}
            title={item.label}
          >
            <NavGlyph short={item.short} />
            {item.label}
          </button>
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>Collections</div>
        {COLLECTIONS.map((collection) => (
          <button
            key={collection.key}
            className={`nav-item${activeView === "collection" && activeCollection === collection.key ? " active" : ""}`}
            onClick={() => setView("collection", collection.key)}
            title={collection.label}
          >
            <NavGlyph short={collection.short} />
            {collection.label}
            {cache[collection.key]?.length ? <span className="nav-badge">{formatNumber(cache[collection.key].length)}</span> : null}
          </button>
        ))}
      </nav>

      <div className="health-card">
        <div className="health-row">
          <StatusDot status={lastSync > 0 ? "ok" : "unknown"} />
          <span className="health-label">Last sync</span>
          <span className="health-val">{lastSync ? relativeTime(lastSync) : "Never"}</span>
        </div>
        <div className="health-row" style={{ marginTop: 4 }}>
          <span style={{ width: 8 }} />
          <span className="health-label">Cached items</span>
          <span className="health-val">{formatNumber(totalItems)}</span>
        </div>
      </div>

      <div className="sidebar-footer">Sezane Monitoring 2026</div>
    </aside>
  );
}
