import React, { useState } from "react";
import { useAppStore } from "../../../store/appStore";
import { Button } from "../../common/Button";
import type { AppSettings } from "../../../store/types";

export function SettingsView() {
  const { settings, saveSettings } = useAppStore();
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = <K extends keyof AppSettings>(key: K) => ({
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const v = e.target.type === "checkbox"
        ? (e.target as HTMLInputElement).checked
        : (["journeyTimeout", "pageSize", "autoInterval"].includes(key) ? Number(e.target.value) : e.target.value);
      setForm(f => ({ ...f, [key]: v }));
    },
  });

  return (
    <div className="buddy-content">
      <div className="section-header"><span className="section-title">Settings</span></div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header"><span className="card-title">Synchronization</span></div>
        <div className="card-body settings-stack">
          <label className="settings-field">
            <span className="settings-label">Journey capture timeout (s)</span>
            <input className="input" type="number" min={5} max={300} {...field("journeyTimeout")} />
          </label>
          <label className="settings-field">
            <span className="settings-label">Page size (items per API call)</span>
            <input className="input" type="number" min={10} max={200} {...field("pageSize")} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" checked={form.autoRefresh}
              onChange={e => setForm(f => ({ ...f, autoRefresh: e.target.checked }))} />
            <span style={{ fontSize: ".78rem" }}>Auto-refresh</span>
          </label>
          {form.autoRefresh && (
            <label className="settings-field">
              <span className="settings-label">Refresh interval (min)</span>
              <input className="input" type="number" min={1} max={60} {...field("autoInterval")} />
            </label>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header"><span className="card-title">Interface</span></div>
        <div className="card-body settings-stack">
          <label className="settings-field">
            <span className="settings-label">Language</span>
            <select className="select" value={form.lang} onChange={e => setForm(f => ({ ...f, lang: e.target.value as "fr" | "en" }))}>
              <option value="fr">Francais</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </div>

      <Button variant="primary" onClick={handleSave}>
        {saved ? "Saved" : "Save settings"}
      </Button>
    </div>
  );
}
