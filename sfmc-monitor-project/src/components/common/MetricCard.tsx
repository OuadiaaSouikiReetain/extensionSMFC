import React from "react";
type Variant = "default" | "brand" | "success" | "warning" | "danger";
interface Props { label: string; value: React.ReactNode; sub?: string; variant?: Variant; }
export function MetricCard({ label, value, sub, variant = "default" }: Props) {
  return (
    <div className={`metric-card ${variant !== "default" ? variant : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
