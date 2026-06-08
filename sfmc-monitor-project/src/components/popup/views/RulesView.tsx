import React, { useMemo, useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import { Badge } from "../../common/Badge";
import { EmptyState } from "../../common/EmptyState";
import { relativeTime } from "../../../utils/formatters";
import type { AlertRule, RuleMetric, RuleOperator } from "../../../store/types";

const METRICS: { value: RuleMetric; label: string; isRate: boolean }[] = [
  { value: "bounceRate", label: "Bounce rate", isRate: true },
  { value: "openRate", label: "Open rate", isRate: true },
  { value: "clickRate", label: "Click rate", isRate: true },
  { value: "unsubRate", label: "Unsub rate", isRate: true },
  { value: "deliveryRate", label: "Delivery rate", isRate: true },
  { value: "bounces", label: "Bounces", isRate: false },
  { value: "sent", label: "Sent", isRate: false },
  { value: "delivered", label: "Delivered", isRate: false },
  { value: "opens", label: "Opens", isRate: false },
  { value: "clicks", label: "Clicks", isRate: false },
  { value: "unsubs", label: "Unsubscribes", isRate: false },
];
const OPERATORS: RuleOperator[] = [">", ">=", "<", "<=", "=="];

function metricMeta(metric: RuleMetric) {
  return METRICS.find((m) => m.value === metric) ?? METRICS[0];
}
function ruleSummary(rule: AlertRule, journeyName: string): string {
  const m = metricMeta(rule.metric);
  const thr = m.isRate ? `${rule.threshold}%` : rule.threshold;
  return `${journeyName}: ${m.label} ${rule.operator} ${thr}`;
}
function newId(): string {
  try { return crypto.randomUUID(); } catch { return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
}

export function RulesView() {
  const {
    rules, alertSettings, ruleViolations, ruleCheckedAt, cache, loading,
    saveRule, deleteRule, toggleRule, saveAlertSettings, checkRules, sendTestAlert, runRuleNow,
  } = useAppStore();

  const journeys = cache.journeys ?? [];
  const journeyName = (id: string) =>
    id === "all" ? "All journeys" : (journeys.find((j) => String(j.id) === id)?.name as string) || id;

  // ── New-rule form state ──
  const [name, setName] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [metric, setMetric] = useState<RuleMetric>("bounceRate");
  const [operator, setOperator] = useState<RuleOperator>(">");
  const [threshold, setThreshold] = useState("5");
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);

  const isRate = metricMeta(metric).isRate;

  const violationsByRule = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of ruleViolations) map.set(v.ruleId, (map.get(v.ruleId) ?? 0) + 1);
    return map;
  }, [ruleViolations]);

  const handleAdd = async () => {
    const num = Number(threshold);
    if (!name.trim() || !Number.isFinite(num) || adding) return;
    setAdding(true);
    try {
      // saveRule fetches missing KPIs for the scope, evaluates, and alerts immediately.
      await saveRule({
        id: newId(),
        name: name.trim(),
        scope,
        metric,
        operator,
        threshold: num,
        enabled: true,
        createdAt: Date.now(),
      });
      setName("");
      setThreshold("5");
    } finally {
      setAdding(false);
    }
  };

  const handleRunRule = async (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule || runningRuleId) return;
    setRunningRuleId(ruleId);
    try { await runRuleNow(rule); } finally { setRunningRuleId(null); }
  };

  const handleCheck = async () => { setChecking(true); try { await checkRules(); } finally { setChecking(false); } };
  const handleTest = async () => { setTesting(true); try { await sendTestAlert(); } finally { setTesting(false); } };

  const set = (patch: Parameters<typeof saveAlertSettings>[0]) => void saveAlertSettings(patch);
  const emailjsReady = !!(alertSettings.emailjsServiceId && alertSettings.emailjsTemplateId && alertSettings.emailjsPublicKey);

  return (
    <div className="buddy-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Header ── */}
      <div className="section-header">
        <span className="section-title">KPI Alert Rules</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ruleCheckedAt > 0 && <span className="text-muted" style={{ fontSize: ".68rem" }}>Checked {relativeTime(ruleCheckedAt)}</span>}
          <Button variant="secondary" size="sm" loading={checking || loading} onClick={handleCheck}>Check now</Button>
        </div>
      </div>

      {/* ── Active violations ── */}
      {ruleViolations.length > 0 && (
        <div className="card" style={{ borderColor: "var(--danger-border)" }}>
          <div className="card-header" style={{ background: "var(--danger-surface)" }}>
            <span className="card-title" style={{ color: "var(--danger)" }}>
              {ruleViolations.length} active violation{ruleViolations.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px" }}>
            {ruleViolations.map((v, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".78rem" }}>
                <Badge variant="danger">{metricMeta(v.metric).label}</Badge>
                <span style={{ fontWeight: 600 }}>{v.journeyName}</span>
                <span className="text-muted">
                  {metricMeta(v.metric).label} = {metricMeta(v.metric).isRate ? `${Math.round(v.actual * 100) / 100}%` : Math.round(v.actual)}
                  {" "}(rule: {v.operator} {metricMeta(v.metric).isRate ? `${v.threshold}%` : v.threshold})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add rule ── */}
      <div className="card">
        <div className="card-header"><span className="card-title">New rule</span></div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="settings-field">
            <label className="settings-label">Rule name</label>
            <input className="input" placeholder="e.g. High bounce rate" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="responsive-form-grid">
            <div className="settings-field">
              <label className="settings-label">Journey</label>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">All journeys</option>
                {journeys.map((j) => (
                  <option key={String(j.id)} value={String(j.id)}>{String(j.name || j.id)}</option>
                ))}
              </select>
            </div>
            <div className="settings-field">
              <label className="settings-label">Metric</label>
              <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as RuleMetric)}>
                {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}{m.isRate ? " (%)" : ""}</option>)}
              </select>
            </div>
            <div className="settings-field">
              <label className="settings-label">Condition</label>
              <select className="select" value={operator} onChange={(e) => setOperator(e.target.value as RuleOperator)}>
                {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
            </div>
            <div className="settings-field">
              <label className="settings-label">Threshold{isRate ? " (%)" : ""}</label>
              <input className="input" type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
            {adding && <span className="text-muted" style={{ fontSize: ".7rem" }}>Fetching KPIs &amp; evaluating…</span>}
            <Button variant="primary" size="sm" onClick={() => void handleAdd()} disabled={!name.trim()} loading={adding}>
              Add &amp; check now
            </Button>
          </div>
        </div>
      </div>

      {/* ── Existing rules ── */}
      <div className="card">
        <div className="card-header"><span className="card-title">Rules ({rules.length})</span></div>
        <div className="card-body" style={{ padding: rules.length ? 0 : undefined }}>
          {rules.length === 0 ? (
            <EmptyState title="No rules yet" message="Add a rule above to start monitoring journey KPIs." />
          ) : (
            rules.map((rule) => {
              const breaches = violationsByRule.get(rule.id) ?? 0;
              return (
                <div key={rule.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      {rule.name}
                      {breaches > 0 && <Badge variant="danger">{breaches} breach{breaches === 1 ? "" : "es"}</Badge>}
                    </div>
                    <div className="text-muted" style={{ fontSize: ".72rem", marginTop: 2 }}>
                      {ruleSummary(rule, journeyName(rule.scope))}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    loading={runningRuleId === rule.id}
                    onClick={() => void handleRunRule(rule.id)}
                  >
                    Run
                  </Button>
                  <button
                    className={`badge ${rule.enabled ? "badge-success" : "badge-neutral"}`}
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => void toggleRule(rule.id)}
                    title="Toggle rule"
                  >
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <Button variant="ghost" size="xs" onClick={() => void deleteRule(rule.id)}>Delete</Button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Alert delivery settings ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Alert delivery</span>
          <div className="card-actions">
            <Button variant="secondary" size="sm" loading={testing} onClick={handleTest}>Send test</Button>
          </div>
        </div>
        <div className="card-body settings-stack">
          <div className="settings-field">
            <label className="settings-label">Recipient email</label>
            <input
              className="input"
              type="email"
              value={alertSettings.recipient}
              onChange={(e) => set({ recipient: e.target.value })}
              placeholder="you@company.com"
            />
          </div>
          <p className="text-muted" style={{ fontSize: ".7rem", margin: 0 }}>
            Emails are sent via FormSubmit by default — no account needed. The very first send delivers a
            one-time <b>activation email</b> to this address: click its confirm link, then send again.
          </p>

          <div className="divider" />
          <div className="settings-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Optional: EmailJS {emailjsReady ? <Badge variant="success">Configured</Badge> : <Badge variant="neutral">Not set</Badge>}
          </div>
          <p className="text-muted" style={{ fontSize: ".7rem", margin: 0 }}>
            Alternative sender (custom from-address, templates). Create a free account at emailjs.com and paste the
            three values — leave empty to keep using FormSubmit.
          </p>
          <div className="responsive-form-grid">
            <div className="settings-field">
              <label className="settings-label">Service ID</label>
              <input className="input" value={alertSettings.emailjsServiceId} onChange={(e) => set({ emailjsServiceId: e.target.value })} />
            </div>
            <div className="settings-field">
              <label className="settings-label">Template ID</label>
              <input className="input" value={alertSettings.emailjsTemplateId} onChange={(e) => set({ emailjsTemplateId: e.target.value })} />
            </div>
            <div className="settings-field">
              <label className="settings-label">Public key</label>
              <input className="input" value={alertSettings.emailjsPublicKey} onChange={(e) => set({ emailjsPublicKey: e.target.value })} />
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: ".68rem", margin: 0 }}>
            Template should accept variables: <code>to_email</code>, <code>subject</code>, <code>message</code>.
          </p>

          <div className="divider" />
          <div className="settings-field">
            <label className="settings-label">Or webhook URL (Zapier / Make / custom — POST JSON)</label>
            <input className="input" value={alertSettings.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://hooks.zapier.com/..." />
          </div>

          <div className="divider" />
          <div className="responsive-form-grid">
            <label className="settings-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={alertSettings.notifyDesktop} onChange={(e) => set({ notifyDesktop: e.target.checked })} />
              <span className="settings-label" style={{ margin: 0 }}>Desktop notification</span>
            </label>
            <label className="settings-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={alertSettings.checkOnSync} onChange={(e) => set({ checkOnSync: e.target.checked })} />
              <span className="settings-label" style={{ margin: 0 }}>Check after each Sync</span>
            </label>
            <div className="settings-field">
              <label className="settings-label">Re-alert cooldown (min)</label>
              <input className="input" type="number" min="1" value={alertSettings.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) || 60 })} />
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: ".68rem", margin: 0 }}>
            Rules also auto-check every 30 minutes in the background. KPIs populate as journeys are synced/opened.
          </p>
        </div>
      </div>
    </div>
  );
}
