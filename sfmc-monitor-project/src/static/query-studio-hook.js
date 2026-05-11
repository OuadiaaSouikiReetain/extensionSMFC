// SFMC Buddy v2.2.0 — Query Studio page-context hook
(function () {
  "use strict";
  if (window.__sfmcBuddyQueryHooked) return;
  window.__sfmcBuddyQueryHooked = true;
  const SFMC_KEYWORDS = /JourneyID|JourneyName|Sent|UniqueOpens|UniqueClicks|Bounces|SubscriberKey|ActivityName|ActivityType|Delivered|Opens|Clicks|Unsubscribes|EventDate|TriggererSendDefinitionObjectID|JobID|BatchID|ListID/i;

  function report(url, body) {
    try {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      if (!text || !SFMC_KEYWORDS.test(text)) return;
      window.postMessage({ type: "SFMC_BUDDY_QUERY_RESULT", payload: { url: String(url || location.href), body: text.slice(0, 500000), capturedAt: Date.now() } }, "*");
    } catch { /* ignore */ }
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function () {
      const url = arguments[0]?.url || arguments[0];
      return nativeFetch.apply(this, arguments).then(response => {
        try { response.clone().text().then(text => report(url, text)).catch(() => null); } catch { /* ignore */ }
        return response;
      });
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__sfmcBuddyUrl = url; return nativeOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { this.addEventListener("load", () => report(this.__sfmcBuddyUrl, this.responseText)); return nativeSend.apply(this, arguments); };
})();
