import {
  Activity, ArrowDownUp, ArrowRight, BarChart3, CalendarDays, CalendarRange, Check,
  CheckCircle2, ChevronDown, CircleAlert, Clock3, Coins, Copy, Database,
  ExternalLink, Gauge, Info, Luggage, MapPin, Plane, Radar, RefreshCw,
  Route, Search, ShieldCheck, SlidersHorizontal, Sparkles, TicketCheck,
  TimerReset, Users, X, Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthPrompt } from './AuthPrompt'
import { formatDuration, rankOffers } from './lib/optimizer'
import { matchStationQuery, stationLabel } from './lib/stations'
import type { Cabin, ExploreFare, ExploreResponse, RankedOffer, SearchRequest, SearchResponse, Station } from './types'

const cabinLabels: Record<Cabin, string> = {
  ECONOMY: 'Economy',
  PREMIUM: 'Premium',
  BUSINESS: 'Business',
}

const initialOrigin: Station = {
  code: 'NCE', cityCode: 'NCE', cityName: 'Nice', countryName: 'France',
  displayText: "Nice, aéroport Nice Côte d'Azur", stationType: 'AIRPORT', isOrigin: true, isDestination: true,
}
const initialDestination: Station = {
  code: '', cityCode: '', cityName: '', countryName: '',
  displayText: '', stationType: 'AIRPORT', isOrigin: true, isDestination: true,
}

const dateOffset = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const initialRequest: SearchRequest = {
  origin: initialOrigin,
  destination: initialDestination,
  departureDate: dateOffset(45),
  returnDate: dateOffset(55),
  flexibleDays: 3,
  tripLengthDays: 10,
  cabins: ['ECONOMY'],
  paymentMode: 'both',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 24,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
}

const cashFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
})
const milesFormatter = new Intl.NumberFormat('fr-FR')
const verifiedDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})
const flightDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})

