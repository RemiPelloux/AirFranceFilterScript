# AirFranceRat — État des lieux et cahier des charges

Version : 1.0  
Date de l'audit : 2 août 2026  
Périmètre observé : `https://wwws.airfrance.fr/`, recherche Air France France, flux euros et amorçage du flux Flying Blue/Miles.

## 1. Résumé exécutif

L'application visée est un moteur de recherche de tarifs Air France qui compare, pour une origine, une destination et une plage de dates :

- les billets payés en euros ;
- les billets prime payés en Miles Flying Blue, avec leurs taxes en euros ;
- les aéroports d'une même zone urbaine ;
- les itinéraires directs, avec une correspondance et avec deux correspondances ;
- les itinéraires construits avec un point intermédiaire qui peuvent être moins chers que le trajet naturel ;
- les cabines Economy, Premium et Business ;
- le prix facial et le coût réel du trajet, incluant durée, transfert terrestre, hôtel éventuel et risque de billets séparés.

L'audit du site réel confirme que le moteur Air France ne repose pas sur une API REST publique de vols. Le front appelle une passerelle GraphQL interne :

```text
https://wwws.airfrance.fr/gql/v1
```

Le catalogue d'aéroports est accessible publiquement par une requête GraphQL persistée. Le moteur de prix est, lui, stateful : la recherche crée un contexte serveur, puis les offres et le calendrier de bas tarifs sont lus dans ce contexte. Un appel isolé au endpoint d'offres sans ce contexte retourne un objet vide.

Le flux Miles est différent du flux euros. Le mode `bookingFlow=REWARD` exige une authentification Flying Blue et redirige vers :

```text
https://identity.airfranceklm.com/login/otp
```

Conclusion d'architecture : le MVP peut exploiter directement les endpoints publics de référence et piloter le parcours Air France dans une session navigateur contrôlée pour les tarifs. Une intégration serveur qui rejoue aveuglément les appels GraphQL internes serait fragile, difficile à exploiter légalement à grande échelle et insuffisante pour les Miles sans session utilisateur authentifiée.

## 2. Ce qui a été vérifié sur le site Air France

### 2.1 Recherche euros réalisée

Paramètres du test :

| Paramètre | Valeur |
|---|---|
| Origine | Nice, `NCE` |
| Destination | New York, groupe ville `NYC` |
| Aller | 15 septembre 2026 |
| Retour | 22 septembre 2026 |
| Passagers | 1 adulte |
| Cabine initiale | Economy |
| Flux | `LEISURE` |

Résultats affichés à l'étape de sélection de l'aller :

| Itinéraire observé | Economy | Premium | Business | Remarque |
|---|---:|---:|---:|---|
| Direct `NCE-JFK`, Delta, 9 h 15 | 257 EUR | 2 126 EUR | 5 491 EUR | Meilleur tarif affiché pour le direct |
| `NCE-CDG-JFK`, 11 h 54 | 347 EUR | 776 EUR | 1 964 EUR | 1 h 55 de correspondance |
| `NCE-AMS-JFK`, 12 h 12 | 626 EUR | 2 137 EUR | 3 252 EUR | 1 h 50 de correspondance |
| `NCE-CDG-JFK`, 11 h 45 | 298 EUR | 688 EUR | 1 852 EUR | 1 h 55 de correspondance |
| `NCE-CDG-EWR`, 11 h 40 | 259 EUR | 959 EUR | 2 252 EUR | Tarif promo Economy |

Le calendrier affichait notamment : 259 EUR le 14 septembre, 257 EUR le 15, et 256 EUR les 16, 17 et 18 septembre.

Ces montants sont des prix affichés à l'étape « Vol aller ». Ils ne doivent pas être considérés comme un devis final tant que le retour, le produit tarifaire, les passagers et les éventuels services n'ont pas été validés. Le produit devra distinguer systématiquement « prix repéré », « prix revérifié » et « prix final Air France ».

### 2.2 Comportement multi-aéroports

