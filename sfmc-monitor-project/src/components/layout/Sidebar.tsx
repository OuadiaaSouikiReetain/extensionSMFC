import React from "react";
import { useAppStore } from "../../store/appStore";
import type { View, CollectionKey } from "../../store/types";
import { StatusDot } from "../common/StatusDot";
import { formatNumber, relativeTime } from "../../utils/formatters";

interface NavItem { id: View; label: string; icon: string; collection?: CollectionKey; badge?: string; }

const NAV: NavItem[] = [
  { id: "dashboard",       label: "Dashboard",        icon: "⊞" },
  { id: "journey-history", label: "Journey History",  icon: "🕐" },
  { id: "storage-miner",   label: "Storage Insights", icon: "🔍" },
  { id: "analytics",       label: "Analytics",        icon: "📈" },
  { id: "utilities",       label: "Utilities",        icon: "🛠" },
  { id: "settings",        label: "Settings",         icon: "⚙" },
];

const COLLECTIONS: { key: CollectionKey; label: string; icon: string }[] = [
  { key: "journeys",       label: "Journeys",       icon: "🗺" },
  { key: "automations",    label: "Automations",    icon: "⚡" },
  { key: "sqlQueries",     label: "SQL Queries",    icon: "🗃" },
  { key: "dataExtensions", label: "Data Extensions",icon: "📋" },
  { key: "assets",         label: "Assets",         icon: "🖼" },
  { key: "errors",         label: "Errors",         icon: "⚠" },
];

export function Sidebar() {
  const { activeView, activeCollection, setView, cache, updatedAt, storageMinerData, loading } = useAppStore();
  const miner = storageMinerData;
  const buName = miner?.businessUnit?.buName || miner?.userProfile?.userName || "—";
  const buMid  = miner?.userProfile?.legacyMid || miner?.businessUnit?.buMid || "—";
  const lastSync = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const totalItems = Object.values(cache).reduce((s, a) => s + a.length, 0);

  return (
    <aside className="buddy-sidebar">
      {/* Brand */}
      <div className="brand-block">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#0066cc"/>
          <path d="M6 8h8M6 12h12M6 16h6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <div>
          <div className="brand-name">SFMC Buddy</div>
          <div className="brand-version">v2.2.0</div>
        </div>
        {loading && <span className="spinner" style={{ marginLeft: "auto", width: 14, height: 14 }} />}
      </div>

      {/* BU Card */}
      <div className="bu-card">
        <div className="bu-card-label">Business Unit</div>
        <div className="bu-card-name">{buName}</div>
        <div className="bu-card-mid">MID {buMid}</div>
      </div>

      {/* Navigation */}
      <nav className="buddy-nav">
        <div className="nav-section-label">Navigation</div>
        {NAV.map(item => (
          <button
            key={item.id}
            className={`nav-item${activeView === item.id && !activeCollection ? " active" : ""}`}
            onClick={() => setView(item.id)}
          >
            <span>{item.icon}</span>
            {item.label}
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </button>
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>Collections</div>
        {COLLECTIONS.map(col => (
          <button
            key={col.key}
            className={`nav-item${activeView === "collection" && activeCollection === col.key ? " active" : ""}`}
            onClick={() => setView("collection", col.key)}
          >
            <span>{col.icon}</span>
            {col.label}
            {cache[col.key]?.length > 0 && (
              <span className="nav-badge">{formatNumber(cache[col.key].length)}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Health */}
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

      <div className="sidebar-footer">SFMC Buddy © 2026</div>
    </aside>
  );
}
