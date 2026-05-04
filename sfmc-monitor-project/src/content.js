// Content script injected into SFMC pages.
// Journey Builder is a SPA, so this script watches DOM mutations and periodically
// extracts visible canvas activities. It does not authenticate or call APIs.

(function () {
  "use strict";

  const SFMC_HOST_RE = /exacttarget\.com|marketingcloudapis\.com|marketingcloudapps\.com|salesforce\.com/i;
  const ACTIVITY_SELECTOR = ".activity.wait, .activity.email, .activity.split";
  let lastSignature = "";
  let debounceTimer = null;

  if (!SFMC_HOST_RE.test(location.hostname + location.pathname)) return;

  function scheduleSnapshot(reason) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => sendSnapshot(reason), 350);
  }

  function sendSnapshot(reason) {
    const activities = collectCanvasActivities();
    exposeActivityKeys(activities);
    extractPublicationLists();
    const payload = {
      url: location.href,
      title: document.title,
      reason,
      stack: detectSfmcStack(location.href),
      activities,
      capturedAt: Date.now()
    };
    const signature = JSON.stringify({
      url: payload.url,
      activities: activities.map(item => `${item.key}:${item.type}:${item.name}`)
    });
    if (signature === lastSignature) return;
    lastSignature = signature;

    chrome.runtime.sendMessage({
      type: "SFMC_CANVAS_SNAPSHOT",
      payload
    }).catch(() => null);
  }

  function collectCanvasActivities() {
    return [...document.querySelectorAll(ACTIVITY_SELECTOR)].map((node, index) => {
      const host = node.closest("[data-activity-key]") || node;
      const key = host.getAttribute("data-activity-key") ||
        node.getAttribute("data-activity-key") ||
        node.dataset.activityKey ||
        `activity-${index + 1}`;
      return {
        key,
        name: readActivityName(node),
        type: inferActivityType(node),
        domIndex: index,
        classes: node.className || ""
      };
    });
  }

  function exposeActivityKeys(activities) {
    ensureStyle();
    for (const activity of activities) {
      const nodes = [...document.querySelectorAll(ACTIVITY_SELECTOR)];
      const node = nodes[activity.domIndex];
      if (!node || node.querySelector(":scope > .sfmc-buddy-activity-key")) continue;
      const badge = document.createElement("div");
      badge.className = "sfmc-buddy-activity-key";
      badge.textContent = activity.key;
      node.style.position = node.style.position || "relative";
      node.prepend(badge);
    }
    if (activities.length) {
      chrome.runtime.sendMessage({
        type: "SFMC_BUDDY_COLLECTION",
        collection: "canvasActivities",
        items: activities,
        source: location.href
      }).catch(() => null);
    }
  }

  function extractPublicationLists() {
    if (!/publication/i.test(location.href + " " + document.body.innerText.slice(0, 2000))) return;
    const rows = [...document.querySelectorAll("tr, [role='row'], li")];
    const lists = rows.map(row => {
      const text = row.textContent.replace(/\s+/g, " ").trim();
      if (!text || !/\d/.test(text)) return null;
      const id = findId(row);
      if (!id) return null;
      const name = text.replace(String(id), "").trim().slice(0, 180);
      addInlineId(row, id);
      return { id, name: name || text, capturedAt: Date.now(), url: location.href };
    }).filter(Boolean);
    const unique = dedupe(lists, item => item.id);
    if (unique.length) {
      chrome.runtime.sendMessage({
        type: "SFMC_BUDDY_COLLECTION",
        collection: "publicationLists",
        items: unique,
        source: location.href
      }).catch(() => null);
    }
  }

  function findId(node) {
    const attrs = ["data-id", "data-listid", "data-list-id", "id"];
    for (const attr of attrs) {
      const value = node.getAttribute?.(attr);
      const match = String(value || "").match(/\d{2,}/);
      if (match) return match[0];
    }
    const html = node.outerHTML || "";
    const match = html.match(/(?:listId|listID|publicationListId|publicationListID|categoryId)[^\d]{0,20}(\d{2,})/i) ||
      html.match(/[?&](?:id|listId)=(\d{2,})/i);
    return match?.[1] || null;
  }

  function addInlineId(row, id) {
    if (row.querySelector?.(".sfmc-buddy-inline-id")) return;
    const badge = document.createElement("span");
    badge.className = "sfmc-buddy-inline-id";
    badge.textContent = `ID ${id}`;
    row.appendChild(badge);
  }

  function ensureStyle() {
    if (document.getElementById("sfmc-buddy-style")) return;
    const style = document.createElement("style");
    style.id = "sfmc-buddy-style";
    style.textContent = `
      .sfmc-buddy-activity-key {
        display: inline-flex;
        margin: 0 0 4px 0;
        padding: 2px 6px;
        border-radius: 999px;
        background: #0070d2;
        color: #fff;
        font: 700 10px/1.4 system-ui, sans-serif;
        z-index: 9999;
      }
      .sfmc-buddy-inline-id {
        display: inline-flex;
        margin-left: 8px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(0,112,210,.14);
        color: #0070d2;
        font: 700 11px/1.4 system-ui, sans-serif;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function dedupe(items, getKey) {
    const seen = new Set();
    return items.filter(item => {
      const key = getKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function readActivityName(node) {
    const candidate = node.querySelector(".activity-name, .name, [title], [aria-label]");
    const text = candidate?.textContent?.trim() ||
      candidate?.getAttribute?.("title") ||
      candidate?.getAttribute?.("aria-label") ||
      node.getAttribute("title") ||
      node.getAttribute("aria-label") ||
      "";
    return text.replace(/\s+/g, " ").trim() || "Unnamed activity";
  }

  function inferActivityType(node) {
    const text = `${node.className || ""} ${node.getAttribute("data-type") || ""}`.toLowerCase();
    if (text.includes("email")) return "EMAILV2";
    if (text.includes("wait")) return "WAIT";
    if (text.includes("split")) return "SPLIT";
    return "UNKNOWN";
  }

  function detectSfmcStack(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const stackMatch = url.hostname.match(/\.s(\d+)\./i) || url.hostname.match(/mc\.s(\d+)\.exacttarget\.com/i);
      if (stackMatch) return `s${stackMatch[1]}`;
      const restMatch = url.hostname.match(/^([a-z0-9-]+)\.rest\.marketingcloudapis\.com/i);
      if (restMatch) return restMatch[1];
      return null;
    } catch {
      return null;
    }
  }

  const observer = new MutationObserver(() => scheduleSnapshot("dom-mutated"));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-activity-key", "class", "title", "aria-label"]
  });

  window.addEventListener("popstate", () => scheduleSnapshot("navigation"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSnapshot("visible");
  });

  scheduleSnapshot("initial-load");
  setInterval(() => scheduleSnapshot("interval"), 5000);
})();
