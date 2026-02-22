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
data/data/html/pi-webview/
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

- **Live mode:** JS sends `{cmd:'navigate', page:'xxx'}` via `toCtrl()`. The CTRL handler calls `loadSnippet("/data/html/pi-webview/xxx.html")`.
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

## KPI Calculation Pipeline — From Source Data to Presentation

This section describes the end-to-end process of calculating KPIs, from raw data acquisition in WinCC OA to final visualization in the browser.

### Overview: Two Calculation Paths

The application provides two complementary paths for computing KPIs:

```
                         ┌──────────────────────────────────────────────┐
                         │          WinCC OA Archive                    │
                         │  Machine State DP   Counter DPs   Cause DP  │
                         └──────┬─────────────────┬──────────────┬─────┘
                                │                 │              │
              ┌─────────────────┴─────────────────┴──────────────┘
              │                                   │
     ┌────────┴────────┐                 ┌────────┴────────┐
     │ PATH A           │                 │ PATH B           │
     │ Pre-Calculated   │                 │ Display-Time     │
     │ (CTRL Engines)   │                 │ (JS Analysis)    │
     ├─────────────────┤                 ├─────────────────┤
     │ Runs every 60s   │                 │ On user request  │
     │ Fixed period      │                 │ Any time range   │
     │ Writes to DPs     │                 │ In-memory only   │
     └────────┬─────────┘                 └────────┬─────────┘
              │                                    │
     ┌────────┴────────┐                 ┌────────┴────────┐
     │ KPI_Result DPs   │                 │ Browser DOM      │
     │ KPI_OEE_Result   │                 │ Gauges, Gantt,   │
     │ (historized)      │                 │ Pareto, Tables   │
     └─────────────────┘                 └─────────────────┘
```

**Path A — Pre-Calculated (CTRL engines):** Two CTRL manager scripts (`kpiAggregationEngine.ctl` and `kpiOeeEngine.ctl`) run continuously in WinCC OA, computing KPIs every 60 seconds and writing results to target datapoints. These results are historized and available for trending, alarming, and external systems.

**Path B — Display-Time (JS analysis):** The OEE Analysis page (`oeeAnalysis.js`) queries raw archive data directly and computes all metrics on the fly in the browser. This allows the user to freely pick any time range without waiting for pre-calculated periods.

Both paths use the same formulas and source data, but serve different purposes.

---

### Step 1 — Source Data Registration

Before any KPI can be computed, source datapoints must be registered on the **Sources** page (`sourceConfig.js`).

Each source describes a WinCC OA datapoint and its metadata:

| Field | Purpose | Example |
|-------|---------|---------|
| `dpSource` | Full DP path in WinCC OA | `System1:Line1.PieceCounter` |
| `dataType` | Value type (FLOAT, INT, BOOL, ...) | `FLOAT` |
| `characterization` | Signal semantics | `COUNTER`, `PROCESS_VALUE`, `MACHINE_STATE` |
| `archiving` | Archive class + smoothing/deadband | `_EVENT`, deadband 0.5 |
| `limits` | Min/max validity range | min: 0, max: 10000 |

The characterization is critical because it determines how the value is interpreted during aggregation. For example, a `COUNTER` uses delta (last − first) logic with rollover detection, while a `PROCESS_VALUE` uses arithmetic mean.

Sources are stored as JSON in `KPI_Config.sources`.

---

### Step 2 — Machine State & Cause Configuration

The **Machine States** page (`machineStateConfig.js`) defines how a machine's integer state codes map to semantic states and OEE categories.

```
State DP value    →    Label           →    OEE Category       →  OEE impact
─────────────────────────────────────────────────────────────────────────────
0                 →    Stopped         →    UNPLANNED_STOP      →  Reduces Availability
1                 →    Producing       →    PRODUCING           →  Run time (denominator)
2                 →    Idle            →    IDLE                →  Reduces Availability
3                 →    Setup           →    SETUP               →  Planned or unplanned
4                 →    Maintenance     →    MAINTENANCE         →  Planned downtime
5                 →    Planned Stop    →    PLANNED_STOP        →  Planned downtime
```

Each state has:
- **value**: The numeric code read from the state DP
- **category**: OEE classification (PRODUCING, UNPLANNED_STOP, PLANNED_STOP, IDLE, SETUP, MAINTENANCE)
- **isPlanned**: Whether this state counts as planned downtime (excluded from availability denominator)

Optionally, a **cause datapoint** can be configured. Cause definitions follow the same model as states: a `value` field maps to the numeric code read from the cause DP. Parent-child relationships (via `parentValue`) enable hierarchical grouping.

---

### Step 3 — Production Calendar

The **Calendar** page (`calendarConfig.js`) defines shift schedules and exception days.

When an OEE configuration uses `calendarMode: 'CALENDAR'`, the planned production time is computed dynamically from shift definitions instead of a fixed hours/day value:

