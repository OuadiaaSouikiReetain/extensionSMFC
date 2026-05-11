import React from "react";
interface Props { icon?: string; title: string; message?: string; action?: React.ReactNode; }
export function EmptyState({ icon = "📭", title, message, action }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {message && <p style={{ marginTop: 4 }}>{message}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
