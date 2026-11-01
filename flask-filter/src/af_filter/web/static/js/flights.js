// Flight-details modal for a single date.

import { fetchFlights } from './api.js';
import { $, esc, parseIso, plural, price, hhmm, AF_CARRIERS } from './util.js';

let controller = null;
let lastFocus = null;

export function closeModal() {
  controller?.abort();
  controller = null;
  $('modal').innerHTML = '';
  lastFocus?.focus?.();
}

const stopsLabel = (n) => (n === 0 ? 'Direct' : plural(n, 'escale'));

function segmentHTML(seg) {
  return `<div class="seg-row" title="${esc(seg.fromCity)} → ${esc(seg.toCity)}">
    <span class="seg-time">${hhmm(seg.dep)}</span><span class="seg-code">${esc(seg.from)}</span>
    <span class="seg-arrow">→</span>
    <span class="seg-time">${hhmm(seg.arr)}</span><span class="seg-code">${esc(seg.to)}</span>
    ${seg.flightNo ? `<span class="seg-flight-no">${esc(seg.flightNo)}</span>` : ''}
  </div>`;
}

function flightHTML(fl, cheapestPrice, bookingUrl, index) {
  const isCheapest = fl.price != null && fl.price === cheapestPrice;
  const isAF = fl.carriers.length && fl.carriers.every((c) => AF_CARRIERS.includes(c));
  const tags = fl.carriers
    .map((c) => `<span class="carrier-tag${AF_CARRIERS.includes(c) ? '' : ' other'}">${esc(c)}</span>`)
    .join('');
  return `<article class="flight-card ${isCheapest ? 'cheapest-flight' : ''}" style="--i:${index}">
    <div class="flight-top">
      <div class="flight-carriers">${tags}</div>
      <div class="flight-price ${isCheapest ? 'is-cheapest' : ''}">${price(fl.price)}</div>
    </div>
    <div class="seg-list">${fl.segments.map(segmentHTML).join('')}</div>
    <div class="flight-bottom">
      <span class="flight-meta">${stopsLabel(fl.stops)}${isAF ? ' · Air France' : ''}</span>
      <a href="${esc(bookingUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sm">Réserver sur AF →</a>
    </div>
  </article>`;
}

function renderFlights(body, data, p) {
  if (!data.flights?.length) {
    body.innerHTML = `<div class="no-flights-msg">Aucun vol ${p.afOnly ? 'Air France / HOP ' : ''}trouvé pour cette date.</div>`;
    return;
  }
  const head = `<div style="font-size:12px;color:var(--muted);margin-bottom:14px">
    ${plural(data.totalFlights, 'vol')} · ${p.afOnly ? 'filtre AF/HOP actif' : 'toutes compagnies'}</div>`;
  body.innerHTML = head + data.flights
    .map((fl, i) => flightHTML(fl, data.cheapestPrice, data.bookingUrl, i)).join('');
}

function openShell(title) {
  lastFocus = document.activeElement;
  $('modal').innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-head">
          <h2 id="modalTitle">${esc(title)}</h2>
          <button type="button" class="close-btn" id="modalClose" aria-label="Fermer">✕</button>
        </div>
        <div class="modal-body" id="modalBody">
          <div class="loading"><div class="spinner"></div>Chargement des vols…</div>
        </div>
      </div>
    </div>`;
  $('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
  $('modalClose').addEventListener('click', closeModal);
  $('modalClose').focus();
}

export async function showFlights(date, p) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const label = parseIso(date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  openShell(`${p.origin} → ${p.destination} · ${label}`);
  try {
    const data = await fetchFlights({
      origin: p.origin, originType: p.originType,
      destination: p.destination, destinationType: p.destinationType,
      cabin: p.cabin, passengers: p.passengers, departureDate: date,
      airlineFilter: p.afOnly ? AF_CARRIERS : [],
    }, signal);
    const body = $('modalBody');
    if (body) renderFlights(body, data, p);
  } catch (e) {
    if (signal.aborted) return;
    const body = $('modalBody');
    if (body) body.innerHTML = `<div class="error-msg">Erreur : ${esc(e.message)}</div>`;
  }
}
