# Filtre Vols Air France

Application web qui affiche les **tarifs les moins chers uniquement pour les vols Air France / HOP (A5)**, en reverse-engineerant l'API GraphQL d'Air France et en contournant la protection anti-bot Akamai.

Le problème d'origine : sur airfrance.fr, le calendrier mensuel affiche le vol le moins cher *toutes compagnies confondues* (China Eastern, KLM, etc.). Il n'existe aucun filtre "Air France uniquement". Cette app le fait.

---

## Fonctionnalités

- **Vue mensuelle** — prix le moins cher par mois (comme sur airfrance.fr)
- **Vue journalière** — prix jour par jour pour un mois donné
- **Filtre AF / HOP** — n'affiche que les vols opérés par Air France ou HOP, avec comparaison vs toutes compagnies
- **Détails des vols** — clic sur un jour pour voir tous les vols avec segments, escales, compagnies et prix
- **Terminal de logs** — fenêtre temps réel pendant la recherche filtrée (progression, prix, erreurs)
- **Lien de réservation** — chaque vol renvoie directement vers la page de réservation airfrance.fr
- **Batch parallélisé** — les requêtes sont envoyées par chunks de 5 avec concurrence 3 et retry automatique

---

## Comment ça marche

### Architecture

```
┌─────────────┐       ┌──────────────┐       ┌──────────────────┐
│  Navigateur │  HTTP │  Flask (API) │ queue  │  Chrome piloté   │
│  (frontend) │◄─────►│  port 5555   │◄──────►│  par patchright  │
└─────────────┘       └──────────────┘       └───────┬──────────┘
                                                     │
                                              page.evaluate(fetch)
                                                     │
                                              ┌──────▼──────────┐
                                              │  airfrance.fr   │
                                              │  API GraphQL    │
                                              └─────────────────┘
```

1. **patchright** (fork stealth de Playwright) ouvre une vraie instance Chrome et navigue sur airfrance.fr pour obtenir les cookies Akamai (`_abck`, `bm_sz`, etc.)
2. Un **thread dédié** gère cette instance Chrome. Flask lui envoie des tâches via une `queue.Queue`
3. Chaque requête GraphQL est exécutée via `page.evaluate(fetch(...))` — le `fetch` s'exécute dans le contexte de la page, donc same-origin, avec tous les cookies Akamai valides
4. Le frontend Flask (HTML/CSS/JS) appelle les endpoints `/api/*` qui dispatchent vers le thread navigateur

### Contournement Akamai

Akamai bloque les POST vers `/gql/v1` quand l'URL contient `SearchResultAvailableOffersQuery`. La solution :

- L'URL utilise toujours `operationName=SharedSearchLowestFareOffersForSearchQuery` (opération "safe")
- L'opération réelle (`SearchResultAvailableOffersQuery`) est envoyée uniquement dans le **body JSON**
- Le serveur Air France lit l'opération depuis le body, pas l'URL — Akamai ne vérifie que l'URL

### Requêtes GraphQL

| Requête | Hash | Usage |
|---|---|---|
| `SharedSearchLowestFareOffersForSearchQuery` | `3129e428...` | Calendrier mensuel/journalier (prix par date, toutes compagnies) |
| `SearchResultAvailableOffersQuery` | `6c2316d3...` | Détail des vols (segments, compagnies opérantes, prix par itinéraire) |

La première ne renvoie pas les compagnies opérantes — d'où la nécessité de la seconde pour filtrer AF/HOP.

### Gestion du rate-limiting

Akamai invalide la session après ~15 requêtes rapides. Stratégie :

1. Le frontend envoie les dates par **chunks de 5** avec **1.5s de pause** entre chaque
2. Le backend teste le premier appel pour valider la session ; s'il échoue, il **recharge la page** (nouveau cookie `_abck`)
3. Après chaque batch, les **échecs sont retentés** individuellement après un refresh de page
4. Chaque worker a un **délai de 350ms** entre les items pour réduire la pression

---

## Installation

### Prérequis

- Python 3.11+
- Google Chrome installé sur la machine

### Étapes

```bash
# Cloner le repo
git clone https://github.com/RemiPelloux/AirFranceFilterScript.git
cd AirFranceFilterScript

# Créer un environnement virtuel
python3 -m venv venv
source venv/bin/activate

# Installer les dépendances
pip install -r requirements.txt

# Installer le navigateur Chromium pour patchright
python -m patchright install chromium
```

---

## Lancement

```bash
python app.py
```

Le serveur démarre en deux temps :

1. **Chrome s'ouvre** automatiquement (fenêtre visible, `headless=False`) et navigue sur airfrance.fr
2. Une fois les cookies Akamai obtenus (~3s), le **serveur Flask** démarre sur `http://127.0.0.1:5555`

Ouvrir `http://127.0.0.1:5555` dans un navigateur.

> **Note** : La fenêtre Chrome pilotée doit rester ouverte pendant toute l'utilisation. Ne pas la fermer.

---

## Utilisation

### Recherche mensuelle

1. Entrer les codes ville/aéroport (ex: `SHA` → `BIO`)
2. Choisir la cabine et le nombre de passagers
3. Cliquer **Rechercher**
4. Le calendrier affiche le prix le moins cher par mois
5. Cliquer sur un mois pour passer en vue journalière

### Recherche journalière filtrée (AF/HOP)

1. Activer l'onglet **Vue journalière**
2. Cocher **AF + HOP uniquement**
3. Sélectionner le mois dans le menu déroulant
4. Le terminal de logs s'affiche avec la progression en temps réel
5. Chaque carte jour affiche le prix le moins cher AF/HOP, avec comparaison vs toutes compagnies

### Détails d'un vol

- Cliquer sur une carte jour pour ouvrir le panneau de détails
- Voir les segments (aéroports, horaires, numéro de vol)
- Nombre d'escales et compagnie opérante
- Bouton **Réserver sur AF** pour aller directement sur airfrance.fr

---

## Endpoints API

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Page principale |
| `POST` | `/api/calendar` | Calendrier mensuel ou journalier (LowestFare) |
| `POST` | `/api/flights` | Détail des vols pour une date (AvailableOffers) |
| `POST` | `/api/calendar-filtered` | Calendrier journalier filtré par compagnie (batch) |

---

## Structure du projet

```
AirFranceFilterScript/
├── app.py              # Backend Flask + thread navigateur + API
├── static/
│   └── index.html      # Frontend (HTML/CSS/JS single-page)
├── requirements.txt    # Dépendances Python
└── README.md
```

---

## Limitations

- **Chrome visible requis** — `headless=True` est détecté par Akamai, l'app fonctionne en mode visible
- **Session limitée** — après ~15 requêtes rapides, Akamai peut bloquer temporairement (géré par retry + page refresh)
- **Un seul utilisateur à la fois** — le thread navigateur traite les requêtes séquentiellement
- **Pas de cache** — chaque recherche refait les appels API
- **Les hashes GraphQL peuvent changer** — si Air France met à jour son frontend, les hashes des persisted queries devront être mis à jour