La recherche de « New York » retourne un groupe ville et ses aéroports :

- `NYC` — tous les aéroports ;
- `EWR` — Newark Liberty International Airport ;
- `JFK` — John F. Kennedy International Airport ;
- `LGA` — La Guardia Airport ;
- `SWF` — Stewart International Airport.

Le moteur doit comparer le code ville et chaque aéroport individuellement. Une recherche limitée à `NYC` peut masquer des différences de disponibilité, de taxe, de temps de transfert et de prix.

### 2.3 Catalogue de gares et aéroports

La requête publique observée renvoie :

- 1 539 entrées dans `flatStations` ;
- 1 432 groupes dans `stations` ;
- un `stationType` distinguant notamment `CITY` et `AIRPORT` ;
- `cityCode`, `cityName`, `countryName`, `code`, `displayText` ;
- `isOrigin` et `isDestination` ;
- une chaîne `searchText` utilisable pour l'autocomplétion.

Exemples confirmés : `NCE`, `BIO`, `NYC`, `JFK` et `EWR` sont présents. `NYC` est un groupe de type `CITY`, tandis que `JFK` et `EWR` sont de type `AIRPORT` rattachés à `cityCode=NYC`.

### 2.4 Flux Miles

Le code client expose quatre valeurs de flux :

```text
LEISURE
CORPORATE
REWARD
PACKAGE_DEALS
```

La tentative publique avec `bookingFlow=REWARD` redirige vers l'authentification OTP Air France/KLM. Le code public du client confirme que `REWARD` rend la connexion obligatoire. Il stocke temporairement un contexte de recherche avant la redirection, puis le récupère après connexion.

Conséquences :

- les prix Miles ne sont pas disponibles par le même appel anonyme que les prix euros ;
- un backend central ne doit pas collecter les identifiants Flying Blue ;
- l'utilisateur doit se connecter dans sa propre session Air France ;
- l'application ne doit ni contourner le CAPTCHA, ni automatiser un OTP, ni exporter durablement les cookies de session ;
- un audit réseau Miles complet nécessite une session Flying Blue de test autorisée et authentifiée.

## 3. Cartographie technique de l'API Air France observée

### 3.1 Transport

Air France utilise GraphQL avec des requêtes persistées Apollo. Une requête publique prend typiquement cette forme :

```http
GET /gql/v1
  ?bookingFlow=LEISURE
  &brand=AF
  &country=FR
  &language=fr
  &operationName=...
  &variables=...
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"..."}}
```

Les opérations de recherche de prix observées apparaissent sous forme de requêtes sur `/gql/v1` avec `operationName`, mais sans variables dans l'URL. Elles sont vraisemblablement envoyées en POST et reposent sur le contexte serveur créé au démarrage de la recherche.

### 3.2 Opérations importantes observées

