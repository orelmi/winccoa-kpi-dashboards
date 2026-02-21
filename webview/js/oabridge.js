/* ═══════════════════════════════════════════════════════════════
   oabridge.js — Abstraction layer for WinCC OA oaJS API
   Provides a unified interface with automatic mock/simulation mode
   when oaJS is not available (development outside WinCC OA).
   ═══════════════════════════════════════════════════════════════ */

const OABridge = (() => {
  'use strict';

  // ── Detection ───────────────────────────────────────────────
  const isOaJsAvailable = () => typeof oaJS !== 'undefined' && oaJS !== null;

  let _mode = 'mock'; // 'live' | 'mock'
  let _mockStore = {};
  let _mockDpTree = [];
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
  // Stores configuration as JSON strings in dedicated DPs

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
