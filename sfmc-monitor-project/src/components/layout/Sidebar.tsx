import React from "react";
import { useAppStore } from "../../store/appStore";
import type { View, CollectionKey } from "../../store/types";
import { StatusDot } from "../common/StatusDot";
import { formatNumber, relativeTime } from "../../utils/formatters";

// ── SVG icon set ──────────────────────────────────────────────────────────────

const Icon = {
  Dashboard: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.2" opacity=".9"/>
      <rect x="9" y="1" width="6" height="6" rx="1.2" opacity=".9"/>
      <rect x="1" y="9" width="6" height="6" rx="1.2" opacity=".9"/>
      <rect x="9" y="9" width="6" height="6" rx="1.2" opacity=".9"/>
    </svg>
  ),
  Analytics: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1 13 L4 8 L7 10 L10 5 L13 7 L15 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="4" cy="8" r="1.3"/>
      <circle cx="7" cy="10" r="1.3"/>
      <circle cx="10" cy="5" r="1.3"/>
      <circle cx="13" cy="7" r="1.3"/>
    </svg>
  ),
  JourneyHistory: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" opacity=".7"/>
      <path d="M7.25 4.5v4l2.8 1.6-.7 1.3-3.35-1.9V4.5h1.25Z"/>
    </svg>
  ),
  StorageMiner: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="6" ry="2.2"/>
      <path d="M2 4v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V4" opacity=".6" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 8v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V8" opacity=".4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  Utilities: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5Zm0 1.5a5 5 0 1 1 0 10A5 5 0 0 1 8 3Zm0 2a3 3 0 1 0 0 6A3 3 0 0 0 8 5Zm0 1.5a1.5 1.5 0 1 1 0 3A1.5 1.5 0 0 1 8 6.5Z"/>
    </svg>
  ),
  Settings: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>
      <path d="M6.3 1.4 5.5 3H3.4L2 4.4v1.2l1.4 1.4H2v1.5l1.4 1.4v1.1L3.4 12H5.5l.8 1.6h3.4l.8-1.6H12.6l1.4-1.4v-1.1L14 9.5h-.6L14 8V6.8h-.6L14 5.6V4.4L12.6 3H10.5l-.8-1.6H6.3Z" opacity=".7"/>
    </svg>
  ),
  Rules: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1 2 3.4v3.3c0 3 2.3 5.8 6 7.3 3.7-1.5 6-4.3 6-7.3V3.4L8 1Zm0 1.6 4.5 1.8v2.3c0 2.3-1.7 4.5-4.5 5.7C5.2 12.2 3.5 10 3.5 7.7V4.4L8 2.6Z"/>
      <path d="M7.3 8.6 5.9 7.2l-1 1L7.3 10.6l3.8-3.8-1-1-2.8 2.8Z"/>
    </svg>
  ),
  // Collections
  Journeys: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="2.2"/>
      <circle cx="13" cy="4" r="2.2"/>
      <circle cx="13" cy="12" r="2.2"/>
      <path d="M5 8h3M10.5 4.8 8 7.5M10.5 11.2 8 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
    </svg>
  ),
  Automations: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 8c0-3.3 2.7-6 6-6v3l4-4-4-4v3C3.8.5.5 4 .5 8s3.3 7.5 7.5 7.5v-1.5C4.7 14 2 11.3 2 8Z" opacity=".8"/>
      <path d="M15.5 8A7.5 7.5 0 0 1 8 15.5v-3l-4 4 4 4V17c4.2-.4 7.5-3.9 7.5-9z" opacity=".4"/>
    </svg>
  ),
  SQLQueries: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 3.5h12v1.5H2zm0 3.5h8v1.5H2zm0 3.5h10v1.5H2z" opacity=".8"/>
    </svg>
  ),
  DataExtensions: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="14" height="3" rx="1"/>
      <rect x="1" y="6" width="14" height="3" rx="1" opacity=".7"/>
      <rect x="1" y="11" width="14" height="3" rx="1" opacity=".45"/>
    </svg>
  ),
  Assets: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" opacity=".8"/>
      <path d="M10 2v3h3" opacity=".5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  ),
  Folders: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1 4a1 1 0 0 1 1-1h4l1.5 2H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4Z" opacity=".85"/>
    </svg>
  ),
  PublicationLists: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="5" r="1.5"/>
      <circle cx="4" cy="11" r="1.5"/>
      <path d="M7 5h7M7 11h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    </svg>
  ),
  CanvasActivities: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.5" opacity=".85"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" opacity=".55"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" opacity=".55"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" opacity=".3"/>
    </svg>
  ),
  Errors: () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1L15 13H1L8 1Z" opacity=".8"/>
      <path d="M7.25 6h1.5v3.5h-1.5zm0 4.5h1.5V12h-1.5z" fill="var(--bg-base)" opacity=".9"/>
    </svg>
  ),
};

