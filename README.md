# WinCC OA KPI Configuration & Performance Manager

Configuration web-based pour le calcul de KPIs, l'analyse OEE et le suivi des temps d'arret dans WinCC OA.
Inspiré de Siemens Industrial Edge (IIH + Performance Insight).

---

## Quick Start

### 1. Mode Simulation (sans WinCC OA)

Ouvrir directement dans un navigateur pour tester l'interface :

```bash
# Depuis la racine du projet
open webview/index.html
# ou
python3 -m http.server 8080 --directory webview
# puis ouvrir http://localhost:8080
```

Le mode simulation est automatiquement activé quand `oaJS` n'est pas détecté. Les données sont persistées dans `localStorage`.

### 2. Intégration WinCC OA

#### a) Importer les Datapoint Types

1. Ouvrir le **Para** dans WinCC OA
2. **Import** > sélectionner `dplist/kpi_dptypes.dpl`
3. Vérifier que les types `KPI_Config`, `KPI_Result` et `KPI_OEE_Result` sont créés

#### b) Copier les fichiers dans le projet WinCC OA

```
<Projet_WinCC_OA>/
├── panels/
│   └── kpiWebView.pnl        ← copier depuis panels/
├── scripts/
│   └── libs/
│       ├── kpiAggregationEngine.ctl  ← copier depuis scripts/libs/
│       └── kpiOeeEngine.ctl          ← copier depuis scripts/libs/
└── webview/                   ← copier le dossier entier
    ├── index.html
    ├── css/style.css
    └── js/*.js
```

#### c) Configurer les managers CTRL

Dans la **Console** WinCC OA, ajouter deux managers CTRL :

| Manager | Script |
|---------|--------|
| CTRL Manager 1 | `scripts/libs/kpiAggregationEngine.ctl` |
| CTRL Manager 2 | `scripts/libs/kpiOeeEngine.ctl` |

#### d) Ouvrir le panel

- Ouvrir `panels/kpiWebView.pnl` dans GEDI ou le module Vision
- La page HTML se charge dans le widget WebView et communique via `oaJS`

---

## Architecture

```
webview/
├── index.html            # Page principale (Single Page App)
├── css/style.css         # Theme industriel
└── js/
    ├── oabridge.js       # Couche d'abstraction oaJS + mode mock
    ├── utils.js          # Helpers, constantes, formatage
    ├── sourceConfig.js   # Config des sources de données
    ├── aggregationConfig.js  # Config des agrégations KPI
    ├── machineStateConfig.js # Config des états machines
    ├── oeeConfig.js      # Config OEE
    ├── oeeAnalysis.js    # Analyse OEE temps réel (agrégation à l'affichage)
    ├── correctionManager.js  # Correction de données archivées
    └── app.js            # Point d'entrée, tabs, DP browser

scripts/libs/
├── kpiAggregationEngine.ctl  # Moteur de calcul des agrégations
└── kpiOeeEngine.ctl          # Moteur de calcul OEE + analyse arrêts

panels/
└── kpiWebView.pnl       # Panel WinCC OA avec WebView

dplist/
└── kpi_dptypes.dpl       # Export des types de DP
```

---

## Fonctionnalités

### Onglet Sources

Configuration des datapoints sources :

| Paramètre | Description |
|-----------|-------------|
| **Name** | Nom lisible de la source |
| **Datapoint** | Chemin DP WinCC OA (ex: `System1:Plant.Water.Counter`) |
| **Data Type** | FLOAT, INT, BOOL, UINT, STRING |
| **Characterization** | Type de signal — voir tableau ci-dessous |
| **Archiving** | Activation, classe d'archivage, lissage (deadband) |
| **Limits** | Valeurs min/max de validité |

**Caractérisations disponibles :**

| Type | Usage |
|------|-------|
| Process Value | Température, pression, niveau... |
| Counter | Compteur incrémental (eau, énergie, pièces) |
| Flow Rate | Débit instantané |
| Status | État binaire ON/OFF |
| Setpoint | Consigne |
| Energy Meter | Compteur d'énergie |
| Machine State | Signal d'état machine (pour OEE) |

### Onglet Aggregations

Configuration des KPIs calculés :

| Méthode | Description | Usage typique |
|---------|-------------|---------------|
| Sum | Somme des valeurs | Consommation totale |
| Average | Moyenne arithmétique | Température moyenne |
| Min / Max | Extrema | Valeurs crête |
| Count | Nombre d'échantillons | Fréquence d'événements |
| Delta | Différence premier-dernier | Consommation compteur |
| Time-Weighted Avg | Moyenne pondérée par le temps | Process values |
| Flow from Counter | Delta / période (en unités/h) | Débit depuis compteur |
| Uptime Ratio | % de temps à l'état ON | Disponibilité |
| Std Deviation | Écart-type | Variabilité process |

**Périodes** : 15min, Horaire, Poste, Jour, Semaine, Mois (calendaire ou glissant).

**Expression personnalisée** : formule libre utilisant `delta`, `sum`, `avg`, `min`, `max`, `count`, `periodSeconds`.

### Onglet Machine States

