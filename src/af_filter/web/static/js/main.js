// App entry: form state, search orchestration and event wiring.

import { fetchCalendar, fetchFilteredDays } from './api.js';
import { MODE, renderCalendar, renderPending, fillDays, settlePending, fromScan } from './calendar.js';
import { showFlights, closeModal } from './flights.js';
import { startSessionPolling } from './session.js';
import { initLog, log, setProgress, finishLog, clearLog } from './terminal.js';
import { $, esc, isoDate, isoMonth, capitalize, plural, price, sleep, AF_CARRIERS } from './util.js';

const SCAN_CHUNK = 5;            // dates per /api/calendar-filtered call
const SCAN_PAUSE_MS = 1500;      // breathing room for Akamai between live chunks
const CACHED_CHUNK_MS = 400;     // faster than this ⇒ served from cache ⇒ no pause
const STORAGE_KEY = 'aff:form:v1';
const IATA = /^[A-Z]{3}$/;
const FIELDS = ['origin', 'originType', 'dest', 'destType', 'cabin', 'pax', 'returnTrip', 'afOnly', 'oneWayPrice'];

const state = { view: 'MONTH', lastParams: null, controller: null };

// --- form ---------------------------------------------------------------------

function readParams() {
  return {
    origin: $('origin').value.trim().toUpperCase(),
    originType: $('originType').value,
    destination: $('dest').value.trim().toUpperCase(),
    destinationType: $('destType').value,
    cabin: $('cabin').value,
    passengers: Math.min(9, Math.max(1, parseInt($('pax').value, 10) || 1)),
    returnTrip: $('returnTrip').checked,
    afOnly: $('afOnly').checked,
    showOneWay: $('oneWayPrice').checked,
  };
}

function validate(p) {
  let ok = true;
  for (const [id, code] of [['origin', p.origin], ['dest', p.destination]]) {
    const valid = IATA.test(code);
    $(id).setAttribute('aria-invalid', String(!valid));
    ok &&= valid;
  }
  return ok;
}

function saveForm() {
  const data = Object.fromEntries(FIELDS.map((id) => {
    const el = $(id);
    return [id, el.type === 'checkbox' ? el.checked : el.value];
  }));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

function restoreForm() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { data = null; }
  if (!data) return;
  for (const id of FIELDS) {
    const el = $(id);
    if (!(id in data) || !el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(data[id]);
    else el.value = data[id];
  }
}

function swapCities() {
  for (const [a, b] of [['origin', 'dest'], ['originType', 'destType']]) {
    [$(a).value, $(b).value] = [$(b).value, $(a).value];
  }
  const btn = $('swapBtn');
  btn.classList.toggle('spin');
}

function populateMonths() {
  const now = new Date();
  $('monthPicker').innerHTML = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = capitalize(d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    return `<option value="${isoMonth(d)}">${esc(label)}</option>`;
  }).join('');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === view;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $('monthSelect').hidden = view !== 'DAY';
}

// --- searches -----------------------------------------------------------------

function monthWindow(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { y, m, last, interval: `${ym}-01/${ym}-${String(last).padStart(2, '0')}` };
}

async function searchMonths(p, signal) {
  const now = new Date();
  const end = new Date(now.getFullYear() + 1, now.getMonth(), 0);
  const interval = `${isoMonth(now)}-01/${isoDate(end)}`;
  const data = await fetchCalendar({ ...p, view: 'MONTH', departureDate: isoDate(now), dateInterval: interval }, signal);
  renderCalendar(data.days, p, MODE.MONTH);
}

async function searchDays(p, signal) {
  const ym = $('monthPicker').value;
  const { y, m, interval } = monthWindow(ym);
  const first = new Date(y, m - 1, 1);
  const today = new Date();
  const dep = isoDate(first < today ? today : first);
  const data = await fetchCalendar({ ...p, view: 'DAY', departureDate: dep, dateInterval: interval }, signal);
  renderCalendar(data.days, p, MODE.DAY);
}

function upcomingDates(ym) {
  const { y, m, last } = monthWindow(ym);
  const today = isoDate(new Date());
  return Array.from({ length: last }, (_, i) => isoDate(new Date(y, m - 1, i + 1)))
    .filter((d) => d >= today);
}

function logScanDay(d) {
  if (d.error) return log([[`${d.date}: `, 'dim'], [d.error, 'err']], 'err');
  if (d.afPrice == null) return log([[`${d.date}: `, 'dim'], ['pas de vol AF', 'warn']]);
  const cheaper = d.allPrice != null && d.allPrice < d.afPrice ? ` (toutes : ${price(d.allPrice)})` : '';
  return log([[`${d.date}: `, 'dim'], [price(d.afPrice), 'ok'],
    [` · ${plural(d.afFlights, 'vol')} AF`, 'ok'], [cheaper, 'dim']]);
}

