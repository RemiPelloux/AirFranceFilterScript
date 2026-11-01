// Small DOM / formatting helpers shared by every module.

export const $ = (id) => document.getElementById(id);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for safe interpolation into HTML text or attributes. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n) => String(n).padStart(2, '0');

/** Local-time ISO date (YYYY-MM-DD), unlike toISOString() which is UTC. */
export const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const isoMonth = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

export const parseIso = (s) => new Date(`${s}T00:00:00`);

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const price = (v) => (v == null ? '—' : EUR.format(Math.round(v)));

export const hhmm = (s) => (s ? s.slice(11, 16) : '--:--');

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

export const CABIN_LABELS = {
  ECONOMY: 'Éco', PREMIUM_ECONOMY: 'Premium', BUSINESS: 'Affaires', FIRST: 'Première',
};

export const AF_CARRIERS = ['AF', 'A5'];
