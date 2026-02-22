# WinCC OA KPI Configuration & Performance Manager

Web-based configuration for KPI calculation, OEE analysis, and downtime tracking in WinCC OA.
Inspired by Siemens Industrial Edge (IIH + Performance Insight).

---

## Quick Start

### 1. Simulation Mode (without WinCC OA)

Open directly in a browser to test the interface:

```bash
# From the project root
open webview/index.html
# or
python3 -m http.server 8080 --directory webview
# then open http://localhost:8080
```

Simulation mode is automatically enabled when `oaJsApi` is not detected. Data is persisted in `localStorage`.

### 2. WinCC OA Integration

#### a) Import Datapoint Types

1. Open **Para** in WinCC OA
2. **Import** > select `dplist/kpi_dptypes.dpl`
3. Verify that the types `KPI_Config`, `KPI_Result`, and `KPI_OEE_Result` are created

#### b) Enable the WinCC OA Web Server

The `oaJsApi` library requires an active web server. Add a CTRL manager with parameter `webclient_http.ctl` in the Console, or drag-drop the file onto the Console.

#### c) Copy files into the WinCC OA project

```
<WinCC_OA_Project>/
├── panels/
│   └── kpiWebView.xml        ← copy from panels/
├── scripts/
│   └── libs/
│       ├── kpiDataAccess.ctl        ← copy from scripts/libs/
│       ├── kpiAggregationEngine.ctl ← copy from scripts/libs/
│       └── kpiOeeEngine.ctl         ← copy from scripts/libs/
└── data/
    └── webview/               ← copy the webview/ folder here
        ├── index.html
        ├── css/style.css
        └── js/*.js
```

> **Note:** The `webview/` folder must be placed under the `data/` directory so the WinCC OA web server can serve it. The panel loads it via `loadSnippet("/webview/index.html")`.

#### d) Configure CTRL managers

In the WinCC OA **Console**, add two CTRL managers:

| Manager | Script |
|---------|--------|
| CTRL Manager 1 | `scripts/libs/kpiAggregationEngine.ctl` |
| CTRL Manager 2 | `scripts/libs/kpiOeeEngine.ctl` |

#### e) Open the panel

- Open `panels/kpiWebView.xml` in GEDI or the Vision module
- The panel calls `loadSnippet("/webview/index.html")` which loads the HTML into the WebView EWO and injects the `oaJsApi` library
- The `messageReceived` handler dispatches ALL commands to the CTRL data access layer (`kpiDataAccess.ctl`)

---

## Architecture

```
webview/
├── index.html            # Main page (Single Page App)
├── css/style.css         # Industrial theme
└── js/
    ├── kpi.js            # Domain-oriented data access + mock mode
    ├── utils.js          # Helpers, constants, formatting
    ├── sourceConfig.js   # Data source configuration
    ├── aggregationConfig.js  # KPI aggregation configuration
    ├── machineStateConfig.js # Machine state configuration
    ├── oeeConfig.js      # OEE configuration
    ├── oeeAnalysis.js    # Real-time OEE analysis (display-time aggregation)
    ├── correctionManager.js  # Archive data correction
    └── app.js            # Entry point, tabs, DP browser

scripts/libs/
├── kpiDataAccess.ctl         # CTRL data access layer (domain commands)
├── kpiAggregationEngine.ctl  # Aggregation calculation engine
└── kpiOeeEngine.ctl          # OEE calculation engine + downtime analysis

panels/
└── kpiWebView.xml       # WinCC OA panel with WebView (XML format)

dplist/
└── kpi_dptypes.dpl       # DP type export
```

---

## Features

### Sources Tab

Source datapoint configuration:

| Parameter | Description |
|-----------|-------------|
| **Name** | Human-readable source name |
| **Datapoint** | WinCC OA DP path (e.g. `System1:Plant.Water.Counter`) |
| **Data Type** | FLOAT, INT, BOOL, UINT, STRING |
| **Characterization** | Signal type — see table below |
| **Archiving** | Activation, archive class, smoothing (deadband) |
| **Limits** | Min/max validity values |

