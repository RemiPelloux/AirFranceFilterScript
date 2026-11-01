# Audit réseau Air France

Audit vérifié le 2 août 2026 sur `https://wwws.airfrance.fr/`, en cash et en Flying Blue Reward, avec la route Nice (`NCE`) - Saint-Denis (`RUN`) du 2 au 12 octobre 2026. Les données personnelles et les valeurs des cookies ne sont pas consignées dans ce document.

## Résultat du reverse engineering

Le moteur de recherche est un client GraphQL à requêtes persistées. Les tarifs ne sont pas accessibles de manière fiable avec un simple client HTTP : Air France exige une origine navigateur valide (cookies Akamai `_abck` / `bm_sz`). Un POST Node/curl vers `/gql/v1` est refusé (403 HTML).

Ratline utilise le transport prouvé d’[AirFranceFilterScript](https://github.com/RemiPelloux/AirFranceFilterScript) : Chrome visible + `page.evaluate(fetch)` same-origin, avec warm-up Akamai et retry sur 403.

```text
Chrome visible (Patchright)
        |
        v
/search/advanced + warm-up Akamai
        |
        +--> Cash: UUID local (pas de CreateSearchContext, pas de hashcash)
        |
        +--> Reward: SearchCustomer + ContextPassengers + hashcash v2
        |
        +--> LowestFare MONTH [/ DAY]
        |
        v
AvailableOffers (batch + refresh)
        |
        v
normalisation EUR / Miles
```

## Opérations et hashes persistés

| Opération | Hash (cash défaut / FilterScript) | Hash (fallback Ratline août 2026) | Rôle |
| --- | --- | --- | --- |
| `SharedSearchBoxReferenceDataForSearchQuery` | `c11344fdd1…` | idem | Stations (via curl) |
| `SharedSearchLowestFareOffersForSearchQuery` | `3129e428…` | `da21c637…` | Calendrier MONTH/DAY |
| `SearchResultAvailableOffersQuery` | `6c2316d3…` | `6fc9f9d9…` | Offres exactes |
| `SearchCustomerForSearchQuery` | — | `53889e46…` | Session Flying Blue |
| `SharedSearchContextPassengersForSearchQuery` | — | `f8426ca7…` | Contexte Reward |

Cash n’utilise plus `CreateSearchContext`. Reward conserve hashcash v2 et `x-client-revision`. Les hashes sont surchargeables via `AF_LOWEST_FARE_HASH` / `AF_AVAILABLE_OFFERS_HASH`.

## En-têtes stables

Les requêtes sont des POST JSON same-origin. L’URL utilise toujours l’opération « safe » pour contourner le filtre Akamai sur le query-string :

```text
/gql/v1?bookingFlow=LEISURE&operationName=SharedSearchLowestFareOffersForSearchQuery
```

L’opération réelle (ex. `SearchResultAvailableOffersQuery`) est uniquement dans le body JSON.

Le corps peut néanmoins contenir `bookingFlow: "REWARD"`. Cette asymétrie est celle du client Air France observé. Les en-têtes utiles sont :

```text
accept: application/json, text/plain, */*
accept-language: fr
afkl-travel-country: FR
afkl-travel-host: AF
afkl-travel-language: fr
afkl-travel-market: FR
content-type: application/json
country: FR
language: fr
x-aviato-host: wwws.airfrance.fr
x-client-revision: <révision du client>
x-ubc-name: search
```

`traceparent`, `tracestate`, `sec-ch-*` et `x-dtpc` ne font pas partie du contrat fonctionnel nécessaire observé par Ratline.

## Hashcash v2

Toutes les opérations de recherche sensibles sauf `SearchCustomerForSearchQuery` portent :

```json
{
  "extensions": {
    "hashcash": {
      "version": 2,
      "timestamp": "<ISO-8601>",
      "hash": "<initialHash>-<nonce>"
    },
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "<hash de l'opération>"
    }
  }
}
```

Algorithme vérifié contre les requêtes réseau fournies :

1. trier récursivement les clés des variables ;
2. ajouter `timestamp` au niveau racine ;
3. calculer `initialHash = SHA256(JSON.stringify(challenge))` ;
4. incrémenter `nonce` depuis zéro ;
5. accepter le premier `SHA256(initialHash + "-" + nonce)` commençant par `000`.

## Parcours cash

1. ouvrir `/search/advanced` et warm-up Akamai ;
2. `searchStateUuid` local (pas de `CreateSearchContext`) ;
3. `SharedSearchLowestFareOffersForSearchQuery` en `MONTH` (puis `DAY` si fenêtre flexible) ;
4. `SearchResultAvailableOffersQuery` par couple de dates (batch + retry) ;
5. parser `activeConnection`, `flightProducts` et `upsellCabinProducts`.

Le smoke `pnpm test:live` (NCE→RUN) doit renvoyer au moins une offre cash réelle. Aucune fixture tarifaire n’est utilisée.

## Parcours Reward

Reward ajoute trois prérequis :

1. `SearchCustomerForSearchQuery` avec `expand: "memberships_flyingblue"` ;
2. `SharedSearchCreateSearchContextForSearchQuery` pour lire `possibleTravelersFromProfile.travelerKey` ;
3. `SharedSearchContextPassengersForSearchQuery` avec ces `travelerKey` réels (pas un index inventé `0`).

Sans `CreateSearchContext`, les passagers restent `null` et `SearchResultAvailableOffersQuery` renvoie `9000: UNKNOWN_ERROR`. Reward utilise les hashes Ratline (`da21c637…` / `6fc9f9d9…`) pour LowestFare / AvailableOffers.

La session est importée uniquement à la demande dans le profil local dédié. Les cookies ne sont ni renvoyés à l'interface, ni journalisés, ni ajoutés au dépôt. Une session absente ou expirée produit `auth-required`.

## Calendrier ouvert

`/search/open-dates/0` appelle `SharedSearchLowestFareOffersForSearchQuery` deux fois :

- `type: "MONTH"` sur environ douze mois ;
- `type: "DAY"` sur le mois sélectionné ou un intervalle court.

La réponse contient notamment :

```text
flightDate
currency
totalPrice
totalPriceItinerary
totalTaxDetails.totalPrice
connections[].price
connections[].tax
isPromoFare
noFlight
```

Ratline appelle `MONTH` une fois par mode de paiement et conserve séparément le meilleur jour cash et le meilleur jour Reward de chaque mois, en privilégiant `totalPriceItinerary` (plancher aller-retour Open Dates) plutôt que `totalPrice` (aller seul). La fusion ne suppose jamais que les deux devises atteignent leur minimum le même jour. Chaque ligne du rail mensuel peut ensuite déclencher un vrai pricing aller-retour avec un retour égal à `départ + durée du séjour`.

Le mode Explorer accepte explicitement `cash` ou `both`. En cash, aucune opération `SearchCustomer`/Reward n'est envoyée. En comparaison, il exécute les flows LEISURE et REWARD séparément, puis appelle `DAY` pour chaque mois disponible et garde les trois dates distinctes les moins chères en A/R. Les appels journaliers sont espacés de 350 ms et retentés après rafraîchissement de la page si le transport échoue. Cash utilise par défaut les hashes FilterScript (`3129e428…` / `6c2316d3…`), avec bascule automatique vers les hashes Ratline (août 2026) si `PersistedQueryNotFound`.

Sur `NCE → RUN`, le test Reward réel du 2 août 2026 a notamment renvoyé :

```text
décembre 2026
flightDate: 2026-12-07
totalPrice: 30000 Miles
totalPriceItinerary: 95000 Miles
totalTaxDetails.totalPrice: 319.66 EUR
```

Le rail affiche `95 000 Miles` (A/R Open Dates). Le repricing exact du 7 au 17 décembre 2026, fenêtre ±1 jour, peut renvoyer un minimum distinct (ex. 103 500 Miles + 320 EUR) car le pricing exact fixe le séjour.

Ratline utilise aussi le calendrier `DAY` comme borne de présélection. Pour une fenêtre de plus de sept couples, il conserve la date cible et les six meilleurs candidats du calendrier, puis reprixe chacun avec un vrai `SearchResultAvailableOffersQuery`. Une barre du calendrier exact n'est donc affichée qu'après ce pricing.

Complexité réseau :

```text
fenêtre ±X -> 2X+1 couples possibles
2X+1 <= 7 -> tous les couples sont pricés
2X+1 > 7  -> calendrier DAY + 7 pricings exacts maximum
rail annuel -> 1 requête MONTH par mode de paiement
Explorer -> 1 requête MONTH + jusqu'à 12 requêtes DAY par mode sélectionné
```

## Calcul correct de l'aller-retour

`upsellCabinProducts[].connections[0]` ne contient que le prix de la connexion active, donc généralement l'aller sur `/search/flights/0`. L'afficher seul sous-estime le voyage.

Le produit complet se trouve dans `flightProducts[]`. Ratline relie les objets avec l'identifiant de connexion :

```text
upsellCabinProducts.connection._id
             ==
flightProducts.connections[activeConnectionIndex]._id
```

Il additionne ensuite toutes les `flightProducts.connections[].price` du produit correspondant. Pour Reward, il additionne séparément les taxes EUR. Cette jointure conserve aussi la cabine, la famille tarifaire et le nombre de sièges exposé par Air France.

## Données de vol extraites

Pour chaque segment actif :

- aéroports et noms complets ;
- départ, arrivée et durée ;
- vol marketing ;
- transporteur et vol opérant ;
- appareil (`equipmentName`) ;
- durée de correspondance ;
- éligibilité plan de cabine.

Le classement local n'invente aucun itinéraire vendable. Il filtre les réponses Air France, convertit éventuellement les Miles en équivalent EUR selon la valeur choisie, applique les pénalités explicites de temps et d'escales, puis calcule une frontière de Pareto en `O(n log n)`.

## Transport et limites

Le vrai mode headless déclenche `ERR_HTTP2_PROTOCOL_ERROR` / un 403 Akamai. Le transport stable est un **Chrome visible** (Patchright, `channel=chrome` ou exécutable local) avec profil persistant `.airfrance-browser-profile/`. Les POST GraphQL passent par `page.evaluate(fetch)` same-origin (`credentials: include`). L’URL spoofe toujours `operationName=SharedSearchLowestFareOffersForSearchQuery`. Un warm-up + refresh de page gère les 403 HTML intermittents. `AF_CDP_ENDPOINT` permet d’attacher un Chrome déjà ouvert (optionnel).

Air France ne publie pas cette API comme contrat partenaire. Les hashes, la révision client, les règles anti-automatisation et les conditions d'utilisation peuvent évoluer. Le collecteur conserve un cache réel de 90 secondes, borne les fenêtres flexibles à ±30 jours, limite le repricing à sept couples exacts et n'effectue aucune réservation.
