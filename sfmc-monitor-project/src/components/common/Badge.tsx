import React from "react";

type Variant = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

interface Props { variant?: Variant; children: React.ReactNode; className?: string; }

export function Badge({ variant = "neutral", children, className = "" }: Props) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>;
}
