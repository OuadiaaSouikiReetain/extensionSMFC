import React, { useEffect, useReducer } from "react";
import { Badge } from "../components/common/Badge";
import { StatusDot } from "../components/common/StatusDot";
import { Button } from "../components/common/Button";

interface Activity {
  key: string;
  name: string;
  type: string;
  sent?: number;
  opens?: number;
  clicks?: number;
  bounces?: number;
  exits?: number;
}

interface JourneyDetail {
  id: string;
  name: string;
  status: string;
  version: number;
  entryCount: number;
  goalCount: number;
  exitCount: number;
  activities: Activity[];
  createdDate?: string;
  modifiedDate?: string;
  description?: string;
}

interface State {
  journey: JourneyDetail | null;
  loading: boolean;
  error: string | null;
  networkLogs: { ts: number; method: string; url: string; status: number }[];
  activeTab: "overview" | "activities" | "network";
}

type Action =
  | { type: "SET_JOURNEY"; payload: JourneyDetail }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string }
  | { type: "ADD_LOG"; payload: { ts: number; method: string; url: string; status: number } }
  | { type: "SET_TAB"; payload: State["activeTab"] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_JOURNEY":  return { ...state, journey: action.payload, loading: false, error: null };
    case "SET_LOADING":  return { ...state, loading: action.payload };
    case "SET_ERROR":    return { ...state, error: action.payload, loading: false };
    case "ADD_LOG":      return { ...state, networkLogs: [action.payload, ...state.networkLogs].slice(0, 100) };
    case "SET_TAB":      return { ...state, activeTab: action.payload };
    default:             return state;
  }
}

function statusColor(s: string): "green" | "yellow" | "red" | "neutral" {
  const m: Record<string, "green" | "yellow" | "red" | "neutral"> = {
    Active: "green", Draft: "yellow", Stopped: "red", Completed: "green",
    Paused: "yellow", Error: "red",
  };
  return m[s] ?? "neutral";
}

