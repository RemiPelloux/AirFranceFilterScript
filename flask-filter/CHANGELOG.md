# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/).

## [2.0.0] — 2026-11-01

Refonte complète : paquet Python structuré, cache, interface progressive, tests et CI.

### Ajouté
- Paquet `src/af_filter/` (config, modèles, cache, service, navigateur, GraphQL, web) et commande `af-filter`.
- Cache TTL + LRU des réponses par `(route, date)` : ouvrir un jour déjà scanné ne refait aucun appel.
- Remplissage progressif du calendrier pendant le scan AF/HOP, bouton **Arrêter**, annulation automatique de la recherche précédente.
- Choix Ville / Aéroport pour le départ et l'arrivée (avant : codé en dur).
- Mémorisation du dernier formulaire, navigation clavier, mise en page mobile, animations respectant `prefers-reduced-motion`.
- Validation des entrées (IATA, dates, cabine, 1 à 9 passagers, 31 dates max par lot) et codes HTTP typés (400 / 502 / 503 / 504).
- Configuration par variables d'environnement (`.env.example`).
- 39 tests pytest avec une fausse session navigateur, lint et format ruff, `pip-audit`, CI GitHub Actions (Python 3.11 à 3.13).
- `Makefile` (`install`, `run`, `test`, `lint`, `format`, `audit`, `check`).
- README avec SVG animés et diagramme de séquence.

### Modifié
- Le projet vit dans `flask-filter/`, à côté de Ratline (app TypeScript à la racine du dépôt).
- Le JS exécuté dans la page reçoit sa config en argument de `page.evaluate` (avant : formatage `%` de la source).
- Un seul pool de fetch sert aux appels simples comme aux lots.
- Logs via `logging` au lieu de `print`.
- Les dates par défaut de `/api/calendar` sont calculées à partir d'aujourd'hui (avant : `2026-06-01`, déjà passée).
- Les lots déjà servis par le cache s'enchaînent sans la pause de 1,5 s.
- Frontend découpé : `index.html`, `css/app.css` et des modules ES `js/*.js`.

### Corrigé
- Une réponse non-2xx (ex. page de blocage Akamai) est maintenant traitée comme un échec et retentée, au lieu d'être lue comme « aucun vol ».
- Une erreur GraphQL typée sur le calendrier remonte en 502 au lieu de produire un calendrier vide.
- Les itinéraires sans compagnie connue ne passent plus le filtre AF/HOP.

### Sécurité
- Suppression du CORS ouvert : n'importe quel site visité pouvait piloter la session Air France locale.
- `TRUSTED_HOSTS` en écoute locale : protection contre le DNS rebinding.
- Échappement HTML de toutes les données injectées dans le DOM.
- En-têtes `X-Content-Type-Options`, `X-Frame-Options` et `Referrer-Policy`.
- pytest ≥ 9.0.3 (PYSEC-2026-1845).

### Supprimé
- `app.py` monolithique, remplacé par le paquet.
- Dépendance `flask-cors`.

## [1.0.0] — 2026-03-20

- Première version : calendrier AF/HOP, contournement Akamai via l'`operationName` de l'URL, batch parallélisé, keepalive de session.
