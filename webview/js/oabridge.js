/* ═══════════════════════════════════════════════════════════════
   oabridge.js — Abstraction layer for WinCC OA data access
   Provides a unified Promise-based interface with automatic
   mock/simulation mode when oaJsApi is not available.

   ARCHITECTURE:
     JavaScript does NOT call oaJsApi functions directly.
     All data operations go through the message mechanism:

       JS  →  oaJsApi.toCtrl({cmd, ...})
            →  panel messageReceived
            →  kpiDataAccess.ctl (CTRL data access layer)
            →  msgToJs / execJsFunction  →  JS

     The only oaJsApi function called from JavaScript is toCtrl().

   For dpConnect subscriptions, the CTRL side pushes updates via
   execJsFunction("_oaBridgeDpUpdate", dp, value). A global JS
   function dispatches to the registered callback.

   Archive correction model:
     _original.._value   — raw archived value (written by archiving)
     _corr.._value       — corrected value (written via dpSetTimed)
     _offline.._value    — virtual config: returns _corr if exists,
                           else _original. Used for all standard reads.
   ═══════════════════════════════════════════════════════════════ */

const OABridge = (() => {
  'use strict';

  // ── Detection ───────────────────────────────────────────────
  // oaJsApi is injected by loadSnippet() in the WebView EWO.
  const isOaJsAvailable = () =>
    typeof oaJsApi !== 'undefined' && oaJsApi !== null;

  let _mode = 'mock'; // 'live' | 'mock'
  let _mockStore = {};
  let _mockDpTree = [];
  let _mockCorrections = {}; // dp -> [{time, value}, ...]
  let _connectCallbacks = [];

  // ── dpConnect subscription registry ────────────────────────
  // Maps DP name → callback function.
  // In live mode, the CTRL side pushes updates via
  // execJsFunction("_oaBridgeDpUpdate", dp, value).
  const _dpSubscriptions = {};

  // Global function called by CTRL via WebView.execJsFunction()
  // when a subscribed DP value changes.
  window._oaBridgeDpUpdate = function(dp, value) {
    const cb = _dpSubscriptions[dp];
    if (cb) {
      cb(value);
    }
  };

  // ── Send command to CTRL ───────────────────────────────────
  // Single gateway: all live-mode calls go through here.
  function _sendToCtrl(cmdObj) {
    return new Promise((resolve, reject) => {
      oaJsApi.toCtrl(cmdObj, {
        success: function(data) { resolve(data); },
        error: function() {
          reject(new Error('[OABridge] toCtrl failed: ' + cmdObj.cmd));
        }
      });
    });
  }

  // ── Initialize ──────────────────────────────────────────────
  function init() {
    if (isOaJsAvailable()) {
      _mode = 'live';
      console.log('[OABridge] Connected to WinCC OA — all calls via toCtrl');
    } else {
      _mode = 'mock';
      _initMockData();
      console.log('[OABridge] Running in SIMULATION mode (no oaJsApi detected)');
    }
    _connectCallbacks.forEach(cb => cb(_mode));
    return _mode;
  }

  function onConnect(callback) {
    _connectCallbacks.push(callback);
  }

  function getMode() { return _mode; }

  // ══════════════════════════════════════════════════════════════
  // dpGet — Read a value from a datapoint
  // CTRL handler: dpGet(dp, val) → msgToJs(params, val)
  // ══════════════════════════════════════════════════════════════
  function dpGet(dp) {
    if (_mode === 'live') {
      return _sendToCtrl({ cmd: 'dpGet', dp: dp });
    }
    return Promise.resolve(_mockStore[dp] !== undefined ? _mockStore[dp] : null);
  }

  // ── dpGetMultiple — Read multiple DPs in one round-trip ────
  function dpGetMultiple(dps) {
    if (_mode === 'live') {
      return _sendToCtrl({ cmd: 'dpGet', dps: dps });
    }
    const result = dps.map(dp => _mockStore[dp] !== undefined ? _mockStore[dp] : null);
    return Promise.resolve(result);
  }

  // ══════════════════════════════════════════════════════════════
  // dpSet — Write a value to a datapoint
  // CTRL handler: dpSet(dp, value) → msgToJs(params, rc)
  // ══════════════════════════════════════════════════════════════
  function dpSet(dp, value) {
    if (_mode === 'live') {
      return _sendToCtrl({ cmd: 'dpSet', dp: dp, value: value });
    }
    _mockStore[dp] = value;
    return Promise.resolve();
  }

  // ── dpSetMultiple — Write multiple DPs in one round-trip ───
  function dpSetMultiple(dpValuePairs) {
    if (_mode === 'live') {
      return _sendToCtrl({
        cmd: 'dpSet',
        dps: dpValuePairs.map(p => p[0]),
        values: dpValuePairs.map(p => p[1])
      });
    }
    dpValuePairs.forEach(p => { _mockStore[p[0]] = p[1]; });
    return Promise.resolve();
  }

  // ══════════════════════════════════════════════════════════════
  // dpSetTimed — Write a value at a specific timestamp
  // Used for archive corrections: writes to _corr.._value
  // CTRL handler: dpSetTimed(ts, dp, val) → msgToJs(params, rc)
  // ══════════════════════════════════════════════════════════════
  function dpSetTimed(timestamp, dp, value) {
    if (_mode === 'live') {
      const ts = timestamp instanceof Date
        ? timestamp.toISOString()
        : String(timestamp);
      return _sendToCtrl({
        cmd: 'dpSetTimed',
        timestamp: ts,
        dp: dp,
        value: value
      });
    }
    // Mock: store correction
    const key = dp.replace(':_corr.._value', '').replace(':_offline.._value', '');
    if (!_mockCorrections[key]) _mockCorrections[key] = [];
    _mockCorrections[key].push({
      time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
      value: value,
    });
    _mockCorrections[key].sort((a, b) => a.time - b.time);
    localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
    console.log('[OABridge][Mock] dpSetTimed correction:', key,
      '@', new Date(timestamp), '=', value);
    return Promise.resolve();
  }

  // ── dpSetTimedMultiple — Multiple timed writes in one call ──
  function dpSetTimedMultiple(timestamp, dpValuePairs) {
    if (_mode === 'live') {
      const ts = timestamp instanceof Date
        ? timestamp.toISOString()
        : String(timestamp);
      return _sendToCtrl({
        cmd: 'dpSetTimed',
        timestamp: ts,
        dps: dpValuePairs.map(p => p[0]),
        values: dpValuePairs.map(p => p[1])
      });
    }
    dpValuePairs.forEach(p => {
      const key = p[0].replace(':_corr.._value', '').replace(':_offline.._value', '');
      if (!_mockCorrections[key]) _mockCorrections[key] = [];
      _mockCorrections[key].push({
        time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
        value: p[1],
      });
    });
    localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
    return Promise.resolve();
  }

  // ══════════════════════════════════════════════════════════════
  // writeCorrection — High-level helper for archive correction
  // Writes a corrected value at a specific timestamp.
  // _offline queries will then transparently return this value
  // instead of the original.
  // ══════════════════════════════════════════════════════════════
  function writeCorrection(dpName, timestamp, correctedValue) {
    const corrDp = dpName + ':_corr.._value';
    return dpSetTimed(timestamp, corrDp, correctedValue);
  }

  // ══════════════════════════════════════════════════════════════
  // dpQuery — Execute a SQL-like DP query
  // CTRL handler: dpQuery(query, result) → msgToJs(params, result)
  // ══════════════════════════════════════════════════════════════
  function dpQuery(query) {
    if (_mode === 'live') {
      return _sendToCtrl({ cmd: 'dpQuery', query: query });
    }
    return Promise.resolve(_mockQuery(query));
  }

  // ── queryOriginalValues — Query _original archive only ──────
  function queryOriginalValues(dpName, tStart, tEnd) {
    const query = "SELECT '_original.._value', '_original.._stime' FROM '" +
      dpName + "' TIMERANGE(\"" + _fmtOaTime(tStart) + "\",\"" +
      _fmtOaTime(tEnd) + "\",1,0)";
    return dpQuery(query);
  }

  // ── queryCorrectionValues — Query _corr archive only ────────
  function queryCorrectionValues(dpName, tStart, tEnd) {
    const query = "SELECT '_corr.._value', '_corr.._stime' FROM '" +
      dpName + "' TIMERANGE(\"" + _fmtOaTime(tStart) + "\",\"" +
      _fmtOaTime(tEnd) + "\",1,0)";
    return dpQuery(query);
  }

  // ── getCorrections — Get mock corrections for a DP ──────────
  function getCorrections(dpName) {
    if (_mode === 'mock') {
      return _mockCorrections[dpName] || [];
    }
    return []; // In live mode, query _corr directly
  }

  // ══════════════════════════════════════════════════════════════
  // dpConnect — Subscribe to value changes (hotlink)
  //
  // In live mode: sends toCtrl({cmd:"dpConnect", dp, answer}).
  // The CTRL side registers a dpConnect and pushes updates via
  // execJsFunction("_oaBridgeDpUpdate", dp, value).
  //
  // Returns the DP name as a handle for dpDisconnect.
  // ══════════════════════════════════════════════════════════════
  function dpConnect(dp, callback) {
    if (_mode === 'live') {
      const dpName = Array.isArray(dp) ? dp[0] : dp;
      _dpSubscriptions[dpName] = callback;

      oaJsApi.toCtrl({
        cmd: 'dpConnect',
        dp: dpName,
        answer: false
      }, {
        success: function() {
          console.log('[OABridge] dpConnect registered:', dpName);
        },
        error: function() {
          console.error('[OABridge] dpConnect failed:', dpName);
          delete _dpSubscriptions[dpName];
        }
      });
      return dpName; // handle for dpDisconnect
    }
    console.log('[OABridge][Mock] dpConnect on:', dp);
    return { dp: dp, callback: callback, _mockId: Date.now() };
  }

  // ── dpDisconnect ────────────────────────────────────────────
  function dpDisconnect(handle) {
    if (_mode === 'live' && handle) {
      const dpName = typeof handle === 'string' ? handle : (Array.isArray(handle) ? handle[0] : null);
      if (!dpName) return;

      delete _dpSubscriptions[dpName];

      oaJsApi.toCtrl({
        cmd: 'dpDisconnect',
        dp: dpName
      }, {
        success: function() {},
        error: function() {}
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // dpExists — Check if a DP exists
  // Uses dpNames pattern match in CTRL.
  // ══════════════════════════════════════════════════════════════
  function dpExists(dp) {
    if (_mode === 'live') {
      return _sendToCtrl({
        cmd: 'dpNames',
        pattern: dp,
        dpType: ''
      }).then(data => Array.isArray(data) && data.length > 0);
    }
    return Promise.resolve(
      dp in _mockStore || _mockDpTree.some(d => d.startsWith(dp))
    );
  }

  // ── dpCreate — Create a new DP ────────────────────────────
  // CTRL handler: dpCreate(dpName, dpTypeId) → msgToJs(params, rc)
  function dpCreate(dpName, dpType) {
    if (_mode === 'live') {
      return _sendToCtrl({
        cmd: 'dpCreate',
        dpName: dpName,
        dpType: dpType
      });
    }
    _mockDpTree.push(dpName);
    return Promise.resolve();
  }

  // ══════════════════════════════════════════════════════════════
  // browseDatapoints — List DPs matching a filter
  // CTRL handler: dpNames(pattern, dpType) → msgToJs(params, names)
  // ══════════════════════════════════════════════════════════════
  function browseDatapoints(filter) {
    if (_mode === 'live') {
      const pattern = filter ? '*' + filter + '*' : '*';
      return _sendToCtrl({
        cmd: 'dpNames',
        pattern: pattern,
        dpType: ''
      }).then(data => Array.isArray(data) ? data : []);
    }
    const items = _mockDpTree.filter(dp =>
      !filter || dp.toLowerCase().includes(filter.toLowerCase())
    );
    return Promise.resolve(items);
  }

  // ── Config persistence via DPs ──────────────────────────────
  const CONFIG_DP_PREFIX = 'KPI_Config.';

  function saveConfig(section, data) {
    const dp = CONFIG_DP_PREFIX + section;
    const jsonStr = JSON.stringify(data);
    if (_mode === 'mock') {
      localStorage.setItem('kpi_config_' + section, jsonStr);
    }
    return dpSet(dp, jsonStr);
  }

  function loadConfig(section) {
    const dp = CONFIG_DP_PREFIX + section;
    return dpGet(dp).then(val => {
      if (!val) return null;
      try { return JSON.parse(val); }
      catch (e) { return null; }
    });
  }

  // ── Time formatting for WinCC OA queries ──────────────────
  function _fmtOaTime(d) {
    const t = d instanceof Date ? d : new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '.' + pad(t.getMonth() + 1) + '.' +
      pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' +
      pad(t.getMinutes()) + ':' + pad(t.getSeconds());
  }

  // ── Mock Data ───────────────────────────────────────────────
  function _initMockData() {
    _mockDpTree = [
      'System1:Plant.Water.Counter',
      'System1:Plant.Water.FlowRate',
      'System1:Plant.Water.Pressure',
      'System1:Plant.Water.Temperature',
      'System1:Plant.Elec.EnergyMeter',
      'System1:Plant.Elec.Power',
      'System1:Plant.Elec.Voltage',
      'System1:Plant.Gas.Counter',
      'System1:Plant.Gas.FlowRate',
      'System1:Plant.HVAC.TempSupply',
      'System1:Plant.HVAC.TempReturn',
      'System1:Plant.HVAC.FanStatus',
      'System1:Line1.MachineState',
      'System1:Line1.PieceCounter',
      'System1:Line1.RejectCounter',
      'System1:Line1.CycleTime',
      'System1:Line1.Speed',
      'System1:Line1.StopCause',
      'System1:Line2.MachineState',
      'System1:Line2.PieceCounter',
      'System1:Line2.RejectCounter',
      'System1:Line2.Speed',
      'System1:Line2.StopCause',
    ];

    _mockDpTree.forEach(dp => { _mockStore[dp] = 0; });

    // Pre-load persisted config from localStorage for mock mode
    ['sources', 'aggregations', 'machines', 'oee'].forEach(section => {
      const stored = localStorage.getItem('kpi_config_' + section);
      if (stored) {
        _mockStore[CONFIG_DP_PREFIX + section] = stored;
      }
    });

    // Pre-load persisted corrections from localStorage
    const storedCorr = localStorage.getItem('kpi_corrections');
    if (storedCorr) {
      try { _mockCorrections = JSON.parse(storedCorr); } catch (e) { /* ignore */ }
    }
  }

  function _mockQuery(query) {
    const matchFrom = query.match(/FROM\s+'([^']+)'/i);
    if (!matchFrom) return [['dp']];

    const pattern = matchFrom[1].replace(/\*/g, '');
    const results = [['dp', 'value']];
    _mockDpTree.forEach(dp => {
      if (!pattern || dp.toLowerCase().includes(pattern.toLowerCase())) {
        results.push([dp, _mockStore[dp] || 0]);
      }
    });
    return results;
  }

  // ── Public API ──────────────────────────────────────────────
  return {
    init,
    onConnect,
    getMode,
    dpSet,
    dpSetMultiple,
    dpSetTimed,
    dpSetTimedMultiple,
    writeCorrection,
    queryOriginalValues,
    queryCorrectionValues,
    getCorrections,
    dpGet,
    dpGetMultiple,
    dpQuery,
    dpConnect,
    dpDisconnect,
    dpExists,
    dpCreate,
    browseDatapoints,
    saveConfig,
    loadConfig,
    CONFIG_DP_PREFIX,
  };
})();
