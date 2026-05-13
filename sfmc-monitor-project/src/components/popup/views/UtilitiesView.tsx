import React, { useState, useRef } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";

function buildKpiSql(): string {
  return `SELECT
  j.JourneyID, j.JourneyName,
  ja.ActivityName, ja.ActivityType,
  COUNT(DISTINCT s.SubscriberKey)                                           AS Sent,
  COUNT(DISTINCT CASE WHEN b.SubscriberKey IS NULL THEN s.SubscriberKey END) AS Delivered,
  COUNT(o.SubscriberKey)                                                    AS Opens,
  COUNT(DISTINCT o.SubscriberKey)                                           AS UniqueOpens,
  COUNT(c.SubscriberKey)                                                    AS Clicks,
  COUNT(DISTINCT c.SubscriberKey)                                           AS UniqueClicks,
  COUNT(DISTINCT b.SubscriberKey)                                           AS Bounces,
  COUNT(DISTINCT u.SubscriberKey)                                           AS Unsubs
FROM _Journey j
INNER JOIN _JourneyActivity ja ON j.VersionID = ja.VersionID
LEFT JOIN _Sent s              ON ja.JourneyActivityObjectID = s.TriggererSendDefinitionObjectID
LEFT JOIN _Open o              ON s.JobID=o.JobID AND s.ListID=o.ListID AND s.BatchID=o.BatchID AND s.SubscriberKey=o.SubscriberKey
LEFT JOIN _Click c             ON s.JobID=c.JobID AND s.ListID=c.ListID AND s.BatchID=c.BatchID AND s.SubscriberKey=c.SubscriberKey
LEFT JOIN _Bounce b            ON s.JobID=b.JobID AND s.ListID=b.ListID AND s.BatchID=b.BatchID AND s.SubscriberKey=b.SubscriberKey
LEFT JOIN _Unsubscribe u       ON s.JobID=u.JobID AND s.ListID=u.ListID AND s.BatchID=u.BatchID AND s.SubscriberKey=u.SubscriberKey
WHERE s.EventDate >= DATEADD(day, -180, GETDATE())
GROUP BY j.JourneyID, j.JourneyName, ja.ActivityName, ja.ActivityType`;
}

export function UtilitiesView() {
  const { exportSnapshot, importSnapshot, purgeCache, addLog } = useAppStore();
  const [urlInput, setUrlInput] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const sql = buildKpiSql();

  async function copySql() {
    await navigator.clipboard.writeText(sql);
    addLog("KPI SQL copied.");
  }

  async function openQueryStudio() {
    await chrome.storage.local.set({ sfmcBuddyPendingQuery: { journeyId: "__all__", sql, createdAt: Date.now() } });
    chrome.tabs.create({ url: "https://querystudio.herokuapp.com/" });
  }

  async function handleExport() {
    const snap = exportSnapshot();
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    addLog("Snapshot exported to clipboard.");
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        await importSnapshot(data);
      } catch {
        addLog("Import failed: invalid JSON.");
      }
    };
    reader.readAsText(file);
  }

  const parsedUrl = (() => {
    try {
      const url = new URL(urlInput);
      const stackM = url.hostname.match(/\.s(\d+)\./i);
      return { hostname: url.hostname, pathname: url.pathname, stack: stackM ? `s${stackM[1]}` : "-", params: [...url.searchParams.entries()] };
    } catch {
      return null;
    }
  })();

  return (
    <div className="buddy-content" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Journey KPI SQL</span>
          <div className="card-actions">
            <Button variant="secondary" size="sm" onClick={copySql}>Copy</Button>
            <Button variant="primary" size="sm" onClick={openQueryStudio}>Run in Query Studio</Button>
          </div>
        </div>
        <div className="card-body">
          <pre className="code-block" style={{ maxHeight: 180 }}>{sql}</pre>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Snapshot</span></div>
        <div className="card-body button-row-wrap">
          <Button variant="secondary" size="sm" onClick={handleExport}>Export to clipboard</Button>
          <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>Import JSON</Button>
          <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">URL Inspector</span></div>
        <div className="card-body">
          <input className="input" placeholder="Paste an SFMC URL..." value={urlInput} onChange={e => setUrlInput(e.target.value)} />
          {parsedUrl && (
            <div className="inspector-grid">
              <div><span className="inspector-label">Hostname</span><span className="text-mono">{parsedUrl.hostname}</span></div>
              <div><span className="inspector-label">Path</span><span className="text-mono">{parsedUrl.pathname}</span></div>
              <div><span className="inspector-label">Stack</span><span className="text-mono">{parsedUrl.stack}</span></div>
              {parsedUrl.params.length > 0 && (
                <div>
                  <span style={{ color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Query params</span>
                  {parsedUrl.params.map(([k, v]) => (
                    <div key={k} style={{ paddingLeft: 8 }}><span style={{ color: "var(--brand)" }}>{k}</span> = <span>{v}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Cache Management</span></div>
        <div className="card-body button-row-wrap">
          {(["journeys", "automations", "errors"] as const).map(k => (
            <Button key={k} variant="ghost" size="sm" onClick={() => purgeCache(k)}>Clear {k}</Button>
          ))}
          <Button variant="danger" size="sm" onClick={() => purgeCache("all")}>Clear all cache</Button>
        </div>
      </div>
    </div>
  );
}