| Fonction | Opération GraphQL | Hash de requête persistée |
|---|---|---|
| Référentiel du moteur | `SharedSearchBoxReferenceDataForSearchQuery` | `c11344fdd1be05827219b57614c2a6a9dfc88a3da3b8c0fd11cbf48443ff6acb` |
| Liste plate des stations | `SharedSearchBoxFlatStationsForSearchQuery` | `d9d7556bfd85142176545cdb2606c28c5c4ffe2c83e2095b751274255099467d` |
| Création du contexte | `SharedSearchCreateSearchContextForSearchQuery` | `d61f243f209021505e0cbc69a49f3456974d097f719c780176df367a2742909a` |
| Itinéraire du contexte | `SharedSearchContextItineraryForSearchQuery` | `a265f85992f4f38855fb7ace7002c5249358bea8cde814051ad8549bd5d90893` |
| Passagers du contexte | `SharedSearchContextPassengersForSearchQuery` | `f8426ca72294a62b4cd5bb000233f07917ebbc0eb5a7b9703a4fadeeef7b934f` |
| Offres disponibles | `SearchResultAvailableOffersQuery` | `6fc9f9d92bb3fe738cd47068a41ed2170d207876084cc71e21b8e72bbeb7712f` |
| Offres par identifiant | `SearchResultAvailableOffersByIdQuery` | `05b948713feb63df8bdf921119eb77a6afa2aa2e75122ffe9dbe6b8b015c0566` |
| Calendrier bas tarifs | `SharedSearchLowestFareOffersForSearchQuery` | `da21c63708940f578da4e9fb30c1fdf41ae6e7bf4fe8851257c351d66b5dff80` |
| Bas tarifs par ressource | `SharedSearchLowestFareOffersByResourceIdForSearchQuery` | `021e3b66e35a2996d326085e5fdcf215e808cc8776552126d45addeb70759ebb` |
| Offres de vol | `SharedSearchFlightOffersForSearchQuery` | `df037786985392cfdc6ca9b589a39b2de8417df5daf8613b683fef586b4e4ff2` |
| Détails de vol | `SharedSearchFlightDetailsQuery` | `baa3e77360150c07f81a5061a8d1e1ccdae600acf11ef1dc2b42e1db0bd42ad0` |
| Détail du prix | `SharedSearchPriceDetailsForSearchQuery` | `bd1c298fe5782a15ed380e5abff8f70579e5ad17d33f6340ceaf6bd8e9078298` |
| Conditions tarifaires | `SharedSearchTicketConditionsForSearchQuery` | `5b3f09a1ed7c5de91cf28198346992ac4827ac493856a3cea3765115c4d0654e` |
| Cabines disponibles | `SearchAvailableCabinClassesQuery` | `c6841f3ba5425a8232fe2368f3b4e08da5bc16d8d643de45fb24bcad3a1198a8` |

Les hash changent lors des déploiements. Ils doivent être découverts et versionnés, jamais codés en dur sans mécanisme de détection de rupture.

### 3.3 Test d'accès direct

La requête du référentiel a été rejouée sans cookie de navigateur et a renvoyé le catalogue complet. Cela valide son usage possible dans un adaptateur serveur avec cache.

Reproduction minimale de l'appel public observé :

```bash
curl --compressed \
  -H 'Accept: application/json' \
  -H 'Referer: https://wwws.airfrance.fr/' \
  'https://wwws.airfrance.fr/gql/v1?bookingFlow=LEISURE&brand=AF&country=FR&language=fr&operationName=SharedSearchBoxReferenceDataForSearchQuery&variables=%7B%22bookingFlow%22:%22LEISURE%22%7D&extensions=%7B%22persistedQuery%22:%7B%22version%22:1,%22sha256Hash%22:%22c11344fdd1be05827219b57614c2a6a9dfc88a3da3b8c0fd11cbf48443ff6acb%22%7D%7D'
```

La réponse utile se trouve dans :

```text
data.flatStations
data.stations
data.missingCities
data.referenceData
```

À l'inverse, un appel isolé à `SearchResultAvailableOffersQuery`, avec son hash mais sans contexte de recherche, a renvoyé :

```json
{"data": {}}
```

Le prix dépend donc au minimum d'un contexte de recherche et probablement de cookies techniques, d'un `searchStateUuid`, d'en-têtes de contexte et de contrôles anti-abus.

### 3.4 Séquence réseau de recherche observée

Le parcours euros produit la séquence fonctionnelle suivante :

```text
Chargement de la page
  -> SharedSearchBoxReferenceDataForSearchQuery
  -> sélection des stations, dates, passagers et cabine
  -> création/stockage d'un contexte de recherche
  -> /search/flights/0
  -> SharedSearchContextItineraryForSearchQuery
  -> SharedSearchContextPassengersForSearchQuery
  -> SearchResultAvailableOffersQuery
  -> SharedSearchLowestFareOffersForSearchQuery
  -> requêtes de détails au fur et à mesure des interactions
```

Le chemin visible du résultat, `/search/flights/0`, ne contient pas les paramètres métier. Ceux-ci sont conservés dans le contexte de recherche. Copier uniquement cette URL ne permet donc pas de rejouer la recherche.

