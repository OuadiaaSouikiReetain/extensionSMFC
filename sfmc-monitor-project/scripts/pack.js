#!/usr/bin/env node
// ============================================================
// SFMC Monitor — pack.js
// Zips dist/ into sfmc-monitor-v{version}.zip for distribution
// ============================================================

const fs      = require("fs");
const path    = require("path");
const { execSync } = require("child_process");

const ROOT     = path.resolve(__dirname, "..");
const DIST     = path.join(ROOT, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.json"), "utf8"));
const version  = manifest.version;
const outName  = `sfmc-monitor-v${version}.zip`;
const outPath  = path.join(ROOT, outName);

const c = (code, str) => `\x1b[${code}m${str}\x1b[0m`;

// Remove old zip
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

// Use built-in zip (cross-platform via Node)
function zipDir(sourceDir, outFile) {
  // We'll use archiver if available, otherwise fall back to OS zip/powershell
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outFile}'"`,
        { stdio: "inherit" }
      );
    } else {
      execSync(`cd "${sourceDir}" && zip -r "${outFile}" .`, { stdio: "inherit" });
    }
  } catch (e) {
    console.error(c(31, `✗ Zip failed: ${e.message}`));
    process.exit(1);
  }
}

zipDir(DIST, outPath);

const size = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\n${c(32, "✓")} Packed: ${c(36, outName)} ${c(90, `(${size} KB)`)}`);
console.log(c(90, "\nTo install:"));
console.log(c(90, "  chrome://extensions/ → Load unpacked → unzip and select the folder\n"));
