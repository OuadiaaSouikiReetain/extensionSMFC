import React from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatTs, statusVariant } from "../../../utils/formatters";
import type { CachedItem, CollectionKey } from "../../../store/types";

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

const PRIORITY_FIELDS = [
  "id",
  "customerKey",
  "status",
  "version",
  "lastRunStatus",
  "lastRunTime",
  "assetType",
  "type",
  "capturedAt",
];

export function DetailView() {
  const { activeCollection, activeObjectId, cache, setView } = useAppStore();
  const collection = activeCollection as CollectionKey | null;
  const item = collection
    ? cache[collection]?.find((entry) => String(entry.id || "") === String(activeObjectId || ""))
    : null;

  if (!collection || !item) {
    return (
      <div className="buddy-content">
        <EmptyState
          title="No record selected"
          message="Open a collection and choose an item to inspect its details."
          action={<Button variant="primary" onClick={() => setView("dashboard")}>Back to dashboard</Button>}
        />
      </div>
    );
  }

  const fieldEntries = buildFieldEntries(item);

  return (
    <div className="buddy-content">
      <div className="detail-panel">
        <div className="detail-panel-head">
          <div>
            <div className="topbar-eyebrow">{LABELS[collection]}</div>
            <div className="detail-panel-title">{String(item.name || item.id || "Record")}</div>
            <div className="detail-panel-subtitle">{String(item.customerKey || item.id || "")}</div>
          </div>
          <div className="detail-panel-actions">
            {item.status ? <Badge variant={statusVariant(String(item.status))}>{String(item.status)}</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => setView("collection", collection)}>Back to collection</Button>
          </div>
        </div>

        <div className="detail-grid">
          {fieldEntries.map(([key, value]) => (
            <div key={key} className="detail-stat">
              <div className="detail-stat-label">{prettifyKey(key)}</div>
              <div className="detail-stat-value">{renderValue(key, value)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-header" style={{ marginTop: 18 }}>
        <span className="section-title">Raw payload</span>
      </div>
      <pre className="code-block">{JSON.stringify(item, null, 2)}</pre>
    </div>
  );
}

function buildFieldEntries(item: CachedItem): Array<[string, unknown]> {
  const seen = new Set<string>();
  const entries: Array<[string, unknown]> = [];

  for (const key of PRIORITY_FIELDS) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") {
      entries.push([key, item[key]]);
      seen.add(key);
    }
  }

  Object.entries(item).forEach(([key, value]) => {
    if (seen.has(key)) return;
    if (typeof value === "object" && value !== null) return;
    if (value === undefined || value === null || value === "") return;
    entries.push([key, value]);
  });

  return entries.slice(0, 16);
}

function prettifyKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function renderValue(key: string, value: unknown): string {
  if (key.toLowerCase().includes("time") || key === "capturedAt") {
    return formatTs(value as string | number);
  }
  return String(value);
}
