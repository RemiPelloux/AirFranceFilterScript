// Thin client for the Flask JSON API. Every call accepts an AbortSignal so a new
// search can cancel the previous one instead of queueing behind it.

async function post(path, body, signal) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`Réponse invalide du serveur (HTTP ${resp.status})`);
  }
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

export const fetchCalendar = (params, signal) => post('/api/calendar', params, signal);

export const fetchFlights = (params, signal) => post('/api/flights', params, signal);

export const fetchFilteredDays = (params, signal) => post('/api/calendar-filtered', params, signal);

export async function fetchStatus() {
  const resp = await fetch('/api/status');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
