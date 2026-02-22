/**
 * kpiDataAccess.ctl
 * ═══════════════════════════════════════════════════════════════
 * WinCC OA CTRL — Domain-oriented data access layer
 *
 * All commands are expressed in KPI domain terms.
 * WinCC OA specifics (DP attribute paths, SQL query syntax,
 * config DP prefix) are encapsulated here.
 *
 * Commands:
 *   loadConfig, saveConfig,
 *   browseDatapoints, datapointExists, createDatapoint,
 *   readHistory, readOriginalHistory, readCorrectionHistory,
 *   writeCorrection, writeCorrectionBatch,
 *   requestRecalculation,
 *   subscribe, unsubscribe
 *
 * Usage in panel (WebView EWO scripts):
 *   #uses "libs/kpiDataAccess"
 *
 *   Initialize:
 *     kpiDataAccessInit(this);
 *     this.loadSnippet("/webview/index.html");
 *
 *   messageReceived:
 *     kpiHandleMessage(this, params);
 * ═══════════════════════════════════════════════════════════════
 */

// ── Constants ────────────────────────────────────────────────
const string KPI_CONFIG_DP_PREFIX = "KPI_Config.";

// Global reference to the WebView shape for subscription callbacks
global shape g_kpiWebView;

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

void kpiDataAccessInit(shape webView)
{
  g_kpiWebView = webView;
  DebugN("[kpiDataAccess] Initialized");
}

// ═══════════════════════════════════════════════════════════════
// Main dispatcher
// ═══════════════════════════════════════════════════════════════

void kpiHandleMessage(shape webView, mapping params)
{
  mapping p = params["params"];
  string cmd = p["cmd"];

  if      (cmd == "loadConfig")           _kpiLoadConfig(webView, params, p);
  else if (cmd == "saveConfig")           _kpiSaveConfig(webView, params, p);
  else if (cmd == "browseDatapoints")     _kpiBrowseDatapoints(webView, params, p);
  else if (cmd == "datapointExists")      _kpiDatapointExists(webView, params, p);
  else if (cmd == "createDatapoint")      _kpiCreateDatapoint(webView, params, p);
  else if (cmd == "readHistory")          _kpiReadHistory(webView, params, p, "_offline");
  else if (cmd == "readOriginalHistory")  _kpiReadHistory(webView, params, p, "_original");
  else if (cmd == "readCorrectionHistory") _kpiReadHistory(webView, params, p, "_corr");
  else if (cmd == "writeCorrection")      _kpiWriteCorrection(webView, params, p);
  else if (cmd == "writeCorrectionBatch") _kpiWriteCorrectionBatch(webView, params, p);
  else if (cmd == "requestRecalculation") _kpiRequestRecalculation(webView, params, p);
  else if (cmd == "subscribe")            _kpiSubscribe(webView, params, p);
  else if (cmd == "unsubscribe")          _kpiUnsubscribe(webView, params, p);
  else
    DebugN("[kpiDataAccess] Unknown command:", cmd);
}

// ═══════════════════════════════════════════════════════════════
// loadConfig — Read a KPI configuration section
//
// { cmd:"loadConfig", section:"sources" }
// Reads KPI_Config.<section> and returns the JSON string.
// ═══════════════════════════════════════════════════════════════

void _kpiLoadConfig(shape ws, mapping params, mapping p)
{
  string section = p["section"];
  string dp = KPI_CONFIG_DP_PREFIX + section;

  anytype val;
  int rc = dpGet(dp, val);
  if (rc != 0)
    DebugN("[kpiDataAccess] loadConfig error for", dp, "rc:", rc);

  ws.msgToJs(params, val);
}

// ═══════════════════════════════════════════════════════════════
// saveConfig — Write a KPI configuration section
//
// { cmd:"saveConfig", section:"sources", data:"[{...}]" }
// ═══════════════════════════════════════════════════════════════

