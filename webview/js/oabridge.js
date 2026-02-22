/* ═══════════════════════════════════════════════════════════════
   oabridge.js — Abstraction layer for WinCC OA oaJsApi
   Provides a unified Promise-based interface with automatic
   mock/simulation mode when oaJsApi is not available.

   In live mode (loaded via loadSnippet in WebView EWO), uses the
   oaJsApi library with its {success, error} callback pattern.
   See: https://www.winccoa.com/documentation/WinCCOA/3.18/en_US/oaJsApi/oaJsApi.html

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

  // ── Initialize ──────────────────────────────────────────────
  function init() {
    if (isOaJsAvailable()) {
      _mode = 'live';
      console.log('[OABridge] Connected to WinCC OA via oaJsApi');
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
  //
  // oaJsApi.dpGet(dpeName, {success(data), error()})
  // ══════════════════════════════════════════════════════════════
  function dpGet(dp) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        oaJsApi.dpGet(dp, {
          success: function(data) { resolve(data); },
          error: function() { reject(new Error('dpGet failed: ' + dp)); }
        });
      } else {
        resolve(_mockStore[dp] !== undefined ? _mockStore[dp] : null);
      }
    });
  }

  // ── dpGetMultiple — Read multiple DPs ───────────────────────
  function dpGetMultiple(dps) {
    if (_mode === 'live') {
      return Promise.all(dps.map(dp => dpGet(dp)));
    }
    const result = dps.map(dp => _mockStore[dp] !== undefined ? _mockStore[dp] : null);
    return Promise.resolve(result);
  }

  // ══════════════════════════════════════════════════════════════
  // dpSet — Write a value to a datapoint
  //
  // oaJsApi.dpSet(dpeName, value, {success(), error()})
  // ══════════════════════════════════════════════════════════════
  function dpSet(dp, value) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        oaJsApi.dpSet(dp, value, {
          success: function() { resolve(); },
          error: function() { reject(new Error('dpSet failed: ' + dp)); }
        });
      } else {
        _mockStore[dp] = value;
        resolve();
      }
    });
  }

  // ── dpSetMultiple — Write multiple DPs ──────────────────────
  function dpSetMultiple(dpValuePairs) {
    if (_mode === 'live') {
      return Promise.all(dpValuePairs.map(p => dpSet(p[0], p[1])));
    }
    dpValuePairs.forEach(p => { _mockStore[p[0]] = p[1]; });
    return Promise.resolve();
  }

  // ══════════════════════════════════════════════════════════════
  // dpSetTimed — Write a value at a specific timestamp
  // Used for archive corrections: writes to _corr.._value
  //
  // dpSetTimed is NOT available in oaJsApi. In live mode we
  // delegate to the panel CTRL script via oaJsApi.toCtrl().
  // The panel's messageReceived handler calls the real
  // CTRL dpSetTimed(time, dp, value).
  // ══════════════════════════════════════════════════════════════
  function dpSetTimed(timestamp, dp, value) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        const ts = timestamp instanceof Date
          ? timestamp.toISOString()
          : String(timestamp);
        oaJsApi.toCtrl({
          cmd: 'dpSetTimed',
          timestamp: ts,
          dp: dp,
          value: value
        }, {
          success: function() { resolve(); },
          error: function() {
            reject(new Error('dpSetTimed failed (toCtrl): ' + dp));
          }
        });
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

  // ── dpSetTimedMultiple — Multiple timed writes ──────────────
  function dpSetTimedMultiple(timestamp, dpValuePairs) {
    if (_mode === 'live') {
      return Promise.all(dpValuePairs.map(p => dpSetTimed(timestamp, p[0], p[1])));
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
  //
  // oaJsApi.dpQuery(queryString, {success(data), error()})
  // ══════════════════════════════════════════════════════════════
  function dpQuery(query) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        oaJsApi.dpQuery(query, {
          success: function(data) { resolve(data); },
          error: function() { reject(new Error('dpQuery failed')); }
        });
      } else {
        resolve(_mockQuery(query));
      }
    });
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
  // oaJsApi.dpConnect(dpNames, answer, {success(data), error()})
  //   dpNames: string[] — DP element names to subscribe to
  //   answer:  boolean  — true = receive current value immediately
  //   success: called on EVERY value change (not just once)
  //
  // Returns dpNames array as handle for dpDisconnect.
  // ══════════════════════════════════════════════════════════════
  function dpConnect(dp, callback) {
    if (_mode === 'live') {
      const dpNames = Array.isArray(dp) ? dp : [dp];
      oaJsApi.dpConnect(dpNames, false, {
        success: function(data) { callback(data); },
        error: function() {
          console.error('[OABridge] dpConnect error for:', dp);
        }
      });
      return dpNames; // handle for dpDisconnect
    }
    console.log('[OABridge][Mock] dpConnect on:', dp);
    return { dp: dp, callback: callback, _mockId: Date.now() };
  }

  // ── dpDisconnect ────────────────────────────────────────────
  // oaJsApi.dpDisconnect(dpNames, {success(), error()})
  // dpNames must be in the same order as in dpConnect.
  function dpDisconnect(handle) {
    if (_mode === 'live' && handle) {
      const dpNames = Array.isArray(handle) ? handle : [handle];
      oaJsApi.dpDisconnect(dpNames, {
        success: function() {},
        error: function() {}
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // dpExists — Check if a DP exists
  //
  // Not directly in oaJsApi; uses dpNames pattern match.
  // oaJsApi.dpNames(pattern, dpType, {success(data), error()})
  // ══════════════════════════════════════════════════════════════
  function dpExists(dp) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        oaJsApi.dpNames(dp, '', {
          success: function(data) {
            resolve(Array.isArray(data) && data.length > 0);
          },
          error: function() { reject(new Error('dpExists check failed: ' + dp)); }
        });
      });
    }
    return Promise.resolve(
      dp in _mockStore || _mockDpTree.some(d => d.startsWith(dp))
    );
  }

  // ── dpCreate — Create a new DP (via toCtrl to panel CTRL) ──
  // Not in oaJsApi; delegates to panel CTRL via toCtrl.
  function dpCreate(dpName, dpType) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        oaJsApi.toCtrl({
          cmd: 'dpCreate',
          dpName: dpName,
          dpType: dpType
        }, {
          success: function() { resolve(); },
          error: function() {
            reject(new Error('dpCreate failed (toCtrl): ' + dpName));
          }
        });
      });
    }
    _mockDpTree.push(dpName);
    return Promise.resolve();
  }

  // ══════════════════════════════════════════════════════════════
  // browseDatapoints — List DPs matching a filter
  //
  // oaJsApi.dpNames(pattern, dpType, {success(data), error()})
  // ══════════════════════════════════════════════════════════════
  function browseDatapoints(filter) {
    if (_mode === 'live') {
      const pattern = filter ? '*' + filter + '*' : '*';
      return new Promise((resolve, reject) => {
        oaJsApi.dpNames(pattern, '', {
          success: function(data) {
            resolve(Array.isArray(data) ? data : []);
          },
          error: function() { reject(new Error('dpNames browse failed')); }
        });
      });
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
