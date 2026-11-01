// Header pill showing browser-session health, polled from /api/status.

import { fetchStatus } from './api.js';
import { $ } from './util.js';

const POLL_MS = 15000;
const WARN_RATIO = 0.7;

function paint(state, text) {
  $('sessionDot').className = `session-dot ${state}`;
  $('sessionText').textContent = text;
}

async function poll() {
  try {
    const s = await fetchStatus();
    if (!s.ready) return paint('dead', 'Navigateur hors ligne');
    const minutes = Math.max(0, Math.floor(s.sessionAgeSec / 60));
    const state = s.sessionAgeSec < s.keepaliveIntervalSec * WARN_RATIO ? 'ok' : 'warn';
    const cache = s.cache?.entries ? ` · ${s.cache.entries} en cache` : '';
    return paint(state, `Session ${minutes} min${cache}`);
  } catch {
    return paint('dead', 'Serveur injoignable');
  }
}

export function startSessionPolling() {
  poll();
  setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
