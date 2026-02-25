/**
 * tts.js — Text-to-Speech wrapper using Piper TTS (WASM).
 * Runs entirely in the browser. Falls back to browser SpeechSynthesis if Piper fails.
 *
 * Default voice: en_US-hfc_male-medium (clear male voice)
 * Voice model downloads from Hugging Face on first use (~16MB) and caches in OPFS.
 */

const DEFAULT_VOICE = 'en_US-hfc_male-medium';

let piperModule = null;
let currentAudio = null;
let state = 'idle'; // 'idle' | 'loading' | 'generating' | 'speaking'
let stateCallback = null;
let useFallback = false;

/**
 * Set a callback that fires whenever TTS state changes.
 * @param {(state: string) => void} cb
 */
export function onStateChange(cb) {
  stateCallback = cb;
}

function setState(newState) {
  state = newState;
  if (stateCallback) stateCallback(state);
}

/**
 * Get current TTS state.
 */
export function getState() {
  return state;
}

/**
 * Initialize Piper TTS module. Called lazily on first speak().
 * Returns true if Piper loaded, false if falling back to browser TTS.
 */
async function initPiper(progressCb) {
  if (piperModule) return true;
  if (useFallback) return false;

  try {
    piperModule = await import('../vendor/piper/piper-tts-web.js');
    // Pre-download the voice model so we can show progress
    const storedVoices = await piperModule.stored();
    if (!storedVoices.includes(DEFAULT_VOICE)) {
      setState('loading');
      await piperModule.download(DEFAULT_VOICE, (progress) => {
        if (progressCb) {
          const pct = progress.total > 0
            ? Math.round((progress.loaded / progress.total) * 100)
            : 0;
          progressCb(pct);
        }
      });
    }
    return true;
  } catch (err) {
    console.warn('Piper TTS failed to load, falling back to browser voices:', err);
    useFallback = true;
    return false;
  }
}

/**
 * Speak text using Piper TTS, with browser SpeechSynthesis as fallback.
 * @param {string} text - Text to speak
 * @param {(pct: number) => void} [progressCb] - Download progress callback (first use only)
 * @returns {Promise<void>}
 */
export async function speak(text, progressCb) {
  if (!text) return;

  // Stop anything currently playing
  stop();

  const piperReady = await initPiper(progressCb);

  if (piperReady) {
    await speakWithPiper(text);
  } else {
    speakWithBrowser(text);
  }
}

async function speakWithPiper(text) {
  try {
    setState('generating');

    const wav = await piperModule.predict({
      text,
      voiceId: DEFAULT_VOICE,
    });

    // User may have clicked stop while generating
    if (state !== 'generating') return;

    const url = URL.createObjectURL(wav);
    currentAudio = new Audio(url);

    currentAudio.onplay = () => setState('speaking');
    currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      setState('idle');
    };
    currentAudio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      setState('idle');
    };

    await currentAudio.play();
  } catch (err) {
    console.warn('Piper TTS playback failed, trying browser fallback:', err);
    setState('idle');
    speakWithBrowser(text);
  }
}

function speakWithBrowser(text) {
  if (!window.speechSynthesis) {
    setState('idle');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onstart = () => setState('speaking');
  utterance.onend = () => setState('idle');
  utterance.onerror = () => setState('idle');

  window.speechSynthesis.speak(utterance);
}

/**
 * Stop any currently playing audio.
 */
export function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentAudio.src) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  setState('idle');
}
