// Live log panel shown during a carrier-filtered scan.

import { $, esc } from './util.js';

const MAX_LINES = 400;

export function initLog(title) {
  $('logContainer').innerHTML = `
    <div class="log-panel" id="logPanel">
      <div class="log-header" id="logHeader" role="button" tabindex="0" aria-expanded="true">
        <div class="log-dots"><span class="d1"></span><span class="d2"></span><span class="d3"></span></div>
        <span class="log-title">${esc(title)}</span>
        <span class="log-status" id="logStatus">en cours…</span>
        <span class="log-toggle" aria-hidden="true">▼</span>
      </div>
      <div class="log-body" id="logBody" role="log"></div>
      <div class="log-progress" style="padding:0 14px 10px">
        <div class="log-bar"><div class="log-bar-fill" id="logFill" style="width:0%"></div></div>
        <span class="log-pct" id="logPct">0%</span>
      </div>
    </div>`;
  const header = $('logHeader');
  const toggle = () => {
    const collapsed = $('logPanel').classList.toggle('collapsed');
    header.setAttribute('aria-expanded', String(!collapsed));
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

/**
 * Append one line. `parts` is a list of [text, cssClass] pairs so that every
 * fragment is escaped individually and can carry its own colour.
 */
export function log(parts, type = 'info') {
  const body = $('logBody');
  if (!body) return;
  const ts = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const content = (Array.isArray(parts) ? parts : [[parts, type]])
    .map(([text, cls]) => `<span class="${cls || type}">${esc(text)}</span>`)
    .join('');
  body.insertAdjacentHTML('beforeend', `<div class="log-line"><span class="ts">[${ts}]</span> ${content}</div>`);
  while (body.childElementCount > MAX_LINES) body.firstElementChild.remove();
  body.scrollTop = body.scrollHeight;
}

export function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  const fill = $('logFill');
  if (fill) fill.style.width = `${pct}%`;
  const label = $('logPct');
  if (label) label.textContent = `${pct}%`;
}

export function finishLog(status) {
  const el = $('logStatus');
  if (el) el.textContent = status;
}

export function clearLog() {
  $('logContainer').innerHTML = '';
}
