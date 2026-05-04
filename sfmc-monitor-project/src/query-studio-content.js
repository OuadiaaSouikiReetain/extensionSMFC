// Query Studio bridge. It reads a pending SQL query from extension storage,
// attempts to inject it into common editor controls, clicks a Run/Execute button,
// and stores intercepted result payloads for the Journey detail page.
(function () {
  "use strict";

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.type !== "SFMC_BUDDY_QUERY_RESULT") return;
    chrome.runtime.sendMessage({
      type: "QUERY_STUDIO_RESULT",
      payload: event.data.payload
    }).catch(() => null);
  });

  chrome.storage.local.get(["sfmcBuddyPendingQuery"], data => {
    const pending = data.sfmcBuddyPendingQuery;
    if (!pending?.sql) return;
    setTimeout(() => injectQuery(pending.sql), 1200);
    setTimeout(() => injectQuery(pending.sql), 3500);
  });

  function injectQuery(sql) {
    const editor = findEditor();
    if (!editor) return;

    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      editor.focus();
      editor.value = sql;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (editor.classList.contains("cm-content")) {
      editor.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, sql);
    } else if (editor.CodeMirror) {
      editor.CodeMirror.setValue(sql);
    } else {
      editor.textContent = sql;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: sql }));
    }

    const runButton = findRunButton();
    if (runButton) runButton.click();
  }

  function findEditor() {
    return document.querySelector("textarea") ||
      document.querySelector(".cm-content") ||
      document.querySelector(".CodeMirror") ||
      document.querySelector("[contenteditable='true']") ||
      document.querySelector("input[type='text']");
  }

  function findRunButton() {
    const buttons = [...document.querySelectorAll("button, input[type='button'], a")];
    return buttons.find(el => /run|execute|query|submit|play/i.test(el.textContent || el.value || el.title || ""));
  }
})();
