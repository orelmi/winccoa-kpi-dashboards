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
│   └── kpiWebView.pnl        ← copy from panels/
├── scripts/
│   └── libs/
│       ├── kpiAggregationEngine.ctl  ← copy from scripts/libs/
│       └── kpiOeeEngine.ctl          ← copy from scripts/libs/
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

- Open `panels/kpiWebView.pnl` in GEDI or the Vision module
- The panel calls `loadSnippet("/webview/index.html")` which loads the HTML into the WebView EWO and injects the `oaJsApi` library
- The `messageReceived` handler in the panel processes `dpSetTimed` and `dpCreate` commands from JavaScript (these are not available in `oaJsApi` directly)

---

## Architecture

```
webview/
├── index.html            # Main page (Single Page App)
├── css/style.css         # Industrial theme
└── js/
    ├── oabridge.js       # oaJsApi abstraction layer + mock mode
    ├── utils.js          # Helpers, constants, formatting
    ├── sourceConfig.js   # Data source configuration
    ├── aggregationConfig.js  # KPI aggregation configuration
    ├── machineStateConfig.js # Machine state configuration
    ├── oeeConfig.js      # OEE configuration
    ├── oeeAnalysis.js    # Real-time OEE analysis (display-time aggregation)
    ├── correctionManager.js  # Archive data correction
    └── app.js            # Entry point, tabs, DP browser

scripts/libs/
├── kpiAggregationEngine.ctl  # Aggregation calculation engine
└── kpiOeeEngine.ctl          # OEE calculation engine + downtime analysis

panels/
└── kpiWebView.pnl       # WinCC OA panel with WebView

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

## oaJsApi Communication

The HTML page communicates with WinCC OA via the `oaJsApi` library, which is injected by `loadSnippet()` in the WebView EWO. The `OABridge` module wraps `oaJsApi` into a Promise-based interface:

```javascript
// Read a DP — oaJsApi.dpGet(dp, {success, error})
OABridge.dpGet("KPI_Config.sources").then(value => { ... });

// Write a DP — oaJsApi.dpSet(dp, value, {success, error})
OABridge.dpSet("KPI_Config.sources", jsonString);

// DP query — oaJsApi.dpQuery(query, {success, error})
OABridge.dpQuery("SELECT '_online.._value' FROM '*'");

// Browse datapoints — oaJsApi.dpNames(pattern, type, {success, error})
OABridge.browseDatapoints("Plant.*");

// Real-time subscription — oaJsApi.dpConnect(dpNames, answer, {success, error})
OABridge.dpConnect("System1:Plant.Water.Counter:_online.._value", (data) => { ... });

// Archive value correction — oaJsApi.toCtrl → panel CTRL dpSetTimed
OABridge.writeCorrection("System1:Plant.Water.Counter", timestamp, 123.45);
// Panel CTRL executes: dpSetTimed(ts, "System1:Plant.Water.Counter:_corr.._value", 123.45)

// Read original vs corrected archive — oaJsApi.dpQuery with TIMERANGE
OABridge.queryOriginalValues(dp, tStart, tEnd);     // SELECT '_original.._value' ...
OABridge.queryCorrectionValues(dp, tStart, tEnd);    // SELECT '_corr.._value' ...
// All standard reads use _offline (returns correction if present)
```

**Functions not in oaJsApi** (delegated to panel CTRL via `oaJsApi.toCtrl` + `messageReceived`):
- `dpSetTimed` — archive correction writes
- `dpCreate` — datapoint creation

**Native oaJsApi functions used:**
- `dpGet` / `dpSet` — single or array of DPs
- `dpQuery` — SQL-like archive queries
- `dpConnect` / `dpDisconnect` — real-time subscriptions
- `dpNames` — DP browsing and existence check
- `dpGetPeriod` — historical values over a time range
- `dpGetAsynch` — historical value at a specific time
- `customFunction` — call arbitrary CTRL functions

In simulation mode (outside WinCC OA), all calls are intercepted and replaced by a mock using `localStorage`.