interface NavItem { id: View; label: string; icon: React.FC }
const NAV: NavItem[] = [
  { id: "dashboard",       label: "Dashboard",        icon: Icon.Dashboard },
  { id: "analytics",       label: "Analytics",        icon: Icon.Analytics },
  { id: "journey-history", label: "Journey History",  icon: Icon.JourneyHistory },
  { id: "storage-miner",   label: "Storage Insights", icon: Icon.StorageMiner },
  { id: "rules",           label: "Alert Rules",      icon: Icon.Rules },
  { id: "utilities",       label: "Utilities",        icon: Icon.Utilities },
  { id: "settings",        label: "Settings",         icon: Icon.Settings },
];

const COLLECTIONS: { key: CollectionKey; label: string; icon: React.FC }[] = [
  { key: "journeys",         label: "Journeys",          icon: Icon.Journeys },
  { key: "automations",      label: "Automations",       icon: Icon.Automations },
  { key: "sqlQueries",       label: "SQL Queries",       icon: Icon.SQLQueries },
  { key: "dataExtensions",   label: "Data Extensions",   icon: Icon.DataExtensions },
  { key: "assets",           label: "Assets",            icon: Icon.Assets },
  { key: "folders",          label: "Folders",           icon: Icon.Folders },
  { key: "publicationLists", label: "Publication Lists", icon: Icon.PublicationLists },
  { key: "canvasActivities", label: "Canvas Activities", icon: Icon.CanvasActivities },
  { key: "errors",           label: "Errors",            icon: Icon.Errors },
];

export function Sidebar() {
  const { activeView, activeCollection, setView, cache, updatedAt, storageMinerData, loading } = useAppStore();
  const miner = storageMinerData;
  const buName = miner?.businessUnit?.buName || miner?.userProfile?.userName || "Business Unit";
  const buMid  = miner?.userProfile?.legacyMid || miner?.businessUnit?.buMid || "-";
  const lastSync   = Math.max(0, ...Object.values(updatedAt).filter(Number.isFinite));
  const totalItems = Object.values(cache).reduce((sum, items) => sum + items.length, 0);
  const errorCount = cache["errors"]?.length ?? 0;

  return (
    <aside className="buddy-sidebar">
      {/* ── Brand ── */}
      <div className="brand-block">
        <div className="brand-logo-wrap">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="brandLogo" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3b82f6"/>
                <stop offset="1" stopColor="#1e40af"/>
              </linearGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#brandLogo)"/>
            <path d="M6 8h8M6 12h12M6 16h6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          {loading && <span className="brand-spinner" />}
        </div>
        <div className="brand-text">
          <div className="brand-name">Sezane Monitoring</div>
          <div className="brand-version">SFMC Monitor · v2.2.0</div>
        </div>
      </div>

      {/* ── BU Identity card ── */}
      <div className="bu-card">
        <div className="bu-card-inner">
          <div className="bu-avatar">{buName.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bu-card-name">{buName}</div>
            <div className="bu-card-mid">MID&nbsp;{buMid}</div>
          </div>
          <StatusDot status={lastSync > 0 ? "ok" : "unknown"} />
        </div>
        <div className="bu-sync-row">
          <span className="bu-sync-label">Synced</span>
          <span className="bu-sync-val">{lastSync ? relativeTime(lastSync) : "Never"}</span>
          <span className="bu-sync-sep">·</span>
          <span className="bu-sync-label">{formatNumber(totalItems)} items</span>
        </div>
      </div>

      {/* ── Main nav ── */}
      <nav className="buddy-nav">
        <div className="nav-section-label">Main views</div>
        {NAV.map(({ id, label, icon: NavIcon }) => (
          <button
            key={id}
            className={`nav-item${activeView === id && !activeCollection ? " active" : ""}`}
            onClick={() => setView(id)}
            title={label}
          >
            <span className="nav-icon"><NavIcon /></span>
            <span className="nav-label">{label}</span>
          </button>
        ))}

        <div className="nav-section-label" style={{ marginTop: 14 }}>SFMC Collections</div>
        {COLLECTIONS.map(({ key, label, icon: ColIcon }) => {
          const count = cache[key]?.length ?? 0;
          const isErr = key === "errors";
          return (
            <button
              key={key}
              className={`nav-item${activeView === "collection" && activeCollection === key ? " active" : ""}${isErr && count > 0 ? " nav-item-error" : ""}`}
              onClick={() => setView("collection", key)}
              title={label}
            >
              <span className="nav-icon"><ColIcon /></span>
              <span className="nav-label">{label}</span>
              {count > 0 && (
                <span className={`nav-badge${isErr ? " nav-badge-error" : ""}`}>
                  {formatNumber(count)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="sidebar-footer">
        <span>Sezane Monitoring</span>
        <span style={{ opacity: .5 }}>2026</span>
      </div>
    </aside>
  );
}
