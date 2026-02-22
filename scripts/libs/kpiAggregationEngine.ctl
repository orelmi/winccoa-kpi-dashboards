/**
 * kpiAggregationEngine.ctl
 * ═══════════════════════════════════════════════════════════════
 * WinCC OA CTRL script — KPI Aggregation Engine
 *
 * Reads KPI configurations from DPs, computes aggregations
 * periodically, and writes results to target DPs.
 *
 * CORRECTION SUPPORT:
 *   - All archive reads use _offline.._value which transparently
 *     returns _corr.._value if it exists, else _original.
 *   - When a recalculation request is received (source corrected),
 *     the engine recomputes KPIs and writes corrected results
 *     via dpSetTimed() into _corr.._value of the target DPs.
 *   - This way _offline queries on KPI DPs also return corrected
 *     results without touching the original historized values.
 * ═══════════════════════════════════════════════════════════════
 */

#uses "CtrlHTTP"

// ── Constants ────────────────────────────────────────────────
const string CONFIG_DP_SOURCES      = "KPI_Config.sources";
const string CONFIG_DP_AGGREGATIONS = "KPI_Config.aggregations";
const string CONFIG_DP_RECALC       = "KPI_Config.recalcRequest";

// Aggregation period durations in seconds
mapping PERIOD_SECONDS;

// ── Initialization ────────────────────────────────────────────
void main()
{
  PERIOD_SECONDS["MINUTE_15"] = 900;
  PERIOD_SECONDS["HOUR"]      = 3600;
  PERIOD_SECONDS["SHIFT"]     = 28800;  // 8 hours default
  PERIOD_SECONDS["DAY"]       = 86400;
  PERIOD_SECONDS["WEEK"]      = 604800;
  PERIOD_SECONDS["MONTH"]     = 2592000; // 30 days approx

  DebugN("[KPI Engine] Aggregation engine started");

  // Monitor recalculation requests
  dpConnect("onRecalcRequest", CONFIG_DP_RECALC);

  // Main loop — runs every 60 seconds
  while (true)
  {
    processAggregations();
    delay(60);
  }
}

// ══════════════════════════════════════════════════════════════
// Recalculation request handler
// Triggered when a source DP has been corrected and KPIs need
// to be recomputed for the corrected period.
// ══════════════════════════════════════════════════════════════
void onRecalcRequest(string dp, string jsonStr)
{
  if (jsonStr == "") return;

  anytype parsed;
  int rc = jsonDecode(jsonStr, parsed);
  if (rc != 0)
  {
    DebugN("[KPI Engine] ERROR: Failed to parse recalc request");
    return;
  }

  mapping request = parsed;
  string sourceId = request["sourceId"];
  string sourceDp = request["sourceDp"];
  string periodStartStr = request["periodStart"];
  string periodEndStr = request["periodEnd"];
  dyn_string aggIds = request["aggregationIds"];

  DebugN("[KPI Engine] Recalculation request for source: " + sourceDp);
  DebugN("[KPI Engine]   Period: " + periodStartStr + " to " + periodEndStr);
  DebugN("[KPI Engine]   Aggregations: " + dynlen(aggIds));

  // Parse ISO dates
  time tStart, tEnd;
  // ISO 8601 parsing
  sscanf(periodStartStr, "%*4d-%*2d-%*2dT%*2d:%*2d", tStart);
  sscanf(periodEndStr, "%*4d-%*2d-%*2dT%*2d:%*2d", tEnd);

  // Fallback: use last 24h if parse fails
  if (tStart == 0) tStart = getCurrentTime() - 86400;
  if (tEnd == 0) tEnd = getCurrentTime();

  dyn_mapping sources = loadJsonConfig(CONFIG_DP_SOURCES);
  dyn_mapping aggregations = loadJsonConfig(CONFIG_DP_AGGREGATIONS);

  // Find the source config
  mapping source;
  bool foundSource = false;
  for (int j = 1; j <= dynlen(sources); j++)
  {
    if (sources[j]["id"] == sourceId)
    {
      source = sources[j];
      foundSource = true;
      break;
    }
  }

  if (!foundSource)
  {
    DebugN("[KPI Engine] Recalc: source not found: " + sourceId);
    return;
  }

  // Process each affected aggregation
  for (int a = 1; a <= dynlen(aggIds); a++)
  {
    string aggId = aggIds[a];

    for (int i = 1; i <= dynlen(aggregations); i++)
    {
      if (aggregations[i]["id"] != aggId) continue;

      mapping agg = aggregations[i];
      int periodSec;
      if (agg["periodType"] == "SLIDING")
        periodSec = agg["slidingSeconds"];
      else
        periodSec = PERIOD_SECONDS[agg["alignment"]];
      if (periodSec <= 0) periodSec = 3600;

      // Recompute using _offline (which now returns corrections)
      float result;
      bool ok = computeAggregationForPeriod(
        source["dpSource"], agg["method"], tStart, tEnd,
        source["characterization"], agg["expression"], result);

      if (ok)
      {
        string targetDp = agg["dpTarget"];
        // Write corrected result using dpSetTimed to _corr
        // This preserves the original KPI value in _original
        // and _offline will now return the corrected KPI
        time calcTime = tEnd; // Use period end as correction timestamp
        dpSetTimed(calcTime, targetDp + ":_corr.._value", result);
        DebugN("[KPI Engine] Recalc: " + agg["name"] + " = " + result +
               " (written to _corr at " + calcTime + ")");
      }
      break;
    }
  }

  DebugN("[KPI Engine] Recalculation complete");
}