const formatCash = (value?: number) => value == null ? '—' : cashFormatter.format(value)
const formatMiles = (value?: number) => value == null ? '—' : `${milesFormatter.format(value)} M`
const dateTimeLabel = (value: string) => verifiedDateFormatter.format(new Date(value))
const flightDateLabel = (value: string) => value ? flightDateFormatter.format(new Date(value)) : '—'
const readableDate = (value: string) => value.split('-').reverse().join('/')
const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const addIsoDays = (isoDate: string, days: number) => {
  if (!isIsoDate(isoDate)) return isoDate
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function SafeDateInput({
  value,
  min,
  disabled = false,
  onCommit,
}: {
  value: string
  min?: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return <input
    type="date"
    value={draft}
    min={min}
    disabled={disabled}
    onChange={(event) => {
      const next = event.target.value
      setDraft(next)
      if (isIsoDate(next)) onCommit(next)
    }}
    onBlur={() => { if (!isIsoDate(draft)) setDraft(value) }}
  />
}

interface StationAutocompleteProps {
  label: string
  value: Station
  onChange: (station: Station) => void
  destination?: boolean
  onPendingChange?: (pending: boolean) => void
}

function StationAutocomplete({ label, value, onChange, destination = false, onPendingChange }: StationAutocompleteProps) {
  const [query, setQuery] = useState(stationLabel(value))
  const [options, setOptions] = useState<Station[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [selectionError, setSelectionError] = useState(false)

  useEffect(() => {
    const clean = query.replace(/\([^)]*\)/g, '').trim()
    if (!open || clean.length < 2) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setFetchError(false)
      try {
        const response = await fetch(`/api/stations?q=${encodeURIComponent(clean)}`, { signal: controller.signal })
        const payload = await response.json() as { results: Station[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Référentiel indisponible')
        setOptions(payload.results.filter((station) => destination ? station.isDestination : station.isOrigin))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setOptions([])
        setFetchError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [destination, open, query])

  const select = (station: Station) => {
    onChange(station)
    onPendingChange?.(false)
    setSelectionError(false)
    setQuery(stationLabel(station))
    setOpen(false)
  }

  const resolveQuery = async () => {
    const localMatch = matchStationQuery(query, options)
    if (localMatch) return select(localMatch)
    const clean = query.replace(/\([^)]*\)/g, '').trim()
    if (clean.length < 2) {
      setSelectionError(true)
      return
    }
    try {
      const response = await fetch(`/api/stations?q=${encodeURIComponent(clean)}`)
      const payload = await response.json() as { results: Station[] }
      const eligible = payload.results.filter((station) => destination ? station.isDestination : station.isOrigin)
      const remoteMatch = matchStationQuery(query, eligible)
      if (remoteMatch) return select(remoteMatch)
    } catch {
      setFetchError(true)
    }
    setSelectionError(true)
    setOpen(true)
  }

  return (
    <div className="station-field">
      <label>{label}</label>
      <div className="station-input-wrap">
        <MapPin size={17} aria-hidden="true" />
        <input
          value={query}
          placeholder={destination ? 'Ville ou code destination' : 'Ville ou code départ'}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectionError(false)
            onPendingChange?.(true)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => { void resolveQuery(); setOpen(false) }, 130)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void resolveQuery()
          }}
          aria-invalid={selectionError}
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
        />
        <span className="station-code">{value.code}</span>
      </div>
      {open && (
        <div className="station-options" role="listbox">
          {loading && <div className="station-loading"><RefreshCw className="spin" size={15} /> Référentiel Air France</div>}
          {!loading && fetchError && <div className="station-empty"><CircleAlert size={14} /> Air France ne répond pas</div>}
          {!loading && !fetchError && options.map((station) => (
            <button key={`${station.code}-${station.stationType}`} type="button" role="option" onMouseDown={() => select(station)}>
              <span className="option-code">{station.code}</span>
              <span><strong>{station.cityName}</strong><small>{station.countryName} · {station.stationType === 'CITY' ? 'Tous les aéroports' : station.displayText.split(',').at(-1)}</small></span>
            </button>
          ))}
          {!loading && !fetchError && options.length === 0 && <div className="station-empty">Aucun aéroport correspondant</div>}
        </div>
      )}
      {selectionError && <span className="station-validation"><CircleAlert size={12} /> Choisissez une suggestion Air France</span>}
    </div>
  )
}

function RouteRibbon({ offer, baseline }: { offer: RankedOffer; baseline?: number }) {
  const isDetour = offer.stops > 1
  const cash = offer.selectedPrice.cash
  const delta = baseline != null && cash != null ? cash - baseline : undefined
  return (
    <div className={`route-ribbon ${isDetour ? 'is-detour' : ''}`}>
      <div className="route-track" aria-label={`Itinéraire ${offer.route.join(' vers ')}`}>
        {offer.route.map((code, index) => (
          <div className="route-stop" key={`${code}-${index}`}>
            <span className="route-node">{index === 0 ? <Plane size={14} /> : index === offer.route.length - 1 ? <MapPin size={14} /> : <span />}</span>
            <strong>{code}</strong>
            {index < offer.route.length - 1 && <span className="route-line" />}
          </div>
        ))}
      </div>
      {delta != null && <div className={`route-delta ${delta <= 0 ? 'positive' : ''}`}>
        {delta === 0 ? 'Référence' : `${delta > 0 ? '+' : '−'}${formatCash(Math.abs(delta))}`}
      </div>}
    </div>
  )
}

const OfferRow = memo(function OfferRow({ offer, baseline }: { offer: RankedOffer; baseline?: number }) {
  const [expanded, setExpanded] = useState(false)
  const carrier = Array.from(new Set(offer.segments.map((segment) => segment.carrier))).join(' + ')
  return (
    <article className={`offer-row ${offer.paretoOptimal ? 'is-pareto' : ''} ${expanded ? 'is-expanded' : ''}`} id={`offer-${offer.id}`}>
      <button type="button" className="offer-main" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <div className="offer-carrier">
          <span className="carrier-mark">{carrier.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span>
          <span><strong>{carrier}</strong><small>Billet Air France</small></span>
        </div>
        <div className="offer-route-cell">
          <RouteRibbon offer={offer} baseline={baseline} />
          <span className="offer-times">{offer.segments[0]?.departure || '—'} <ArrowRight size={13} /> {offer.segments.at(-1)?.arrival || '—'}</span>
        </div>
        <div className="offer-metrics">
          <span><Clock3 size={14} /> {formatDuration(offer.totalDurationMinutes)}</span>
          <span>{offer.stops === 0 ? 'Direct' : `${offer.stops} escale${offer.stops > 1 ? 's' : ''}`}</span>
        </div>
        <div className="offer-pricing">
          <span className="cabin-label">{cabinLabels[offer.selectedPrice.cabin]}</span>
          <strong>{formatCash(offer.selectedPrice.cash)}</strong>
          <small>{offer.selectedPrice.miles ? `${formatMiles(offer.selectedPrice.miles)} + ${formatCash(offer.selectedPrice.taxes)}` : 'Miles non exposés'}</small>
        </div>
        <div className="score-cell">
          <span className={`risk-dot risk-${offer.risk}`} title={`Risque ${offer.risk}`} />
          <strong>{offer.dealScore}</strong><small>score</small>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      </button>
      <div className="offer-badges">
        {offer.departureDate && offer.returnDate && <span>{readableDate(offer.departureDate)} → {readableDate(offer.returnDate)}</span>}
        {offer.badges.map((badge) => <span key={badge}>{badge}</span>)}
        {offer.paretoOptimal && <span className="pareto-badge"><Sparkles size={12} /> Pareto</span>}
      </div>
      {expanded && (
        <div className="offer-detail">
          <div className="segment-timeline">
            {offer.segments.map((segment, index) => (
              <div className="segment" key={`${segment.from}-${segment.to}-${index}`}>
                <div className="segment-dot" />
                <div className="segment-copy">
                  <strong>{segment.from} <ArrowRight size={13} /> {segment.to}</strong>
                  <small>{segment.flightNumber || segment.carrier}{segment.aircraft ? ` · ${segment.aircraft}` : ''}</small>
                  <small>{flightDateLabel(segment.departure)} → {flightDateLabel(segment.arrival)}{segment.durationMinutes ? ` · ${formatDuration(segment.durationMinutes)}` : ''}</small>
                  {segment.operatingCarrier && segment.operatingCarrier !== segment.carrier && <small>Opéré par {segment.operatingCarrier}{segment.operatingFlightNumber ? ` · ${segment.operatingFlightNumber}` : ''}</small>}
                  {segment.layoverAfterMinutes != null && <small className="layover-line">Correspondance {formatDuration(segment.layoverAfterMinutes)}</small>}
                </div>
              </div>
            ))}
          </div>
          <div className="fare-facts">
            <span><TicketCheck size={15} /> Tarif capturé chez Air France</span>
            <span><Luggage size={15} /> {offer.bagsIncluded == null ? 'Bagage à vérifier' : offer.bagsIncluded ? 'Bagage inclus' : 'Bagage non inclus'}</span>
            <span><ShieldCheck size={15} /> {offer.singleTicket ? 'Correspondances protégées' : 'Billets séparés'}</span>
          </div>
          <div className="cabin-grid">
            {offer.prices.map((price) => (
              <div key={price.cabin}>
                <span>{cabinLabels[price.cabin]}</span>
                <strong>{formatCash(price.cash)}</strong>
                <small>{price.miles ? `${formatMiles(price.miles)}${price.taxes ? ` + ${formatCash(price.taxes)}` : ''}` : 'Miles non exposés'}</small>
                <small>{[price.fareFamily, price.seatsAvailable != null ? `${price.seatsAvailable} siège${price.seatsAvailable > 1 ? 's' : ''}` : undefined].filter(Boolean).join(' · ') || 'Inventaire non exposé'}</small>
              </div>
            ))}
          </div>
          <a className="af-link" href="https://wwws.airfrance.fr/" target="_blank" rel="noreferrer">
            Ouvrir Air France <ExternalLink size={14} />
          </a>
        </div>
      )}
    </article>
  )
})

function FrontierChart({ offers }: { offers: RankedOffer[] }) {
  const [selectedId, setSelectedId] = useState<string>()
  const cashOffers = offers.filter((offer) => offer.selectedPrice.cash != null)
  if (!cashOffers.length) return <div className="analysis-empty">La frontière apparaîtra dès qu’Air France renverra des prix en euros.</div>

  const width = 760
  const height = 250
  const inset = { top: 22, right: 34, bottom: 40, left: 58 }
  const durations = cashOffers.map((offer) => offer.totalDurationMinutes)
  const prices = cashOffers.map((offer) => offer.selectedPrice.cash!)
  const minDuration = Math.min(...durations)
  const maxDuration = Math.max(...durations)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const x = (duration: number) => inset.left + ((duration - minDuration) / Math.max(1, maxDuration - minDuration)) * (width - inset.left - inset.right)
  const y = (price: number) => height - inset.bottom - ((price - minPrice) / Math.max(1, maxPrice - minPrice)) * (height - inset.top - inset.bottom)
  const selected = cashOffers.find((offer) => offer.id === selectedId) ?? cashOffers.find((offer) => offer.paretoOptimal) ?? cashOffers[0]

  const focusOffer = (offer: RankedOffer) => {
    setSelectedId(offer.id)
    document.getElementById(`offer-${offer.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section className="frontier-panel" aria-label="Frontière prix durée">
      <div className="frontier-heading">
        <div><span>Frontière live</span><strong>Prix contre temps de trajet</strong></div>
        <div className="frontier-legend"><span><i className="dot-pareto" /> Optimal</span><span><i /> Dominé</span></div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Nuage de points des offres selon leur prix et leur durée">
          {[0, 1, 2, 3].map((step) => {
            const lineY = inset.top + step * ((height - inset.top - inset.bottom) / 3)
            return <line key={step} x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} className="chart-grid" />
          })}
          <text x={inset.left} y={height - 12} className="chart-label">{formatDuration(minDuration)}</text>
          <text x={width - inset.right} y={height - 12} textAnchor="end" className="chart-label">{formatDuration(maxDuration)}</text>
          <text x={8} y={inset.top + 4} className="chart-label">{formatCash(maxPrice)}</text>
          <text x={8} y={height - inset.bottom + 4} className="chart-label">{formatCash(minPrice)}</text>
          {cashOffers.map((offer) => (
            <g
              key={offer.id}
              role="button"
              tabIndex={0}
              aria-label={`${offer.route.join(' via ')}, ${formatCash(offer.selectedPrice.cash)}, ${formatDuration(offer.totalDurationMinutes)}`}
              onClick={() => focusOffer(offer)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') focusOffer(offer) }}
              className={`chart-point ${offer.paretoOptimal ? 'is-optimal' : ''} ${selected.id === offer.id ? 'is-selected' : ''}`}
            >
              <circle cx={x(offer.totalDurationMinutes)} cy={y(offer.selectedPrice.cash!)} r={selected.id === offer.id ? 8 : 6} />
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-selection">
        <span>{selected.route.join(' · ')}</span>
        <strong>{formatCash(selected.selectedPrice.cash)}</strong>
        <small>{formatDuration(selected.totalDurationMinutes)} · {selected.stops === 0 ? 'direct' : `${selected.stops} escale${selected.stops > 1 ? 's' : ''}`} · score {selected.dealScore}</small>
      </div>
    </section>
  )
}

function MonthlyCalendar({
  items,
  request,
  onSelect,
}: {
  items: SearchResponse['monthlyCalendar']
  request: SearchRequest
  onSelect: (flightDate: string) => void
}) {
  if (!items.length) return <div className="analysis-empty">Air France n’a retourné aucun plancher mensuel pour cette route.</div>
  const lowestCash = Math.min(...items.map((item) => item.cash ?? Infinity))
  const lowestMiles = Math.min(...items.map((item) => item.miles ?? Infinity))
  const bestCashMonths = items.filter((item) => item.cash === lowestCash)
  const bestMilesMonths = items.filter((item) => item.miles === lowestMiles)
  const tiedMonths = (best: typeof items) => best.length > 1 ? `${best[0].label} +${best.length - 1} ex æquo` : best[0]?.label
  return (
    <section className="monthly-horizon" aria-label="Meilleur prix Air France par mois">
      <div className="calendar-heading">
        <div><span>Open Dates · horizon réseau</span><strong>Meilleur prix de chaque mois</strong></div>
        <small>{items.length} mois disponibles · prix aller-retour</small>
      </div>
      <div className="month-leaders" aria-label="Meilleurs mois">
        {bestCashMonths[0]?.cashFlightDate && <button type="button" onClick={() => onSelect(bestCashMonths[0].cashFlightDate!)}>
          <span>Meilleur mois en euros</span><strong>{formatCash(lowestCash)}</strong><small>{tiedMonths(bestCashMonths)} · {readableDate(bestCashMonths[0].cashFlightDate)}</small><ArrowRight size={15} />
        </button>}
        {bestMilesMonths[0]?.milesFlightDate && <button type="button" className="miles" onClick={() => onSelect(bestMilesMonths[0].milesFlightDate!)}>
          <span>Meilleur mois en Miles</span><strong>{formatMiles(lowestMiles)}</strong><small>{tiedMonths(bestMilesMonths)} · {readableDate(bestMilesMonths[0].milesFlightDate)}</small><ArrowRight size={15} />
        </button>}
      </div>
      <div className="month-grid">
        {items.map((item) => {
          const bestCash = item.cash != null && item.cash === lowestCash
          const bestMiles = item.miles != null && item.miles === lowestMiles
          const selected = item.month === request.departureDate.slice(0, 7)
          return <div className={`month-cell ${selected ? 'is-selected' : ''} ${bestCash || bestMiles ? 'is-cheapest' : ''}`} key={item.month}>
            <span className="month-name">{item.label}</span>
            <span className="month-prices">
              {item.cash != null && item.cashFlightDate && <button type="button" className={bestCash ? 'is-best' : ''} onClick={() => onSelect(item.cashFlightDate!)}>
                <span><strong>{formatCash(item.cash)}</strong><small>A/R · {readableDate(item.cashFlightDate)}</small></span><ArrowRight size={12} />
              </button>}
              {item.miles != null && item.milesFlightDate && <button type="button" className={`miles-price ${bestMiles ? 'is-best' : ''}`} onClick={() => onSelect(item.milesFlightDate!)}>
                <span><strong>{formatMiles(item.miles)}</strong><small>A/R · {readableDate(item.milesFlightDate)}</small></span><ArrowRight size={12} />
              </button>}
            </span>
            <span className="month-action">{bestCash || bestMiles ? [bestCash ? 'Plus bas €' : '', bestMiles ? 'Plus bas Miles' : ''].filter(Boolean).join(' · ') : 'Repricing aller-retour'}</span>
          </div>
        })}
      </div>
      <div className="calendar-proof"><CheckCircle2 size={14} /> Planchers `SharedSearchLowestFareOffersForSearchQuery: MONTH` · dates € et Miles conservées séparément</div>
    </section>
  )
}

function FareCalendar({ items, request }: { items: SearchResponse['fareCalendar']; request: SearchRequest }) {
  if (!items.length) return <div className="analysis-empty">Air France n’a pas retourné de fenêtre tarifaire pour cette recherche.</div>
  const comparable = (item: SearchResponse['fareCalendar'][number]) => {
    if (request.paymentMode === 'cash') return item.cash ?? Infinity
    if (request.paymentMode === 'miles') return item.miles ?? Infinity
    return Math.min(item.cash ?? Infinity, item.miles == null ? Infinity : item.miles * request.mileValueCents / 100 + (item.taxes ?? 0))
  }
  const values = items.map(comparable).filter(Number.isFinite)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return (
    <section className="fare-calendar" aria-label="Couples de dates tarifés par Air France">
      <div className="calendar-heading">
        <div><span>Pricings exacts Air France</span><strong>{request.tripLengthDays} jours sur place</strong></div>
        <small>{items.length} couple{items.length > 1 ? 's' : ''} vérifié{items.length > 1 ? 's' : ''} · fenêtre ±{request.flexibleDays} j</small>
      </div>
      <div className="calendar-bars">
        {items.map((item) => {
          const value = comparable(item)
          const height = 35 + ((value - min) / Math.max(1, max - min)) * 100
          return <div className={`calendar-day ${value === min ? 'is-cheapest' : ''} ${item.selected ? 'is-selected' : ''}`} key={`${item.departureDate}-${item.returnDate}`}>
            <strong>{item.cash != null ? formatCash(item.cash) : formatMiles(item.miles)}</strong>
            <div className="calendar-bar-track"><span style={{ height }} /></div>
            <small>{item.label}{item.miles != null && item.cash != null ? ` · ${formatMiles(item.miles)}` : ''}</small>
            {value === min && <em>Meilleur couple</em>}
          </div>
        })}
      </div>
      <div className="calendar-proof"><CheckCircle2 size={14} /> Chaque barre provient d’un `SearchResultAvailableOffersQuery` aller-retour exact</div>
    </section>
  )
}

function ExploreTop3({
  fares,
  mode,
  onSelect,
}: {
  fares: ExploreFare[]
  mode: 'cash' | 'miles'
  onSelect: (date: string, mode: 'cash' | 'miles') => void
}) {
  if (!fares.length) return <span className="explore-missing">—</span>
  return <div className={`explore-top3 ${mode}`}>
    {fares.map((fare, index) => <button type="button" key={`${mode}-${fare.date}`} onClick={() => onSelect(fare.date, mode)}>
      <span className="explore-rank">{index + 1}</span>
      <span><strong>{mode === 'cash' ? formatCash(fare.price) : formatMiles(fare.price)}</strong><small>{readableDate(fare.date)}{mode === 'miles' && fare.taxes != null ? ` · +${formatCash(fare.taxes)}` : ''}</small></span>
      <ArrowRight size={12} />
    </button>)}
  </div>
}

function ExploreCalendar({
  response,
  paymentMode,
  onSelect,
}: {
  response: ExploreResponse
  paymentMode: 'cash' | 'both'
  onSelect: (date: string, mode: 'cash' | 'miles') => void
}) {
  const showMiles = paymentMode === 'both'
  const cashFares = response.months.flatMap((month) => month.cashTop3.map((fare) => ({ ...fare, month: month.label })))
  const milesFares = response.months.flatMap((month) => month.milesTop3.map((fare) => ({ ...fare, month: month.label })))
  const bestCash = cashFares.sort((left, right) => left.price - right.price)[0]
  const bestMiles = milesFares.sort((left, right) => left.price - right.price)[0]
  return <section className={`explore-calendar ${showMiles ? '' : 'cash-only'}`} aria-label="Top 3 mensuel Air France">
    <div className="explore-summary">
      {bestCash && <button type="button" onClick={() => onSelect(bestCash.date, 'cash')}><span>Minimum annuel euros</span><strong>{formatCash(bestCash.price)}</strong><small>{bestCash.month} · {readableDate(bestCash.date)}</small><ArrowRight size={15} /></button>}
      {showMiles && bestMiles && <button type="button" className="miles" onClick={() => onSelect(bestMiles.date, 'miles')}><span>Minimum annuel Miles</span><strong>{formatMiles(bestMiles.price)}</strong><small>{bestMiles.month} · {readableDate(bestMiles.date)}{bestMiles.taxes != null ? ` · +${formatCash(bestMiles.taxes)}` : ''}</small><ArrowRight size={15} /></button>}
    </div>
    <div className="explore-table-head"><span>Mois</span><span>Top 3 euros · A/R</span>{showMiles && <span>Top 3 Miles · A/R</span>}</div>
    <div className="explore-months">
      {response.months.map((month) => <div className="explore-month" key={month.month}>
        <div className="explore-month-name"><span>{month.label}</span><small>{month.cashTop3.length + month.milesTop3.length} tarifs live</small></div>
        <ExploreTop3 fares={month.cashTop3} mode="cash" onSelect={onSelect} />
        {showMiles && <ExploreTop3 fares={month.milesTop3} mode="miles" onSelect={onSelect} />}
      </div>)}
    </div>
    <div className="calendar-proof"><CheckCircle2 size={14} /> Top 3 issus de `MONTH`, puis `DAY` pour chaque mois · aucun prix extrapolé</div>
  </section>
}

function LiveSearchState({ elapsed, onCancel }: { elapsed: number; onCancel: () => void }) {
  return (
    <div className="live-search-state" role="status">
      <div className="radar-scope"><Radar size={28} /><span /></div>
      <div><strong>Air France calcule les disponibilités</strong><span>Session live · {elapsed.toFixed(1)} s</span></div>
      <button type="button" onClick={onCancel}><X size={15} /> Annuler</button>
    </div>
  )
}

type ResultView = 'deals' | 'all' | 'analysis' | 'months' | 'calendar'
type SortMode = 'deal' | 'cash' | 'miles' | 'duration'
type SearchMode = 'search' | 'explore'

function App() {
  const [request, setRequest] = useState<SearchRequest>(initialRequest)
  const [response, setResponse] = useState<SearchResponse>()
  const [exploreResponse, setExploreResponse] = useState<ExploreResponse>()
  const [searchMode, setSearchMode] = useState<SearchMode>('search')
  const [explorePaymentMode, setExplorePaymentMode] = useState<'cash' | 'both'>('both')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string>()
  const [sort, setSort] = useState<SortMode>('deal')
  const [view, setView] = useState<ResultView>('deals')
  const [advanced, setAdvanced] = useState(true)
  const [cabinMenu, setCabinMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [originPending, setOriginPending] = useState(false)
  const [destinationPending, setDestinationPending] = useState(false)
  const searchController = useRef<AbortController | undefined>(undefined)
  const routeReady = !originPending
    && !destinationPending
    && /^[A-Z0-9]{3}$/.test(request.origin.code)
    && /^[A-Z0-9]{3}$/.test(request.destination.code)
    && request.origin.code !== request.destination.code

  const changeSearchMode = (mode: SearchMode) => {
    searchController.current?.abort()
    setLoading(false)
    setError(undefined)
    setSearchMode(mode)
  }

  useEffect(() => {
    if (!loading) return
    const startedAt = performance.now()
    const timer = window.setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [loading])

  const ranked = useMemo(() => {
    const offers = rankOffers(response?.offers ?? [], request)
    return [...offers].sort((a, b) => {
      if (sort === 'cash') return (a.selectedPrice.cash ?? Infinity) - (b.selectedPrice.cash ?? Infinity)
      if (sort === 'miles') return (a.selectedPrice.miles ?? Infinity) - (b.selectedPrice.miles ?? Infinity)
      if (sort === 'duration') return a.totalDurationMinutes - b.totalDurationMinutes
      return b.dealScore - a.dealScore
    })
  }, [request, response?.offers, sort])

  const visibleOffers = useMemo(() => view === 'deals' ? ranked.filter((offer) => offer.paretoOptimal) : ranked, [ranked, view])
  const bestCash = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => (
    offer.selectedPrice.cash != null && (best?.selectedPrice.cash == null || offer.selectedPrice.cash < best.selectedPrice.cash) ? offer : best
  ), undefined), [ranked])
  const bestMiles = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => (
    offer.selectedPrice.miles != null && (best?.selectedPrice.miles == null || offer.selectedPrice.miles < best.selectedPrice.miles) ? offer : best
  ), undefined), [ranked])
  const fastest = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => !best || offer.totalDurationMinutes < best.totalDurationMinutes ? offer : best, undefined), [ranked])
  const baseline = bestCash?.selectedPrice.cash

  const patchRequest = <K extends keyof SearchRequest>(key: K, value: SearchRequest[K]) => setRequest((current) => ({ ...current, [key]: value }))
  const toggleCabin = (cabin: Cabin) => setRequest((current) => {
    const cabins = current.cabins.includes(cabin) ? current.cabins.filter((item) => item !== cabin) : [...current.cabins, cabin]
    return { ...current, cabins: cabins.length ? cabins : current.cabins }
  })
  const swapStations = () => {
    setOriginPending(false)
    setDestinationPending(false)
    setRequest((current) => ({ ...current, origin: current.destination, destination: current.origin }))
  }
  const setDepartureDate = (departureDate: string) => setRequest((current) => ({
    ...current,
    departureDate,
    returnDate: current.flexibleDays ? addIsoDays(departureDate, current.tripLengthDays) : current.returnDate,
  }))
  const setFlexibleDays = (flexibleDays: number) => setRequest((current) => ({
    ...current,
    flexibleDays,
    returnDate: flexibleDays ? addIsoDays(current.departureDate, current.tripLengthDays) : current.returnDate,
  }))
  const setTripLength = (tripLengthDays: number) => setRequest((current) => ({
    ...current,
    tripLengthDays,
    returnDate: addIsoDays(current.departureDate, tripLengthDays),
  }))

  const executeSearch = useCallback(async (searchRequest: SearchRequest) => {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setLoading(true)
    setElapsed(0)
    setError(undefined)
    try {
      const result = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchRequest), signal: controller.signal,
      })
      const payload = await result.json() as SearchResponse & { error?: string }
      if (!result.ok) throw new Error(payload.error ?? 'Recherche impossible')
      setResponse(payload)
      setView(payload.offers.length ? 'deals' : 'all')
    } catch (searchError) {
      if (searchError instanceof DOMException && searchError.name === 'AbortError') return
      setError(searchError instanceof Error ? searchError.message : 'Le moteur ne répond pas')
    } finally {
      if (searchController.current === controller) setLoading(false)
    }
  }, [])

  const runSearch = useCallback(() => {
    setSearchMode('search')
    void executeSearch(request)
  }, [executeSearch, request])

  const runExplore = useCallback(async () => {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearchMode('explore')
    setLoading(true)
    setElapsed(0)
    setError(undefined)
    setExploreResponse(undefined)
    try {
      const result = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: request.origin, destination: request.destination, paymentMode: explorePaymentMode }),
        signal: controller.signal,
      })
      const payload = await result.json() as ExploreResponse & { error?: string }
      if (!result.ok) throw new Error(payload.error ?? 'Exploration impossible')
      setExploreResponse(payload)
    } catch (exploreError) {
      if (exploreError instanceof DOMException && exploreError.name === 'AbortError') return
      setError(exploreError instanceof Error ? exploreError.message : 'Le moteur ne répond pas')
    } finally {
      if (searchController.current === controller) setLoading(false)
    }
  }, [explorePaymentMode, request.destination, request.origin])

  const selectExploreFare = useCallback((departureDate: string, paymentMode: 'cash' | 'miles') => {
    const nextRequest: SearchRequest = {
      ...request,
      departureDate,
      returnDate: addIsoDays(departureDate, request.tripLengthDays),
      flexibleDays: 1,
      paymentMode,
    }
    setRequest(nextRequest)
    setSearchMode('search')
    void executeSearch(nextRequest)
  }, [executeSearch, request])

  const selectMonthlyDate = useCallback((departureDate: string) => {
    const nextRequest = { ...request, departureDate, returnDate: addIsoDays(departureDate, request.tripLengthDays) }
    setRequest(nextRequest)
    setView('deals')
    void executeSearch(nextRequest)
  }, [executeSearch, request])

  const cancelSearch = () => {
    searchController.current?.abort()
    setLoading(false)
  }

  const copySearch = async () => {
    const text = `${request.origin.code} → ${request.destination.code} · ${readableDate(request.departureDate)} au ${readableDate(request.returnDate)} · ${request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const emptyTitle = response?.status === 'blocked'
    ? 'Collecte interrompue par Air France'
    : response?.status === 'auth-required'
      ? 'Connexion Flying Blue requise'
      : response?.status === 'empty'
        ? 'Aucune offre retournée'
        : 'Lancez une recherche live'
  const emptyText = response
    ? response.warnings[0] ?? 'Modifiez les dates ou les contraintes, puis relancez.'
    : 'Choisissez une route, puis interrogez Air France.'
  const exploreEmptyTitle = exploreResponse?.status === 'blocked'
    ? 'Exploration interrompue par Air France'
    : exploreResponse?.status === 'auth-required'
      ? 'Connexion Flying Blue requise'
      : exploreResponse?.status === 'empty'
        ? 'Aucun calendrier retourné'
        : 'Explorez les douze prochains mois'
  const exploreEmptyText = exploreResponse
    ? exploreResponse.warnings[0] ?? 'Air France ne publie aucun tarif calendrier pour cette route.'
    : 'Saisissez uniquement le départ et la destination pour comparer les trois meilleurs jours de chaque mois.'
  const activeWarnings = searchMode === 'explore' ? exploreResponse?.warnings : response?.warnings
  const needsFlyingBlueAuth = searchMode === 'explore'
    ? Boolean(exploreResponse?.authRequired || exploreResponse?.status === 'auth-required')
    : Boolean(response?.authRequired || response?.status === 'auth-required')
  const retryAfterAuth = searchMode === 'explore' ? runExplore : runSearch
  const nonAuthWarnings = activeWarnings?.filter((warning) => !/Flying Blue|connexion/i.test(warning))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-wing"><Plane size={18} /></span><strong>Ratline</strong><span>live deal desk</span></div>
        <nav aria-label="Navigation principale">
          <button className="active" type="button"><Search size={16} /> Recherche</button>
          <span className="network-contract"><Activity size={15} /> AF network parity</span>
        </nav>
        <div className="top-actions">
          <span className="source-status source-live"><span />Air France uniquement</span>
          <button type="button" className="icon-button" title="Copier la recherche" onClick={copySearch}>{copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="search-panel">
          <div className="context-visual">
            <div><span>Recherche réseau</span><strong>{request.origin.code || '—'} <ArrowRight size={18} /> {request.destination.code || '—'}</strong></div>
          </div>

          <div className="search-panel-body">
            <div className="panel-heading"><div><span>Nouvelle analyse</span><h1>Détecter le meilleur routage</h1></div><span className="live-pill"><Zap size={13} /> Live</span></div>

            <div className="search-mode-switch" aria-label="Mode de recherche">
              <button type="button" className={searchMode === 'search' ? 'active' : ''} onClick={() => changeSearchMode('search')}><Search size={15} /> Recherche</button>
              <button type="button" className={searchMode === 'explore' ? 'active' : ''} onClick={() => changeSearchMode('explore')}><CalendarRange size={15} /> Explorer 12 mois</button>
            </div>

            <div className="journey-fields">
              <StationAutocomplete key={`origin-${request.origin.code}`} label="Départ" value={request.origin} onPendingChange={setOriginPending} onChange={(station) => patchRequest('origin', station)} />
              <button className="swap-button" type="button" onClick={swapStations} title="Inverser les aéroports"><ArrowDownUp size={16} /></button>
              <StationAutocomplete key={`destination-${request.destination.code || 'empty'}`} label="Destination" value={request.destination} destination onPendingChange={setDestinationPending} onChange={(station) => patchRequest('destination', station)} />
            </div>

            {searchMode === 'explore' && <label className="explore-payment-select">
              <span>Tarifs à comparer</span>
              <div><Coins size={16} /><select value={explorePaymentMode} onChange={(event) => setExplorePaymentMode(event.target.value as 'cash' | 'both')}>
                <option value="cash">Prix en euros</option>
                <option value="both">Euros + Miles</option>
              </select><ChevronDown size={15} /></div>
            </label>}

            {searchMode === 'search' && <><div className="field-row dates-row">
              <label><span>Aller cible</span><div className="compact-input"><CalendarDays size={16} /><SafeDateInput key={`departure-${request.departureDate}`} value={request.departureDate} min={dateOffset(1)} onCommit={setDepartureDate} /></div></label>
              <label><span>Retour</span><div className="compact-input"><CalendarDays size={16} /><SafeDateInput key={`return-${request.returnDate}`} value={request.returnDate} min={request.departureDate} disabled={request.flexibleDays > 0} onCommit={(value) => patchRequest('returnDate', value)} /></div></label>
            </div>

            <div className="flex-controls">
              <label className="check-line"><input type="checkbox" checked={request.flexibleDays > 0} onChange={(event) => setFlexibleDays(event.target.checked ? 3 : 0)} /><span><Check size={12} /></span>Dates flexibles</label>
              <label><span>Fenêtre</span><div className="compact-input"><input type="number" min="1" max="30" disabled={!request.flexibleDays} value={request.flexibleDays || 3} onChange={(event) => setFlexibleDays(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} /><small>± j</small></div></label>
              <label><span>Séjour</span><div className="compact-input"><input type="number" min="1" max="30" value={request.tripLengthDays} onChange={(event) => setTripLength(Number(event.target.value))} /><small>j</small></div></label>
            </div>

            <div className="field-row">
              <label><span>Voyageurs</span><div className="compact-input"><Users size={16} /><input type="number" min="1" max="9" value={request.adults} onChange={(event) => patchRequest('adults', Number(event.target.value))} /><small>adulte</small></div></label>
              <div className="cabin-control">
                <span>Cabines</span>
                <button type="button" onClick={() => setCabinMenu((value) => !value)} aria-expanded={cabinMenu}>{request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')} <ChevronDown size={14} /></button>
                {cabinMenu && <div className="cabin-menu">
                  {(Object.keys(cabinLabels) as Cabin[]).map((cabin) => <label key={cabin}><input type="checkbox" checked={request.cabins.includes(cabin)} onChange={() => toggleCabin(cabin)} /><span><Check size={13} /></span>{cabinLabels[cabin]}</label>)}
                </div>}
              </div>
            </div>

            <div className="mode-section">
              <span>Payer avec</span>
              <div className="segmented-control">
                {([['cash', 'Euros'], ['miles', 'Miles'], ['both', 'Comparer']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" className={request.paymentMode === mode ? 'active' : ''} onClick={() => patchRequest('paymentMode', mode)}>{mode === 'miles' && <Coins size={14} />}{label}</button>
                ))}
              </div>
              {request.paymentMode !== 'cash' && <label className="mile-value"><span>Valeur d’un Mile</span><input type="range" min="0.5" max="3" step="0.1" value={request.mileValueCents} onChange={(event) => patchRequest('mileValueCents', Number(event.target.value))} /><strong>{request.mileValueCents.toFixed(1)} c</strong></label>}
            </div>

            <button className="advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}><SlidersHorizontal size={16} /> Contraintes de trajet <ChevronDown size={15} /></button>
            {advanced && <div className="advanced-fields">
              <label><span>Escales max.</span><div className="stepper">{([0, 1, 2] as const).map((value) => <button type="button" className={request.maxStops === value ? 'active' : ''} key={value} onClick={() => patchRequest('maxStops', value)}>{value}</button>)}</div></label>
              <label><span>Durée max.</span><div className="compact-input"><Clock3 size={15} /><input type="number" min="8" max="72" value={request.maxDurationHours} onChange={(event) => patchRequest('maxDurationHours', Number(event.target.value))} /><small>h</small></div></label>
              <label className="check-line"><input type="checkbox" checked={request.nearbyAirports} onChange={(event) => patchRequest('nearbyAirports', event.target.checked)} /><span><Check size={12} /></span>Aéroports voisins</label>
              <label className="check-line"><input type="checkbox" checked={request.longLayover} onChange={(event) => patchRequest('longLayover', event.target.checked)} /><span><Check size={12} /></span>Escales longues</label>
              <label className="check-line"><input type="checkbox" checked={request.separateTickets} onChange={(event) => patchRequest('separateTickets', event.target.checked)} /><span><Check size={12} /></span>Billets séparés</label>
            </div>}</>}

            <button className={`search-button ${searchMode === 'explore' ? 'explore' : ''}`} type="button" onClick={searchMode === 'explore' ? runExplore : runSearch} disabled={loading || !routeReady}>
              {loading
                ? <><RefreshCw className="spin" size={17} /> {searchMode === 'explore' ? 'Lecture des calendriers…' : 'Interrogation Air France…'}</>
                : searchMode === 'explore'
                  ? <><CalendarRange size={17} /> Trouver les Top 3 mensuels</>
                  : <><Search size={17} /> Lancer l’analyse live</>}
            </button>
            <p className={`search-footnote ${!routeReady ? 'is-warning' : ''}`}><Database size={13} /> {!routeReady ? 'Choisissez un départ et une destination Air France' : searchMode === 'explore' ? 'Calendriers MONTH + DAY Air France' : 'Tarifs live Air France'}</p>
          </div>
        </aside>

        <section className="results-panel">
          <div className="results-header">
            <div>
              <span className="eyebrow">{request.origin.cityName || 'Départ'} vers {request.destination.cityName || 'destination'}</span>
              <h2>{searchMode === 'explore'
                ? exploreResponse ? `${exploreResponse.months.length} mois comparés` : 'Radar annuel euros + Miles'
                : response ? `${ranked.length} itinéraires Air France` : 'Cockpit de comparaison live'}</h2>
              <p>{searchMode === 'explore'
                ? `Top 3 des prix aller-retour par mois · ${explorePaymentMode === 'both' ? 'Euros + Miles' : 'Euros'} · Economy · 1 adulte`
                : <>{readableDate(request.departureDate)} — {readableDate(request.returnDate)}{request.flexibleDays ? ` · ±${request.flexibleDays} j · séjour ${request.tripLengthDays} j` : ''} · {request.adults} voyageur{request.adults > 1 ? 's' : ''} · {request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')}</>}</p>
            </div>
            <div className="header-actions">
              <button type="button" className="icon-button" title="Actualiser" onClick={searchMode === 'explore' ? runExplore : runSearch} disabled={loading || !routeReady}><RefreshCw size={17} /></button>
            </div>
          </div>

          {loading && <LiveSearchState elapsed={elapsed} onCancel={cancelSearch} />}
          <AuthPrompt visible={!loading && needsFlyingBlueAuth} onRetry={retryAfterAuth} />
          {(error || nonAuthWarnings?.length) ? <div className={`status-banner ${error || (searchMode === 'explore' ? exploreResponse?.status : response?.status) === 'blocked' ? 'is-error' : ''}`}><CircleAlert size={17} /><span>{error ?? nonAuthWarnings?.[0]}</span>{error && <button type="button" title="Fermer" onClick={() => setError(undefined)}><X size={15} /></button>}</div> : null}

          {searchMode === 'explore' && exploreResponse && exploreResponse.months.length > 0 && <ExploreCalendar response={exploreResponse} paymentMode={explorePaymentMode} onSelect={selectExploreFare} />}

          {searchMode === 'search' && ranked.length > 0 && <>
            <section className="decision-band" aria-label="Meilleures options">
              <div className="decision-intro"><span>Décision rapide</span><strong>Lecture en un regard</strong></div>
              <div className="decision-item"><span className="decision-icon cash"><TicketCheck size={17} /></span><div><small>Meilleur cash</small><strong>{formatCash(bestCash?.selectedPrice.cash)}</strong><span>{bestCash?.route.join(' · ')}</span></div></div>
              <div className="decision-item"><span className="decision-icon miles"><Coins size={17} /></span><div><small>Moins de Miles</small><strong>{formatMiles(bestMiles?.selectedPrice.miles)}</strong><span>{bestMiles ? `+ ${formatCash(bestMiles.selectedPrice.taxes)}` : 'Session requise'}</span></div></div>
              <div className="decision-item"><span className="decision-icon time"><Gauge size={17} /></span><div><small>Le plus rapide</small><strong>{fastest ? formatDuration(fastest.totalDurationMinutes) : '—'}</strong><span>{fastest?.stops === 0 ? 'Sans escale' : `${fastest?.stops} escale${(fastest?.stops ?? 0) > 1 ? 's' : ''}`}</span></div></div>
            </section>

            <div className="result-toolbar">
              <div className="view-tabs">
                <button type="button" className={view === 'deals' ? 'active' : ''} onClick={() => setView('deals')}>Frontière <span>{ranked.filter((offer) => offer.paretoOptimal).length}</span></button>
                <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>Tous <span>{ranked.length}</span></button>
                <button type="button" className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}><BarChart3 size={13} /> Analyse</button>
                <button type="button" className={view === 'months' ? 'active' : ''} onClick={() => setView('months')}><CalendarRange size={13} /> Prix par mois <span>{response?.monthlyCalendar.length ?? 0}</span></button>
                <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={13} /> Dates exactes</button>
              </div>
              {(view === 'deals' || view === 'all') && <div className="sort-control"><span>Trier</span>{([['deal', 'Score'], ['cash', 'Prix'], ['miles', 'Miles'], ['duration', 'Durée']] as const).map(([value, label]) => <button type="button" key={value} className={sort === value ? 'active' : ''} onClick={() => setSort(value)}>{label}</button>)}</div>}
            </div>

            {view === 'analysis' ? <div className="analysis-grid">
              <FrontierChart offers={ranked} />
              <aside className="trace-panel">
                <div><Activity size={16} /><span>Chaîne de données</span></div>
                <ol>
                  <li><strong>Référentiel</strong><span>Air France GraphQL</span></li>
                  <li><strong>Disponibilités</strong><span>Air France Search</span></li>
                  <li><strong>Classement</strong><span>Pareto local</span></li>
                </ol>
                <div className="trace-proof"><CheckCircle2 size={16} /><span><strong>{response?.trace.cacheHit ? 'Capture live récente' : 'Capture live fraîche'}</strong><small>{response ? dateTimeLabel(response.searchedAt) : ''}</small></span></div>
                <div className="trace-operations">{response?.trace.operations.slice(-4).map((operation) => <span key={operation}>{operation}</span>)}</div>
              </aside>
            </div> : view === 'months' ? <MonthlyCalendar items={response?.monthlyCalendar ?? []} request={request} onSelect={selectMonthlyDate} /> : view === 'calendar' ? <FareCalendar items={response?.fareCalendar ?? []} request={request} /> : <>
              <div className="offer-table-head"><span>Compagnie</span><span>Itinéraire</span><span>Durée</span><span>Tarif</span><span>Deal</span></div>
              <div className={`offers-list ${loading ? 'is-loading' : ''}`}>
                {visibleOffers.map((offer) => <OfferRow key={offer.id} offer={offer} baseline={baseline} />)}
              </div>
            </>}
          </>}

          {searchMode === 'search' && !loading && ranked.length === 0 && !needsFlyingBlueAuth && <div className={`empty-results ${response ? `empty-${response.status}` : ''}`}>
            {response?.status === 'blocked' ? <TimerReset size={30} /> : <Route size={30} />}
            <strong>{emptyTitle}</strong>
            <span>{emptyText}</span>
            {!response && <button type="button" onClick={runSearch} disabled={!routeReady}><Search size={15} /> Interroger Air France</button>}
          </div>}

          {searchMode === 'explore' && !loading && (!exploreResponse || exploreResponse.months.length === 0) && !needsFlyingBlueAuth && <div className={`empty-results ${exploreResponse ? `empty-${exploreResponse.status}` : ''}`}>
            {exploreResponse?.status === 'blocked' ? <TimerReset size={30} /> : <CalendarRange size={30} />}
            <strong>{exploreEmptyTitle}</strong>
            <span>{exploreEmptyText}</span>
            {!exploreResponse && <button type="button" onClick={runExplore} disabled={!routeReady}><CalendarRange size={15} /> Explorer les mois</button>}
          </div>}

          <footer className="results-footer">
            {searchMode === 'explore' ? <>
              <span><Info size={14} /> {exploreResponse ? `Dernière exploration ${dateTimeLabel(exploreResponse.searchedAt)}` : 'En attente des calendriers Air France'}</span>
              <span>{exploreResponse ? `${(exploreResponse.durationMs / 1000).toFixed(1)} s · ${exploreResponse.months.length} mois · ${exploreResponse.trace.cacheHit ? 'cache live 90 s' : 'session fraîche'}` : 'source : aucune'}</span>
            </> : <>
              <span><Info size={14} /> {response ? `Dernière requête ${dateTimeLabel(response.searchedAt)}` : 'En attente d’une requête Air France'}</span>
              <span>{response ? `${(response.durationMs / 1000).toFixed(1)} s · ${response.trace.candidatePairs} couple${response.trace.candidatePairs > 1 ? 's' : ''} exact${response.trace.candidatePairs > 1 ? 's' : ''} · ${response.trace.cacheHit ? 'cache live 90 s' : 'session fraîche'}` : 'source : aucune'}</span>
            </>}
          </footer>
        </section>
      </main>
    </div>
  )
}

export default App