void _kpiSaveConfig(shape ws, mapping params, mapping p)
{
  string section = p["section"];
  string dp = KPI_CONFIG_DP_PREFIX + section;
  string jsonStr = p["data"];

  int rc = dpSet(dp, jsonStr);
  if (rc != 0)
    DebugN("[kpiDataAccess] saveConfig error for", dp, "rc:", rc);

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// browseDatapoints — List available datapoints matching a filter
//
// { cmd:"browseDatapoints", filter:"Plant" }
// ═══════════════════════════════════════════════════════════════

void _kpiBrowseDatapoints(shape ws, mapping params, mapping p)
{
  string filter = p["filter"];
  string pattern;

  if (filter != "")
    pattern = "*" + filter + "*";
  else
    pattern = "*";

  dyn_string names = dpNames(pattern, "");
  ws.msgToJs(params, names);
}

// ═══════════════════════════════════════════════════════════════
// datapointExists — Check if a datapoint exists
//
// { cmd:"datapointExists", dp:"System1:Plant.Water.Counter" }
// Returns true/false
// ═══════════════════════════════════════════════════════════════

void _kpiDatapointExists(shape ws, mapping params, mapping p)
{
  string dp = p["dp"];
  dyn_string names = dpNames(dp, "");
  bool exists = (dynlen(names) > 0);
  ws.msgToJs(params, exists);
}

// ═══════════════════════════════════════════════════════════════
// createDatapoint — Create a new datapoint
//
// { cmd:"createDatapoint", name:"MyDp", type:"KPI_Config" }
// ═══════════════════════════════════════════════════════════════

void _kpiCreateDatapoint(shape ws, mapping params, mapping p)
{
  string dpName = p["name"];
  string dpTypeName = p["type"];

  int typeId = dpTypeId(dpTypeName);
  int rc = dpCreate(dpName, typeId);
  if (rc != 0)
    DebugN("[kpiDataAccess] createDatapoint error for", dpName, "rc:", rc);

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// readHistory / readOriginalHistory / readCorrectionHistory
//
// { cmd:"readHistory", dp:"System1:Dp", startTime:"ISO", endTime:"ISO" }
//
// Builds the dpQuery with TIMERANGE using the specified attribute
// config (_offline, _original, or _corr).
// Returns raw dpQuery result (2D array).
// JS parses into [{value, time}].
// ═══════════════════════════════════════════════════════════════

void _kpiReadHistory(shape ws, mapping params, mapping p, string attrConfig)
{
  string dp = p["dp"];
  time tStart = _kpiParseISOTime(p["startTime"]);
  time tEnd = _kpiParseISOTime(p["endTime"]);

  string tStartStr = formatTime("%Y.%m.%d %H:%M:%S", tStart);
  string tEndStr = formatTime("%Y.%m.%d %H:%M:%S", tEnd);

  string query = "SELECT '" + attrConfig + ".._value', '" + attrConfig + ".._stime' FROM '" +
    dp + "' TIMERANGE(\"" + tStartStr + "\",\"" + tEndStr + "\",1,0)";

  dyn_dyn_anytype result;
  int rc = dpQuery(query, result);
  if (rc != 0)
    DebugN("[kpiDataAccess] readHistory error, rc:", rc, "query:", query);

  ws.msgToJs(params, result);
}

// ═══════════════════════════════════════════════════════════════
// writeCorrection — Write a corrected value at a specific time
//
// { cmd:"writeCorrection", dp:"System1:Dp", timestamp:"ISO", value:123.45 }
// Appends :_corr.._value and calls dpSetTimed.
// ═══════════════════════════════════════════════════════════════

void _kpiWriteCorrection(shape ws, mapping params, mapping p)
{
  string dp = p["dp"];
  time ts = _kpiParseISOTime(p["timestamp"]);
  anytype val = p["value"];

  string corrDp = dp + ":_corr.._value";
  int rc = dpSetTimed(ts, corrDp, val);
  if (rc != 0)
    DebugN("[kpiDataAccess] writeCorrection error for", corrDp, "rc:", rc);

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// writeCorrectionBatch — Write multiple corrections at one time
//
// { cmd:"writeCorrectionBatch", timestamp:"ISO", dps:["dp1","dp2"], values:[v1,v2] }
// ═══════════════════════════════════════════════════════════════

void _kpiWriteCorrectionBatch(shape ws, mapping params, mapping p)
{
  time ts = _kpiParseISOTime(p["timestamp"]);
  dyn_string dps = p["dps"];
  dyn_anytype vals = p["values"];
  int rc = 0;

  for (int i = 1; i <= dynlen(dps); i++)
  {
    string corrDp = dps[i] + ":_corr.._value";
    rc = dpSetTimed(ts, corrDp, vals[i]);
    if (rc != 0)
      DebugN("[kpiDataAccess] writeCorrectionBatch error for", corrDp, "rc:", rc);
  }

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// requestRecalculation — Trigger KPI recalculation
//
// { cmd:"requestRecalculation", request:{sourceId, sourceDp, ...} }
// Writes the request as JSON to KPI_Config.recalcRequest.
// The CTRL engines (aggregation + OEE) monitor this DP.
// ═══════════════════════════════════════════════════════════════

void _kpiRequestRecalculation(shape ws, mapping params, mapping p)
{
  mapping request = p["request"];
  request["requestTime"] = formatTime("%Y-%m-%dT%H:%M:%S", getCurrentTime());

  string jsonStr;
  jsonEncode(request, jsonStr);

  string dp = KPI_CONFIG_DP_PREFIX + "recalcRequest";
  int rc = dpSet(dp, jsonStr);
  if (rc != 0)
    DebugN("[kpiDataAccess] requestRecalculation error, rc:", rc);

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// subscribe — Subscribe to live value changes
//
// { cmd:"subscribe", dp:"System1:Dp.El:_online.._value" }
// Pushes updates to JS via execJsFunction("_kpiDpUpdate").
// ═══════════════════════════════════════════════════════════════

void _kpiSubscribe(shape ws, mapping params, mapping p)
{
  string dp = p["dp"];
  dpConnect("_kpiSubscriptionCallback", false, dp);
  ws.msgToJs(params, 0);
}

void _kpiSubscriptionCallback(string dp, anytype val)
{
  if (g_kpiWebView)
    g_kpiWebView.execJsFunction("_kpiDpUpdate", dp, val);
}

// ═══════════════════════════════════════════════════════════════
// unsubscribe — Cancel a live subscription
//
// { cmd:"unsubscribe", dp:"System1:Dp.El:_online.._value" }
// ═══════════════════════════════════════════════════════════════

void _kpiUnsubscribe(shape ws, mapping params, mapping p)
{
  string dp = p["dp"];
  dpDisconnect("_kpiSubscriptionCallback", dp);
  ws.msgToJs(params, 0);
}

// ═══════════════════════════════════════════════════════════════
// Internal — Parse ISO 8601 timestamp to WinCC OA time
// ═══════════════════════════════════════════════════════════════

time _kpiParseISOTime(string isoStr)
{
  int year, month, day, hour, minute, second;
  sscanf(isoStr, "%d-%d-%dT%d:%d:%d", year, month, day, hour, minute, second);
  return makeTime(year, month, day, hour, minute, second);
}
