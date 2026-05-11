import React, { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { Sidebar } from "../components/layout/Sidebar";
import { DashboardView } from "../components/popup/views/DashboardView";
import { CollectionView } from "../components/popup/views/CollectionView";
import { JourneyHistoryView } from "../components/popup/views/JourneyHistoryView";
import { StorageMinerView } from "../components/popup/views/StorageMinerView";
import { SettingsView } from "../components/popup/views/SettingsView";
import { UtilitiesView } from "../components/popup/views/UtilitiesView";

function DebugLog() {
  const logs = useAppStore(s => s.logs);
  if (!logs.length) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
      <pre className="debug-log">{logs.join("\n")}</pre>
    </div>
  );
}

export function PopupApp() {
  const { activeView, loadAll } = useAppStore();

  useEffect(() => { loadAll(); }, []);

  const view = (() => {
    switch (activeView) {
      case "dashboard":       return <DashboardView />;
      case "collection":      return <CollectionView />;
      case "journey-history": return <JourneyHistoryView />;
      case "storage-miner":   return <StorageMinerView />;
      case "settings":        return <SettingsView />;
      case "utilities":       return <UtilitiesView />;
      default:                return <DashboardView />;
    }
  })();

  return (
    <div className="buddy-shell">
      <Sidebar />
      <div className="buddy-main">
        {activeView !== "collection" && activeView !== "journey-history" && (
          <div className="buddy-topbar">
            <div>
              <div className="topbar-eyebrow">SFMC Buddy</div>
              <div className="topbar-title">{viewTitle(activeView)}</div>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {view}
        </div>
        <DebugLog />
      </div>
    </div>
  );
}

function viewTitle(v: string): string {
  const map: Record<string, string> = {
    dashboard: "Dashboard", collection: "Collection", "journey-history": "Journey History",
    "storage-miner": "Storage Insights", settings: "Settings", utilities: "Utilities", analytics: "Analytics",
  };
  return map[v] ?? v;
}