Les liens de recherche simples exposés sur la page d'accueil utilisent cependant cette structure :

```text
/search
  ?pax=1:0:0:0:0:0:0:0
  &cabinClass=ECONOMY
  &connections=PAR:C>CUN:C-CUN:C>PAR:C
  &bookingFlow=LEISURE
```

Cette URL est un point d'entrée. Le client la transforme ensuite en contexte serveur. Pour `REWARD`, le même mécanisme déclenche l'authentification avant d'afficher les offres.

### 3.5 Risques de dépendance à l'API interne

- absence de contrat public et de SLA ;
- schéma et hash modifiables sans préavis ;
- cookies et contexte serveur obligatoires ;
- protection Akamai, reCAPTCHA et télémétrie anti-abus ;
- blocage ou throttling en cas de volume excessif ;
- résultats liés au pays, à la langue, à la devise et parfois au profil ;
- Miles liés à une identité Flying Blue ;
- conditions d'utilisation Air France à valider avant exploitation commerciale.

## 4. Objectifs produit

### 4.1 Objectif principal

Pour une demande simple telle que « je pars de Nice et je veux aller à New York », présenter les meilleures options réellement achetables en euros et en Miles, pour Economy, Premium et Business, y compris les variantes d'aéroports et de routage moins évidentes.

### 4.2 Définition d'un bon deal

Un bon deal n'est pas nécessairement le tarif brut le plus bas. L'application doit calculer :

```text
coût généralisé =
  prix cash
  + taxes cash du billet prime
  + valeur monétaire des Miles consommés
  + transports terrestres
  + hôtel éventuel
  + valeur du temps de trajet
  + pénalité de risque des billets séparés
  + pénalité de changement d'aéroport
```

Pour un billet prime :

```text
valeur obtenue par Mile =
  (prix cash comparable - taxes du billet prime) / nombre de Miles
```

La valeur d'un Mile doit être configurable par l'utilisateur, avec une valeur par défaut clairement indiquée comme hypothèse et non comme vérité comptable.

### 4.3 Hors périmètre initial

- achat ou émission automatique du billet ;
- collecte de mots de passe ou d'OTP Flying Blue ;
- contournement de CAPTCHA ou d'une protection anti-bot ;
- abandon volontaire d'un segment (« hidden-city ticketing ») ;
- garantie de correspondance entre deux billets séparés ;
- données temps réel de statut de vol, inutiles pour le cœur du comparateur de tarifs.

## 5. Utilisateurs et cas d'usage

### 5.1 Voyageur flexible

Il saisit une ville de départ, une destination, une durée et une fenêtre de dates. Il veut le meilleur prix, accepte un détour et peut partir d'un aéroport voisin.

### 5.2 Voyageur Flying Blue

Il renseigne son solde de Miles, sa valeur personnelle du Mile et ses cabines préférées. Il compare cash et prime avec taxes.

### 5.3 Voyageur affaires

Il privilégie Premium ou Business, fixe une durée maximale, refuse les billets séparés et valorise fortement le temps.

### 5.4 Chasseur de routages atypiques

Il autorise un ou deux points intermédiaires, une nuit d'escale ou un détour géographique raisonnable, mais exige que tous les segments soient effectivement parcourus et que l'itinéraire soit réservable.

## 6. Exigences fonctionnelles

### 6.1 Formulaire de recherche

Champs obligatoires :

- origine : ville, aéroport ou rayon autour d'une position ;
- destination : ville, aéroport ou rayon ;
- aller simple, aller-retour ou multi-destinations ;
- date fixe ou fenêtre flexible ;
- nombre et type de passagers ;
- cabines : Economy, Premium, Business ;
- paiement : euros, Miles ou les deux.

Options avancées :

- rayon d'aéroports voisins au départ et à l'arrivée ;
- nombre maximal de correspondances ;
- durée maximale porte-à-porte ;
- détour géographique maximal ;
- escale longue autorisée ;
- changement d'aéroport autorisé ;
- billets séparés autorisés ou interdits ;
- compagnie commercialisante ou opérante ;
- bagage requis ;
- solde Miles et valeur d'un Mile ;
- heures de départ et d'arrivée ;
- accessibilité et besoins particuliers.

