import React from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./PopupApp";
import "../styles/index.css";

const bootFlag = document.documentElement;
const fallback = document.getElementById("boot-fallback");

function showBootError(message: string) {
  bootFlag.dataset.popupBoot = "error";
  if (fallback) {
    fallback.removeAttribute("hidden");
    fallback.textContent = `Popup error: ${message}`;
  }
}

window.addEventListener("error", (event) => {
  showBootError(event.error?.message || event.message || "Unknown runtime error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  showBootError(reason?.message || String(reason || "Unhandled promise rejection"));
});

try {
  createRoot(document.getElementById("root")!).render(<PopupApp />);
  bootFlag.dataset.popupBoot = "ready";
  if (fallback) fallback.setAttribute("hidden", "hidden");
} catch (error) {
  showBootError(error instanceof Error ? error.message : String(error));
}
