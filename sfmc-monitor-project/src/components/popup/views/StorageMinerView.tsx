import React, { useState } from "react";
import { useStorageMiner } from "../../../hooks/useStorageMiner";
import { EmptyState } from "../../common/EmptyState";
import { Badge } from "../../common/Badge";
import { formatTs, relativeTime } from "../../../utils/formatters";

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="miner-section">
      <div className="miner-section-header" onClick={() => setOpen(o => !o)}>
        <span>{icon}</span> {title}
        <span className={`miner-chevron${open ? " open" : ""}`}>▾</span>
      </div>
      {open && <div className="miner-section-body">{children}</div>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0 && value !== false) return null;
  return (
    <div className="miner-kv">
      <span className="miner-key">{label}</span>
      <span className="miner-val">{value}</span>
    </div>
  );
}

export function StorageMinerView() {
  const data = useStorageMiner();

  if (!data) {
    return (
      <div className="buddy-content">
        <EmptyState
          icon="🔍"
          title="No storage data yet"
          message="Open an SFMC tab. The extension will automatically mine localStorage and sessionStorage."
        />
      </div>
    );
  }

  const { userProfile: u, businessUnit: b, accountSettings: a, featureFlags: f, recentErrors, automationHistory, journeyDrafts, sessionMetadata: s, minedAt } = data;

  const flagKeys = Object.keys(f ?? {});

  return (
    <div className="buddy-content">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: ".9rem", fontWeight: 600 }}>Storage Insights</div>
        <span style={{ fontSize: ".68rem", color: "var(--text-muted)" }}>Mined {relativeTime(minedAt)}</span>
      </div>

      <div className="miner-panel">

        {/* User profile */}
        <Section title="User Profile" icon="👤">
          <KV label="Name"        value={u?.userName} />
          <KV label="Email"       value={u?.userEmail} />
          <KV label="User ID"     value={u?.userId} />
          <KV label="Legacy MID"  value={u?.legacyMid} />
          <KV label="Stack"       value={u?.stackKey} />
          <KV label="Org ID"      value={u?.organizationId} />
          <KV label="Enterprise"  value={u?.enterpriseId} />
          {u?.userRoles?.length ? (
            <div className="miner-kv">
              <span className="miner-key">Roles</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {u.userRoles.map(r => <Badge key={r} variant="brand">{r}</Badge>)}
              </span>
            </div>
          ) : null}
        </Section>

        {/* Business Unit */}
        <Section title="Business Unit" icon="🏢">
          <KV label="Name"       value={b?.buName} />
          <KV label="MID"        value={b?.buMid} />
          <KV label="Parent MID" value={b?.parentMid} />
          <KV label="Timezone"   value={b?.buTimezone} />
          <KV label="Locale"     value={b?.buLocale} />
          <KV label="Type"       value={b?.accountType} />
          <KV label="Enterprise" value={b?.isEnterprise != null ? (b.isEnterprise ? "Yes" : "No") : undefined} />
        </Section>

        {/* Session */}
        <Section title="Session Metadata" icon="🔐">
          <KV label="Stack"       value={s?.sfmcStack} />
          <KV label="Page context" value={s?.pageContext} />
          <KV label="CSRF token"  value={s?.csrfPresent ? <Badge variant="success">Present</Badge> : <Badge variant="danger">Missing</Badge>} />
          <KV label="Token expiry" value={s?.tokenExpiry ? formatTs(s.tokenExpiry) : undefined} />
          <KV label="Login at"    value={s?.loginTimestamp ? formatTs(s.loginTimestamp) : undefined} />
        </Section>

        {/* Feature flags */}
        {flagKeys.length > 0 && (
          <Section title={`Feature Flags (${flagKeys.length})`} icon="🚩">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {flagKeys.map(k => (
                <span key={k} title={k} style={{
                  padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: ".68rem", fontWeight: 600,
                  background: f[k] === true || f[k] === "true" ? "var(--success-surface)" : "var(--neutral-surface)",
                  color: f[k] === true || f[k] === "true" ? "var(--success)" : "var(--neutral)",
                  border: `1px solid ${f[k] === true || f[k] === "true" ? "var(--success-border)" : "var(--neutral-border)"}`,
                }}>
                  {k.length > 30 ? k.slice(0, 28) + "…" : k}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Account settings */}
        <Section title="Account Settings" icon="⚙">
          <KV label="Date format"   value={a?.dateFormat} />
          <KV label="Send throttle" value={a?.sendThrottle} />
          {a?.enabledModules?.length ? (
            <div className="miner-kv">
              <span className="miner-key">Modules</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {a.enabledModules.map(m => <Badge key={m} variant="neutral">{m}</Badge>)}
              </span>
            </div>
          ) : null}
        </Section>

        {/* Automation history */}
        {automationHistory?.length > 0 && (
          <Section title={`Automation History (${automationHistory.length})`} icon="⚡">
            <table style={{ width: "100%", fontSize: ".74rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Name","Status","Last run","Next run"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {automationHistory.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "5px 8px" }}>{r.name ?? "—"}</td>
                    <td style={{ padding: "5px 8px" }}><Badge variant={r.status?.toLowerCase().includes("error") ? "danger" : "neutral"}>{r.status ?? "—"}</Badge></td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontSize: ".68rem" }}>{r.lastRunTime ?? "—"}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontSize: ".68rem" }}>{r.nextRunTime ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Journey drafts */}
        {journeyDrafts?.length > 0 && (
          <Section title={`Journey Drafts / Recent (${journeyDrafts.length})`} icon="🗺">
            {journeyDrafts.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ flex: 1, fontSize: ".76rem" }}>{d.name ?? d.id ?? "—"}</span>
                <Badge variant="neutral">{d.status ?? "draft"}</Badge>
              </div>
            ))}
          </Section>
        )}

        {/* Recent errors */}
        {recentErrors?.length > 0 && (
          <Section title={`Recent Errors (${recentErrors.length})`} icon="🚨">
            {recentErrors.map((e, i) => (
              <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: ".76rem", color: "var(--danger)" }}>{e.message}</div>
                {e.code && <span style={{ fontSize: ".68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>Code: {e.code}</span>}
                {e.timestamp && <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginLeft: 8 }}>{relativeTime(e.timestamp)}</span>}
              </div>
            ))}
          </Section>
        )}

      </div>
    </div>
  );
}
