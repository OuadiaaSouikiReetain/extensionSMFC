export const fmt = new Intl.NumberFormat("fr-FR");

export function formatNumber(v: number | string | undefined | null): string {
  return fmt.format(Number(v ?? 0));
}

export function formatPct(v: number | null | undefined): string {
  if (v == null) return "--";
  return `${Math.round(v * 1000) / 10}%`;
}

export function ratio(a: number, b: number): number | null {
  return b ? a / b : null;
}

export function relativeTime(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Parse a value that may be ISO string, timestamp, or SFMC WCF format "/Date(1234567890)/"
export function parseSfmcDate(ts: number | string | undefined | null): Date | null {
  if (!ts) return null;
  try {
    if (typeof ts === "number") {
      const d = new Date(ts);
      return isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
    }
    const s = String(ts);
    // WCF JSON date: /Date(1234567890)/ or /Date(1234567890+0000)/
    const wcf = s.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
    if (wcf) {
      const d = new Date(parseInt(wcf[1], 10));
      return isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
  } catch { return null; }
}

export function formatTs(ts: number | string | undefined | null): string {
  const d = parseSfmcDate(ts);
  if (!d) return "—";
  try { return d.toLocaleString("fr-FR"); } catch { return "—"; }
}

export function formatIso(iso: string | undefined | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("fr-FR"); } catch { return iso; }
}

export function estimateCacheKb(obj: unknown): number {
  try { return Math.round(JSON.stringify(obj).length / 1024); } catch { return 0; }
}

export function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] ?? c));
}

export function statusVariant(status: string | undefined): "success" | "warning" | "danger" | "neutral" | "info" {
  const s = String(status || "").toLowerCase();
  if (/running|active|published|done|completed|success/i.test(s)) return "success";
  if (/paused|waiting|scheduled|idle/i.test(s)) return "warning";
  if (/error|failed|stopped|inactive/i.test(s)) return "danger";
  if (/draft/i.test(s)) return "info";
  return "neutral";
}