async function scanChunk(p, chunk, signal) {
  const started = performance.now();
  try {
    const data = await fetchFilteredDays({ ...p, dates: chunk, airlineFilter: AF_CARRIERS }, signal);
    data.days.forEach(logScanDay);
    fillDays(data.days.map(fromScan));
    return data.days.filter((d) => d.afPrice != null).length;
  } catch (e) {
    if (signal.aborted) throw e;
    log(`Lot ${chunk[0]} … échoué : ${e.message}`, 'err');
    fillDays(chunk.map((date) => ({ date, error: e.message })));
    return 0;
  } finally {
    chunk.elapsed = performance.now() - started;
  }
}

async function scanFiltered(p, signal) {
  const dates = upcomingDates($('monthPicker').value);
  if (!dates.length) {
    $('results').innerHTML = '<div class="loading">Ce mois est déjà passé.</div>';
    return;
  }
  const t0 = performance.now();
  initLog(`AF/HOP · ${p.origin}→${p.destination} · ${dates.length} jours`);
  log(`Lancement — ${plural(dates.length, 'jour')}, lots de ${SCAN_CHUNK}`);
  renderPending(dates, p);
  $('stopBtn').hidden = false;
  let found = 0;
  try {
    for (let i = 0; i < dates.length; i += SCAN_CHUNK) {
      const chunk = dates.slice(i, i + SCAN_CHUNK);
      found += await scanChunk(p, chunk, signal);
      setProgress(Math.min(i + SCAN_CHUNK, dates.length), dates.length);
      const more = i + SCAN_CHUNK < dates.length;
      if (more && chunk.elapsed > CACHED_CHUNK_MS) await sleep(SCAN_PAUSE_MS, signal);
    }
  } finally {
    // A superseded scan must not hide the Stop button of the scan that replaced it.
    if (state.controller?.signal === signal) $('stopBtn').hidden = true;
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  log(`Terminé — ${found}/${dates.length} jours avec vols AF (${elapsed}s)`);
  finishLog(`${found}/${dates.length} · ${elapsed}s`);
}

async function search() {
  const p = readParams();
  if (!validate(p)) return;
  saveForm();
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.lastParams = p;
  $('searchBtn').disabled = true;
  clearLog();
  $('results').innerHTML = '<div class="loading"><div class="spinner"></div>Recherche des vols…</div>';
  try {
    if (state.view === 'MONTH') await searchMonths(p, controller.signal);
    else if (p.afOnly) await scanFiltered(p, controller.signal);
    else await searchDays(p, controller.signal);
  } catch (e) {
    if (controller.signal.aborted) {
      if (state.controller === controller) { settlePending('annulé'); finishLog('annulé'); }
      return;
    }
    $('results').innerHTML = `<div class="error-msg">Erreur : ${esc(e.message)}</div>`;
  } finally {
    if (state.controller === controller) $('searchBtn').disabled = false;
  }
}

function goToMonth(ym) {
  const picker = $('monthPicker');
  if (![...picker.options].some((o) => o.value === ym)) {
    picker.insertAdjacentHTML('beforeend', `<option value="${esc(ym)}">${esc(ym)}</option>`);
  }
  picker.value = ym;
  setView('DAY');
  search();
}

// --- wiring -------------------------------------------------------------------

function onCardActivate(target) {
  const card = target.closest('.cal-card');
  if (!card || card.classList.contains('pending') || card.classList.contains('no-flight')) return;
  if (card.dataset.action === 'month') goToMonth(card.dataset.ym);
  else if (card.dataset.action === 'day') showFlights(card.dataset.date, state.lastParams || readParams());
}

function wire() {
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(); });
  $('swapBtn').addEventListener('click', swapCities);
  for (const id of ['origin', 'dest']) {
    $(id).addEventListener('input', () => $(id).removeAttribute('aria-invalid'));
  }
  $('daySearchBtn').addEventListener('click', search);
  $('stopBtn').addEventListener('click', () => state.controller?.abort());
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    setView(t.dataset.view);
    if (t.dataset.view === 'MONTH') search();
  }));
  $('results').addEventListener('click', (e) => onCardActivate(e.target));
  $('results').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardActivate(e.target); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

restoreForm();
populateMonths();
wire();
startSessionPolling();
search();
