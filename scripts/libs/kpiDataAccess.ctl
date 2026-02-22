/**
 * kpiDataAccess.ctl
 * ═══════════════════════════════════════════════════════════════
 * WinCC OA CTRL — Data Access Layer
 *
 * ALL WinCC OA data operations are centralized here.
 * JavaScript communicates exclusively via oaJsApi.toCtrl() →
 * panel messageReceived → kpiHandleMessage().
 *
 * Supported commands:
 *   dpGet, dpSet, dpSetTimed, dpQuery, dpNames,
 *   dpConnect, dpDisconnect, dpCreate
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

// Global reference to the WebView shape — used by dpConnect
// callback to push value updates to JavaScript.
global shape g_kpiWebView;

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

void kpiDataAccessInit(shape webView)
{
  g_kpiWebView = webView;
  DebugN("[kpiDataAccess] Initialized — WebView shape registered");
}

// ═══════════════════════════════════════════════════════════════
// Main dispatcher — called from panel messageReceived
//
// params: the full mapping received by messageReceived.
//   params["params"] contains the JS-sent object with "cmd".
//   params is passed through to msgToJs() for response routing.
// ═══════════════════════════════════════════════════════════════

void kpiHandleMessage(shape webView, mapping params)
{
  mapping p = params["params"];
  string cmd = p["cmd"];

  if      (cmd == "dpGet")          _kpiDpGet(webView, params, p);
  else if (cmd == "dpSet")          _kpiDpSet(webView, params, p);
  else if (cmd == "dpSetTimed")     _kpiDpSetTimed(webView, params, p);
  else if (cmd == "dpQuery")        _kpiDpQuery(webView, params, p);
  else if (cmd == "dpNames")        _kpiDpNames(webView, params, p);
  else if (cmd == "dpConnect")      _kpiDpConnect(webView, params, p);
  else if (cmd == "dpDisconnect")   _kpiDpDisconnect(webView, params, p);
  else if (cmd == "dpCreate")       _kpiDpCreate(webView, params, p);
  else
    DebugN("[kpiDataAccess] Unknown command:", cmd);
}

// ═══════════════════════════════════════════════════════════════
// dpGet — Read datapoint value(s)
//
// Single: { cmd:"dpGet", dp:"System1:Dp.El:_online.._value" }
// Multi:  { cmd:"dpGet", dps:["dp1","dp2"] }
// ═══════════════════════════════════════════════════════════════

void _kpiDpGet(shape ws, mapping params, mapping p)
{
  if (mappingHasKey(p, "dps"))
  {
    dyn_string dps = p["dps"];
    dyn_anytype values;
    int rc;

    for (int i = 1; i <= dynlen(dps); i++)
    {
      anytype val;
      rc = dpGet(dps[i], val);
      if (rc != 0)
        DebugN("[kpiDataAccess] dpGet error for", dps[i], "rc:", rc);
      dynAppend(values, val);
    }
    ws.msgToJs(params, values);
  }
  else
  {
    anytype val;
    int rc = dpGet(p["dp"], val);
    if (rc != 0)
      DebugN("[kpiDataAccess] dpGet error for", p["dp"], "rc:", rc);
    ws.msgToJs(params, val);
  }
}

// ═══════════════════════════════════════════════════════════════
// dpSet — Write datapoint value(s)
//
// Single: { cmd:"dpSet", dp:"...", value:123 }
// Multi:  { cmd:"dpSet", dps:["dp1","dp2"], values:[v1,v2] }
// ═══════════════════════════════════════════════════════════════

void _kpiDpSet(shape ws, mapping params, mapping p)
{
  int rc = 0;

  if (mappingHasKey(p, "dps"))
  {
    dyn_string dps = p["dps"];
    dyn_anytype vals = p["values"];

    for (int i = 1; i <= dynlen(dps); i++)
    {
      rc = dpSet(dps[i], vals[i]);
      if (rc != 0)
        DebugN("[kpiDataAccess] dpSet error for", dps[i], "rc:", rc);
    }
  }
  else
  {
    rc = dpSet(p["dp"], p["value"]);
    if (rc != 0)
      DebugN("[kpiDataAccess] dpSet error for", p["dp"], "rc:", rc);
  }

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// dpSetTimed — Write value(s) with a specific timestamp
// Used for archive corrections (_corr.._value)
//
// Single: { cmd:"dpSetTimed", timestamp:"ISO", dp:"...", value:v }
// Multi:  { cmd:"dpSetTimed", timestamp:"ISO", dps:[...], values:[...] }
// ═══════════════════════════════════════════════════════════════

void _kpiDpSetTimed(shape ws, mapping params, mapping p)
{
  time ts = _kpiParseISOTime(p["timestamp"]);
  int rc = 0;

  if (mappingHasKey(p, "dps"))
  {
    dyn_string dps = p["dps"];
    dyn_anytype vals = p["values"];

    for (int i = 1; i <= dynlen(dps); i++)
    {
      rc = dpSetTimed(ts, dps[i], vals[i]);
      if (rc != 0)
        DebugN("[kpiDataAccess] dpSetTimed error for", dps[i], "rc:", rc);
    }
  }
  else
  {
    rc = dpSetTimed(ts, p["dp"], p["value"]);
    if (rc != 0)
      DebugN("[kpiDataAccess] dpSetTimed error for", p["dp"], "rc:", rc);
  }

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// dpQuery — Execute SQL-like query
//
// { cmd:"dpQuery", query:"SELECT ... FROM ... WHERE ..." }
// Returns: dyn_dyn_anytype (2D array: row 0 = headers)
// ═══════════════════════════════════════════════════════════════

void _kpiDpQuery(shape ws, mapping params, mapping p)
{
  string query = p["query"];
  dyn_dyn_anytype result;

  int rc = dpQuery(query, result);
  if (rc != 0)
    DebugN("[kpiDataAccess] dpQuery error, rc:", rc, "query:", query);

  ws.msgToJs(params, result);
}

// ═══════════════════════════════════════════════════════════════
// dpNames — List datapoint names matching a pattern
//
// { cmd:"dpNames", pattern:"System1:Plant.*", dpType:"" }
// Returns: dyn_string
// ═══════════════════════════════════════════════════════════════

void _kpiDpNames(shape ws, mapping params, mapping p)
{
  string pattern = p["pattern"];
  string dpType  = "";

  if (mappingHasKey(p, "dpType"))
    dpType = p["dpType"];

  dyn_string names = dpNames(pattern, dpType);
  ws.msgToJs(params, names);
}

// ═══════════════════════════════════════════════════════════════
// dpCreate — Create a new datapoint
//
// { cmd:"dpCreate", dpName:"MyDp", dpType:"KPI_Config" }
// ═══════════════════════════════════════════════════════════════

void _kpiDpCreate(shape ws, mapping params, mapping p)
{
  string dpName    = p["dpName"];
  string dpTypeName = p["dpType"];

  int typeId = dpTypeId(dpTypeName);
  int rc = dpCreate(dpName, typeId);
  if (rc != 0)
    DebugN("[kpiDataAccess] dpCreate error for", dpName, "type:", dpTypeName, "rc:", rc);

  ws.msgToJs(params, rc);
}

// ═══════════════════════════════════════════════════════════════
// dpConnect — Subscribe to live value changes
//
// { cmd:"dpConnect", dp:"System1:Dp.El:_online.._value", answer:false }
// { cmd:"dpConnect", dps:["dp1","dp2"], answer:true }
//
// The CTRL-side dpConnect callback pushes each update to
// JavaScript via execJsFunction("_oaBridgeDpUpdate", dp, value).
// The JS side maintains a subscription map and dispatches to
// the correct callback.
// ═══════════════════════════════════════════════════════════════

void _kpiDpConnect(shape ws, mapping params, mapping p)
{
  bool answer = false;
  if (mappingHasKey(p, "answer"))
    answer = p["answer"];

  if (mappingHasKey(p, "dps"))
  {
    dyn_string dps = p["dps"];
    for (int i = 1; i <= dynlen(dps); i++)
    {
      dpConnect("_kpiDpConnCallback", answer, dps[i]);
    }
  }
  else
  {
    dpConnect("_kpiDpConnCallback", answer, p["dp"]);
  }

  ws.msgToJs(params, 0);
}

// ── dpConnect callback — fires on every value change ─────────
// Pushes the update to JavaScript via execJsFunction.
// The JS global function _oaBridgeDpUpdate(dp, value) routes
// the value to the registered callback.

void _kpiDpConnCallback(string dp, anytype val)
{
  if (g_kpiWebView)
  {
    g_kpiWebView.execJsFunction("_oaBridgeDpUpdate", dp, val);
  }
  else
  {
    DebugN("[kpiDataAccess] WARNING: dpConnect callback fired but no WebView shape registered");
  }
}

// ═══════════════════════════════════════════════════════════════
// dpDisconnect — Unsubscribe from live value changes
//
// { cmd:"dpDisconnect", dp:"System1:Dp.El:_online.._value" }
// { cmd:"dpDisconnect", dps:["dp1","dp2"] }
// ═══════════════════════════════════════════════════════════════

void _kpiDpDisconnect(shape ws, mapping params, mapping p)
{
  if (mappingHasKey(p, "dps"))
  {
    dyn_string dps = p["dps"];
    for (int i = 1; i <= dynlen(dps); i++)
    {
      dpDisconnect("_kpiDpConnCallback", dps[i]);
    }
  }
  else
  {
    dpDisconnect("_kpiDpConnCallback", p["dp"]);
  }

  ws.msgToJs(params, 0);
}

// ═══════════════════════════════════════════════════════════════
// Internal — Parse ISO 8601 timestamp to WinCC OA time
// Input:  "2024-01-15T10:30:00.000Z"
// Output: time object
// ═══════════════════════════════════════════════════════════════

time _kpiParseISOTime(string isoStr)
{
  int year, month, day, hour, minute, second;
  sscanf(isoStr, "%d-%d-%dT%d:%d:%d", year, month, day, hour, minute, second);
  return makeTime(year, month, day, hour, minute, second);
}