1. Iterate day by day through the analysis period
2. For each day, check if it falls on an exception (holiday, shutdown → skip; overtime → include)
3. For non-exception days, sum the duration of all `PRODUCTION`-category shifts active on that weekday
4. The total is the **planned production time** for the period

This calculation is performed identically in both the CTRL engine (`calcPlannedTimeFromCalendar`) and the JS analysis module (`_calcPlannedFromCalendar`).

---

### Step 4a — KPI Aggregation (Pre-Calculated Path)

The **kpiAggregationEngine.ctl** runs every 60 seconds as a WinCC OA CTRL manager:

```
┌──────────────────────────────────────────────────────────────────────┐
│  For each enabled aggregation config:                                │
│                                                                      │
│  1. Read config: source DP, method, period, expression               │
│  2. Determine time range: tEnd = now, tStart = now - periodSeconds   │
│  3. Query archive:                                                   │
│     dpQuery("SELECT _offline.._value, _offline.._stime              │
│              FROM 'sourceDp' TIMERANGE(tStart, tEnd)")               │
│  4. Apply aggregation method to archived values:                     │
│     SUM, AVG, MIN, MAX, COUNT, DELTA, TIME_WEIGHTED_AVG,            │
│     FLOW_FROM_COUNTER, UPTIME_RATIO, STDDEV                         │
│  5. Apply custom expression (if defined):                            │
│     Replace variables (delta, sum, avg, min, max, count,             │
│     periodSeconds, result) and evaluate via evalScript()             │
│  6. Write result: dpSet(targetDp, result)                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Key detail:** The `_offline` attribute transparently returns corrected values (`_corr`) when they exist, otherwise the original archived value. This means corrected source data automatically flows into subsequent KPI calculations.

**Aggregation methods in detail:**

| Method | Algorithm |
|--------|-----------|
| Sum | `Σ values[i]` |
| Average | `Σ values[i] / count` |
| Min / Max | Extreme value scan |
| Count | Number of archived samples |
| Delta | `last - first` (with 32-bit counter rollover detection for COUNTER/ENERGY sources) |
| Time-Weighted Avg | `Σ (value[i] × duration[i]) / Σ duration[i]` — weight each value by the time it was held |
| Flow from Counter | `delta / periodSeconds × 3600` — convert counter increment to units/hour |
| Uptime Ratio | `Σ time_where(value > 0) / totalTime × 100` — percentage of time the signal was ON |
| Std Deviation | `√(Σ(value[i] - avg)² / (count - 1))` — sample standard deviation |

---

### Step 4b — OEE Calculation (Pre-Calculated Path)

The **kpiOeeEngine.ctl** runs every 60 seconds and computes OEE for each enabled OEE configuration:

```
┌──────────────────────────────────────────────────────────────────────┐
│  For each enabled OEE config:                                        │
│                                                                      │
│  1. Resolve planned production time                                  │
│     ├── FIXED mode: plannedHours × 3600 × (periodSec / 86400)       │
│     └── CALENDAR mode: iterate shifts per day (see Step 3)           │
│                                                                      │
│  2. AVAILABILITY                                                     │
│     a. Query state DP archive (TIMERANGE)                            │
│     b. Identify unplanned stop states (category=UNPLANNED_STOP       │
│        or isPlanned=false excluding PRODUCING/IDLE)                  │
│     c. Sum unplanned downtime, filtering out microstops              │
│        (stops shorter than microstopThresholdSec)                    │
│     d. A = (PlannedTime - UnplannedDowntime) / PlannedTime           │
│                                                                      │
│  3. PERFORMANCE                                                      │
│     a. Query piece counter DP archive → compute delta (total pieces) │
│     b. Compute run time = Σ time in PRODUCING states                 │
│     c. CYCLE_TIME method:                                            │
│        P = (idealCycleTime × totalPieces) / runTime                  │
│     d. DESIGN_SPEED method:                                          │
│        P = totalPieces / (designSpeed × runTimeHours)                │
│     e. Capped at 150% to flag data issues                            │
│                                                                      │
│  4. QUALITY                                                          │
│     a. FIXED_RATIO:  Q = fixedQuality / 100                         │
│     b. GOOD_PIECES:  Q = goodPiecesDelta / totalPiecesDelta         │
│     c. REJECT_PIECES: Q = (totalPieces - rejectPieces) / totalPieces│
│                                                                      │
│  5. OEE = A × P × Q                                                 │
│                                                                      │
│  6. TEEP = OEE × (PlannedTime / CalendarTime)                       │
│                                                                      │
│  7. MTBF = totalUptime / failureCount                                │
│     MTTR = totalRepairTime / failureCount                            │
│     (failure = transition into an unplanned stop state)              │
│                                                                      │
│  8. Write all results to target DPs:                                 │
│     <prefix>.Availability, .Performance, .Quality, .OEE, .TEEP,     │
│     .MTBF, .MTTR, .FailureCount, .StateTime.<state>, ...            │
│                                                                      │
│  9. Downtime analysis: time per state + cause Pareto written to DPs  │
└──────────────────────────────────────────────────────────────────────┘
```

---

### Step 5 — Display-Time Analysis (JS Path)

When the user opens the **OEE Analysis** page and clicks **Refresh**, the `oeeAnalysis.js` module performs the same calculations in the browser:

```
User clicks "Refresh"
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. RESOLVE TIME RANGE                                         │
│    Preset (Last 8h, Today, This Week...) or custom datetime   │
│    → tRange = { start, end }                                  │
├───────────────────────────────────────────────────────────────┤
│ 2. QUERY STATE HISTORY                                        │
│    Live mode:  KPI.readHistory(stateDp, start, end)           │
│                → toCtrl → dpQuery(_offline) → [{value, time}] │
│    Mock mode:  _generateMockHistory() → Markov chain with     │
│                realistic transition probabilities & durations  │
├───────────────────────────────────────────────────────────────┤
│ 3. MICROSTOP FILTERING                                        │
│    For each unplanned stop shorter than threshold:            │
│    → Mark as __MICROSTOP__ sentinel (excluded from downtime)  │
│    → Count and total duration stored for display              │
├───────────────────────────────────────────────────────────────┤
│ 4. COMPUTE STATE STATISTICS                                   │
│    For each state transition in the filtered history:         │
│    → Clip segment to [tStart, tEnd]                           │
│    → Accumulate totalSeconds and transitionCount per state    │
├───────────────────────────────────────────────────────────────┤
│ 5. QUERY CAUSE HISTORY (if cause tracking enabled)            │
│    Live mode:  KPI.readHistory(causeDp, start, end)           │
│    Mock mode:  _generateCorrelatedCauseHistory()              │
│                → Cause codes only during unplanned stop       │
│                   periods, with weighted random selection      │
│                → Optional split for stops > 30 min            │
├───────────────────────────────────────────────────────────────┤
│ 6. BUILD STOP RECORDS (state-cause alignment)                 │
│    For each non-PRODUCING state segment:                      │
│    → Create a stop record with start/end/duration/state info  │
│    → For unplanned stops: overlay cause history               │
│      → Find cause DP values active during the stop period     │
│      → If cause changes mid-stop, split into segments         │
│    → Result: [{index, startMs, endMs, stateLabel,             │
│               stateCategory, segments: [{causeValue,          │
│               causeLabel, startMs, endMs, source}]}]          │
├───────────────────────────────────────────────────────────────┤
│ 7. COMPUTE OEE (same formulas as CTRL engine)                 │
│    a. Planned time from calendar or fixed hours               │
│    b. Availability from state stats                           │
│    c. Performance from piece counter delta + run time         │
│    d. Quality from good/reject counters or fixed ratio        │
│    e. OEE = A × P × Q                                        │
│    f. TEEP, MTBF, MTTR                                        │
├───────────────────────────────────────────────────────────────┤
│ 8. COMPUTE PREVIOUS PERIOD (delta reference)                  │
│    Same calculation for the period just before the selected   │
│    range, providing change indicators (e.g. "+2.3pp")         │
└───────────────────────────────────────────────────────────────┘
```

---

### Step 6 — Presentation

The analysis results are rendered as an interactive dashboard:

```
┌──────────────────────────────────────────────────────────────────────┐
│  OEE GAUGES                                                          │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                   │
│  │  A  │ │  P  │ │  Q  │ │ OEE │  ← SVG ring gauges with %         │
│  │89.2%│ │95.1%│ │98.5%│ │83.6%│  ← Color from limits (ok/warn/alarm)│
│  │+2.1 │ │-0.3 │ │+0.1 │ │+1.8 │  ← Delta vs previous period       │
│  └─────┘ └─────┘ └─────┘ └─────┘                                   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐                            │
│  │ TEEP │ │ MTBF │ │ MTTR │ │Microstops│  ← KPI cards              │
│  └──────┘ └──────┘ └──────┘ └──────────┘                            │
├──────────────────────────────────────────────────────────────────────┤
│  GANTT CHART (state timeline)                                        │
│  ═══█████░░░█████████░░█████████░░░░░█████████████████░░══           │
│  Each segment = one state period, colored by state definition        │
│  Hover → tooltip with state, duration, cause                         │
│  Click non-producing segment → opens Stop Cause Editor modal         │
├──────────────────────────────────────────────────────────────────────┤
│  TIME MODEL (ISO 22400 breakdown)                                    │
│  Calendar Time → Planned Production | Planned Downtime               │
│                  → Net Production | Unplanned Downtime               │
├──────────────────────────────────────────────────────────────────────┤
│  STATE TIMELINE BAR (proportional colored bar)                       │
│  ████████████████████████░░░░░░░░░░████████████                      │
│  Producing 72%  |  Idle 8%  |  Setup 5%  |  Stopped 15%             │
├──────────────────────────────────────────────────────────────────────┤
│  PRODUCTION LOSSES PARETO                                            │
│  Combines non-producing time:                                        │
│  - State categories (Planned Stop, Idle, Setup, Maintenance)         │
│  - Unplanned stop causes (from cause DP alignment)                   │
│  Sorted by total duration (biggest losses first)                     │
├──────────────────────────────────────────────────────────────────────┤
│  DOWNTIME EVENTS LIST                                                │
│  Table of all unplanned stop events:                                 │
│  | Start | End | Duration | State | Cause(s) | [Edit] |             │
│  Click Edit → Stop Cause Editor (assign, correct, or split cause)   │
├──────────────────────────────────────────────────────────────────────┤
│  STATE STATISTICS TABLE                                              │
│  | State | Category | Duration | % | Transitions |                  │
└──────────────────────────────────────────────────────────────────────┘
```

**KPI Limits:** Warning and alarm thresholds configured in OEE Config change gauge colors (green → orange → red) and add warning icons.

**CSV Export:** Three download buttons export the current analysis data as CSV files (OEE Summary, State Analysis, Cause Analysis).

**Time Comparison view:** Side-by-side OEE/MTBF/MTTR comparison for yesterday, last 7 days, and last 30 days.

**KPI Roll-Up:** When the machine selector is set to "Roll-Up" (available when an asset context covers multiple machines), the module computes weighted-average OEE across all machines and shows a per-machine breakdown table.

---

### Step 7 — Archive Correction & Recalculation

When source data is incorrect, corrections trigger a recalculation cascade:

```
1. User corrects a value on the Sources page (Correction Manager)
   → KPI.writeCorrection(dp, timestamp, newValue)
   → CTRL: dpSetTimed(ts, dp:_corr.._value, newValue)
   → The _offline attribute now returns the corrected value for that timestamp