### 6.2 Vérification des aéroports

Le système doit :

1. résoudre le texte utilisateur vers un code ville et des codes aéroport ;
2. vérifier `isOrigin` et `isDestination` dans le référentiel Air France ;
3. développer automatiquement un groupe ville, par exemple `NYC` vers `JFK`, `EWR`, `LGA`, `SWF` ;
4. ajouter les aéroports voisins selon un rayon et le temps d'accès terrestre ;
5. exclure un aéroport non commercialisé par Air France pour le flux demandé ;
6. expliquer pourquoi chaque aéroport alternatif a été inclus ;
7. afficher le coût et le temps de transfert terrestre.

### 6.3 Génération d'itinéraires

Le générateur produit, par ordre de coût calculatoire :

1. direct entre chaque paire origine/destination ;
2. correspondance via les hubs naturellement proposés par Air France/KLM/SkyTeam ;
3. correspondance via un aéroport adjacent ou un marché secondaire ;
4. deux correspondances avec contrainte de détour ;
5. multi-city avec un point intermédiaire explicitement parcouru ;
6. billets séparés, uniquement si l'utilisateur les autorise.

Pour l'exemple `NCE-BIO-CDG-NYC`, l'application doit vérifier trois constructions distinctes :

- un billet unique multi-segments ;
- un aller-retour ou multi-city tarifé par Air France ;
- plusieurs billets séparés.

Ces constructions ne sont pas équivalentes. Le résultat doit indiquer la protection en cas d'irrégularité, le transfert de bagage, les formalités et le temps de sécurité nécessaire.

### 6.4 Moteur de comparaison

Chaque offre normalisée doit contenir :

- prix total et devise ;
- Miles et taxes cash ;
- prix par passager ;
- cabine de chaque segment ;
- produit tarifaire et conditions ;
- aéroports, terminaux, heures locales et fuseaux ;
- durée totale, temps de vol et temps de correspondance ;
- compagnie marketing et opérante ;
- nombre de billets et références d'offres ;
- bagages inclus ;
- règles de modification et remboursement ;
- fraîcheur et source du prix ;
- statut de vérification.

Classements disponibles :

- meilleur prix cash ;
- moins de Miles ;
- meilleure valeur par Mile ;
- meilleur compromis ;
- durée la plus courte ;
- meilleur Business ;
- risque le plus faible.

### 6.5 Restitution

La vue résultat doit afficher :

- un résumé « meilleur cash », « meilleur Miles », « meilleur compromis » ;
- un tableau comparable par cabine ;
- une chronologie des segments ;
- les aéroports alternatifs testés ;
- le détail du calcul de coût généralisé ;
- les avertissements de billets séparés et de changement d'aéroport ;
- le lien profond vers Air France pour revérifier et réserver ;
- l'heure exacte de la dernière vérification.

### 6.6 Alertes

Le système pourra surveiller une recherche sauvegardée et notifier lorsque :

- le cash passe sous un seuil ;
- le prix Miles passe sous un seuil ;
- la valeur par Mile dépasse un seuil ;
- une cabine supérieure devient compétitive ;
- un nouvel aéroport ou routage devient moins cher.

Les alertes doivent respecter un budget de requêtes et ne jamais contourner une limitation Air France.

## 7. Algorithme de découverte de deals

### 7.1 Graphe de transport

Nœuds : villes, aéroports et éventuellement gares commercialisées.  
Arêtes aériennes : segments proposés dans les résultats Air France.  
Arêtes terrestres : aéroports d'une même zone, avec temps et coût estimés.

### 7.2 Génération bornée

Le moteur ne doit pas tester toutes les combinaisons naïvement. Il applique :

