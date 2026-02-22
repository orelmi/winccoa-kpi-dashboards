# WinCC OA KPI Dashboards

Web-based KPI/OEE configuration and analysis for Siemens WinCC OA.
Inspired by Siemens Performance Insight (Industrial Edge).

## Features

### Implemented

- **Asset Organization** — Hierarchical plant structure (Site > Area > Line > Machine) with context-based filtering, calendar inheritance, and configuration linking
- **Source Configuration** — Register WinCC OA datapoints with type, characterization, archiving, and validity limits
- **KPI Aggregation** — 10 aggregation methods (Sum, Avg, Min, Max, Delta, Time-Weighted Avg, Flow Rate, Uptime Ratio, StdDev, Count) with calendar-aligned or sliding periods
- **Machine State Configuration** — Define machine states with OEE categories, colors, and downtime cause tracking (hierarchical cause tree)
- **Production Calendar** — Shift schedules (days/times), exception days (holidays, shutdowns), with optional MES/ERP connectors (SAP PP, SQL Database, CSV Import, OPC UA, REST API)
- **OEE Calculation** — Availability x Performance x Quality, with TEEP, MTBF, MTTR
- **Live Analysis** — Display-time OEE gauges, Gantt chart, ISO 22400 time model, state distribution, cause Pareto, time comparison
- **KPI Limits** — Warning/alarm thresholds with visual indicators for OEE, Availability, Performance, Quality, MTBF, MTTR
- **Microstop Filtering** — Configurable duration threshold to exclude short stops from OEE availability
- **Archive Correction** — View/correct archived values with KPI recalculation trigger
- **CSV Export** — Download state analysis, cause analysis, OEE summary
- **Dashboard Gantt Compatibility** — Export mapping tables for WinCC OA Dashboard Gantt Chart widget
- **Asset Context Filtering** — All configuration pages filter by active asset context; context filter bar with "Show all" reset
- **Calendar-Based Planned Time** — OEE engine computes planned production time from shift schedules instead of fixed hours/day
- **KPI Roll-Up** — Weighted-average OEE across all machines in an asset context (line/area/site level), with per-machine breakdown
- **Machine State Templates** — Predefined templates (Standard 6-State, Simple 3-State, Packaging 8-State, CNC 7-State) plus custom user-saved templates
- **Event Log / Audit Trail** — Tracks all configuration changes (create, update, delete) with timestamp, module, and details

### Not Yet Implemented

- Custom KPI Formulas (user-defined formula builder)
- Step Time Analysis (sequence/batch step tracking)
- Histogram / Boxplot Widgets (statistical distribution)
- Report Generation (scheduled Excel/CSV/PDF with email)
- Post-Production Reason Editing (reclassify causes after the fact)

## Quick Start

### Simulation Mode (no WinCC OA needed)

```bash
python3 -m http.server 8080 --directory webview
# Open http://localhost:8080/sources.html
```

Data is stored in `localStorage`. Simulation mode activates automatically when `oaJsApi` is not detected.

### WinCC OA Integration

1. **Import DP types** — Para > Import > `dplist/kpi_dptypes.dpl`
2. **Copy files** into your WinCC OA project:
   - `panels/kpiWebView.xml` → `<project>/panels/`
   - `scripts/libs/*.ctl` → `<project>/scripts/libs/`
   - `webview/` → `<project>/data/webview/`
3. **Start CTRL managers** for `kpiAggregationEngine.ctl` and `kpiOeeEngine.ctl`
4. **Open** `panels/kpiWebView.xml` — the panel loads `sources.html` by default

The panel accepts a `$startPage` parameter to load a specific page directly (e.g., `$startPage:oee-analysis`).

## Pages

| Page | File | Description |
|------|------|-------------|
| Assets | `assets.html` | Plant hierarchy, context selection, link configs |
| Sources | `sources.html` | Source datapoint configuration |
| Aggregations | `aggregations.html` | KPI aggregation rules |
| Machine States | `machines.html` | Machine state definitions + cause tracking |
| Calendar | `calendar.html` | Shift schedules + exceptions + MES/ERP connector |
| OEE Config | `oee-config.html` | OEE calculation configuration |
| OEE Analysis | `oee-analysis.html` | Live OEE analysis dashboard |
| Event Log | `event-log.html` | Audit trail of all configuration changes |

Each page is self-contained and can be loaded independently into any WinCC OA WebView panel.
Navigation between pages is handled by the CTRL panel script (`loadSnippet`).

## Documentation

For detailed documentation, see the `docs/` folder:

- [Architecture](docs/architecture.md) — Data access layer, module structure, CTRL integration
- [Functional Specification](docs/functional-spec.md) — Detailed feature descriptions
- [User Manual](docs/user-manual.md) — Step-by-step usage instructions
