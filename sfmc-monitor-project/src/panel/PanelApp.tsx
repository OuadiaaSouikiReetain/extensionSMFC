import React, { useEffect, useReducer, useCallback } from "react";
import { StatusDot } from "../components/common/StatusDot";
import { Badge } from "../components/common/Badge";
import { Button } from "../components/common/Button";
import { EmptyState } from "../components/common/EmptyState";
import { formatNumber, statusVariant } from "../utils/formatters";
import type { Journey, JourneyListItem, SfmcSession, TabState } from "../store/types";

const BOTTLENECK_THRESHOLD = 20;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

interface State {
  session: SfmcSession | null;
  journeysData: Record<string, Journey>;
  journeyList: JourneyListItem[];
  canvas: TabState["canvas"] | null;
  selectedJourneyId: string | null;
  requestCount: number;
  logs: string[];
}

type Action =
  | { type: "SET_SESSION"; session: SfmcSession | null }
  | { type: "SET_JOURNEY"; journey: Journey }
  | { type: "SET_JOURNEY_LIST"; list: JourneyListItem[] }
  | { type: "SET_CANVAS"; canvas: TabState["canvas"] }
  | { type: "SELECT_JOURNEY"; id: string }
  | { type: "INC_REQUESTS" }
  | { type: "ADD_LOG"; line: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_SESSION": return { ...state, session: action.session };
    case "SET_JOURNEY": {
      const journeysData = { ...state.journeysData, [action.journey.id]: action.journey };
      return { ...state, journeysData, selectedJourneyId: state.selectedJourneyId ?? action.journey.id };
    }
    case "SET_JOURNEY_LIST": return { ...state, journeyList: action.list };
    case "SET_CANVAS": return { ...state, canvas: action.canvas };
    case "SELECT_JOURNEY": return { ...state, selectedJourneyId: action.id };
    case "INC_REQUESTS": return { ...state, requestCount: state.requestCount + 1 };
    case "ADD_LOG": return { ...state, logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${action.line}`].slice(-80) };
    default: return state;
  }
}

function normalizeJourney(raw: Record<string, unknown>): Journey | null {
  if (!raw?.id || !Array.isArray(raw.activities)) return null;
  return {
    id: raw.id as string,
    key: (raw.key ?? raw.definitionId ?? null) as string | null,
    name: (raw.name ?? "Journey") as string,
    version: (raw.version ?? raw.versionNumber ?? null) as string | null,
    activities: raw.activities as Journey["activities"],
    stats: (raw.stats ?? {}) as Record<string, unknown>,
    goals: (raw.goals ?? []) as unknown[],
    raw,
    capturedAt: Date.now(),
  };
}

export function PanelApp() {
  const [state, dispatch] = useReducer(reducer, {
    session: null, journeysData: {}, journeyList: [], canvas: null,
    selectedJourneyId: null, requestCount: 0, logs: [],
  });

  const log = useCallback((line: string) => dispatch({ type: "ADD_LOG", line }), []);

  // Detect session
  useEffect(() => {
    chrome.tabs.get(inspectedTabId, tab => {
      const url = tab?.url;
      if (!url) { dispatch({ type: "SET_SESSION", session: null }); return; }
      const session = parseSfmcSession(url);
      dispatch({ type: "SET_SESSION", session });
      if (session.isSfmc) chrome.runtime.sendMessage({ type: "PANEL_UPDATE_SESSION", tabId: inspectedTabId, session });
      log(session.isSfmc ? `SFMC session detected. Stack: ${session.stack ?? "unknown"}` : "Not an SFMC tab.");
    });
  }, []);

  // Restore saved state
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PANEL_GET_STATE", tabId: inspectedTabId }, res => {
      const saved = res?.state as TabState | null;
      if (!saved) return;
      if (saved.journeys) Object.values(saved.journeys).forEach(j => dispatch({ type: "SET_JOURNEY", journey: j }));
      if (saved.journeyList) dispatch({ type: "SET_JOURNEY_LIST", list: saved.journeyList });
      if (saved.canvas) dispatch({ type: "SET_CANVAS", canvas: saved.canvas });
    });
  }, []);

  // Storage live-sync
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes.sfmcProcessMinerState) return;
      const tabState = changes.sfmcProcessMinerState.newValue?.tabs?.[String(inspectedTabId)] as TabState;
      if (!tabState) return;
      if (tabState.journeys) Object.values(tabState.journeys).forEach(j => dispatch({ type: "SET_JOURNEY", journey: j }));
      if (tabState.journeyList) dispatch({ type: "SET_JOURNEY_LIST", list: tabState.journeyList });
      if (tabState.canvas) dispatch({ type: "SET_CANVAS", canvas: tabState.canvas });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Network listener (DevTools API)
  useEffect(() => {
    const handler = (request: chrome.devtools.network.Request) => {
      const url = request.request?.url ?? "";
      if (!/\/interaction\/v1\/interactions/i.test(url) || !/marketingcloudapis|exacttargetapis|marketingcloudapps/i.test(url)) return;
      dispatch({ type: "INC_REQUESTS" });
      log(`Network: ${request.request.method} ${url.split("?")[0].slice(-60)}`);
      request.getContent((content, encoding) => {
        if (!content) return;
        try {
          const text = encoding === "base64" ? atob(content) : content;
          const json = JSON.parse(text) as Record<string, unknown>;
          if (Array.isArray(json?.items)) {
            dispatch({ type: "SET_JOURNEY_LIST", list: json.items as JourneyListItem[] });
            chrome.runtime.sendMessage({ type: "PANEL_STORE_JOURNEY_LIST", tabId: inspectedTabId, journeys: json.items });
            log(`${(json.items as unknown[]).length} journeys in list`);
          }
          const journey = normalizeJourney(json);
          if (journey) {
            dispatch({ type: "SET_JOURNEY", journey });
            chrome.runtime.sendMessage({ type: "PANEL_STORE_JOURNEY", tabId: inspectedTabId, journey });
            log(`Journey captured: ${journey.name} v${journey.version ?? "--"}`);
          }
        } catch { /* non-JSON */ }
      });
    };
    chrome.devtools.network.onRequestFinished.addListener(handler);
    return () => chrome.devtools.network.onRequestFinished.removeListener(handler);
  }, []);

  const journey = state.selectedJourneyId
    ? state.journeysData[state.selectedJourneyId]
    : Object.values(state.journeysData)[0] ?? null;

  const mining = journey ? mineJourney(journey) : null;

  return (
    <div className="panel-shell">
      {/* Main */}
      <div className="panel-main">
        {/* Session */}
        <div className="session-card">
          <StatusDot status={state.session?.isSfmc ? "ok" : "bad"} />
          <div className="session-info">
            <div className="session-title">{state.session?.isSfmc ? "SFMC session detected" : "No SFMC session"}</div>
            <div className="session-subtitle">
              {state.session?.isSfmc
                ? `Stack: ${state.session.stack ?? "unknown"} · REST: ${state.session.restBase ?? "capturing…"}`
                : "Open a Journey Builder tab and reload."
              }
            </div>
          </div>
          <span style={{ fontSize: ".7rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {state.requestCount} req
          </span>
        </div>

        {/* Journey header */}
        {journey ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: ".9rem", fontWeight: 700 }}>{journey.name}</div>
              <div style={{ fontSize: ".72rem", color: "var(--text-secondary)", marginTop: 2 }}>
                Version {journey.version ?? "--"} · {journey.activities.length} activities
              </div>
            </div>

            {/* KPI row */}
            {mining && (
              <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
                <div className="metric-card brand">
                  <div className="metric-label">Entered</div>
                  <div className="metric-value">{formatNumber(mining.totalEntered)}</div>
                </div>
                <div className="metric-card success">
                  <div className="metric-label">Completed</div>
                  <div className="metric-value">{formatNumber(mining.totalCompleted)}</div>
                </div>
                <div className={`metric-card ${mining.completionRate < 50 ? "warning" : "success"}`}>
                  <div className="metric-label">Completion</div>
                  <div className="metric-value">{Math.round(mining.completionRate)}%</div>
                </div>
                <div className={`metric-card ${mining.bottlenecks > 0 ? "danger" : "success"}`}>
                  <div className="metric-label">Bottlenecks</div>
                  <div className="metric-value">{mining.bottlenecks}</div>
                </div>
              </div>
            )}

            {/* Funnel */}
            {mining && <Funnel mining={mining} />}

            {/* Analysis */}
            {mining && <Analysis mining={mining} />}
          </>
        ) : (
          <EmptyState icon="🗺" title="No journey captured" message="Open or refresh a Journey in Journey Builder." />
        )}
      </div>

      {/* Sidebar */}
      <div className="panel-sidebar">
        <div className="panel-section-title">Journeys ({state.journeyList.length})</div>
        {state.journeyList.length === 0
          ? <div style={{ fontSize: ".74rem", color: "var(--text-muted)" }}>None yet.</div>
          : state.journeyList.slice(0, 15).map(j => (
            <div key={j.id} onClick={() => {
              if (state.journeysData[j.id]) dispatch({ type: "SELECT_JOURNEY", id: j.id });
            }} style={{
              padding: "7px 10px", marginBottom: 3, borderRadius: "var(--radius-md)",
              background: state.selectedJourneyId === j.id ? "var(--brand-surface)" : "var(--bg-elevated)",
              border: `1px solid ${state.selectedJourneyId === j.id ? "var(--border-focus)" : "var(--border-subtle)"}`,
              cursor: "pointer", fontSize: ".76rem",
            }}>
              <div style={{ fontWeight: 500 }}>{j.name ?? j.id}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                <span style={{ fontSize: ".65rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>v{j.version ?? "--"}</span>
                {j.status && <Badge variant={statusVariant(j.status)}>{j.status}</Badge>}
              </div>
            </div>
          ))
        }

        <div className="divider" />
        <div className="panel-section-title">Canvas DOM ({state.canvas?.activities?.length ?? 0})</div>
        {(state.canvas?.activities ?? []).slice(0, 10).map(a => (
          <div key={a.key} style={{ fontSize: ".72rem", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between" }}>
            <span>{a.name}</span>
            <Badge variant="neutral">{a.type}</Badge>
          </div>
        ))}

        <div className="divider" />
        <div className="panel-section-title">Network log</div>
        <pre className="debug-log" style={{ fontSize: ".64rem", maxHeight: 160 }}>{state.logs.join("\n")}</pre>
      </div>
    </div>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────

interface MiningResult {
  steps: MiningStep[];
  totalEntered: number;
  totalCompleted: number;
  completionRate: number;
  bottlenecks: number;
  maxRelativeDrop: MiningStep | null;
}

interface MiningStep {
  id: string; name: string; type: string;
  contactsIn: number; contactsOut: number; contactsError: number;
  dropCount: number; dropRate: number; isBottleneck: boolean;
  severity: "green" | "orange" | "red";
}

function mineJourney(journey: Journey): MiningResult {
  const steps: MiningStep[] = journey.activities.map((a, i) => {
    const s = a.stats ?? {};
    const contactsIn  = Number(s.contactsIn ?? (s.currentPopulation as Record<string,unknown>)?.count ?? s.entered ?? 0);
    const contactsOut = Number(s.contactsOut ?? s.contactsMet ?? s.completed ?? contactsIn);
    const contactsError = Number(s.contactsError ?? 0);
    const dropCount = Math.max(0, contactsIn - contactsOut);
    const dropRate  = contactsIn ? (dropCount / contactsIn) * 100 : 0;
    return {
      id: String(a.id ?? a.key ?? `a-${i}`),
      name: a.name ?? a.key ?? `Activity ${i + 1}`,
      type: a.type ?? "UNKNOWN",
      contactsIn, contactsOut, contactsError,
      dropCount, dropRate,
      isBottleneck: dropRate > BOTTLENECK_THRESHOLD,
      severity: dropRate > 30 ? "red" : dropRate >= 10 ? "orange" : "green",
    } as MiningStep;
  });

  const js = journey.stats as Record<string, unknown>;
  const totalEntered   = Number(js.totalContactsEntered   ?? steps[0]?.contactsIn ?? 0);
  const totalCompleted = Number(js.totalContactsCompleted ?? js.totalContactsExited ?? steps.at(-1)?.contactsOut ?? 0);
  const completionRate = totalEntered ? (totalCompleted / totalEntered) * 100 : 0;
  const maxRelativeDrop = [...steps].sort((a, b) => b.dropRate - a.dropRate)[0] ?? null;
  const bottlenecks = steps.filter(s => s.isBottleneck).length;

  return { steps, totalEntered, totalCompleted, completionRate, bottlenecks, maxRelativeDrop };
}

function Funnel({ mining }: { mining: MiningResult }) {
  const max = Math.max(mining.totalEntered, ...mining.steps.map(s => s.contactsIn), 1);
  return (
    <div className="funnel" style={{ marginBottom: 14 }}>
      {/* Entry */}
      <div className="funnel-step">
        <div className="step-head">
          <div className="step-title">Journey Entry <span className="step-type">ENTRY</span></div>
          <div className="step-count">{formatNumber(mining.totalEntered)} · 100%</div>
        </div>
        <div className="bar-track"><div className="bar-fill green" style={{ "--bar-width": "100%" } as React.CSSProperties} /></div>
      </div>

      {mining.steps.map(step => {
        const pct = Math.round((step.contactsIn / max) * 100);
        return (
          <React.Fragment key={step.id}>
            {step.dropCount > 0 && (
              <div className={`drop-line ${step.severity === "red" ? "critical" : step.severity === "orange" ? "warning" : ""}`}>
                ↓ -{formatNumber(step.dropCount)} ({Math.round(step.dropRate)}%)
                {step.dropRate > 30 ? " — DROP CRITIQUE" : step.isBottleneck ? " — BOTTLENECK" : ""}
                {step.contactsError > 0 && ` · ${formatNumber(step.contactsError)} errors`}
              </div>
            )}
            <div className="funnel-step">
              <div className="step-head">
                <div className="step-title">
                  {step.name}
                  <span className="step-type">{step.type}</span>
                  {step.contactsError > 0 && <Badge variant="danger">{step.contactsError} err</Badge>}
                </div>
                <div className="step-count">{formatNumber(step.contactsIn)} · {pct}%</div>
              </div>
              <div className="bar-track">
                <div className={`bar-fill ${step.severity}`} style={{ "--bar-width": `${Math.max(3, pct)}%` } as React.CSSProperties} />
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Analysis({ mining }: { mining: MiningResult }) {
  const c = mining.maxRelativeDrop;
  if (!c?.dropCount) return null;

  const suggestions: string[] = c.type.toUpperCase().includes("EMAIL")
    ? ["Check open/click rate on this email.", "Review subject line and sender.", "Verify bounces in Data Views."]
    : c.type.toUpperCase().includes("WAIT")
      ? ["Wait duration may be too long.", "Contacts may have met goal before this step.", "Check exit criteria."]
      : c.type.toUpperCase().includes("SPLIT")
        ? ["Verify decision split conditions.", "One path may be misconfigured.", "Some contacts may match no condition."]
        : ["Compare with SFMC tracking data.", "Check activity errors and Journey Builder exits.", "Review entry, suppression, and goal criteria."];

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">📊 Analysis</span></div>
      <div className="card-body" style={{ fontSize: ".78rem" }}>
        <strong>Largest relative drop: {c.name}</strong>
        <span style={{ color: "var(--danger)", marginLeft: 6 }}>-{Math.round(c.dropRate)}% ({formatNumber(c.dropCount)} contacts)</span>
        <ul style={{ marginTop: 8, paddingLeft: 16, lineHeight: 1.8 }}>
          {suggestions.map(s => <li key={s}>{s}</li>)}
        </ul>
      </div>
    </div>
  );
}

function parseSfmcSession(rawUrl: string): SfmcSession {
  try {
    const url = new URL(rawUrl);
    const isSfmc = /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com/i.test(url.hostname);
    const stackMatch = url.hostname.match(/mc\.s(\d+)\.exacttarget\.com/i) ?? url.hostname.match(/\.s(\d+)\./i);
    const stack = stackMatch ? `s${stackMatch[1]}` : null;
    const restBase = stack ? `https://${stack}.rest.marketingcloudapis.com` : null;
    return { isSfmc, url: rawUrl, host: url.hostname, stack, subdomain: stack, restBase };
  } catch {
    return { isSfmc: false, url: rawUrl, host: null, stack: null, subdomain: null, restBase: null };
  }
}
