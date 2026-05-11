import React from "react";
type Status = "ok" | "warn" | "bad" | "unknown";
export function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot ${status}`} />;
}
