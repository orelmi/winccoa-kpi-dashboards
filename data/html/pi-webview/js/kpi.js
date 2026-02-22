/* ═══════════════════════════════════════════════════════════════
   kpi.js — Domain-oriented data access for KPI dashboards

   All operations are expressed in KPI domain terms (config,
   history, corrections, recalculation, subscriptions).
   No WinCC OA concepts (dpGet, dpSet, dpQuery, attribute paths)
   are exposed to consumers.

   In live mode: all calls go through oaJsApi.toCtrl() to the
   CTRL data access layer (kpiDataAccess.ctl).
   In simulation mode: mock data from localStorage.
   ═══════════════════════════════════════════════════════════════ */

const KPI = (() => {
  'use strict';

  const _isOaAvailable = () =>
    typeof oaJsApi !== 'undefined' && oaJsApi !== null;

  let _mode = 'mock';
  let _connectCallbacks = [];

  // ── Mock stores ────────────────────────────────────────────
  let _mockStore = {};
  let _mockDpTree = [];
  let _mockCorrections = {};
  const CONFIG_PREFIX = 'KPI_Config.';

  // ── Subscription registry ──────────────────────────────────
  const _subscriptions = {};

  // Global callback invoked by CTRL via execJsFunction()
  window._kpiDpUpdate = function(dp, value) {
    const cb = _subscriptions[dp];
    if (cb) cb(value);
  };

  // ── CTRL gateway ───────────────────────────────────────────
  function _toCtrl(cmdObj) {
    return new Promise((resolve, reject) => {
      oaJsApi.toCtrl(cmdObj, {
        success: function(data) { resolve(data); },
        error: function() {
          reject(new Error('[KPI] command failed: ' + cmdObj.cmd));
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════

  function init() {
    if (_isOaAvailable()) {
      _mode = 'live';
      console.log('[KPI] Connected to WinCC OA');
    } else {
      _mode = 'mock';
      _initMockData();
      console.log('[KPI] Running in SIMULATION mode');
    }
    _connectCallbacks.forEach(cb => cb(_mode));
    return _mode;
  }

  function onConnect(callback) { _connectCallbacks.push(callback); }
  function getMode() { return _mode; }

  // ═══════════════════════════════════════════════════════════
  // Configuration — load / save KPI config sections
  //
  // Sections: 'sources', 'aggregations', 'machines', 'oee'
  // Stored as JSON strings in KPI_Config DPs.
  // ═══════════════════════════════════════════════════════════

  function loadConfig(section) {
    if (_mode === 'live') {
      return _toCtrl({ cmd: 'loadConfig', section: section })
        .then(val => {
          if (!val) return null;
          try { return JSON.parse(val); }
          catch (e) { return null; }
        });
    }
    const stored = localStorage.getItem('kpi_config_' + section);
    if (!stored) return Promise.resolve(null);
    try { return Promise.resolve(JSON.parse(stored)); }
    catch (e) { return Promise.resolve(null); }
  }

  function saveConfig(section, data) {
    const jsonStr = JSON.stringify(data);
    if (_mode === 'live') {
      return _toCtrl({ cmd: 'saveConfig', section: section, data: jsonStr });
    }
    localStorage.setItem('kpi_config_' + section, jsonStr);
    return Promise.resolve();
  }

  // ═══════════════════════════════════════════════════════════
  // Datapoint browsing
  // ═══════════════════════════════════════════════════════════

  function browseDatapoints(filter) {
    if (_mode === 'live') {
      return _toCtrl({ cmd: 'browseDatapoints', filter: filter || '' })
        .then(data => Array.isArray(data) ? data : []);
    }
    const items = _mockDpTree.filter(dp =>
      !filter || dp.toLowerCase().includes(filter.toLowerCase())
    );
    return Promise.resolve(items);
  }

  function datapointExists(dp) {
    if (_mode === 'live') {
      return _toCtrl({ cmd: 'datapointExists', dp: dp })
        .then(data => !!data);
    }
    return Promise.resolve(
      dp in _mockStore || _mockDpTree.some(d => d.startsWith(dp))
    );
  }

  function createDatapoint(name, type) {
    if (_mode === 'live') {
      return _toCtrl({ cmd: 'createDatapoint', name: name, type: type });
    }
    _mockDpTree.push(name);
    return Promise.resolve();
  }

  // ═══════════════════════════════════════════════════════════
  // Archive history — read time-series data
  //
  // All return: [{value, time}, ...]
  // The CTRL side builds the SQL query and selects the
  // appropriate attribute (_offline, _original, _corr).
  // ═══════════════════════════════════════════════════════════

  function readHistory(dp, tStart, tEnd) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'readHistory',
        dp: dp,
        startTime: _toISO(tStart),
        endTime: _toISO(tEnd)
      }).then(_parseHistoryResult);
    }
    return Promise.resolve(_mockHistory(dp, tStart, tEnd));
  }

  function readOriginalHistory(dp, tStart, tEnd) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'readOriginalHistory',
        dp: dp,
        startTime: _toISO(tStart),
        endTime: _toISO(tEnd)
      }).then(_parseHistoryResult);
    }
    return Promise.resolve(_mockHistory(dp, tStart, tEnd));
  }

  function readCorrectionHistory(dp, tStart, tEnd) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'readCorrectionHistory',
        dp: dp,
        startTime: _toISO(tStart),
        endTime: _toISO(tEnd)
      }).then(_parseHistoryResult);
    }
    // Mock: return stored corrections as [{value, time}]
    const corrections = _mockCorrections[dp] || [];
    const start = tStart.getTime();
    const end = tEnd.getTime();
    const result = corrections
      .filter(c => c.time >= start && c.time <= end)
      .map(c => ({ value: c.value, time: new Date(c.time) }));
    return Promise.resolve(result);
  }

  // Parse raw dpQuery result (2D array from CTRL) into [{value, time}]
  function _parseHistoryResult(raw) {
    if (!raw || raw.length < 2) return [];
    // raw[0] = header, raw[1..n] = data rows
    // Each row: [dpName, value, time]
    return raw.slice(1).map(row => ({
      value: row[1],
      time: row[2]
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // Archive correction — write corrected values
  //
  // The CTRL side appends :_corr.._value to the DP path
  // and calls dpSetTimed(timestamp, dp, value).
  // ═══════════════════════════════════════════════════════════

  function writeCorrection(dp, timestamp, value) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'writeCorrection',
        dp: dp,
        timestamp: _toISO(timestamp),
        value: value
      });
    }
    // Mock: store correction
    if (!_mockCorrections[dp]) _mockCorrections[dp] = [];
    _mockCorrections[dp].push({
      time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
      value: value,
    });
    _mockCorrections[dp].sort((a, b) => a.time - b.time);
    localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
    return Promise.resolve();
  }

  function writeCorrectionBatch(timestamp, dpValuePairs) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'writeCorrectionBatch',
        timestamp: _toISO(timestamp),
        dps: dpValuePairs.map(p => p[0]),
        values: dpValuePairs.map(p => p[1])
      });
    }
    dpValuePairs.forEach(p => {
      if (!_mockCorrections[p[0]]) _mockCorrections[p[0]] = [];
      _mockCorrections[p[0]].push({
        time: timestamp instanceof Date ? timestamp.getTime() : timestamp,
        value: p[1],
      });
    });
    localStorage.setItem('kpi_corrections', JSON.stringify(_mockCorrections));
    return Promise.resolve();
  }

  // Mock-only: get stored corrections for display
  function getCorrections(dp) {
    return _mockCorrections[dp] || [];
  }

  // ═══════════════════════════════════════════════════════════
  // KPI recalculation — request the CTRL engines to recompute
  // ═══════════════════════════════════════════════════════════

  function requestRecalculation(request) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'requestRecalculation',
        request: request
      });
    }
    return Promise.resolve();
  }

  // ═══════════════════════════════════════════════════════════
  // Live monitoring — subscribe to value changes
  // ═══════════════════════════════════════════════════════════

  function subscribe(dp, callback) {
    if (_mode === 'live') {
      const dpName = Array.isArray(dp) ? dp[0] : dp;
      _subscriptions[dpName] = callback;

      oaJsApi.toCtrl({
        cmd: 'subscribe',
        dp: dpName
      }, {
        success: function() {},
        error: function() { delete _subscriptions[dpName]; }
      });
      return dpName;
    }
    return { dp: dp, _mockId: Date.now() };
  }

  function unsubscribe(handle) {
    if (_mode === 'live' && handle) {
      const dpName = typeof handle === 'string' ? handle : null;
      if (!dpName) return;
      delete _subscriptions[dpName];
      oaJsApi.toCtrl({ cmd: 'unsubscribe', dp: dpName }, {
        success: function() {},
        error: function() {}
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════

  function _toISO(d) {
    return d instanceof Date ? d.toISOString() : String(d);
  }

  function _mockHistory(dp, tStart, tEnd) {
    const result = [];
    const start = tStart instanceof Date ? tStart.getTime() : tStart;
    const end = tEnd instanceof Date ? tEnd.getTime() : tEnd;
    let t = start;
    let val = 100 + Math.random() * 50;
    const isCounter = dp.toLowerCase().includes('counter') ||
                      dp.toLowerCase().includes('piece') ||
                      dp.toLowerCase().includes('energy');

    while (t <= end && result.length < 500) {
      if (isCounter) {
        val += Math.random() * 5;
      } else {
        val += (Math.random() - 0.5) * 4;
      }
      result.push({
        value: Math.round(val * 100) / 100,
        time: new Date(t)
      });
      t += 30000;
    }
    return result;
  }

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

    ['sources', 'aggregations', 'machines', 'oee'].forEach(section => {
      const stored = localStorage.getItem('kpi_config_' + section);
      if (stored) _mockStore[CONFIG_PREFIX + section] = stored;
    });

    const storedCorr = localStorage.getItem('kpi_corrections');
    if (storedCorr) {
      try { _mockCorrections = JSON.parse(storedCorr); } catch (e) { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Dashboard Gantt chart compatibility
  //
  // Generates a mapping table compatible with the WinCC OA
  // Dashboard Gantt Chart widget. The mapping translates
  // machine state integer codes to labels and colors.
  // ═══════════════════════════════════════════════════════════

  /**
   * Build a Gantt mapping table from machine state config.
   * Returns: { default: {name,description,color}, entries: [{value,name,description,color}] }
   */
  function buildGanttMapping(machineConfig) {
    if (!machineConfig || !machineConfig.states) return null;

    const entries = machineConfig.states.map(st => ({
      value: st.value,
      name: st.label,
      description: st.category + (st.isPlanned ? ' (planned)' : ''),
      color: st.color,
    }));

    return {
      default: { name: 'Unknown', description: 'Unmapped state value', color: '#999999' },
      entries: entries,
    };
  }

  /**
   * Export Gantt mapping to a WinCC OA DP (for Dashboard use).
   * The CTRL side writes the JSON mapping to KPI_Config.ganttMappings.<machineId>
   */
  function exportGanttMapping(machineId, mapping) {
    if (_mode === 'live') {
      return _toCtrl({
        cmd: 'exportGanttMapping',
        machineId: machineId,
        mapping: JSON.stringify(mapping),
      });
    }
    localStorage.setItem('kpi_gantt_mapping_' + machineId, JSON.stringify(mapping));
    return Promise.resolve();
  }

  /**
   * Build full Dashboard Gantt widget config for a machine.
   * Returns a JSON config object that can be imported into
   * the WinCC OA Dashboard editor.
   */
  function buildDashboardGanttConfig(machineConfig, options) {
    const opt = options || {};
    const mapping = buildGanttMapping(machineConfig);
    if (!mapping) return null;

    return {
      widget: 'ganttChart',
      title: opt.title || machineConfig.name + ' — State Timeline',
      series: [
        {
          dp: machineConfig.stateDp,
          name: machineConfig.name,
        },
      ],
      mapping: mapping,
      timeRange: opt.timeRange || '8h',
      rangeChangeable: true,
      showLegend: true,
      showTooltip: true,
      showGrid: true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Page navigation — CTRL-based routing
  //
  // In live mode: sends a 'navigate' command to CTRL,
  // which calls loadSnippet() on the WebView to load the
  // requested page.
  // In simulation mode: uses window.location for browser nav.
  // ═══════════════════════════════════════════════════════════

  function navigate(page) {
    if (_mode === 'live') {
      _toCtrl({ cmd: 'navigate', page: page });
    } else {
      window.location.href = page + '.html';
    }
  }

  // ── Public API ──────────────────────────────────────────────
  return {
    init,
    onConnect,
    getMode,

    // Config
    loadConfig,
    saveConfig,

    // Datapoint browsing
    browseDatapoints,
    datapointExists,
    createDatapoint,

    // Archive history
    readHistory,
    readOriginalHistory,
    readCorrectionHistory,

    // Archive correction
    writeCorrection,
    writeCorrectionBatch,
    getCorrections,

    // Recalculation
    requestRecalculation,

    // Live monitoring
    subscribe,
    unsubscribe,

    // Dashboard Gantt chart compatibility
    buildGanttMapping,
    exportGanttMapping,
    buildDashboardGanttConfig,

    // Navigation
    navigate,
  };
})();
