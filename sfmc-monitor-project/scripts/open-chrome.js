#!/usr/bin/env node
// ============================================================
// SFMC Monitor — open-chrome.js
// Launches Chrome with the extension pre-loaded in a dedicated
// profile so it doesn't interfere with your main Chrome profile
// ============================================================

const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const { spawn } = require("child_process");

const ROOT      = path.resolve(__dirname, "..");
const DIST      = path.join(ROOT, "dist");
const PROFILE   = path.join(ROOT, ".chrome-profile"); // isolated dev profile

const c = (code, str) => `\x1b[${code}m${str}\x1b[0m`;

// ── Validate dist/ ────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(DIST, "manifest.json"))) {
  console.error(c(31, "✗ dist/ not found. Run: npm run build"));
  process.exit(1);
}

// ── Find Chrome ───────────────────────────────────────────────────────────────
const CHROME_PATHS = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/usr/bin/brave-browser"
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe")
      : null
  ].filter(Boolean)
};

const platform = process.platform;
const chromeBin = (CHROME_PATHS[platform] || []).find(p => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (!chromeBin) {
  console.error(c(31, "✗ Chrome not found on this system."));
  console.log("\nInstall Google Chrome: https://www.google.com/chrome/");
  console.log(c(90, "\nOr load the extension manually:"));
  console.log(c(90, "  1. Open chrome://extensions/"));
  console.log(c(90, "  2. Enable Developer Mode"));
  console.log(c(90, `  3. Load unpacked → ${DIST}`));
  process.exit(1);
}

// ── Launch ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });

const SFMC_URL = "https://mc.exacttarget.com";

const args = [
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${DIST}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions-except=" + DIST,
  SFMC_URL
];

console.log("\n" + c("1", c(36, "SFMC Monitor — Launching Chrome")));
console.log(c(90, "─────────────────────────────────────"));
console.log(c(32, "✓") + ` Extension: ${c(36, DIST)}`);
console.log(c(32, "✓") + ` Profile:   ${c(90, PROFILE)}`);
console.log(c(32, "✓") + ` Opening:   ${c(36, SFMC_URL)}`);
console.log(c(90, "─────────────────────────────────────"));
console.log(c(33, "\n→ Log in to SFMC, navigate to Journey Builder or Automation Studio"));
console.log(c(33, "→ Then click the SFMC Monitor icon in the toolbar\n"));

const proc = spawn(chromeBin, args, {
  detached: true,
  stdio: "ignore",
  ...(platform === "win32" ? { shell: true } : {})
});
proc.unref();

console.log(c(32, "Chrome launched ✓") + c(90, " (this terminal can be closed)"));
