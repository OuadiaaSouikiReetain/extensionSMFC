import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, readFileSync, writeFileSync } from "fs";

// After the build, copy the nested HTML outputs to the root-level names
// that manifest.json and devtools.js expect (popup.html, panel.html, journey-detail.html).
function flattenHtml(): Plugin {
  return {
    name: "flatten-html",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      const copies: [string, string][] = [
        ["src/popup/index.html",        "popup.html"],
        ["src/panel/index.html",        "panel.html"],
        ["src/journey-detail/index.html", "journey-detail.html"],
      ];
      for (const [src, dest] of copies) {
        const sourcePath = resolve(dist, src);
        const destPath = resolve(dist, dest);
        copyFileSync(sourcePath, destPath);
        const html = readFileSync(destPath, "utf8").replace(/\.\.\/\.\.\//g, "./");
        writeFileSync(destPath, html, "utf8");
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), flattenHtml()],
  publicDir: "src/static",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        panel: resolve(__dirname, "src/panel/index.html"),
        "journey-detail": resolve(__dirname, "src/journey-detail/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
    minify: "terser",
    terserOptions: { compress: { pure_funcs: ["console.log"] } },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
