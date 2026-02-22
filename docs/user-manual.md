# User Manual

## Getting Started

### Simulation Mode (Browser)

1. Start a local server: `python3 -m http.server 8080 --directory webview`
2. Open `http://localhost:8080/sources.html`
3. Data is stored in browser `localStorage`

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
3. Enter the machine name and state datapoint
4. Add state definitions (value, label, category, color)
5. Optionally enable cause tracking and define causes
6. Click **Save Machine**

## Configuring the Production Calendar

1. Navigate to **Calendar**
2. **Add Shifts:** Click **+ Add Shift**, set name, times, days of week, category
3. **Add Exceptions:** Click **+ Add Exception** for holidays, shutdowns, etc.
4. **External Connector (optional):** Click **Configure Connector** to import calendar from SAP PP, SQL database, CSV file, OPC UA, or REST API

## Configuring OEE

1. Navigate to **OEE Config**
2. Click **+ Add OEE Line**
3. Select the machine and configure:
   - **Availability:** Planned hours/day, calculation method
   - **Performance:** Ideal cycle time or design speed + pieces source
   - **Quality:** Good pieces counter, reject counter, or fixed ratio
4. Optionally set **microstop threshold** and **KPI limits**
5. Click **Save OEE Configuration**

## Using Live Analysis

1. Navigate to **OEE Analysis**
2. Select a machine and time period
3. Click **Refresh**
4. View:
   - **Overview:** OEE gauges, Gantt chart, time model, state table, cause Pareto
   - **Time Comparison:** Side-by-side period comparison

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
