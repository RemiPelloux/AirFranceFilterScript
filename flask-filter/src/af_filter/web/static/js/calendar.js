// Calendar grid rendering. Supports a full render (month/day views) and a
// progressive mode where skeleton cells are filled as scan chunks arrive.

import { $, esc, parseIso, capitalize, plural, price, CABIN_LABELS } from './util.js';

export const MODE = { MONTH: 'MONTH', DAY: 'DAY', FILTERED: 'DAY_FILTERED' };

/** Normalise a /api/calendar-filtered day into the generic card shape. */
export const fromScan = (d) => ({
  date: d.date,
  price: d.afPrice,
  allPrice: d.allPrice,
  afFlights: d.afFlights,
  error: d.error,
  noFlight: !d.error && (d.noFlight || d.afPrice == null),
});

const priceKey = (p, mode) => (p.showOneWay || mode === MODE.FILTERED ? 'price' : 'roundTrip');

const displayPrice = (day, key) => day[key] ?? day.price;

function dateLabel(iso, mode) {
  const dt = parseIso(iso);
  return mode === MODE.MONTH
    ? capitalize(dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))
    : dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function cardBody(day, mode, oneWay) {
  if (day.pending) return '<div class="price">000 €</div><div class="sub">recherche…</div>';
  if (day.error) return '<div class="price" style="color:var(--light-muted)">?</div><div class="sub">échec — recliquer</div>';
  if (day.noFlight) {
    const label = mode === MODE.FILTERED ? 'Pas de vol AF' : 'Pas de vol';
    return `<div class="price" style="color:var(--light-muted)">—</div><div class="sub">${label}</div>`;
  }
  const value = displayPrice(day, priceKey({ showOneWay: oneWay }, mode));
  let html = `<div class="price">${price(value)}</div>`;
  if (mode !== MODE.FILTERED) return `${html}<div class="sub">${oneWay ? 'aller simple' : 'aller-retour'}</div>`;
  html += `<div class="sub">${plural(day.afFlights, 'vol')} AF</div>`;
  if (day.allPrice != null && day.price != null && day.allPrice < day.price) {
    html += `<div class="compare">+${price(day.price - day.allPrice)} vs toutes</div>`;
  }
  return html;
}

function cardHTML(day, mode, oneWay, index) {
  const cls = ['cal-card'];
  if (day.pending) cls.push('pending');
  else if (day.error) cls.push('errored');
  else if (day.noFlight) cls.push('no-flight');
  const action = mode === MODE.MONTH
    ? `data-action="month" data-ym="${esc(day.date.slice(0, 7))}"`
    : `data-action="day" data-date="${esc(day.date)}"`;
  const badges = (day.isPromo ? '<span class="badge badge-promo">PROMO</span>' : '')
    + (mode === MODE.FILTERED && day.afFlights ? '<span class="badge badge-af">AF</span>' : '');
  return `<div class="${cls.join(' ')}" ${action} data-key="${esc(day.date)}" role="button" tabindex="0" style="--i:${index}">
    ${badges}<div class="date">${esc(dateLabel(day.date, mode))}</div>${cardBody(day, mode, oneWay)}
  </div>`;
}

function summaryHTML(days, p, mode, best) {
  const unit = mode === MODE.MONTH ? 'mois' : 'jour';
  const count = mode === MODE.MONTH ? `${days.length} mois` : plural(days.length, unit);
  return `<div class="summary" id="summary">
    <span class="route">${esc(p.origin)} → ${esc(p.destination)}</span>
    <span class="pill">${esc(CABIN_LABELS[p.cabin] || p.cabin)}</span>
    <span class="pill">${count}${mode === MODE.FILTERED ? ' · AF/HOP' : ''}</span>
    ${p.returnTrip && mode !== MODE.FILTERED ? '<span class="pill">A/R</span>' : ''}
    ${best != null ? `<span>Meilleur prix : <span class="best">${price(best)}</span></span>` : ''}
  </div>`;
}

// --- state for the progressive (filtered) mode ------------------------------
let current = { days: [], p: null, mode: null };

function bestOf(days, p, mode) {
  const key = priceKey(p, mode);
  const values = days.filter((d) => !d.pending && !d.noFlight && !d.error)
    .map((d) => displayPrice(d, key)).filter((v) => v != null);
  return values.length ? Math.min(...values) : null;
}

function highlightCheapest() {
  const { days, p, mode } = current;
  const best = bestOf(days, p, mode);
  const key = priceKey(p, mode);
  for (const day of days) {
    const el = document.querySelector(`.cal-card[data-key="${CSS.escape(day.date)}"]`);
    if (!el) continue;
    const cheapest = best != null && !day.noFlight && !day.pending && displayPrice(day, key) === best;
    el.classList.toggle('cheapest', cheapest);
    el.querySelector('.price')?.classList.toggle('cheapest-price', cheapest);
  }
  const summary = $('summary');
  if (summary) summary.outerHTML = summaryHTML(days, p, mode, best);
}

/** Render a complete calendar in one go. */
export function renderCalendar(days, p, mode) {
  current = { days, p, mode };
  if (!days.length) {
    $('results').innerHTML = '<div class="loading">Aucun vol trouvé.</div>';
    return;
  }
  const cards = days.map((d, i) => cardHTML(d, mode, p.showOneWay, i)).join('');
  $('results').innerHTML = `${summaryHTML(days, p, mode, null)}<div class="calendar-grid">${cards}</div>`;
  highlightCheapest();
}

/** Show skeleton cells for every date of a progressive scan. */
export function renderPending(dates, p) {
  renderCalendar(dates.map((date) => ({ date, pending: true })), p, MODE.FILTERED);
}

/** Replace one skeleton cell with its result, then refresh the cheapest marker. */
export function fillDays(newDays) {
  for (const day of newDays) {
    const idx = current.days.findIndex((d) => d.date === day.date);
    if (idx === -1) continue;
    current.days[idx] = day;
    const el = document.querySelector(`.cal-card[data-key="${CSS.escape(day.date)}"]`);
    if (el) el.outerHTML = cardHTML(day, current.mode, current.p.showOneWay, 0);
  }
  highlightCheapest();
}

/** Turn every still-pending cell into an error cell (e.g. after cancellation). */
export function settlePending(message) {
  fillDays(current.days.filter((d) => d.pending).map((d) => ({ date: d.date, error: message })));
}