// ── Load JSON config from DP ──────────────────────────────────
dyn_mapping loadJsonConfig(string dpName)
{
  dyn_mapping result;
  string jsonStr;

  dpGet(dpName, jsonStr);

  if (jsonStr == "")
    return result;

  int rc;
  anytype parsed;
  rc = jsonDecode(jsonStr, parsed);
  if (rc != 0)
  {
    DebugN("[KPI Engine] ERROR: Failed to parse JSON from " + dpName);
    return result;
  }

  result = parsed;
  return result;
}

// ── Process all aggregation configs ───────────────────────────
void processAggregations()
{
  dyn_mapping sources = loadJsonConfig(CONFIG_DP_SOURCES);
  dyn_mapping aggregations = loadJsonConfig(CONFIG_DP_AGGREGATIONS);

  if (dynlen(aggregations) == 0)
    return;

  for (int i = 1; i <= dynlen(aggregations); i++)
  {
    mapping agg = aggregations[i];

    // Skip disabled
    if (!agg["enabled"])
      continue;

    // Find source
    mapping source;
    bool found = false;
    for (int j = 1; j <= dynlen(sources); j++)
    {
      if (sources[j]["id"] == agg["sourceRef"])
      {
        source = sources[j];
        found = true;
        break;
      }
    }

    if (!found)
    {
      DebugN("[KPI Engine] WARNING: Source not found for aggregation " + agg["name"]);
      continue;
    }

    // Determine period
    int periodSec;
    if (agg["periodType"] == "SLIDING")
      periodSec = agg["slidingSeconds"];
    else
      periodSec = PERIOD_SECONDS[agg["alignment"]];

    if (periodSec <= 0) periodSec = 3600;

    time tEnd = getCurrentTime();
    time tStart = tEnd - periodSec;

    // Compute aggregation — uses _offline which returns corrected
    // values transparently when they exist
    float result;
    bool ok = computeAggregationForPeriod(source["dpSource"], agg["method"],
                                           tStart, tEnd,
                                           source["characterization"],
                                           agg["expression"], result);

    if (ok)
    {
      // Write result to target DP (normal periodic write)
      string targetDp = agg["dpTarget"];
      if (dpExists(targetDp))
      {
        dpSet(targetDp, result);
        DebugN("[KPI Engine] " + agg["name"] + " = " + result);
      }
      else
      {
        DebugN("[KPI Engine] WARNING: Target DP does not exist: " + targetDp);
      }
    }
  }
}

// ── Compute a single aggregation for a given period ───────────
// All archive reads use _offline.._value which automatically
// returns _corr if present, else _original.
bool computeAggregationForPeriod(string sourceDp, string method,
                                  time tStart, time tEnd,
                                  string characterization, string expression,
                                  float &result)
{
  // Query archive via _offline — transparently returns corrected
  // values where _corr exists, else _original
  dyn_dyn_anytype queryResult;
  string query = "SELECT '_offline.._value', '_offline.._stime' FROM '" +
                 sourceDp + "' TIMERANGE(\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tStart) + "\",\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tEnd) + "\",1,0)";

  dpQuery(query, queryResult);

  int count = dynlen(queryResult) - 1; // First row is header
  if (count <= 0)
  {
    result = 0;
    return true;
  }

  // Extract values and timestamps
  dyn_float values;
  dyn_time timestamps;
  for (int i = 2; i <= dynlen(queryResult); i++)
  {
    dynAppend(values, (float)queryResult[i][1]);
    dynAppend(timestamps, (time)queryResult[i][2]);
  }

  int periodSec = (int)(period(tEnd) - period(tStart));

  // Apply method
  if (method == "SUM")
  {
    result = calcSum(values);
  }
  else if (method == "AVG")
  {
    result = calcAvg(values);
  }
  else if (method == "MIN")
  {
    result = calcMin(values);
  }
  else if (method == "MAX")
  {
    result = calcMax(values);
  }
  else if (method == "COUNT")
  {
    result = dynlen(values);
  }
  else if (method == "DELTA")
  {
    result = calcDelta(values, characterization);
  }
  else if (method == "TIME_WEIGHTED_AVG")
  {
    result = calcTimeWeightedAvg(values, timestamps, tStart, tEnd);
  }
  else if (method == "FLOW_FROM_COUNTER")
  {
    float delta = calcDelta(values, characterization);
    result = (periodSec > 0) ? (delta / periodSec * 3600.0) : 0; // per hour
  }
  else if (method == "UPTIME_RATIO")
  {
    result = calcUptimeRatio(values, timestamps, tStart, tEnd);
  }
  else if (method == "STDDEV")
  {
    result = calcStdDev(values);
  }
  else
  {
    DebugN("[KPI Engine] Unknown method: " + method);
    return false;
  }

  // Apply custom expression if provided
  if (expression != "" && expression != "0")
  {
    result = evalExpression(expression, result, values, periodSec);
  }

  return true;
}