2. User triggers recalculation
   → KPI.requestRecalculation({ sourceId, periodStart, periodEnd, aggregationIds })
   → CTRL: dpSet("KPI_Config.recalcRequest", json)

3. Both CTRL engines detect the recalcRequest via dpConnect:

   kpiAggregationEngine.ctl:
   → Re-reads source archive via _offline (now returns corrected values)
   → Recomputes aggregation for the affected period
   → Writes corrected KPI result via dpSetTimed(tEnd, targetDp:_corr.._value, result)

   kpiOeeEngine.ctl:
   → Checks if any OEE config references the corrected source
   → Recomputes A, P, Q, OEE, TEEP, MTBF, MTTR
   → Writes corrected OEE results via dpSetTimed to _corr

4. Result: _offline queries on KPI result DPs now return corrected values
   without modifying the original historized data.
```

**Cause corrections** follow a simpler path: the operator assigns or splits a cause from the OEE Analysis page, which writes to the cause DP archive. The display-time analysis re-runs immediately to reflect the updated cause data. No engine recalculation is needed since causes affect only the Pareto and stop list visualizations.

---

### Data Flow Summary

```
Source DPs (archive)           Configuration (KPI_Config DPs)
─────────────────────          ──────────────────────────────
Machine State DP ──────┐      Sources config
Piece Counter DP ──────┤      Machine States + Causes
Good/Reject Counter DP ┤      OEE Config (A/P/Q methods)
Cause DP ──────────────┤      Calendar (shifts/exceptions)
                       │      Asset Hierarchy (context)
                       │
         ┌─────────────┴──────────────┐
         │                            │
    ┌────┴─────┐              ┌───────┴────────┐
    │ CTRL     │              │ JS Browser     │
    │ Engines  │              │ (display-time) │
    │          │              │                │
    │ dpQuery  │              │ KPI.readHistory│
    │ (_offline)│             │ (toCtrl/mock)  │
    │          │              │                │
    │ Compute  │              │ Compute        │
    │ A,P,Q    │              │ A,P,Q          │
    │ OEE      │              │ OEE            │
    │ MTBF/MTTR│              │ MTBF/MTTR      │
    │          │              │ Stop records   │
    │ dpSet    │              │ Pareto         │
    │ (results)│              │                │
    └────┬─────┘              └───────┬────────┘
         │                            │
    ┌────┴─────┐              ┌───────┴────────┐
    │ Result   │              │ DOM Rendering  │
    │ DPs      │              │ Gauges, Gantt, │
    │ (trend)  │              │ Tables, Charts │
    └──────────┘              └────────────────┘
```

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
| `navigate` | `loadSnippet("/data/html/pi-webview/" + page + ".html")` | Page navigation |
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