- rayon maximum autour de l'origine et de la destination ;
- liste de hubs et de marchés secondaires ;
- facteur de détour maximal, par défaut 1,6 sur la distance orthodromique ;
- durée maximale de 36 heures par sens, configurable ;
- au plus deux correspondances pour le MVP ;
- dominance : éliminer un itinéraire plus cher, plus long et plus risqué qu'un autre ;
- cache par marché, date, cabine, passagers et flux de paiement.

### 7.3 Stratégie de recherche

```text
1. Résoudre les groupes de villes et aéroports.
2. Chercher les trajets standards pour établir un prix de référence.
3. Extraire les hubs réellement proposés.
4. Générer les détours candidats à partir des hubs et marchés secondaires.
5. Rechercher chaque candidat dans la limite du budget de requêtes.
6. Normaliser cash et Miles séparément.
7. Vérifier les contraintes de billet, bagage et correspondance.
8. Calculer le front de Pareto prix / durée / risque / confort.
9. Revérifier les finalistes avant affichage.
```

### 7.4 Prévention des faux deals

Un itinéraire est rejeté ou fortement pénalisé si :

- un segment n'est pas achetable ;
- la classe de cabine n'est pas homogène sans avertissement ;
- le temps de correspondance est sous le minimum ;
- un changement d'aéroport n'est pas réalisable ;
- le prix provient d'un cache trop ancien ;
- les taxes ou frais obligatoires sont absents ;
- un billet séparé n'a pas de marge de sécurité ;
- le deal suppose d'abandonner un segment.

## 8. Architecture cible

### 8.1 Composants

```text
Web app
  -> API applicative
      -> Airport Catalog Adapter
      -> Search Orchestrator
          -> Air France Public Reference Adapter
          -> Air France Browser Session Adapter
          -> Reward Session Adapter (session utilisateur)
      -> Route Generator
      -> Offer Normalizer
      -> Deal Scorer
      -> Cache / Database
      -> Alert Scheduler
```

### 8.2 Adaptateurs Air France

`Public Reference Adapter` :

- appelle les requêtes de référence anonymes ;
- met en cache les 1 539 stations ;
- détecte un changement de hash ou de schéma ;
- conserve la dernière version valide.

`Browser Session Adapter` :

- utilise une vraie session navigateur autorisée ;
- remplit le formulaire Air France ou rejoue le protocole seulement après validation ;
- collecte les résultats visibles et les réponses GraphQL autorisées ;
- respecte les limites de débit ;
- ne contourne pas les protections.

`Reward Session Adapter` :

- fonctionne uniquement après connexion volontaire de l'utilisateur ;
- ne reçoit jamais le mot de passe ni l'OTP ;
- privilégie une extension locale ou un navigateur compagnon ;
- envoie au backend uniquement les offres normalisées nécessaires ;
- révoque la session locale à la demande.

### 8.3 Données internes

Entités principales :

- `Station` : code, type, ville, pays, capacités origine/destination ;
- `SearchRequest` : passagers, dates, cabines, contraintes ;
- `SearchRun` : source, contexte, statut, durée, erreurs ;
- `Itinerary` : segments, billets, transferts, durée ;
- `Offer` : cash, Miles, taxes, cabine, règles, fraîcheur ;
- `DealScore` : coût généralisé, valeur par Mile, risque ;
- `SavedSearch` et `PriceObservation` ;
- `AdapterVersion` : hash, schéma observé et date de validation.

### 8.4 API applicative proposée

```http
GET  /api/stations?q=nice
POST /api/searches
GET  /api/searches/{id}
GET  /api/searches/{id}/offers
POST /api/searches/{id}/refresh
POST /api/searches/{id}/reward-session
GET  /api/offers/{id}
POST /api/alerts
DELETE /api/reward-sessions/{id}
```

Le `POST /api/searches` répond rapidement avec un identifiant. Les variantes sont explorées de façon asynchrone et le front reçoit les mises à jour par SSE ou WebSocket.

## 9. Sécurité, confidentialité et conformité

### 9.1 Règles impératives

