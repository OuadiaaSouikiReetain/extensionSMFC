// SFMC Buddy — XHR/fetch interceptor (world: MAIN)
// Intercepts SFMC API responses and forwards them to content.js via postMessage.
// No Chrome debugger needed — no banner, no page interference.

(function () {
  "use strict";

  const SFMC_API_RE = /\/interaction\/v1\/|\/automation\/v1\/|\/asset\/v1\/|\/data\/v1\/|\/contacts\/v1\/|\/legacy\/v1\/beta\/automations\//i;
  const MAX_PAYLOAD = 512 * 1024; // 512 KB — skip huge responses

  function shouldCapture(url) {
    return SFMC_API_RE.test(String(url || ""));
  }

  function forward(url, text) {
    if (!text || text.length > MAX_PAYLOAD) return;
    let json;
    try { json = JSON.parse(text); } catch { return; }
    if (!json || typeof json !== "object") return;
    window.postMessage({ __sfmcBuddy: true, url, json }, "*");
  }

  // ── Intercept XMLHttpRequest ───────────────────────────────────────────────

  const OrigXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = "";

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _url = String(url || "");
      return origOpen(method, url, ...rest);
    };

    xhr.addEventListener("load", function () {
      if (!shouldCapture(_url)) return;
      try { forward(_url, xhr.responseText); } catch { /* ignore */ }
    });

    return xhr;
  }

  // Copy static properties
  Object.setPrototypeOf(PatchedXHR, OrigXHR);
  Object.setPrototypeOf(PatchedXHR.prototype, OrigXHR.prototype);
  Object.defineProperty(PatchedXHR, "DONE",            { value: OrigXHR.DONE });
  Object.defineProperty(PatchedXHR, "HEADERS_RECEIVED", { value: OrigXHR.HEADERS_RECEIVED });
  Object.defineProperty(PatchedXHR, "LOADING",          { value: OrigXHR.LOADING });
  Object.defineProperty(PatchedXHR, "OPENED",           { value: OrigXHR.OPENED });
  Object.defineProperty(PatchedXHR, "UNSENT",           { value: OrigXHR.UNSENT });

  window.XMLHttpRequest = PatchedXHR;

  // ── Intercept fetch ────────────────────────────────────────────────────────

  const origFetch = window.fetch.bind(window);

  // Expose the original (unpatched) fetch so extension injected scripts can bypass this wrapper.
  window.__sfmcBuddyOrigFetch = origFetch;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    const promise = origFetch(input, init);

    if (!shouldCapture(url)) return promise;

    return promise.then(response => {
      // Clone so we don't consume the body — guard against already-used bodies
      try {
        const clone = response.clone();
        clone.text().then(text => forward(url, text)).catch(() => null);
      } catch { /* body already used, skip forwarding */ }
      return response;
    });
  };

})();