**Available characterizations:**

| Type | Usage |
|------|-------|
| Process Value | Temperature, pressure, level... |
| Counter | Incremental counter (water, energy, pieces) |
| Flow Rate | Instantaneous flow rate |
| Status | Binary state ON/OFF |
| Setpoint | Setpoint value |
| Energy Meter | Energy counter |
| Machine State | Machine state signal (for OEE) |

### Aggregations Tab

Computed KPI configuration:

| Method | Description | Typical Usage |
|--------|-------------|---------------|
| Sum | Sum of values | Total consumption |
| Average | Arithmetic mean | Average temperature |
| Min / Max | Extremes | Peak values |
| Count | Number of samples | Event frequency |
| Delta | First-to-last difference | Counter consumption |
| Time-Weighted Avg | Time-weighted average | Process values |
| Flow from Counter | Delta / period (in units/h) | Flow rate from counter |
| Uptime Ratio | % of time in ON state | Availability |
| Std Deviation | Standard deviation | Process variability |

**Periods**: 15min, Hourly, Shift, Day, Week, Month (calendar-aligned or sliding).

**Custom expression**: free-form formula using `delta`, `sum`, `avg`, `min`, `max`, `count`, `periodSeconds`.

### Machine States Tab

Machine state configuration for OEE analysis and downtime tracking:

- Define each possible state (code + label + category)
- Categories: Producing, Idle, Planned Stop, Unplanned Stop, Setup, Maintenance
- Mark planned vs unplanned stops
- Configure downtime cause tracking with categorization (Mechanical, Electrical, Process, Operator, Quality, Supply)

**Default preset:** 6 states + 9 causes pre-configured, fully customizable.

### OEE Tab

OEE (Overall Equipment Effectiveness) calculation configuration:

```
OEE = Availability x Performance x Quality
```

| Factor | Formula | Sources |
|--------|---------|---------|
| **Availability** | (Planned Time - Unplanned Stops) / Planned Time | From machine states |
| **Performance** | (Ideal Cycle Time x Total Pieces) / Run Time | Piece counter + ideal cycle time or design speed |
| **Quality** | Good Pieces / Total Pieces | Good piece counter, reject counter, or fixed ratio |

**Results written to DPs:**
- `<prefix>.Availability` (%)
- `<prefix>.Performance` (%)
- `<prefix>.Quality` (%)
- `<prefix>.OEE` (%)
- `<prefix>.StateTime.<state>` (seconds per state)
- `<prefix>.Causes.<cause>.Count` (stop count)
- `<prefix>.Causes.<cause>.Duration` (duration in seconds)

---

## Datapoint Types

### KPI_Config

Stores all configuration as JSON:

| Element | Type | Content |
|---------|------|---------|
| sources | string | JSON array of source configs |
| aggregations | string | JSON array of aggregation configs |
| machines | string | JSON array of machine configs |
| oee | string | JSON array of OEE configs |
| recalcRequest | string | JSON recalculation request (triggers KPI/OEE recalculation) |

### KPI_Result

Aggregation result:

| Element | Type |
|---------|------|
| value | float |
| lastCalc | time |
| status | int (0=OK, 1=Warning, 2=Error) |
| unit | string |

### KPI_OEE_Result

OEE result:

| Element | Type |
|---------|------|
| Availability | float (%) |
| Performance | float (%) |
| Quality | float (%) |
| OEE | float (%) |
| StateTime | dyn_float |
| lastCalc | time |

### Archive Data Correction

The system integrates the WinCC OA archive correction mechanism:

| Concept | Description |
|---------|-------------|
| `_original.._value` | Raw archived value (written by the archiving engine) |
| `_corr.._value` | Corrected value (written via `dpSetTimed`) |
| `_offline.._value` | Abstraction: returns `_corr` if present, otherwise `_original` |

**Correction workflow:**

1. Open the correction modal from the magnifying glass button on a source
2. Load history to view original and corrected values
3. Apply a correction: writes via `dpSetTimed(timestamp, dp:_corr.._value, value)`
4. Trigger KPI recalculation: the CTRL engines re-read via `_offline` (which returns corrections) and write recalculated KPI results into `_corr.._value` of the target DPs