// ── Mathematical helpers ──────────────────────────────────────

float calcSum(dyn_float values)
{
  float s = 0;
  for (int i = 1; i <= dynlen(values); i++)
    s += values[i];
  return s;
}

float calcAvg(dyn_float values)
{
  if (dynlen(values) == 0) return 0;
  return calcSum(values) / dynlen(values);
}

float calcMin(dyn_float values)
{
  if (dynlen(values) == 0) return 0;
  float m = values[1];
  for (int i = 2; i <= dynlen(values); i++)
    if (values[i] < m) m = values[i];
  return m;
}

float calcMax(dyn_float values)
{
  if (dynlen(values) == 0) return 0;
  float m = values[1];
  for (int i = 2; i <= dynlen(values); i++)
    if (values[i] > m) m = values[i];
  return m;
}

float calcDelta(dyn_float values, string characterization)
{
  if (dynlen(values) < 2) return 0;

  float first = values[1];
  float last = values[dynlen(values)];
  float delta = last - first;

  // Handle counter rollover
  if (characterization == "COUNTER" || characterization == "ENERGY")
  {
    if (delta < 0)
    {
      // Assume 32-bit counter rollover
      delta = (4294967295.0 - first) + last;
      DebugN("[KPI Engine] Counter rollover detected, adjusted delta = " + delta);
    }
  }

  return delta;
}

float calcTimeWeightedAvg(dyn_float values, dyn_time timestamps,
                            time tStart, time tEnd)
{
  if (dynlen(values) == 0) return 0;
  if (dynlen(values) == 1) return values[1];

  float totalWeighted = 0;
  float totalDuration = 0;

  for (int i = 1; i < dynlen(values); i++)
  {
    float dt = (float)(period(timestamps[i+1]) - period(timestamps[i]));
    if (dt < 0) dt = 0;
    totalWeighted += values[i] * dt;
    totalDuration += dt;
  }

  // Last value until end
  float dtLast = (float)(period(tEnd) - period(timestamps[dynlen(timestamps)]));
  if (dtLast > 0)
  {
    totalWeighted += values[dynlen(values)] * dtLast;
    totalDuration += dtLast;
  }

  return (totalDuration > 0) ? (totalWeighted / totalDuration) : 0;
}

float calcUptimeRatio(dyn_float values, dyn_time timestamps,
                       time tStart, time tEnd)
{
  if (dynlen(values) == 0) return 0;

  float uptimeSeconds = 0;
  float totalSeconds = (float)(period(tEnd) - period(tStart));

  for (int i = 1; i < dynlen(values); i++)
  {
    if (values[i] > 0)
    {
      float dt = (float)(period(timestamps[i+1]) - period(timestamps[i]));
      uptimeSeconds += dt;
    }
  }

  // Last segment
  if (values[dynlen(values)] > 0)
  {
    float dt = (float)(period(tEnd) - period(timestamps[dynlen(timestamps)]));
    uptimeSeconds += dt;
  }

  return (totalSeconds > 0) ? (uptimeSeconds / totalSeconds * 100.0) : 0;
}

float calcStdDev(dyn_float values)
{
  if (dynlen(values) < 2) return 0;
  float avg = calcAvg(values);
  float sumSq = 0;
  for (int i = 1; i <= dynlen(values); i++)
  {
    float diff = values[i] - avg;
    sumSq += diff * diff;
  }
  return sqrt(sumSq / (dynlen(values) - 1));
}

// ── Simple expression evaluator ───────────────────────────────
float evalExpression(string expr, float currentResult,
                      dyn_float values, int periodSec)
{
  float delta_val = 0;
  if (dynlen(values) >= 2)
    delta_val = values[dynlen(values)] - values[1];

  strreplace(expr, "delta", (string)delta_val);
  strreplace(expr, "sum", (string)calcSum(values));
  strreplace(expr, "avg", (string)calcAvg(values));
  strreplace(expr, "min", (string)calcMin(values));
  strreplace(expr, "max", (string)calcMax(values));
  strreplace(expr, "count", (string)dynlen(values));
  strreplace(expr, "periodSeconds", (string)periodSec);
  strreplace(expr, "result", (string)currentResult);

  float evalResult;
  evalScript(evalResult, "float main() { return " + expr + "; }");
  return evalResult;
}
