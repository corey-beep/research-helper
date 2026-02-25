/**
 * options.js — Settings page logic.
 * Manages save/load of external LLM configuration.
 * API keys are stored in chrome.storage.local and never logged.
 */

const elEnabled = document.getElementById('llm-enabled');
const elEndpoint = document.getElementById('llm-endpoint');
const elApiKey = document.getElementById('llm-api-key');
const elModel = document.getElementById('llm-model');
const btnSave = document.getElementById('btn-save');
const statusMsg = document.getElementById('status-msg');

/** Load saved settings. */
function loadSettings() {
  chrome.storage.local.get(
    ['llmEnabled', 'llmApiKey', 'llmEndpoint', 'llmModel'],
    (data) => {
      elEnabled.checked = data.llmEnabled || false;
      elEndpoint.value = data.llmEndpoint || '';
      elApiKey.value = data.llmApiKey || '';
      elModel.value = data.llmModel || '';
    }
  );
}

/** Save settings. */
function saveSettings() {
  const settings = {
    llmEnabled: elEnabled.checked,
    llmEndpoint: elEndpoint.value.trim(),
    llmApiKey: elApiKey.value.trim(),
    llmModel: elModel.value.trim(),
  };

  // Basic validation
  if (settings.llmEnabled) {
    if (!settings.llmEndpoint) {
      showStatus('API endpoint is required when LLM is enabled.', 'error');
      return;
    }
    if (!settings.llmApiKey) {
      showStatus('API key is required when LLM is enabled.', 'error');
      return;
    }
    try {
      new URL(settings.llmEndpoint);
    } catch (_) {
      showStatus('Invalid endpoint URL.', 'error');
      return;
    }
  }

  chrome.storage.local.set(settings, () => {
    if (chrome.runtime.lastError) {
      showStatus('Failed to save: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('Settings saved.', 'success');
    }
  });
}

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg ' + type;
  setTimeout(() => {
    statusMsg.textContent = '';
    statusMsg.className = 'status-msg';
  }, 3000);
}

btnSave.addEventListener('click', saveSettings);

// Load on init
loadSettings();