**Automatic recalculation:**

- The webview writes a JSON request to `KPI_Config.recalcRequest`
- Both CTRL engines (`kpiAggregationEngine` and `kpiOeeEngine`) monitor this DP via `dpConnect`
- Upon receipt, they recalculate affected KPIs/OEE by re-reading via `_offline`
- Corrected results are written via `dpSetTimed` into `_corr.._value` of the result DPs
- Subsequent `_offline` queries on KPI DPs then return the corrected values

---

## Data Access Architecture

The interface is **domain-oriented**: JavaScript operates with KPI concepts (configs, history, corrections, recalculation), not WinCC OA primitives (dpGet, dpSet, dpQuery). All WinCC OA specifics (DP attribute paths, SQL query syntax, config DP prefix) are encapsulated in the CTRL data access layer.

```
JS (kpi.js)                         CTRL (kpiDataAccess.ctl)
───────────                         ────────────────────────
KPI.loadConfig("sources")
  → toCtrl({cmd:"loadConfig"})
    → dpGet("KPI_Config.sources", val)
      → msgToJs(params, val)

KPI.readHistory(dp, t1, t2)
  → toCtrl({cmd:"readHistory"})
    → dpQuery("SELECT '_offline.._value'... TIMERANGE(...)")
      → msgToJs(params, result)

KPI.writeCorrection(dp, ts, val)
  → toCtrl({cmd:"writeCorrection"})
    → dpSetTimed(ts, dp + ":_corr.._value", val)
      → msgToJs(params, rc)
```

### KPI API (JavaScript)

```javascript
// Configuration
KPI.loadConfig("sources").then(data => { ... });
KPI.saveConfig("sources", configArray);

// Datapoint browsing
KPI.browseDatapoints("Plant.*");

// Archive history — returns [{value, time}, ...]
KPI.readHistory(dp, tStart, tEnd);
KPI.readOriginalHistory(dp, tStart, tEnd);
KPI.readCorrectionHistory(dp, tStart, tEnd);

// Archive correction
KPI.writeCorrection(dp, timestamp, 123.45);

// KPI recalculation
KPI.requestRecalculation({ sourceId, periodStart, periodEnd, ... });

// Live monitoring
const handle = KPI.subscribe(dp, value => { ... });
KPI.unsubscribe(handle);
```

### CTRL Commands (kpiDataAccess.ctl)

| Domain Command | CTRL Implementation | Description |
|----------------|---------------------|-------------|
| `loadConfig` | `dpGet("KPI_Config." + section)` | Load KPI configuration |
| `saveConfig` | `dpSet("KPI_Config." + section, json)` | Save KPI configuration |
| `browseDatapoints` | `dpNames("*" + filter + "*")` | List available datapoints |
| `datapointExists` | `dpNames(dp)` + length check | Check DP existence |
| `createDatapoint` | `dpCreate(name, typeId)` | Create new datapoint |
| `readHistory` | `dpQuery(SELECT _offline.. TIMERANGE)` | Read effective archive |
| `readOriginalHistory` | `dpQuery(SELECT _original.. TIMERANGE)` | Read original archive |
| `readCorrectionHistory` | `dpQuery(SELECT _corr.. TIMERANGE)` | Read correction archive |
| `writeCorrection` | `dpSetTimed(ts, dp:_corr.._value, val)` | Write archive correction |
| `writeCorrectionBatch` | Multiple `dpSetTimed()` | Batch corrections |
| `requestRecalculation` | `dpSet("KPI_Config.recalcRequest", json)` | Trigger KPI recalc |
| `subscribe` | `dpConnect()` + `execJsFunction()` | Live value subscription |
| `unsubscribe` | `dpDisconnect()` | Cancel subscription |

JavaScript never touches WinCC OA attribute paths, SQL syntax, or DP naming conventions. The CTRL layer is the single source of truth for all WinCC OA integration details.

In simulation mode, all calls are handled by a mock layer using `localStorage`.
