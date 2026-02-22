/* ═══════════════════════════════════════════════════════════════
   oabridge.js — Abstraction layer for WinCC OA oaJS API
   Provides a unified interface with automatic mock/simulation mode
   when oaJS is not available (development outside WinCC OA).

   Archive correction model:
     _original.._value   — raw archived value (written by archiving)
     _corr.._value       — corrected value (written via dpSetTimed)
     _offline.._value    — abstraction: returns _corr if exists,
                           else _original. Used for all queries.
   ═══════════════════════════════════════════════════════════════ */

const OABridge = (() => {
  'use strict';

  // ── Detection ───────────────────────────────────────────────
  const isOaJsAvailable = () => typeof oaJS !== 'undefined' && oaJS !== null;

  let _mode = 'mock'; // 'live' | 'mock'
  let _mockStore = {};
  let _mockDpTree = [];
  let _mockCorrections = {}; // dp -> [{time, value}, ...]
  let _connectCallbacks = [];

  // ── Initialize ──────────────────────────────────────────────
  function init() {
    if (isOaJsAvailable()) {
      _mode = 'live';
      console.log('[OABridge] Connected to WinCC OA via oaJS');
    } else {
      _mode = 'mock';
      _initMockData();
      console.log('[OABridge] Running in SIMULATION mode (no oaJS detected)');
    }
    _connectCallbacks.forEach(cb => cb(_mode));
    return _mode;
  }

  function onConnect(callback) {
    _connectCallbacks.push(callback);
  }

  function getMode() { return _mode; }

  // ── dpSet — Write a value to a datapoint ────────────────────
  function dpSet(dp, value) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        try {
          oaJS.dpSet(dp, value, (err) => {
            if (err) reject(new Error('dpSet failed: ' + err));
            else resolve();
          });
        } catch (e) { reject(e); }
      } else {
        _mockStore[dp] = value;
        resolve();
      }
    });
  }

  // ── dpSetMultiple — Write multiple DPs at once ──────────────
  function dpSetMultiple(dpValuePairs) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        const dps = dpValuePairs.map(p => p[0]);
        const vals = dpValuePairs.map(p => p[1]);
        try {
          oaJS.dpSet(dps, vals, (err) => {
            if (err) reject(new Error('dpSetMultiple failed: ' + err));
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    } else {
      dpValuePairs.forEach(([dp, val]) => { _mockStore[dp] = val; });
      return Promise.resolve();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // dpSetTimed — Write a value at a specific timestamp
  // Used for archive corrections: writes to _corr.._value
  //
  // WinCC OA signature:
  //   dpSetTimed(time t, string dp1, value1 [, dp2, value2, ...])
  //
  // For corrections:
  //   dpSetTimed(timestamp, dpName + ":_corr.._value", newValue)
  // ══════════════════════════════════════════════════════════════
  function dpSetTimed(timestamp, dp, value) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        try {
          oaJS.dpSetTimed(timestamp, dp, value, (err) => {
            if (err) reject(new Error('dpSetTimed failed: ' + err));
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    } else {
      // Mock: store correction
      const key = dp.replace(':_corr.._value', '').replace(':_offline.._value', '');
      if (!_mockCorrections[key]) _mockCorrections[key] = [];
      _mockCorrections[key].push({
        time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
        value: value,
      });
      // Sort by time
      _mockCorrections[key].sort((a, b) => a.time - b.time);
      // Persist to localStorage
      localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
      console.log('[OABridge][Mock] dpSetTimed correction:', key, '@', new Date(timestamp), '=', value);
      return Promise.resolve();
    }
  }

  // ── dpSetTimedMultiple — Multiple timed writes ──────────────
  function dpSetTimedMultiple(timestamp, dpValuePairs) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        // Build flat args array: time, dp1, val1, dp2, val2, ...
        const args = [timestamp];
        dpValuePairs.forEach(([dp, val]) => { args.push(dp, val); });
        try {
          oaJS.dpSetTimed(...args, (err) => {
            if (err) reject(new Error('dpSetTimedMultiple failed: ' + err));
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    } else {
      dpValuePairs.forEach(([dp, val]) => {
        const key = dp.replace(':_corr.._value', '').replace(':_offline.._value', '');
        if (!_mockCorrections[key]) _mockCorrections[key] = [];
        _mockCorrections[key].push({
          time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
          value: val,
        });
      });
      localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
      return Promise.resolve();
    }
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

  // ── queryOriginalValues — Query _original archive only ──────
  function queryOriginalValues(dpName, tStart, tEnd) {
    const fmt = (d) => {
      const t = d instanceof Date ? d : new Date(d);
      const pad = (n) => String(n).padStart(2, '0');
      return t.getFullYear() + '.' + pad(t.getMonth() + 1) + '.' + pad(t.getDate()) + ' ' +
             pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
    };
    const query = "SELECT '_original.._value', '_original.._stime' FROM '" +
                  dpName + "' TIMERANGE(\"" + fmt(tStart) + "\",\"" + fmt(tEnd) + "\",1,0)";
    return dpQuery(query);
  }

  // ── queryCorrectionValues — Query _corr archive only ────────
  function queryCorrectionValues(dpName, tStart, tEnd) {
    const fmt = (d) => {
      const t = d instanceof Date ? d : new Date(d);
      const pad = (n) => String(n).padStart(2, '0');
      return t.getFullYear() + '.' + pad(t.getMonth() + 1) + '.' + pad(t.getDate()) + ' ' +
             pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
    };
    const query = "SELECT '_corr.._value', '_corr.._stime' FROM '" +
                  dpName + "' TIMERANGE(\"" + fmt(tStart) + "\",\"" + fmt(tEnd) + "\",1,0)";
    return dpQuery(query);
  }

  // ── getCorrections — Get mock corrections for a DP ──────────
  function getCorrections(dpName) {
    if (_mode === 'mock') {
      return _mockCorrections[dpName] || [];
    }
    return []; // In live mode, query _corr directly
  }

  // ── dpGet — Read a value from a datapoint ───────────────────
  function dpGet(dp) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        try {
          oaJS.dpGet(dp, (err, value) => {
            if (err) reject(new Error('dpGet failed: ' + err));
            else resolve(value);
          });
        } catch (e) { reject(e); }
      } else {
        resolve(_mockStore[dp] !== undefined ? _mockStore[dp] : null);
      }
    });
  }

  // ── dpGetMultiple — Read multiple DPs ───────────────────────
  function dpGetMultiple(dps) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        try {
          oaJS.dpGet(dps, (err, values) => {
            if (err) reject(new Error('dpGetMultiple failed: ' + err));
            else resolve(values);
          });
        } catch (e) { reject(e); }
      });
    } else {
      const result = dps.map(dp => _mockStore[dp] !== undefined ? _mockStore[dp] : null);
      return Promise.resolve(result);
    }
  }

  // ── dpQuery — Execute a DP query ────────────────────────────
  function dpQuery(query) {
    return new Promise((resolve, reject) => {
      if (_mode === 'live') {
        try {
          oaJS.dpQuery(query, (err, result) => {
            if (err) reject(new Error('dpQuery failed: ' + err));
            else resolve(result);
          });
        } catch (e) { reject(e); }
      } else {
        resolve(_mockQuery(query));
      }
    });
  }

  // ── dpConnect — Subscribe to value changes ──────────────────
  function dpConnect(dp, callback) {
    if (_mode === 'live') {
      try {
        return oaJS.dpConnect(dp, callback);
      } catch (e) {
        console.error('[OABridge] dpConnect error:', e);
        return null;
      }
    } else {
      console.log('[OABridge][Mock] dpConnect on:', dp);
      return { dp, callback, _mockId: Date.now() };
    }
  }

  // ── dpDisconnect ────────────────────────────────────────────
  function dpDisconnect(handle) {
    if (_mode === 'live' && handle) {
      try { oaJS.dpDisconnect(handle); } catch (e) { /* ignore */ }
    }
  }

  // ── dpExists — Check if a DP exists ─────────────────────────
  function dpExists(dp) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        try {
          oaJS.dpExists(dp, (err, exists) => {
            if (err) reject(err);
            else resolve(exists);
          });
        } catch (e) { reject(e); }
      });
    } else {
      return Promise.resolve(dp in _mockStore || _mockDpTree.some(d => d.startsWith(dp)));
    }
  }

  // ── dpCreate — Create a new DP ──────────────────────────────
  function dpCreate(dpName, dpType) {
    if (_mode === 'live') {
      return new Promise((resolve, reject) => {
        try {
          oaJS.dpCreate(dpName, dpType, (err) => {
            if (err) reject(new Error('dpCreate failed: ' + err));
            else resolve();
          });
        } catch (e) { reject(e); }
      });
    } else {
      _mockDpTree.push(dpName);
      return Promise.resolve();
    }
  }

  // ── Browse available DPs (for the DP browser) ───────────────
  function browseDatapoints(filter) {
    if (_mode === 'live') {
      const query = filter
        ? `SELECT '_online.._value' FROM '${filter}*'`
        : `SELECT '_online.._value' FROM '*'`;
      return dpQuery(query).then(result => {
        if (!result || result.length < 2) return [];
        return result.slice(1).map(row => {
          const fullDp = row[0];
          return fullDp.replace(':_online.._value', '').replace('_online.._value', '');
        });
      });
    } else {
      const items = _mockDpTree.filter(dp =>
        !filter || dp.toLowerCase().includes(filter.toLowerCase())
      );
      return Promise.resolve(items);
    }
  }

  // ── Config persistence via DPs ──────────────────────────────
  const CONFIG_DP_PREFIX = 'KPI_Config.';

  function saveConfig(section, data) {
    const dp = CONFIG_DP_PREFIX + section;
    const jsonStr = JSON.stringify(data);
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
    // Simplified mock query parser
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

  // Mock mode: also persist to localStorage for development
  const _origSaveConfig = saveConfig;
  function saveConfigWithFallback(section, data) {
    if (_mode === 'mock') {
      localStorage.setItem('kpi_config_' + section, JSON.stringify(data));
    }
    return _origSaveConfig(section, data);
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
    saveConfig: saveConfigWithFallback,
    loadConfig,
    CONFIG_DP_PREFIX,
  };
})();