function fmtNum(n?: number) {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtDate(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function pct(a?: number, b?: number) {
  if (!a || !b) return "—";
  return `${((a / b) * 100).toFixed(1)}%`;
}

export function JourneyDetailApp() {
  const [state, dispatch] = useReducer(reducer, {
    journey: null,
    loading: true,
    error: null,
    networkLogs: [],
    activeTab: "overview",
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const journeyId = params.get("journeyId");
    if (!journeyId) {
      dispatch({ type: "SET_ERROR", payload: "No journeyId in URL." });
      return;
    }

    // Request journey data from background
    chrome.runtime.sendMessage({ type: "GET_JOURNEY_DETAIL", journeyId }, (resp) => {
      if (chrome.runtime.lastError || !resp?.journey) {
        dispatch({ type: "SET_ERROR", payload: chrome.runtime.lastError?.message ?? "Journey not found." });
        return;
      }
      dispatch({ type: "SET_JOURNEY", payload: resp.journey });
    });

    // Listen for live network events
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "JOURNEY_DETAIL_LOG" && msg.journeyId === journeyId) {
        dispatch({ type: "ADD_LOG", payload: msg.log });
      }
    });
  }, []);

  const { journey, loading, error, networkLogs, activeTab } = state;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--text-muted)", fontSize: ".9rem" }}>
      Loading journey…
    </div>
  );

  if (error) return (
    <div style={{ padding: 32, color: "var(--red)" }}>
      <strong>Error:</strong> {error}
    </div>
  );

  if (!journey) return null;

  const openRate  = pct(journey.activities.reduce((s, a) => s + (a.opens ?? 0), 0), journey.entryCount);
  const clickRate = pct(journey.activities.reduce((s, a) => s + (a.clicks ?? 0), 0), journey.entryCount);
  const exitRate  = pct(journey.exitCount, journey.entryCount);

  return (
    <div className="buddy-shell" style={{ minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "var(--bg-sidebar)", color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={() => window.close()}
          style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: ".8rem" }}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: ".7rem", opacity: .6, textTransform: "uppercase", letterSpacing: ".06em" }}>Journey Detail</div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{journey.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot status={statusColor(journey.status)} />
          <span style={{ fontSize: ".8rem", opacity: .85 }}>{journey.status}</span>
          <Badge variant="neutral" style={{ marginLeft: 4 }}>v{journey.version}</Badge>
        </div>
      </div>

      <div className="buddy-main" style={{ padding: 0 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
          {(["overview", "activities", "network"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => dispatch({ type: "SET_TAB", payload: tab })}
              style={{
                padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
                fontSize: ".82rem", fontWeight: activeTab === tab ? 700 : 400,
                color: activeTab === tab ? "var(--brand)" : "var(--text-muted)",
                borderBottom: activeTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* KPI row */}
              <div className="responsive-grid-4">
                {[
                  { label: "Entries",    value: fmtNum(journey.entryCount) },
                  { label: "Goals Met",  value: fmtNum(journey.goalCount) },
                  { label: "Exited",     value: fmtNum(journey.exitCount) },
                  { label: "Activities", value: String(journey.activities.length) },
                ].map(({ label, value }) => (
                  <div key={label} className="card" style={{ padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand)" }}>{value}</div>
                    <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Rate row */}
              <div className="responsive-grid-3">
                {[
                  { label: "Open Rate",  value: openRate },
                  { label: "Click Rate", value: clickRate },
                  { label: "Exit Rate",  value: exitRate },
                ].map(({ label, value }) => (
                  <div key={label} className="card" style={{ padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Meta */}
              <div className="card">
                <div className="card-header"><span className="card-title">Journey Info</span></div>
                <div className="card-body">
                  <div className="table-scroll">
                    <table style={{ width: "100%", fontSize: ".8rem", borderCollapse: "collapse", minWidth: 420 }}>
                      <tbody>
                        {[
                          ["ID",       journey.id],
                          ["Created",  fmtDate(journey.createdDate)],
                          ["Modified", fmtDate(journey.modifiedDate)],
                          ["Description", journey.description ?? "—"],
                        ].map(([k, v]) => (
                          <tr key={k} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "6px 8px", color: "var(--text-muted)", width: 120 }}>{k}</td>
                            <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVITIES TAB */}
          {activeTab === "activities" && (
            <div className="card">
              <div className="card-header"><span className="card-title">Activities ({journey.activities.length})</span></div>
              <div className="card-body" style={{ padding: 0 }}>
                <div className="table-scroll">
                  <table style={{ width: "100%", minWidth: 720, fontSize: ".78rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-elevated)" }}>
                      {["Name", "Type", "Sent", "Opens", "Clicks", "Bounces", "Exits"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {journey.activities.map((a, i) => (
                      <tr key={a.key} style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)", borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "7px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</td>
                        <td style={{ padding: "7px 10px" }}><Badge variant={a.type === "EMAIL" ? "blue" : "neutral"}>{a.type}</Badge></td>
                        <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(a.sent)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(a.opens)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(a.clicks)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(a.bounces)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)" }}>{fmtNum(a.exits)}</td>
                      </tr>
                    ))}
                    {journey.activities.length === 0 && (
                      <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>No activities found.</td></tr>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* NETWORK TAB */}
          {activeTab === "network" && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Network Log ({networkLogs.length})</span>
                <div className="card-actions">
                  <Button variant="ghost" size="sm" onClick={async () => {
                    await navigator.clipboard.writeText(JSON.stringify(networkLogs, null, 2));
                  }}>Copy JSON</Button>
                </div>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <div className="table-scroll">
                  <table style={{ width: "100%", minWidth: 720, fontSize: ".75rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-elevated)" }}>
                      {["Time", "Method", "Status", "URL"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border-subtle)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {networkLogs.map((log, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "5px 10px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{new Date(log.ts).toLocaleTimeString()}</td>
                        <td style={{ padding: "5px 10px" }}><Badge variant="neutral">{log.method}</Badge></td>
                        <td style={{ padding: "5px 10px", fontFamily: "var(--font-mono)", color: log.status >= 400 ? "var(--red)" : "var(--green)" }}>{log.status}</td>
                        <td style={{ padding: "5px 10px", fontFamily: "var(--font-mono)", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.url}>{log.url}</td>
                      </tr>
                    ))}
                    {networkLogs.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>No network activity captured yet.</td></tr>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
