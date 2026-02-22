/**
 * kpiOeeEngine.ctl
 * ═══════════════════════════════════════════════════════════════
 * WinCC OA CTRL script — OEE Calculation Engine
 * Computes Availability, Performance, Quality and OEE
 * based on machine state data and counter sources.
 *
 * Also provides downtime analysis: time per state, cause Pareto.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Constants ────────────────────────────────────────────────
const string CONFIG_DP_SOURCES  = "KPI_Config.sources";
const string CONFIG_DP_MACHINES = "KPI_Config.machines";
const string CONFIG_DP_OEE      = "KPI_Config.oee";
const string CONFIG_DP_RECALC   = "KPI_Config.recalcRequest";

mapping PERIOD_SECONDS;

// ── Initialization ────────────────────────────────────────────
void main()
{
  PERIOD_SECONDS["SHIFT"] = 28800;
  PERIOD_SECONDS["DAY"]   = 86400;
  PERIOD_SECONDS["WEEK"]  = 604800;
  PERIOD_SECONDS["MONTH"] = 2592000;

  DebugN("[OEE Engine] OEE calculation engine started");

  // Monitor recalculation requests (shared with aggregation engine)
  dpConnect("onRecalcRequest", CONFIG_DP_RECALC);

  while (true)
  {
    processOeeCalculations();
    delay(60);
  }
}

// ══════════════════════════════════════════════════════════════
// Recalculation request handler
// When a source DP is corrected, OEE may need recalculation.
// The request contains sourceId — we check if any OEE config
// references that source (pieces, good, reject counters or
// the machine state DP) and recompute.
// ══════════════════════════════════════════════════════════════
void onRecalcRequest(string dp, string jsonStr)
{
  if (jsonStr == "") return;

  anytype parsed;
  int rc = jsonDecode(jsonStr, parsed);
  if (rc != 0)
  {
    DebugN("[OEE Engine] ERROR: Failed to parse recalc request");
    return;
  }

  mapping request = parsed;
  string sourceId = request["sourceId"];
  string periodStartStr = request["periodStart"];
  string periodEndStr = request["periodEnd"];

  DebugN("[OEE Engine] Recalculation request for source: " + sourceId);

  // Parse period
  time tStart, tEnd;
  sscanf(periodStartStr, "%*4d-%*2d-%*2dT%*2d:%*2d", tStart);
  sscanf(periodEndStr, "%*4d-%*2d-%*2dT%*2d:%*2d", tEnd);
  if (tStart == 0) tStart = getCurrentTime() - 86400;
  if (tEnd == 0) tEnd = getCurrentTime();

  dyn_mapping sources   = loadJsonConfig(CONFIG_DP_SOURCES);
  dyn_mapping machines  = loadJsonConfig(CONFIG_DP_MACHINES);
  dyn_mapping oeeConfigs = loadJsonConfig(CONFIG_DP_OEE);

  // Check each OEE config to see if it references the corrected source
  for (int i = 1; i <= dynlen(oeeConfigs); i++)
  {
    mapping oee = oeeConfigs[i];
    if (!oee["enabled"]) continue;

    // Check if this OEE references the corrected source
    bool affected = false;
    if (oee["piecesSourceRef"] == sourceId) affected = true;
    if (oee["goodSourceRef"] == sourceId)   affected = true;
    if (oee["rejectSourceRef"] == sourceId) affected = true;

    if (!affected) continue;

    DebugN("[OEE Engine] Recalc: OEE '" + oee["name"] + "' affected by source " + sourceId);

    mapping machine = findById(machines, oee["machineRef"]);
    if (mappinglen(machine) == 0) continue;

    int periodSec = (int)(period(tEnd) - period(tStart));
    if (periodSec <= 0) periodSec = 86400;

    // Recompute OEE using _offline (returns corrected values)
    float availability = calcAvailability(machine, oee, tStart, tEnd, periodSec);
    float performance  = calcPerformance(oee, sources, machine, tStart, tEnd, periodSec);
    float quality      = calcQuality(oee, sources, tStart, tEnd);
    float oeeValue     = availability * performance * quality;

    // Write corrected results via dpSetTimed to _corr
    string prefix = oee["targetDp"];
    if (prefix == "") prefix = "KPI_OEE." + oee["name"];

    time calcTime = tEnd;
    writeCorrectedResult(prefix + ".Availability", availability * 100, calcTime);
    writeCorrectedResult(prefix + ".Performance",  performance * 100, calcTime);
    writeCorrectedResult(prefix + ".Quality",      quality * 100, calcTime);
    writeCorrectedResult(prefix + ".OEE",          oeeValue * 100, calcTime);

    DebugN("[OEE Engine] Recalc: " + oee["name"] +
           " A=" + (availability*100) +
           "% P=" + (performance*100) +
           "% Q=" + (quality*100) +
           "% OEE=" + (oeeValue*100) +
           "% (written to _corr at " + calcTime + ")");
  }

  DebugN("[OEE Engine] Recalculation complete");
}

// ── Write corrected result via dpSetTimed to _corr ───────────
void writeCorrectedResult(string dpName, float value, time calcTime)
{
  strreplace(dpName, " ", "_");
  strreplace(dpName, "/", "_");

  if (!dpExists(dpName))
  {
    DebugN("[OEE Engine] Recalc: Target DP not found: " + dpName);
    return;
  }

  dpSetTimed(calcTime, dpName + ":_corr.._value", value);
}

// ── Load JSON config ──────────────────────────────────────────
dyn_mapping loadJsonConfig(string dpName)
{
  dyn_mapping result;
  string jsonStr;
  dpGet(dpName, jsonStr);
  if (jsonStr == "") return result;

  anytype parsed;
  int rc = jsonDecode(jsonStr, parsed);
  if (rc != 0)
  {
    DebugN("[OEE Engine] ERROR: JSON parse failed for " + dpName);
    return result;
  }
  result = parsed;
  return result;
}

// ── Find config item by ID ────────────────────────────────────
mapping findById(dyn_mapping items, string id)
{
  mapping empty;
  for (int i = 1; i <= dynlen(items); i++)
  {
    if (items[i]["id"] == id) return items[i];
  }
  return empty;
}

// ── Process all OEE configurations ────────────────────────────
void processOeeCalculations()
{
  dyn_mapping sources  = loadJsonConfig(CONFIG_DP_SOURCES);
  dyn_mapping machines = loadJsonConfig(CONFIG_DP_MACHINES);
  dyn_mapping oeeConfigs = loadJsonConfig(CONFIG_DP_OEE);

  for (int i = 1; i <= dynlen(oeeConfigs); i++)
  {
    mapping oee = oeeConfigs[i];
    if (!oee["enabled"]) continue;

    mapping machine = findById(machines, oee["machineRef"]);
    if (mappinglen(machine) == 0)
    {
      DebugN("[OEE Engine] Machine not found: " + oee["machineRef"]);
      continue;
    }

    int periodSec = PERIOD_SECONDS[oee["period"]];
    if (periodSec <= 0) periodSec = 86400;

    time tEnd = getCurrentTime();
    time tStart = tEnd - periodSec;

    // ────────────────────────────────
    // 1. AVAILABILITY
    // ────────────────────────────────
    float availability = calcAvailability(machine, oee, tStart, tEnd, periodSec);

    // ────────────────────────────────
    // 2. PERFORMANCE
    // ────────────────────────────────
    float performance = calcPerformance(oee, sources, machine, tStart, tEnd, periodSec);

    // ────────────────────────────────
    // 3. QUALITY
    // ────────────────────────────────
    float quality = calcQuality(oee, sources, tStart, tEnd);

    // ────────────────────────────────
    // 4. OEE
    // ────────────────────────────────
    float oeeValue = availability * performance * quality;

    // ── Write results ─────────────
    string prefix = oee["targetDp"];
    if (prefix == "") prefix = "KPI_OEE." + oee["name"];

    writeResult(prefix + ".Availability", availability * 100);
    writeResult(prefix + ".Performance",  performance * 100);
    writeResult(prefix + ".Quality",      quality * 100);
    writeResult(prefix + ".OEE",          oeeValue * 100);

    DebugN("[OEE Engine] " + oee["name"] +
           " A=" + (availability*100) +
           "% P=" + (performance*100) +
           "% Q=" + (quality*100) +
           "% OEE=" + (oeeValue*100) + "%");

    // ── Downtime analysis ─────────
    computeDowntimeAnalysis(machine, prefix, tStart, tEnd);
  }
}

// ── AVAILABILITY Calculation ──────────────────────────────────
float calcAvailability(mapping machine, mapping oee,
                        time tStart, time tEnd, int periodSec)
{
  float plannedSeconds = oee["plannedHours"] * 3600.0;
  // Scale planned time to actual period vs 24h
  float periodDays = (float)periodSec / 86400.0;
  float totalPlanned = plannedSeconds * periodDays;

  if (totalPlanned <= 0) return 1.0;

  // Get state history
  mapping stateTime = calcTimePerState(machine, tStart, tEnd);

  // Sum unplanned downtime
  float unplannedDown = 0;
  dyn_mapping states = machine["states"];
  for (int i = 1; i <= dynlen(states); i++)
  {
    string cat = states[i]["category"];
    bool planned = states[i]["isPlanned"];
    string val = states[i]["value"];

    if (cat == "UNPLANNED_STOP" || (cat != "PRODUCING" && !planned))
    {
      if (mappingHasKey(stateTime, val))
        unplannedDown += stateTime[val];
    }
  }

  float avail = (totalPlanned - unplannedDown) / totalPlanned;
  if (avail < 0) avail = 0;
  if (avail > 1) avail = 1;
  return avail;
}

// ── PERFORMANCE Calculation ───────────────────────────────────
float calcPerformance(mapping oee, dyn_mapping sources, mapping machine,
                       time tStart, time tEnd, int periodSec)
{
  // Get total pieces from counter source
  mapping piecesSource = findById(sources, oee["piecesSourceRef"]);
  if (mappinglen(piecesSource) == 0) return 1.0;

  float totalPieces = getCounterDelta(piecesSource["dpSource"], tStart, tEnd);

  // Get run time (time in PRODUCING state)
  mapping stateTime = calcTimePerState(machine, tStart, tEnd);
  float runTime = 0;
  dyn_mapping states = machine["states"];
  for (int i = 1; i <= dynlen(states); i++)
  {
    if (states[i]["category"] == "PRODUCING")
    {
      string val = states[i]["value"];
      if (mappingHasKey(stateTime, val))
        runTime += stateTime[val];
    }
  }

  if (runTime <= 0) return 0;

  float perf;
  if (oee["perfMethod"] == "CYCLE_TIME")
  {
    float idealCycle = oee["idealCycleTime"];
    if (idealCycle <= 0) idealCycle = 1;
    perf = (idealCycle * totalPieces) / runTime;
  }
  else // DESIGN_SPEED
  {
    float designSpeed = oee["designSpeed"]; // units/hour
    if (designSpeed <= 0) designSpeed = 1;
    float runHours = runTime / 3600.0;
    perf = totalPieces / (designSpeed * runHours);
  }

  if (perf < 0) perf = 0;
  if (perf > 1.5) perf = 1.5; // Cap at 150% to detect issues
  return perf;
}

// ── QUALITY Calculation ───────────────────────────────────────
float calcQuality(mapping oee, dyn_mapping sources, time tStart, time tEnd)
{
  string method = oee["qualityMethod"];

  if (method == "FIXED_RATIO")
  {
    return oee["fixedQuality"] / 100.0;
  }

  // Get total pieces
  mapping piecesSource = findById(sources, oee["piecesSourceRef"]);
  if (mappinglen(piecesSource) == 0) return 1.0;
  float totalPieces = getCounterDelta(piecesSource["dpSource"], tStart, tEnd);
  if (totalPieces <= 0) return 1.0;

  if (method == "GOOD_PIECES")
  {
    mapping goodSource = findById(sources, oee["goodSourceRef"]);
    if (mappinglen(goodSource) == 0) return 1.0;
    float goodPieces = getCounterDelta(goodSource["dpSource"], tStart, tEnd);
    return goodPieces / totalPieces;
  }
  else if (method == "REJECT_PIECES")
  {
    mapping rejectSource = findById(sources, oee["rejectSourceRef"]);
    if (mappinglen(rejectSource) == 0) return 1.0;
    float rejectPieces = getCounterDelta(rejectSource["dpSource"], tStart, tEnd);
    return (totalPieces - rejectPieces) / totalPieces;
  }

  return 1.0;
}

// ── Calculate time spent in each state ────────────────────────
mapping calcTimePerState(mapping machine, time tStart, time tEnd)
{
  mapping result;
  string stateDp = machine["stateDp"];

  // Query state history
  dyn_dyn_anytype queryResult;
  string query = "SELECT '_offline.._value', '_offline.._stime' FROM '" +
                 stateDp + "' TIMERANGE(\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tStart) + "\",\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tEnd) + "\",1,0)";

  dpQuery(query, queryResult);

  int count = dynlen(queryResult) - 1;
  if (count <= 0) return result;

  for (int i = 2; i < dynlen(queryResult); i++)
  {
    string stateVal = (string)queryResult[i][1];
    time t1 = (time)queryResult[i][2];
    time t2 = (time)queryResult[i+1][2];
    float dt = (float)(period(t2) - period(t1));

    if (!mappingHasKey(result, stateVal))
      result[stateVal] = 0.0;
    result[stateVal] = result[stateVal] + dt;
  }

  // Last segment until tEnd
  if (count >= 1)
  {
    string lastState = (string)queryResult[dynlen(queryResult)][1];
    time lastTime = (time)queryResult[dynlen(queryResult)][2];
    float dt = (float)(period(tEnd) - period(lastTime));
    if (!mappingHasKey(result, lastState))
      result[lastState] = 0.0;
    result[lastState] = result[lastState] + dt;
  }

  return result;
}

// ── Get counter delta over a period ───────────────────────────
float getCounterDelta(string dpName, time tStart, time tEnd)
{
  dyn_dyn_anytype queryResult;
  string query = "SELECT '_offline.._value' FROM '" + dpName +
                 "' TIMERANGE(\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tStart) + "\",\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tEnd) + "\",1,0)";

  dpQuery(query, queryResult);

  int count = dynlen(queryResult) - 1;
  if (count < 2) return 0;

  float first = (float)queryResult[2][1];
  float last  = (float)queryResult[dynlen(queryResult)][1];
  float delta = last - first;

  // Handle rollover
  if (delta < 0)
    delta = (4294967295.0 - first) + last;

  return delta;
}

// ── Downtime analysis: time per state + cause Pareto ──────────
void computeDowntimeAnalysis(mapping machine, string prefix,
                              time tStart, time tEnd)
{
  // Time per state
  mapping stateTime = calcTimePerState(machine, tStart, tEnd);
  dyn_mapping states = machine["states"];

  for (int i = 1; i <= dynlen(states); i++)
  {
    string val = states[i]["value"];
    string label = states[i]["label"];
    float seconds = 0;
    if (mappingHasKey(stateTime, val))
      seconds = stateTime[val];

    string dpName = prefix + ".StateTime." + label;
    writeResult(dpName, seconds);
  }

  // Cause analysis (if cause tracking is enabled)
  if (machine["trackCauses"] && machine["causeDp"] != "")
  {
    computeCausePareto(machine, prefix, tStart, tEnd);
  }
}

// ── Cause Pareto analysis ─────────────────────────────────────
void computeCausePareto(mapping machine, string prefix,
                         time tStart, time tEnd)
{
  string causeDp = machine["causeDp"];
  string stateDp = machine["stateDp"];

  // Query cause history alongside state history
  dyn_dyn_anytype causeQuery;
  string query = "SELECT '_offline.._value', '_offline.._stime' FROM '" +
                 causeDp + "' TIMERANGE(\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tStart) + "\",\"" +
                 formatTime("%Y.%m.%d %H:%M:%S", tEnd) + "\",1,0)";

  dpQuery(query, causeQuery);

  int count = dynlen(causeQuery) - 1;
  if (count <= 0) return;

  // Count occurrences and duration per cause
  mapping causeCount;    // number of stops per cause
  mapping causeDuration; // total duration per cause

  for (int i = 2; i < dynlen(causeQuery); i++)
  {
    string causeCode = (string)causeQuery[i][1];
    time t1 = (time)causeQuery[i][2];
    time t2 = (time)causeQuery[i+1][2];
    float dt = (float)(period(t2) - period(t1));

    if (!mappingHasKey(causeCount, causeCode))
    {
      causeCount[causeCode] = 0;
      causeDuration[causeCode] = 0.0;
    }
    causeCount[causeCode] = causeCount[causeCode] + 1;
    causeDuration[causeCode] = causeDuration[causeCode] + dt;
  }

  // Write cause data
  dyn_mapping causes = machine["causes"];
  for (int i = 1; i <= dynlen(causes); i++)
  {
    string code = causes[i]["code"];
    string label = causes[i]["label"];

    float cnt = 0;
    float dur = 0;
    if (mappingHasKey(causeCount, code))
    {
      cnt = causeCount[code];
      dur = causeDuration[code];
    }

    writeResult(prefix + ".Causes." + label + ".Count", cnt);
    writeResult(prefix + ".Causes." + label + ".Duration", dur);
  }
}

// ── Write result to DP (create if needed) ─────────────────────
void writeResult(string dpName, float value)
{
  // Clean DP name
  strreplace(dpName, " ", "_");
  strreplace(dpName, "/", "_");

  if (!dpExists(dpName))
  {
    // In production, DPs should be pre-created via dpCreate
    DebugN("[OEE Engine] Target DP not found: " + dpName + " (value=" + value + ")");
    return;
  }

  dpSet(dpName, value);
}
