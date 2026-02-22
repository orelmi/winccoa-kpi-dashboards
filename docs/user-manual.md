# User Manual

## Getting Started

### Simulation Mode (Browser)

1. Start a local server: `python3 -m http.server 8080 --directory webview`
2. Open `http://localhost:8080/sources.html`
3. Data is stored in browser `localStorage`

#### Loading Demo Data

To test with pre-configured demo data instead of starting from scratch:

1. Open `http://localhost:8080/demo-seed.html`
2. Click **Seed Demo Data** — populates all modules with coherent data:
   - 1 Site (Munich Factory), 2 Areas, 3 Lines, 4 Machines
   - 12 source datapoints (water, electricity, machine states, piece counters)
   - 4 aggregation rules (hourly/daily water, shift electricity, temperature avg)
   - 3 machine state configs with cause tracking
   - 3 OEE configs (cycle time, design speed, fixed ratio methods)
   - 3 production shifts + 1 maintenance shift + 3 exception days
   - 15 event log entries
3. Navigate to any page to explore the data
4. To reset, click **Clear All Data** or run `DemoSeed.clear()` in the console

### WinCC OA

1. Import DP types: Para > Import > `dplist/kpi_dptypes.dpl`
2. Copy project files (see README)
3. Start CTRL managers for aggregation and OEE engines
4. Open `panels/kpiWebView.xml`

## Page Navigation

Use the navigation bar at the top to switch between pages. In WinCC OA, you can also load pages directly using the `$startPage` panel parameter:

```
$startPage:assets         → Asset organization / hierarchy
$startPage:sources        → Source configuration
$startPage:aggregations   → KPI aggregation rules
$startPage:machines       → Machine state definitions
$startPage:calendar       → Production calendar / shifts
$startPage:oee-config     → OEE configuration
$startPage:oee-analysis   → Live OEE analysis
$startPage:event-log      → Event log / audit trail
```

## Organizing Assets

1. Navigate to **Assets**
2. Click **+ Add Site** to create a root site
3. Use the **+** button on any asset to add child assets (Area, Line, Machine)
4. Click the **link icon** to open the reference modal and link machines, sources, aggregations, OEE configs
5. Click an asset **name** to set it as the active context — other pages will filter by this context
6. Assign a calendar at any level (children inherit unless they have their own)

## Configuring Sources

1. Navigate to **Sources**
2. Click **+ Add Source**
3. Fill in the name, datapoint path, data type, and characterization
4. Configure archiving (class, smoothing) and validity limits
5. Click **Save Source**

Use the **Browse** button to select datapoints from the WinCC OA DP tree.

## Configuring Aggregations

1. Navigate to **Aggregations**
2. Click **+ Add Aggregation**
3. Select a source, method, and period
4. Optionally add a custom expression
5. Click **Save Aggregation**

## Configuring Machine States

1. Navigate to **Machine States**
2. Click **+ Add Machine**
3. **Optionally apply a template** from the dropdown (Standard 6-State, Simple 3-State, Packaging, CNC, or custom)
4. Enter the machine name and state datapoint
5. Add/modify state definitions (value, label, category, color)
6. Optionally enable cause tracking:
   - Set the **Cause Datapoint** (DP that contains numeric cause codes)
   - Define causes with **Value** (numeric code matching the DP), label, category, and optional parent
7. Click **Save Machine**

### Saving Custom Templates

After configuring states and causes, click **Save as Template** in the modal to save the current configuration as a reusable template. Custom templates appear in the template dropdown for future machines.

## Configuring the Production Calendar

1. Navigate to **Calendar**
2. **Add Shifts:** Click **+ Add Shift**, set name, times, days of week, category
3. **Add Exceptions:** Click **+ Add Exception** for holidays, shutdowns, etc.
4. **External Connector (optional):** Click **Configure Connector** to import calendar from SAP PP, SQL database, CSV file, OPC UA, or REST API

## Configuring OEE

1. Navigate to **OEE Config**
2. Click **+ Add OEE Line**
3. Select the machine and configure:
   - **Calendar Mode:** Choose "Fixed" (manual hours/day) or "Calendar" (planned time from shift schedules)
   - **Availability:** Planned hours/day (if Fixed mode), calculation method
   - **Performance:** Ideal cycle time or design speed + pieces source
   - **Quality:** Good pieces counter, reject counter, or fixed ratio
4. Optionally set **microstop threshold** and **KPI limits**
5. Click **Save OEE Configuration**

## Using Live Analysis

1. Navigate to **OEE Analysis**
2. Select a machine and time period
3. Click **Refresh**
4. View:
   - **Overview:** OEE gauges, Gantt chart, time model, production losses Pareto, downtime events, state table
   - **Time Comparison:** Side-by-side period comparison

### Assigning & Correcting Downtime Causes

From the OEE Analysis overview, there are two ways to edit causes:

1. **From the Gantt chart:** Click a non-producing (stop) segment — the stop editor opens
2. **From the Downtime Events table:** Click the pencil icon on any event

In the stop editor:
- **Assign/Change Cause:** Select a cause from the dropdown, click **Save Cause**
- **Split Stop:** Set a split timestamp and assign a second cause, click **Split & Save**

After saving, the analysis re-runs automatically to reflect the updated cause data.

### KPI Roll-Up (Multi-Machine)

When an asset context with multiple machines is active, a **Roll-Up** option appears in the machine selector:

1. Set an asset context (e.g. a Line or Area) on the **Assets** page
2. Navigate to **OEE Analysis**
3. Select **Roll-Up (all machines in context)** from the machine dropdown
4. Click **Refresh** — displays weighted-average OEE with per-machine breakdown

### Exporting Data

Use the **Export** toolbar above the analysis results:
- **OEE Summary** — CSV with OEE, Availability, Performance, Quality, TEEP, MTBF, MTTR
- **State Analysis** — CSV with state names, durations, percentages, counts
- **Cause Analysis** — CSV with cause names, categories, durations, counts

## Correcting Archive Data

1. Navigate to **Sources**
2. Click the magnifying glass icon on a source
3. Load a time period to view archive history
4. Enter a timestamp and corrected value, click **Apply Correction**
5. Click **Recalculate KPIs** to trigger recalculation for the affected period

## Using the Asset Context Filter

All configuration pages respect the active asset context:

1. Navigate to **Assets** and click an asset name to set the context
2. On any other page (Sources, Aggregations, Machines, OEE Config), a **filter bar** appears showing the active context
3. Only items linked to the selected asset (and its descendants) are displayed
4. Click **Show all** in the filter bar to clear the filter and see all items

## Viewing the Event Log

1. Navigate to **Event Log**
2. View all configuration changes with timestamps, actions, and details
3. Use the **filter dropdown** to show only events from a specific module
4. Click **Clear Log** to remove all entries (with confirmation)
