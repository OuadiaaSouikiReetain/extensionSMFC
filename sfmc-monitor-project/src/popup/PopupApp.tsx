import React, { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { Sidebar } from "../components/layout/Sidebar";
import { DashboardView } from "../components/popup/views/DashboardView";
import { CollectionView } from "../components/popup/views/CollectionView";
import { DetailView } from "../components/popup/views/DetailView";
import { AnalyticsView } from "../components/popup/views/AnalyticsView";
import { JourneyHistoryView } from "../components/popup/views/JourneyHistoryView";
import { StorageMinerView } from "../components/popup/views/StorageMinerView";
import { SettingsView } from "../components/popup/views/SettingsView";
import { UtilitiesView } from "../components/popup/views/UtilitiesView";
import { RulesView } from "../components/popup/views/RulesView";

function DebugLog() {
  const logs = useAppStore((state) => state.logs);
  if (!logs.length) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
      <pre className="debug-log">{logs.join("\n")}</pre>
    </div>
  );
}

export function PopupApp() {
  const { activeView, loadAll } = useAppStore();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const view = (() => {
    switch (activeView) {
      case "dashboard":
        return <DashboardView />;
      case "collection":
        return <CollectionView />;
      case "detail":
        return <DetailView />;
      case "analytics":
        return <AnalyticsView />;
      case "journey-history":
        return <JourneyHistoryView />;
      case "storage-miner":
        return <StorageMinerView />;
      case "settings":
        return <SettingsView />;
      case "utilities":
        return <UtilitiesView />;
      case "rules":
        return <RulesView />;
      default:
        return <DashboardView />;
    }
  })();

  const chromeHandledView = activeView === "collection" || activeView === "detail" || activeView === "journey-history";

  return (
    <div className="buddy-shell">
      <Sidebar />
      <div className="buddy-main">
        {!chromeHandledView ? (
          <div className="buddy-topbar">
            <div>
              <div className="topbar-eyebrow">Sezane Monitoring</div>
              <div className="topbar-title">{viewTitle(activeView)}</div>
            </div>
          </div>
        ) : null}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {view}
        </div>
        <DebugLog />
      </div>
    </div>
  );
}

function viewTitle(view: string): string {
  const map: Record<string, string> = {
    dashboard: "Dashboard",
    collection: "Collection",
    detail: "Details",
    analytics: "Analytics",
    "journey-history": "Journey History",
    "storage-miner": "Storage Insights",
    rules: "Alert Rules",
    settings: "Settings",
    utilities: "Utilities",
  };
  return map[view] ?? view;
}
