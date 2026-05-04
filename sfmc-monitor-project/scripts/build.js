#!/usr/bin/env node
// ============================================================
// SFMC Monitor — build.js
// Copies src/ → dist/ (ready to load in Chrome)
// ============================================================

const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC  = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
}

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
copyDir(SRC, DIST);

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.json"), "utf8"));
console.log(`\x1b[32m✓\x1b[0m Built \x1b[36m${manifest.name} v${manifest.version}\x1b[0m → dist/`);
