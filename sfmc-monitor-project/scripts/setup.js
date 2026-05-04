#!/usr/bin/env node
// ============================================================
// SFMC Monitor — setup.js
// Checks environment and prepares the dist/ folder
// ============================================================

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT  = path.resolve(__dirname, "..");
const SRC   = path.join(ROOT, "src");
const DIST  = path.join(ROOT, "dist");

const COLORS = {
  reset : "\x1b[0m",
  bold  : "\x1b[1m",
  green : "\x1b[32m",
  blue  : "\x1b[34m",
  yellow: "\x1b[33m",
  red   : "\x1b[31m",
  cyan  : "\x1b[36m",
  gray  : "\x1b[90m"
};
const c = (color, str) => `${COLORS[color]}${str}${COLORS.reset}`;

console.log("\n" + c("bold", c("cyan", "╔══════════════════════════════════╗")));
console.log(c("bold", c("cyan", "║      SFMC Monitor — Setup        ║")));
console.log(c("bold", c("cyan", "╚══════════════════════════════════╝")) + "\n");

// ── Step 1: Node version ───────────────────────────────────────────────────────
const [major] = process.versions.node.split(".").map(Number);
if (major < 16) {
  console.error(c("red", `✗ Node.js 16+ required. You have v${process.versions.node}`));
  process.exit(1);
}
console.log(c("green", `✓`) + ` Node.js v${process.versions.node}`);

// ── Step 2: Check src/ ────────────────────────────────────────────────────────
const required = ["manifest.json", "background.js", "content.js", "popup.html", "popup.js"];
let allFound = true;
for (const f of required) {
  if (!fs.existsSync(path.join(SRC, f))) {
    console.error(c("red", `✗ Missing: src/${f}`));
    allFound = false;
  }
}
if (!allFound) process.exit(1);
console.log(c("green", "✓") + " Source files OK");

// ── Step 3: Build dist/ ───────────────────────────────────────────────────────
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
if (!fs.existsSync(path.join(DIST, "icons"))) fs.mkdirSync(path.join(DIST, "icons"), { recursive: true });

const copy = (src, dst) => fs.copyFileSync(src, dst);

for (const f of required) copy(path.join(SRC, f), path.join(DIST, f));

// Copy icons
const iconsDir = path.join(SRC, "icons");
if (fs.existsSync(iconsDir)) {
  for (const icon of fs.readdirSync(iconsDir)) {
    copy(path.join(iconsDir, icon), path.join(DIST, "icons", icon));
  }
  console.log(c("green", "✓") + " Icons copied");
}

console.log(c("green", "✓") + ` Extension built → ${c("cyan", "dist/")}`);

// ── Step 4: Detect Chrome ─────────────────────────────────────────────────────
console.log("\n" + c("bold", "Chrome detection:"));
const chromePaths = detectChrome();
if (chromePaths.length === 0) {
  console.warn(c("yellow", "⚠ Chrome not found automatically."));
  console.log(c("gray",   "  Install Chrome: https://www.google.com/chrome/"));
} else {
  console.log(c("green", "✓") + ` Chrome found: ${c("gray", chromePaths[0])}`);
}

// ── Done ───────────────────────────────────────────────────────────────────────
console.log("\n" + c("bold", "─────────────────────────────────────"));
console.log(c("green", c("bold", "Setup complete! Run:")) );
console.log(c("cyan",  "\n  npm run dev\n"));
console.log(c("gray",  "Or load the extension manually:"));
console.log(c("gray",  "  1. Open chrome://extensions/"));
console.log(c("gray",  "  2. Enable Developer Mode"));
console.log(c("gray",  `  3. Load unpacked → select: ${DIST}`));
console.log(c("bold", "─────────────────────────────────────") + "\n");

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectChrome() {
  const platform = process.platform;
  const candidates = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium"
    ],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ]
  };
  return (candidates[platform] || []).filter(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}
