/**
 * background.js — Service worker that coordinates message passing
 * between the popup and content script, and runs summarization/QA.
 */

// Import library modules into the service worker scope
importScripts('lib/summarize.js', 'lib/retrieve.js', 'lib/qa.js');

// In-memory cache: tabId -> { pageData, summary, chunks, index, timestamp }
const cache = new Map();

/**
 * Inject extraction scripts into the active tab and return extracted content.
 */
async function extractFromTab(tabId) {
  // Inject lib/extract.js first (defines the extraction function)
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/extract.js'],
  });

  // Then inject content_script.js which calls the extraction and returns results
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content_script.js'],
  });

  if (!results || results.length === 0 || !results[0].result) {
    throw new Error('Content extraction returned no results. The page may block scripts or have no readable content.');
  }

  return results[0].result;
}

/**
 * Run the full analysis pipeline: extract -> summarize -> index.
 */
async function analyzePage(tabId) {
  // Step 1: Extract
  const pageData = await extractFromTab(tabId);

  if (!pageData.cleanText || pageData.cleanText.trim().length < 30) {
    throw new Error('Could not extract meaningful content from this page. It may be empty, heavily dynamic, or script-protected.');
  }

  // Step 2: Summarize
  const summary = globalThis.__ResearchHelper_summarize(pageData);

  // Step 3: Chunk and build retrieval index
  const { chunkText, buildIndex } = globalThis.__ResearchHelper_retrieve;
  const chunks = chunkText(pageData.cleanText);
  const index = buildIndex(chunks);

  // Cache results
  const entry = {
    pageData,
    summary,
    chunks,
    index,
    timestamp: Date.now(),
  };
  cache.set(tabId, entry);

  return { summary, timestamp: entry.timestamp, url: pageData.url, title: pageData.title };
}

/**
 * Answer a question using cached analysis data.
 */
async function answerQuestion(tabId, question, useExternal) {
  const entry = cache.get(tabId);
  if (!entry) {
    throw new Error('No analysis data found. Please click "Analyze Page" first.');
  }

  // Retrieve relevant chunks
  const results = entry.index.search(question, 5);

  if (!useExternal) {
    // Local extractive answer
    return globalThis.__ResearchHelper_qa.answerLocal(question, results);
  }

  // External LLM mode
  const config = await getExternalConfig();
  if (!config.enabled) {
    // Fall back to local
    return globalThis.__ResearchHelper_qa.answerLocal(question, results);
  }

  return globalThis.__ResearchHelper_qa.answerExternal(question, results, config);
}

/**
 * Get external LLM configuration from storage.
 */
async function getExternalConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['llmEnabled', 'llmApiKey', 'llmEndpoint', 'llmModel'], (data) => {
      resolve({
        enabled: data.llmEnabled || false,
        apiKey: data.llmApiKey || '',
        endpoint: data.llmEndpoint || '',
        model: data.llmModel || '',
      });
    });
  });
}

/**
 * Get cached data for a tab if it exists.
 */
function getCached(tabId) {
  const entry = cache.get(tabId);
  if (!entry) return null;
  return {
    summary: entry.summary,
    timestamp: entry.timestamp,
    url: entry.pageData.url,
    title: entry.pageData.title,
  };
}

// Clean up cache when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  cache.delete(tabId);
});

/**
 * Message handler: popup <-> background communication.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE') {
    analyzePage(msg.tabId)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (msg.type === 'ASK') {
    answerQuestion(msg.tabId, msg.question, msg.useExternal)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'GET_CACHED') {
    const cached = getCached(msg.tabId);
    sendResponse({ ok: true, data: cached });
    return false; // Synchronous
  }

  if (msg.type === 'GET_CONFIG') {
    getExternalConfig()
      .then(config => sendResponse({ ok: true, data: config }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
