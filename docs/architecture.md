# Architecture

## Overview

The application follows a domain-oriented architecture where JavaScript operates with KPI concepts (configs, history, corrections, recalculation), not WinCC OA primitives (dpGet, dpSet, dpQuery).

```
Browser / WebView EWO
┌─────────────────────────────────────────┐
│  HTML Pages (sources, machines, ...)    │
│  ├── nav.js          (shared navigation)│
│  ├── kpi.js          (domain API layer) │
│  ├── utils.js        (helpers)          │
│  └── <module>.js     (page modules)     │
└───────────────┬─────────────────────────┘
                │ toCtrl() / msgToJs()
┌───────────────┴─────────────────────────┐
│  CTRL Panel Script (kpiWebView.xml)     │
│  └── kpiDataAccess.ctl                  │
│      ├── dpGet / dpSet / dpQuery        │
│      ├── dpSetTimed (corrections)       │
│      └── dpConnect (subscriptions)      │
└───────────────┬─────────────────────────┘
                │
┌───────────────┴─────────────────────────┐
│  WinCC OA Runtime                       │
│  ├── kpiAggregationEngine.ctl           │
│  └── kpiOeeEngine.ctl                   │
└─────────────────────────────────────────┘
```

## Data Flow

All WinCC OA data access goes through: **JS → toCtrl() → messageReceived → CTRL → msgToJs()**

JavaScript never touches DP attribute paths, SQL syntax, or DP naming conventions. The CTRL layer is the single source of truth for all WinCC OA integration details.

In simulation mode, all calls are handled by a mock layer using `localStorage`.

## File Structure

```
webview/
├── index.html              # Landing page (redirects to sources.html)
├── assets.html             # Asset hierarchy / organization page
├── sources.html            # Source configuration page
├── aggregations.html       # KPI aggregation page
├── machines.html           # Machine state configuration page
├── calendar.html           # Production calendar / shift page
├── oee-config.html         # OEE configuration page
├── oee-analysis.html       # Live OEE analysis page
├── event-log.html          # Event log / audit trail page
├── demo-seed.html          # Demo data seeder (optional, simulation mode)
├── css/style.css           # Industrial theme (Siemens-inspired)
└── js/
    ├── kpi.js              # Domain-oriented data access + mock mode
    ├── utils.js            # Helpers, constants, formatting
    ├── nav.js              # Shared page navigation + context badge + context filter
    ├── assetConfig.js      # Asset tree + context provider (self-contained)
    ├── sourceConfig.js     # Source datapoint configuration
    ├── aggregationConfig.js # KPI aggregation configuration
    ├── machineStateConfig.js # Machine state config + templates
    ├── calendarConfig.js   # Production calendar + shift + connector
    ├── oeeConfig.js        # OEE configuration (supports calendar mode)
    ├── oeeAnalysis.js      # Real-time OEE analysis + roll-up
    ├── eventLog.js         # Event log / audit trail
    ├── correctionManager.js # Archive data correction
    └── demoSeed.js         # Demo data seeder (optional)

scripts/libs/
├── kpiDataAccess.ctl       # CTRL data access layer (command dispatch)
├── kpiAggregationEngine.ctl # Aggregation calculation engine
└── kpiOeeEngine.ctl        # OEE calculation engine

panels/
└── kpiWebView.xml          # WinCC OA panel with WebView EWO
```

## Multi-Page Architecture

Each HTML page is self-contained and can be loaded independently into any WinCC OA WebView panel. Navigation between pages is handled by:

- **Live mode:** JS sends `{cmd:'navigate', page:'xxx'}` via `toCtrl()`. The CTRL handler calls `loadSnippet("/webview/xxx.html")`.
- **Simulation mode:** Browser `window.location.href` redirect.

Modules are safe for data-only loading — `render()` and `init()` check for DOM elements before binding events or updating the UI. This allows dependent modules (e.g., SourceConfig on the OEE page) to load their data without having their UI present.

## Asset Context

The `AssetConfig` module is **self-contained** and provides an organizational context to the application:

```
AssetConfig (self-contained)           Other modules (consumers)
─────────────────────────────          ─────────────────────────
Tree: SITE > AREA > LINE > MACHINE
Context: setContext(id) / getContext()  →  getRefsForContext() → filter
Calendar: resolveCalendar(id)          →  walk up tree for inheritance
Refs: machines[], sources[], oee[]     →  link configs to assets
```

**Key design principle:** AssetConfig does NOT import or depend on other modules. Other modules optionally query the context API to filter their data. This keeps the asset module portable — it can be loaded alone or alongside any subset of modules.

**Context persistence:** The current asset context is stored in `localStorage` so it survives page navigation (each `loadSnippet` reloads the entire page).

### Context Filter Bar

When a context is active, `Nav.renderContextFilter(reRenderCallbacks)` inserts a filter bar below the navigation showing the active asset path with a "Show all" button. When cleared, all registered re-render callbacks are invoked to refresh page content unfiltered.

Each module's `render()` method checks for an active context via `AssetConfig.getContext()` and filters its display items using `AssetConfig.getRefsForContext()`. Without an active context, all items are shown.

## CTRL Commands

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
| `navigate` | `loadSnippet("/webview/" + page + ".html")` | Page navigation |
| `exportGanttMapping` | `dpSet("KPI_Config.ganttMappings", json)` | Export Gantt mapping |

## Datapoint Types

### KPI_Config

Stores all configuration as JSON strings:

| Element | Content |
|---------|---------|
| sources | Source configs |
| aggregations | Aggregation configs |
| machines | Machine configs |
| oee | OEE configs |
| calendar | Calendar/shift configs |
| recalcRequest | Recalculation trigger |
| ganttMappings | Dashboard Gantt mappings |
| eventLog | Event log / audit trail entries |
| stateTemplates | Custom machine state templates |
| assets | Asset hierarchy configs |

### KPI_Result

| Element | Type |
|---------|------|
| value | float |
| lastCalc | time |
| status | int (0=OK, 1=Warning, 2=Error) |
| unit | string |

### KPI_OEE_Result

| Element | Type |
|---------|------|
| Availability | float (%) |
| Performance | float (%) |
| Quality | float (%) |
| OEE | float (%) |
| TEEP | float (%) |
| MTBF | float (seconds) |
| MTTR | float (seconds) |
| FailureCount | int |
| StateTime | dyn_float |
| lastCalc | time |