- aucun stockage de mot de passe ou d'OTP Air France/Flying Blue ;
- aucun contournement de CAPTCHA, WAF ou rate limit ;
- pas de partage de cookies entre utilisateurs ;
- chiffrement des données sensibles au repos et en transit ;
- session Reward courte et révocable ;
- journalisation sans token, cookie ni donnée personnelle brute ;
- limitation stricte des requêtes par utilisateur et par marché ;
- suppression automatique des traces de navigation ;
- consentement explicite avant connexion Flying Blue ;
- revue juridique des conditions Air France avant mise en production publique.

### 9.2 Position sur le reverse engineering

L'analyse d'un trafic généré par un utilisateur sur un site public permet de comprendre le protocole, mais ne crée pas un droit contractuel d'exploitation illimitée. Le produit doit éviter toute mesure de contournement et prévoir un mode dégradé si l'accès interne change ou est interdit.

Une mise en production commerciale doit faire valider :

- les conditions générales et conditions d'utilisation Air France ;
- les droits sui generis sur les bases de données en Europe ;
- le RGPD pour les comptes et sessions ;
- l'usage des marques Air France et Flying Blue ;
- les obligations liées à l'affiliation ou à la redirection marchande.

## 10. Exigences non fonctionnelles

### 10.1 Performance

- autocomplétion locale sous 100 ms après chargement du catalogue ;
- premiers résultats standards sous 15 secondes au P95 ;
- exploration étendue progressive, sans bloquer l'écran ;
- revérification des finalistes avant présentation comme « vérifiés ».

### 10.2 Résilience

- circuit breaker par adaptateur ;
- backoff exponentiel sur erreurs transitoires ;
- aucun retry automatique sur CAPTCHA, 401, 403 ou écriture incertaine ;
- détection de changement de schéma GraphQL ;
- conservation du dernier catalogue valide ;
- bannière claire en cas de données partielles.

### 10.3 Fraîcheur

- catalogue : cache 24 heures, stale-while-revalidate ;
- calendrier bas tarifs : cache court, par exemple 15 à 60 minutes ;
- offre détaillée : quelques minutes maximum ;
- finaliste : revérification immédiate avant redirection.

### 10.4 Observabilité

- durée et résultat de chaque étape ;
- nombre de candidats générés, testés et éliminés ;
- taux de rupture par opération GraphQL ;
- taux de prix périmés ;
- taux de redirection réussie ;
- métriques séparées LEISURE et REWARD ;
- alertes sur changement de hash, schéma ou comportement d'authentification.

## 11. UX attendue

### 11.1 Écran principal

Une interface de travail compacte, centrée sur le formulaire, sans page marketing. Origine et destination doivent afficher immédiatement le groupe ville et les aéroports inclus. Les modes euros, Miles et comparaison sont présentés comme un contrôle segmenté.

### 11.2 Résultats

Trois onglets :

- `Meilleurs deals` ;
- `Tous les itinéraires` ;
- `Calendrier`.

Chaque ligne doit rester comparable. Le prix, les Miles, les taxes, la cabine, la durée, les correspondances et le niveau de risque sont visibles sans ouvrir un panneau.

### 11.3 Explication du deal

Une offre atypique doit expliquer son avantage :

```text
NCE-BIO-CDG-JFK économise 184 EUR par rapport au meilleur NCE-CDG-JFK,
mais ajoute 5 h 20 et une correspondance. Billet unique : oui. Bagage suivi : oui.
```

L'application ne doit jamais qualifier un itinéraire de meilleur deal sans montrer le coût supplémentaire en temps et en risque.

## 12. Tests et critères d'acceptation

### 12.1 Tests unitaires

- résolution ville/aéroport ;
- expansion d'un groupe ville ;
- génération bornée de chemins ;
- élimination par dominance ;
- conversion de devises ;
- valeur par Mile ;
- calcul porte-à-porte ;
- pénalités de billets séparés ;
- normalisation des cabines et bagages.

### 12.2 Tests d'intégration

