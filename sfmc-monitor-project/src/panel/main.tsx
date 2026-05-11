import React from "react";
import { createRoot } from "react-dom/client";
import { PanelApp } from "./PanelApp";
import "../styles/index.css";

createRoot(document.getElementById("root")!).render(<PanelApp />);
