/**
 * content_script.js — Injected into pages via chrome.scripting.executeScript.
 * Runs extractPageContent() and returns the result.
 *
 * This file is NOT declared as a persistent content script in the manifest.
 * Instead, the background worker injects lib/extract.js + this file on demand
 * (requires only the "activeTab" permission, no host_permissions needed).
 */

(() => {
  // extract.js should have been injected before this file,
  // making extractPageContent available on window.
  if (typeof window.__ResearchHelper_extract === 'function') {
    return window.__ResearchHelper_extract();
  }
  throw new Error('Extraction function not found. lib/extract.js may not have loaded.');
})();
