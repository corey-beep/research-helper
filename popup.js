/**
 * popup.js — UI logic for the Research Helper popup.
 * Manages user interactions, message passing to background worker,
 * and rendering of analysis results.
 */

// --- DOM References ---
const btnAnalyze = document.getElementById('btn-analyze');
const btnOptions = document.getElementById('btn-options');
const btnCopy = document.getElementById('btn-copy');
const btnAsk = document.getElementById('btn-ask');
const qaInput = document.getElementById('qa-question');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const spinner = document.getElementById('spinner');
const lastAnalyzed = document.getElementById('last-analyzed');
const lastAnalyzedText = document.getElementById('last-analyzed-text');
const resultsDiv = document.getElementById('results');
const errorDiv = document.getElementById('error');
const errorText = document.getElementById('error-text');
const llmWarning = document.getElementById('llm-warning');
const qaResults = document.getElementById('qa-results');

// --- Helpers ---

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setStatus(text, showSpinner = false) {
  show(statusBar);
  statusText.textContent = text;
  showSpinner ? show(spinner) : hide(spinner);
}

function clearStatus() {
  hide(statusBar);
  statusText.textContent = '';
  hide(spinner);
}

function showError(msg) {
  show(errorDiv);
  errorText.textContent = msg;
}

function clearError() {
  hide(errorDiv);
  errorText.textContent = '';
}

/** Get the current active tab ID. */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Could not access the active tab.');
  return tab.id;
}

/** Send a message to the background service worker. */
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('No response from background worker.'));
      } else if (!response.ok) {
        reject(new Error(response.error || 'Unknown error'));
      } else {
        resolve(response.data);
      }
    });
  });
}

// --- Rendering ---

function renderSummary(data) {
  const { summary, timestamp, title } = data;

  // What about
  document.getElementById('what-about').textContent = summary.whatAbout;

  // Summary overview
  document.getElementById('summary-text').textContent = summary.overview;

  // Remember 3
  const r3 = document.getElementById('remember3');
  r3.innerHTML = '';
  for (const item of summary.remember3) {
    const li = document.createElement('li');
    li.textContent = item;
    r3.appendChild(li);
  }

  // Key points
  const kp = document.getElementById('key-points-list');
  kp.innerHTML = '';
  for (const point of summary.keyPoints) {
    const li = document.createElement('li');
    li.textContent = point;
    kp.appendChild(li);
  }

  // Quotes
  const ql = document.getElementById('quotes-list');
  ql.innerHTML = '';
  for (const quote of summary.quotes) {
    const li = document.createElement('li');
    li.textContent = quote;
    ql.appendChild(li);
  }

  // Last analyzed timestamp
  const time = new Date(timestamp).toLocaleTimeString();
  lastAnalyzedText.textContent = `Last analyzed: ${time} — ${title || 'Untitled'}`;
  show(lastAnalyzed);

  // Show results
  show(resultsDiv);
}

function renderQAResult(data) {
  const answerText = document.getElementById('qa-answer-text');
  const sourcesList = document.getElementById('qa-sources-list');

  answerText.textContent = data.answer;

  sourcesList.innerHTML = '';
  for (const src of data.sources) {
    const li = document.createElement('li');
    li.textContent = `[Chunk ${src.chunkIndex}] ${src.excerpt}`;
    sourcesList.appendChild(li);
  }

  show(qaResults);
}

// --- Event Handlers ---

btnAnalyze.addEventListener('click', async () => {
  clearError();
  hide(resultsDiv);
  hide(qaResults);
  btnAnalyze.disabled = true;

  try {
    setStatus('Extracting page content...', true);
    const tabId = await getActiveTabId();

    setStatus('Analyzing and summarizing...', true);
    const result = await sendMessage({ type: 'ANALYZE', tabId });
    clearStatus();
    renderSummary(result);
  } catch (err) {
    clearStatus();
    showError(err.message);
  } finally {
    btnAnalyze.disabled = false;
  }
});

btnAsk.addEventListener('click', async () => {
  const question = qaInput.value.trim();
  if (!question) return;

  clearError();
  hide(qaResults);
  btnAsk.disabled = true;

  try {
    setStatus('Searching for answer...', true);
    const tabId = await getActiveTabId();

    // Check if external LLM is enabled
    const config = await sendMessage({ type: 'GET_CONFIG' });
    const useExternal = config.enabled;

    const result = await sendMessage({
      type: 'ASK',
      tabId,
      question,
      useExternal,
    });
    clearStatus();
    renderQAResult(result);
  } catch (err) {
    clearStatus();
    showError(err.message);
  } finally {
    btnAsk.disabled = false;
  }
});

// Enter key in Q&A input
qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !btnAsk.disabled) {
    btnAsk.click();
  }
});

// Copy summary
btnCopy.addEventListener('click', async () => {
  const whatAbout = document.getElementById('what-about').textContent;
  const overview = document.getElementById('summary-text').textContent;
  const remember3 = Array.from(document.getElementById('remember3').children)
    .map(li => `- ${li.textContent}`).join('\n');
  const keyPoints = Array.from(document.getElementById('key-points-list').children)
    .map(li => `- ${li.textContent}`).join('\n');
  const quotes = Array.from(document.getElementById('quotes-list').children)
    .map(li => `> ${li.textContent}`).join('\n');

  const text = [
    whatAbout,
    '',
    '## Summary',
    overview,
    '',
    '## Remember These 3 Things',
    remember3,
    '',
    '## Key Points',
    keyPoints,
    '',
    '## Notable Quotes',
    quotes,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    btnCopy.textContent = 'Copied!';
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.textContent = 'Copy';
      btnCopy.classList.remove('copied');
    }, 1500);
  } catch (_) {
    showError('Failed to copy to clipboard.');
  }
});

// Open options page
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Collapsible sections
document.querySelectorAll('.collapse-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const targetId = toggle.dataset.target;
    const target = document.getElementById(targetId);
    if (target) {
      target.classList.toggle('hidden');
      toggle.classList.toggle('collapsed');
    }
  });
});

// --- Init: Check for cached data and LLM warning ---
(async () => {
  try {
    const tabId = await getActiveTabId();
    const cached = await sendMessage({ type: 'GET_CACHED', tabId });
    if (cached) {
      renderSummary(cached);
    }
  } catch (_) {
    // No cached data — that's fine
  }

  try {
    const config = await sendMessage({ type: 'GET_CONFIG' });
    if (config.enabled) {
      show(llmWarning);
    }
  } catch (_) {
    // Config not loaded — that's fine
  }
})();