- récupération et cache du catalogue Air France ;
- création d'un contexte LEISURE ;
- lecture du calendrier et des offres ;
- comportement sans contexte ;
- expiration de session ;
- redirection REWARD vers login ;
- reprise après authentification sur compte de test ;
- changement de hash de requête persistée ;
- réponse GraphQL partielle.

### 12.3 Scénarios d'acceptation

1. Une recherche `NCE-NYC` développe `NYC`, `JFK`, `EWR`, `LGA`, `SWF` et explique l'expansion.
2. Economy, Premium et Business sont comparées dans une vue homogène.
3. Le meilleur cash et le meilleur Miles sont distingués.
4. Une offre Miles affiche toujours Miles et taxes cash.
5. Un trajet multi-segments n'est retenu que si tous les segments sont parcourus.
6. Un billet séparé affiche une alerte et une marge de correspondance.
7. Un prix vieux ou non revérifiable n'est pas présenté comme disponible.
8. Le clic de réservation renvoie vers Air France avec la recherche correspondante.
9. Une session Reward peut être supprimée sans conserver d'identifiants.
10. Une rupture de l'API interne n'empêche pas l'affichage du catalogue et des résultats déjà marqués comme historiques.

## 13. Feuille de route

### Phase 0 — Validation technique et juridique

- capturer un HAR LEISURE complet sur un compte de test ;
- capturer un HAR REWARD après connexion volontaire ;
- documenter méthodes, en-têtes, bodies et cookies strictement nécessaires ;
- valider les conditions d'utilisation ;
- définir le budget de requêtes acceptable.

### Phase 1 — MVP euros

- catalogue Air France ;
- recherche standard NCE-NYC ;
- Economy, Premium, Business ;
- aéroports d'une même ville ;
- directs et une correspondance ;
- normalisation et scoring ;
- redirection vers Air France.

### Phase 2 — Routages avancés

- deux correspondances ;
- multi-city ;
- aéroports voisins et transferts terrestres ;
- coûts porte-à-porte ;
- billets séparés optionnels ;
- calendrier flexible.

### Phase 3 — Flying Blue

- extension ou navigateur compagnon ;
- authentification utilisateur sans collecte de credentials ;
- comparaison cash/Miles ;
- valeur par Mile ;
- alertes Miles.

### Phase 4 — Industrialisation

- supervision de rupture des adaptateurs ;
- quotas et file de travaux ;
- tests de non-régression sur marchés de référence ;
- politique de rétention ;
- conformité et affiliation.

## 14. Décisions à prendre avant développement

1. Application personnelle locale ou service public multi-utilisateurs ? La seconde option augmente fortement les risques contractuels, anti-bot et RGPD.
2. Les billets séparés sont-ils inclus dès le MVP ?
3. Quelle valeur par défaut donner au Mile, et l'utilisateur peut-il la modifier ?
4. Quel rayon d'aéroports voisins et quel détour maximal ?
5. Les alertes doivent-elles fonctionner sans navigateur utilisateur ouvert ?
6. Quel compte Flying Blue de test est autorisé pour l'audit REWARD ?
7. Le produit accepte-t-il un mode semi-automatique où l'utilisateur ouvre Air France pour revérifier ?

## 15. Recommandation finale

Construire d'abord un MVP local ou à faible volume : catalogue public Air France, recherche LEISURE pilotée dans une session navigateur, normalisation, comparaison d'aéroports et génération bornée d'itinéraires. Cela valide la valeur produit sans stocker d'identifiants ni dépendre prématurément d'un replay serveur fragile.

Le flux Miles doit être traité comme un module séparé, activé seulement après une capture réseau authentifiée et autorisée. La bonne architecture est une session utilisateur locale qui fournit des offres normalisées, pas un serveur central qui détient des comptes Flying Blue.

Enfin, la recherche de circuits atypiques doit rester une optimisation d'itinéraires réellement parcourus. Le moteur peut trouver des détours tarifaires, mais il doit comparer billet unique, multi-city et billets séparés, puis afficher explicitement temps, bagage, protection et risque.
