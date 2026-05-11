import React, { useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { formatNumber, formatIso, statusVariant } from "../../../utils/formatters";
import type { JourneyHistorySearchRequest, JourneyHistoryStatus } from "../../../store/types";

const STATUSES: JourneyHistoryStatus[] = ["Waiting","Running","Completed","Exited","Error","GoalMet"];

export function JourneyHistoryView() {
  const { cache, journeyHistoryResults, journeyHistoryTotal, journeyHistoryLoading, journeyHistoryError, searchJourneyHistory, addLog } = useAppStore();

  const [form, setForm] = useState<JourneyHistorySearchRequest>({
    page: 1, pageSize: 50,
  });

  const journeyOptions = cache.journeys.slice(0, 200);

  function setField<K extends keyof JourneyHistorySearchRequest>(k: K, v: JourneyHistorySearchRequest[K]) {
    setForm(f => ({ ...f, [k]: v || undefined }));
  }

  async function handleSearch() {
    if (!form.journeyId && !form.contactKey) {
      addLog("Journey History: provide at least a Journey ID or Contact Key.");
      return;
    }
    await searchJourneyHistory(form);
  }

  async function handleExportCsv() {
    const header = "contactKey,journeyName,activityName,activityType,status,enteredAt,exitedAt,errorCode";
    const rows = journeyHistoryResults.map(r =>
      [r.contactKey,r.journeyName,r.activityName,r.activityType,r.status,r.enteredAt,r.exitedAt ?? "",r.errorCode ?? ""]
        .map(v => `"${String(v ?? "").replace(/"/g,'""')}"`)
        .join(",")
    );
    await navigator.clipboard.writeText([header, ...rows].join("\n"));
    addLog(`Journey History CSV (${rows.length} rows) copied.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Topbar */}
      <div className="buddy-topbar">
        <div>
          <div className="topbar-eyebrow">API · POST /interaction/v1/interactions/journeyhistory/search</div>
          <div className="topbar-title">Journey History</div>
        </div>
        <div className="topbar-actions">
          {journeyHistoryResults.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleExportCsv}>⬇ CSV</Button>
          )}
        </div>
      </div>

      {/* Search form */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>

          {/* Journey selector */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              Journey ID *
            </label>
            {journeyOptions.length > 0
              ? (
                <select className="select" value={form.journeyId ?? ""} onChange={e => setField("journeyId", e.target.value)}>
                  <option value="">— select —</option>
                  {journeyOptions.map(j => (
                    <option key={String(j.id)} value={String(j.id)}>
                      {String(j.name || j.id)} {j.version ? `v${j.version}` : ""}
                    </option>
                  ))}
                </select>
              )
              : (
                <input className="input" placeholder="Journey ID (UUID)" value={form.journeyId ?? ""}
                  onChange={e => setField("journeyId", e.target.value)} />
              )
            }
          </div>

          {/* Contact Key */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              Contact Key
            </label>
            <input className="input" placeholder="SubscriberKey…" value={form.contactKey ?? ""}
              onChange={e => setField("contactKey", e.target.value)} />
          </div>

          {/* Status */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              Status
            </label>
            <select className="select" value={form.status ?? ""} onChange={e => setField("status", e.target.value as JourneyHistoryStatus)}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Start date */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              Start date
            </label>
            <input className="input" type="datetime-local" value={form.startDate ?? ""}
              onChange={e => setField("startDate", e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </div>

          {/* End date */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              End date
            </label>
            <input className="input" type="datetime-local" value={form.endDate ?? ""}
              onChange={e => setField("endDate", e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </div>

          {/* Activity Key */}
          <div>
            <label style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              Activity Key
            </label>
            <input className="input" placeholder="Activity key…" value={form.activityKey ?? ""}
              onChange={e => setField("activityKey", e.target.value)} />
          </div>
        </div>

        {/* Page size + Search */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".76rem" }}>
            <span style={{ color: "var(--text-secondary)" }}>Page size</span>
            <select className="select" style={{ width: 80 }} value={form.pageSize ?? 50}
              onChange={e => setField("pageSize", Number(e.target.value))}>
              {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <Button variant="primary" loading={journeyHistoryLoading} onClick={handleSearch}>
            🔍 Search history
          </Button>
          {journeyHistoryResults.length > 0 && (
            <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
              {formatNumber(journeyHistoryResults.length)} / {formatNumber(journeyHistoryTotal)} records
            </span>
          )}
        </div>

        {journeyHistoryError && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--danger-surface)", border: "1px solid var(--danger-border)", borderRadius: "var(--radius-md)", fontSize: ".76rem", color: "var(--danger)" }}>
            ⚠ {journeyHistoryError}
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {journeyHistoryResults.length === 0
          ? (
            <EmptyState
              icon="🕐"
              title="No history yet"
              message="Fill in the search form and click Search. You need an active SFMC tab."
            />
          )
          : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Contact Key</th>
                  <th>Journey</th>
                  <th>Activity</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Entered at</th>
                  <th>Exited at</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {journeyHistoryResults.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.contactKey ?? "—"}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.journeyName ?? "—"}</div>
                      {r.versionNumber != null && (
                        <div style={{ fontSize: ".68rem", color: "var(--text-muted)" }}>v{r.versionNumber}</div>
                      )}
                    </td>
                    <td>{r.activityName ?? "—"}</td>
                    <td>
                      {r.activityType && (
                        <Badge variant="brand">{r.activityType}</Badge>
                      )}
                    </td>
                    <td>
                      <Badge variant={historyStatusVariant(r.status)}>{r.status ?? "—"}</Badge>
                    </td>
                    <td className="mono" style={{ fontSize: ".7rem" }}>{formatIso(r.enteredAt)}</td>
                    <td className="mono" style={{ fontSize: ".7rem" }}>{r.exitedAt ? formatIso(r.exitedAt) : "—"}</td>
                    <td>
                      {r.errorCode
                        ? <span title={r.errorMessage ?? ""} style={{ color: "var(--danger)", fontSize: ".72rem" }}>{r.errorCode}</span>
                        : "—"
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}

function historyStatusVariant(s: string | undefined) {
  const v = statusVariant(s);
  if (s === "GoalMet") return "success" as const;
  if (s === "Error")   return "danger"  as const;
  if (s === "Exited")  return "neutral" as const;
  return v;
}
