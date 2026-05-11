import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "xs" | "md";

interface Props {
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  children: React.ReactNode;
  className?: string;
}

export function Button({ variant = "secondary", size = "md", disabled, loading, onClick, type = "button", children, className = "" }: Props) {
  const cls = ["btn", `btn-${variant}`, size !== "md" ? `btn-${size}` : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} disabled={disabled || loading} onClick={onClick}>
      {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}
      {children}
    </button>
  );
}
