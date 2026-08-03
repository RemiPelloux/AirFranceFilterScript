# Ratline — Deal desk Air France

Successeur TypeScript de [AirFranceFilterScript](https://github.com/RemiPelloux/AirFranceFilterScript) : même transport GraphQL / Akamai éprouvé, interface deal desk moderne (cash, Miles Flying Blue, calendrier et Explorer).

Ratline compare les tarifs **euros** et **Miles**, explore les meilleurs jours sur 12 mois, et classe les offres (coût, durée, escales, Pareto).

---

## Fonctionnalités

- Recherche aller-retour avec fenêtre flexible (±30 jours, max. 7 repricings exacts)
- Calendrier mensuel Open Dates (€ et Miles séparés)
- Mode **Explorer** : Top 3 des jours les moins chers par mois
- Classement local (coût généralisé + frontière de Pareto)
- Session Flying Blue importée par cookies (pas de mot de passe / OTP)
- Collecteur Chrome visible via Patchright (same-origin `fetch`)

---

## Prérequis

- Node.js 22+
- Google Chrome (recommandé) ou Brave
- macOS / Linux / Windows

---

## Installation

```bash
git clone https://github.com/RemiPelloux/AirFranceFilterScript.git
cd AirFranceFilterScript
npm install
```

---

## Lancement

```bash
npm run dev
```

Au premier pricing, Chrome s’ouvre sur `wwws.airfrance.fr/search/advanced`, obtient les cookies Akamai, puis sert l’API.

| Service | URL |
| --- | --- |
| Interface | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 |

> Laissez la fenêtre Chrome ouverte. Le mode headless est refusé par Akamai.

---

## Utilisation

1. Choisir origine / destination (autocomplétion stations Air France)
2. Dates, cabine, mode de paiement : **euros**, **Miles** ou **les deux**
3. **Rechercher** pour les offres exactes, ou **Explorer** pour le Top 3 / mois
4. Cliquer un mois ou un jour pour repricer l’aller-retour

### Session Flying Blue (Miles)

Exporter les cookies `*.airfrance.fr` depuis un navigateur déjà connecté, puis :

```bash
npm run session:import -- /chemin/vers/cookies.json
```

Les cookies sont stockés dans le profil local `.airfrance-browser-profile/` (gitignoré). Sans session valide, l’API renvoie `auth-required`.

---

## Vérifications

```bash
npm test              # parsers + hashcash
npm run typecheck
npm run build
npm run test:live     # smoke cash NCE → RUN (réseau réel)
npm run test:reward   # smoke Miles (session requise)
```

---

## Architecture

```text
React / Vite (:5173)
        │  /api
        ▼
Fastify (:8787)
        │
        ▼
server/af/  — collecteur Patchright
        │
        ▼
Chrome visible → wwws.airfrance.fr/gql/v1
```

| Couche | Rôle |
| --- | --- |
| `src/` | UI deal desk, ranking, stations |
| `server/index.ts` | API `/api/search`, `/api/explore`, `/api/stations` |
| `server/af/` | Transport FilterScript, cash, reward, parsers |
| `server/airfrance.ts` | Catalogue stations (curl HTTP/2) |

### Transport (héritage FilterScript)

1. Chrome visible (`channel=chrome` ou exécutable local)
2. Profil persistant `.airfrance-browser-profile/`
3. `page.evaluate(fetch)` same-origin, `credentials: 'include'`
4. URL toujours `operationName=SharedSearchLowestFareOffersForSearchQuery` ; opération réelle dans le body
5. Warm-up Akamai + refresh + retry sur 403 HTML
6. Batch Explorer : chunks de 5, concurrence 3, pause 350 ms

### Cash vs Miles

| | Cash (LEISURE) | Miles (REWARD) |
| --- | --- | --- |
| Contexte | UUID local | `SearchCustomer` + passagers PROFILE |
| Hashcash | non | oui (v2) |
| Headers révision | non | `x-client-revision` |
| Hashes défaut | FilterScript (`3129e428…` / `6c2316d3…`) | idem + fallback Ratline août 2026 |

---

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `AF_BROWSER_EXECUTABLE` | Chemin Chrome / Brave forcé |
| `AF_BROWSER_PROFILE` | Dossier profil (défaut `.airfrance-browser-profile`) |
| `AF_CDP_ENDPOINT` | Attacher un Chrome déjà ouvert |
| `AF_LOWEST_FARE_HASH` | Surcharge hash LowestFare |
| `AF_AVAILABLE_OFFERS_HASH` | Surcharge hash AvailableOffers |
| `AF_CLIENT_REVISION` | Révision client (Reward) |
| `PORT` | Port API (défaut `8787`) |

---

## Documentation

- [docs/AIRFRANCE_NETWORK_AUDIT.md](docs/AIRFRANCE_NETWORK_AUDIT.md) — protocole GraphQL vérifié
- [docs/ETAT_DES_LIEUX_ET_CAHIER_DES_CHARGES.md](docs/ETAT_DES_LIEUX_ET_CAHIER_DES_CHARGES.md) — cahier des charges produit

---

## Limites

- Chrome visible obligatoire
- Un collecteur à la fois (file d’attente locale)
- Akamai peut bloquer temporairement après trop de requêtes (retry + refresh)
- Les hashes persistés peuvent changer si Air France met à jour son frontend
- Pas d’API partenaire publique — usage personnel / local uniquement

---

## Historique

Ce dépôt a commencé comme un filtre Flask **AF / HOP** ([README d’origine](https://github.com/RemiPelloux/AirFranceFilterScript)). Il est désormais **Ratline** : stack TypeScript (React + Fastify + Patchright), deal desk cash / Miles, tout en conservant le contournement Akamai FilterScript.