Configuration des états machines pour l'analyse OEE et le suivi d'arrêts :

- Définir chaque état possible (code + label + catégorie)
- Catégories : Producing, Idle, Planned Stop, Unplanned Stop, Setup, Maintenance
- Marquer les arrêts planifiés vs non-planifiés
- Configurer le suivi des causes d'arrêt avec catégorisation (Mécanique, Électrique, Process, Opérateur, Qualité, Approvisionnement)

**Preset par défaut :** 6 états + 9 causes pré-configurés, modifiables.

### Onglet OEE

Configuration du calcul OEE (Overall Equipment Effectiveness) :

```
OEE = Availability x Performance x Quality
```

| Facteur | Formule | Sources |
|---------|---------|---------|
| **Availability** | (Temps planifié - Arrêts non planifiés) / Temps planifié | Depuis les états machine |
| **Performance** | (Temps cycle idéal x Pièces totales) / Temps de marche | Compteur pièces + cycle idéal ou vitesse nominale |
| **Quality** | Pièces bonnes / Pièces totales | Compteur bonnes pièces, ou rejects, ou ratio fixe |

**Résultats écrits dans les DPs :**
- `<prefix>.Availability` (%)
- `<prefix>.Performance` (%)
- `<prefix>.Quality` (%)
- `<prefix>.OEE` (%)
- `<prefix>.StateTime.<state>` (secondes par état)
- `<prefix>.Causes.<cause>.Count` (nombre d'arrêts)
- `<prefix>.Causes.<cause>.Duration` (durée en secondes)

---

## Datapoint Types

### KPI_Config

Stocke toute la configuration en JSON :

| Élément | Type | Contenu |
|---------|------|---------|
| sources | string | JSON array des configs sources |
| aggregations | string | JSON array des configs agrégation |
| machines | string | JSON array des configs machine |
| oee | string | JSON array des configs OEE |
| recalcRequest | string | JSON requête de recalcul (déclenche recalcul KPI/OEE) |

### KPI_Result

Résultat d'une agrégation :

| Élément | Type |
|---------|------|
| value | float |
| lastCalc | time |
| status | int (0=OK, 1=Warning, 2=Error) |
| unit | string |

### KPI_OEE_Result

Résultat OEE :

| Élément | Type |
|---------|------|
| Availability | float (%) |
| Performance | float (%) |
| Quality | float (%) |
| OEE | float (%) |
| StateTime | dyn_float |
| lastCalc | time |

### Correction de données archivées

Le système intègre le mécanisme de correction d'archive WinCC OA :

| Concept | Description |
|---------|-------------|
| `_original.._value` | Valeur brute archivée (écrite par le moteur d'archivage) |
| `_corr.._value` | Valeur corrigée (écrite via `dpSetTimed`) |
| `_offline.._value` | Abstraction : retourne `_corr` si présente, sinon `_original` |

**Workflow de correction :**

1. Ouvrir la modale de correction depuis le bouton loupe sur une source
2. Charger l'historique pour visualiser les valeurs originales et corrigées
3. Appliquer une correction : écrit via `dpSetTimed(timestamp, dp:_corr.._value, value)`
4. Déclencher le recalcul KPI : les moteurs CTRL relisent via `_offline` (obtiennent les corrections) et écrivent les KPI recalculés dans `_corr.._value` des DPs cibles

**Recalcul automatique :**

- Le webview écrit une requête JSON dans `KPI_Config.recalcRequest`
- Les deux moteurs CTRL (`kpiAggregationEngine` et `kpiOeeEngine`) surveillent ce DP via `dpConnect`
- À réception, ils recalculent les KPIs/OEE affectés en relisant via `_offline`
- Les résultats corrigés sont écrits via `dpSetTimed` dans `_corr.._value` des DPs résultats
- Les requêtes `_offline` sur les KPIs retournent alors les valeurs corrigées

---

## Communication oaJS

La page HTML communique avec WinCC OA via l'API JavaScript `oaJS` fournie par le widget WebView :

```javascript
// Lecture d'un DP
OABridge.dpGet("KPI_Config.sources").then(value => { ... });

// Écriture d'un DP
OABridge.dpSet("KPI_Config.sources", jsonString);

// Requête DP (browse)
OABridge.dpQuery("SELECT '_online.._value' FROM '*'");

// Subscription temps réel
OABridge.dpConnect("System1:Plant.Water.Counter", (value) => { ... });

// Correction de valeur archivée (dpSetTimed)
OABridge.writeCorrection("System1:Plant.Water.Counter", timestamp, 123.45);
// Équivalent à: dpSetTimed(timestamp, "System1:Plant.Water.Counter:_corr.._value", 123.45)

// Lecture archive originale vs corrigée
OABridge.queryOriginalValues(dp, tStart, tEnd);     // SELECT '_original.._value' ...
OABridge.queryCorrectionValues(dp, tStart, tEnd);    // SELECT '_corr.._value' ...
// Toutes les lectures standard utilisent _offline (retourne correction si présente)
```

En mode simulation (hors WinCC OA), les appels sont interceptés et remplacés par un mock avec `localStorage`.
