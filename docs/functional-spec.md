# Functional Specification

## 0. Asset Organization

Hierarchical plant structure for organizing all configurations:

| Level | Type | Example |
|-------|------|---------|
| 0 | SITE | Factory Munich |
| 1 | AREA | Building A |
| 2 | LINE | Packaging Line 1 |
| 3 | MACHINE | Labeler |

### Features
- **Tree CRUD**: Add, edit, remove assets at any level. Removing a parent removes all descendants.
- **Reference linking**: Each asset links to machines, sources, aggregations, and OEE configs via a reference modal. The asset module does not modify other configs — it only stores references.
- **Context selection**: Click an asset name to set it as the active context. The context is persisted in `localStorage` across page navigation. A breadcrumb badge in the header shows the current context.
- **Calendar inheritance**: Each asset can assign a calendar at its level, or inherit from its parent by walking up the tree.
- **Context API**: Other modules call `AssetConfig.getContext()` and `AssetConfig.getRefsForContext()` to filter their data by the active asset and its descendants.

### Allowed Children

| Parent Type | Allowed Children |
|-------------|-----------------|
| (root) | SITE |
| SITE | AREA, LINE |
| AREA | LINE, MACHINE |
| LINE | MACHINE |
| MACHINE | (none) |

## 1. Source Configuration

Source datapoint registration with metadata:

| Parameter | Description |
|-----------|-------------|
| Name | Human-readable source name |
| Datapoint | WinCC OA DP path (e.g. `System1:Plant.Water.Counter`) |
| Data Type | FLOAT, INT, BOOL, UINT, STRING |
| Characterization | Signal type (see below) |
| Archiving | Activation, archive class, smoothing (deadband) |
| Validity Limits | Min/max valid values |

**Characterizations:** Process Value, Counter, Flow Rate, Status (ON/OFF), Setpoint, Energy Meter, Machine State.

## 2. KPI Aggregation

| Method | Description | Typical Usage |
|--------|-------------|---------------|
| Sum | Sum of values | Total consumption |
| Average | Arithmetic mean | Average temperature |
| Min / Max | Extremes | Peak values |
| Count | Number of samples | Event frequency |
| Delta | First-to-last difference | Counter consumption |
| Time-Weighted Avg | Time-weighted average | Process values |
| Flow from Counter | Delta / period (units/h) | Flow rate from counter |
| Uptime Ratio | % of time in ON state | Availability |
| Std Deviation | Standard deviation | Process variability |

**Periods:** 15min, Hourly, Shift, Day, Week, Month (calendar-aligned or sliding).

**Custom expressions** using variables: `delta`, `sum`, `avg`, `min`, `max`, `count`, `periodSeconds`.

## 3. Machine State Configuration

- Define each state: value, label, OEE category, color, planned/unplanned flag
- **Categories:** Producing, Idle, Planned Stop, Unplanned Stop, Setup, Maintenance
- **Cause Tracking:** Optional downtime cause tracking with hierarchical parent-child relationships
- **Cause Categories:** Mechanical, Electrical, Process, Operator, Quality, Supply
- Default preset: 6 states + 9 causes pre-configured

## 4. Production Calendar

### Shift Definitions
- Name, start/end time, days of week, category (Production, Maintenance, Cleaning, Changeover, Non-Production)
- Support for overnight shifts (e.g. 22:00 - 06:00)
- Enable/disable individual shifts

### Exception Days
- Holidays, plant shutdowns, special maintenance, overtime
- Recurring exceptions (same date every year)

### External Connectors
Optional import from external systems:

| Connector | Description |
|-----------|-------------|
| SAP PP | Reads shift calendar via RFC/BAPI |
| SQL Database | Reads from SQL table (SQL Server, PostgreSQL, Oracle) |
| CSV Import | Import from CSV file with auto-reload |
| OPC UA | Reads from OPC UA calendar node |
| REST API | Fetches from MES/ERP REST endpoint (JSON) |

Each connector supports configurable sync interval and predefined field mapping.

## 5. OEE Calculation

```
OEE = Availability x Performance x Quality
TEEP = OEE x (Planned Production Time / Calendar Time)
MTBF = Total Uptime / Number of Failures
MTTR = Total Repair Time / Number of Failures
```

| KPI | Formula | Sources |
|-----|---------|---------|
| Availability | (Planned Time - Unplanned Stops) / Planned Time | Machine states |
| Performance | (Ideal Cycle Time x Total Pieces) / Run Time | Piece counter + cycle time or design speed |
| Quality | Good Pieces / Total Pieces | Good/reject counter or fixed ratio |
| OEE | A x P x Q | Composite |
| TEEP | OEE x Loading | OEE + planned hours |
| MTBF | Uptime / failure count | Machine states |
| MTTR | Repair time / failure count | Machine states |

### Microstop Filtering

Stops shorter than a configurable threshold (e.g. 120s) are classified as microstops and excluded from unplanned downtime in OEE availability calculation. Microstops are counted and displayed separately.

### KPI Limits / Thresholds

Warning and alarm thresholds for: OEE, Availability, Performance, Quality, MTBF, MTTR. Visual indicators (color changes) in analysis gauges when thresholds are violated.

### Results Written to DPs

- `<prefix>.Availability`, `Performance`, `Quality`, `OEE`, `TEEP` (%)
- `<prefix>.MTBF`, `MTTR` (seconds), `FailureCount` (count)
- `<prefix>.StateTime.<state>` (seconds per state)
- `<prefix>.Causes.<cause>.Count`, `Duration`

## 6. Live Analysis

Display-time aggregation (recomputed from source data each time):

| View | Content |
|------|---------|
| Overview | OEE gauges (with limits coloring + previous period delta), TEEP/MTBF/MTTR cards, Gantt chart, ISO 22400 time model, state distribution, state table, cause Pareto |
| Time Comparison | Side-by-side OEE/MTBF/MTTR for yesterday, 7 days, 30 days |

### Gantt Chart
SVG timeline showing each state transition as a colored segment. Hover for details.

### Time Model (ISO 22400)
Hierarchical breakdown: Calendar Time → Planned Production / Planned Downtime → Net Production / Unplanned Downtime.

## 7. Archive Correction

1. Load archive history for a period
2. Apply corrections via `dpSetTimed(ts, dp:_corr.._value, value)`
3. Trigger KPI recalculation — engines re-read via `_offline` and write corrected results

## 8. CSV Export

Download buttons for: State Analysis, Cause Analysis, OEE Summary.

## 9. Dashboard Gantt Compatibility

Export value-to-label-to-color mapping tables for the WinCC OA Dashboard Gantt Chart widget. Mapping stored in `KPI_Config.ganttMappings`.
