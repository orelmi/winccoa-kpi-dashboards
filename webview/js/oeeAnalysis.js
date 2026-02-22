/* ═══════════════════════════════════════════════════════════════
   oeeAnalysis.js — Display-time OEE analysis
   ═══════════════════════════════════════════════════════════════
   This module computes OEE metrics ON THE FLY from archive data
   for the visualization period selected by the user.

   *** This is NOT the historized/pre-calculated OEE. ***
   The CTRL engine (kpiOeeEngine.ctl) writes pre-calculated KPIs
   into DPs on a fixed schedule (shift, day, etc.).

   This module queries raw archive data directly and aggregates
   it at display time, so the user can freely pick any time range.
   ═══════════════════════════════════════════════════════════════ */

const OeeAnalysis = (() => {
  'use strict';

  let _currentMachineId = null;
  let _currentOeeId = null;

  // ── Public: refresh the analysis view ───────────────────────
  async function refresh() {
    const machineSelect = document.getElementById('analysisMachineSelect');
    const machineId = machineSelect ? machineSelect.value : null;
    if (!machineId) {
      _renderEmpty('Select a machine to view analysis.');
      return;
    }

    _currentMachineId = machineId;
    const machine = MachineStateConfig.getById(machineId);
    if (!machine) {
      _renderEmpty('Machine configuration not found.');
      return;
    }

    // Find matching OEE config for this machine (if any)
    const oeeConfigs = OeeConfig.getAll();
    const oeeConf = oeeConfigs.find(o => o.machineRef === machineId) || null;
    _currentOeeId = oeeConf ? oeeConf.id : null;

    // Read period from UI
    const tRange = _getSelectedTimeRange();

    // Query state history
    const stateHistoryRaw = await _queryStateHistory(machine.stateDp, tRange.start, tRange.end);

    // Apply microstop filtering if configured
    const microstopThreshold = oeeConf ? (oeeConf.microstopThresholdSec || 0) : 0;
    const microstopResult = _filterMicrostops(stateHistoryRaw, machine.states, tRange.start, tRange.end, microstopThreshold);
    const stateHistory = microstopResult.filtered;

    // Compute time per state and frequency
    const stateStats = _computeStateStats(stateHistory, machine.states, tRange.start, tRange.end);

    // Compute cause stats if tracking enabled
    let causeStats = null;
    if (machine.trackCauses && machine.causeDp) {
      const causeHistory = await _queryStateHistory(machine.causeDp, tRange.start, tRange.end);
      causeStats = _computeCauseStats(causeHistory, machine.causes || [], tRange.start, tRange.end);
    }

    // Compute OEE factors if config available
    let oeeResult = null;
    if (oeeConf) {
      oeeResult = await _computeOeeFromArchive(oeeConf, machine, stateStats, tRange);
    }

    // Compute MTBF, MTTR, TEEP from state history
    const mtbfMttr = _computeMtbfMttr(stateHistory, machine.states, tRange.start, tRange.end);
    const teep = oeeResult
      ? _computeTeep(oeeResult, oeeConf, tRange)
      : null;

    // Compute previous period reference
    const prevRange = _getPreviousPeriodRange(tRange);
    let prevOeeResult = null;
    let prevMtbfMttr = null;
    if (oeeConf) {
      const prevStateHistory = await _queryStateHistory(machine.stateDp, prevRange.start, prevRange.end);
      const prevStateStats = _computeStateStats(prevStateHistory, machine.states, prevRange.start, prevRange.end);
      prevOeeResult = await _computeOeeFromArchive(oeeConf, machine, prevStateStats, prevRange);
      prevMtbfMttr = _computeMtbfMttr(prevStateHistory, machine.states, prevRange.start, prevRange.end);
    }

    // Render everything
    _renderAnalysis(machine, stateStats, causeStats, oeeResult, tRange,
      stateHistoryRaw, mtbfMttr, teep, prevOeeResult, prevMtbfMttr, microstopResult);
  }

  // ── Time range from UI ──────────────────────────────────────
  function _getSelectedTimeRange() {
    const preset = document.getElementById('analysisPreset').value;
    const now = new Date();

    if (preset === 'CUSTOM') {
      const startStr = document.getElementById('analysisStart').value;
      const endStr = document.getElementById('analysisEnd').value;
      return {
        start: startStr ? new Date(startStr) : new Date(now.getTime() - 86400000),
        end: endStr ? new Date(endStr) : now,
      };
    }

    const durations = {
      LAST_1H: 3600000,
      LAST_8H: 28800000,
      LAST_24H: 86400000,
      LAST_7D: 604800000,
      LAST_30D: 2592000000,
    };

    if (durations[preset]) {
      return { start: new Date(now.getTime() - durations[preset]), end: now };
    }

    // Calendar-aligned presets
    if (preset === 'TODAY') {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { start: dayStart, end: now };
    }
    if (preset === 'THIS_WEEK') {
      const day = now.getDay() || 7; // Monday = 1
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      return { start: weekStart, end: now };
    }
    if (preset === 'THIS_MONTH') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: monthStart, end: now };
    }

    return { start: new Date(now.getTime() - 86400000), end: now };
  }

  // ── Query archive history (live or mock) ────────────────────
  async function _queryStateHistory(dp, startDate, endDate) {
    if (KPI.getMode() === 'live') {
      return _queryLiveHistory(dp, startDate, endDate);
    } else {
      return _generateMockHistory(dp, startDate, endDate);
    }
  }

  async function _queryLiveHistory(dp, startDate, endDate) {
    const entries = await KPI.readHistory(dp, startDate, endDate);
    return entries.map(entry => ({
      value: String(entry.value),
      time: entry.time instanceof Date ? entry.time : new Date(entry.time),
    }));
  }

  function _generateMockHistory(dp, startDate, endDate) {
    // Generate realistic state change history for simulation
    const history = [];
    const isCauseDp = dp.toLowerCase().includes('cause') || dp.toLowerCase().includes('stop');

    let t = new Date(startDate.getTime());
    const end = endDate.getTime();

    if (isCauseDp) {
      // Generate cause codes for downtime events
      const causeCodes = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
      // Weighted: mechanical & process failures more frequent
      const weights = [5, 20, 15, 18, 8, 10, 12, 7, 5];
      const totalW = weights.reduce((a, b) => a + b, 0);

      while (t.getTime() < end) {
        const r = Math.random() * totalW;
        let acc = 0;
        let code = '0';
        for (let i = 0; i < weights.length; i++) {
          acc += weights[i];
          if (r < acc) { code = causeCodes[i]; break; }
        }
        history.push({ value: code, time: new Date(t.getTime()) });
        // Cause changes every 10min to 2h
        t = new Date(t.getTime() + 600000 + Math.random() * 6600000);
      }
    } else {
      // Machine state: realistic production pattern
      // States: 0=Stopped, 1=Producing, 2=Idle, 3=Setup, 4=Maintenance, 5=PlannedStop
      const stateValues = ['0', '1', '2', '3', '4', '5'];

      // Transition probabilities from current state
      // Producing (1) is dominant with occasional interruptions
      const transitions = {
        '0': { '1': 0.4, '3': 0.3, '4': 0.2, '5': 0.1 },
        '1': { '1': 0.55, '0': 0.1, '2': 0.15, '3': 0.1, '5': 0.1 },
        '2': { '1': 0.6, '0': 0.1, '3': 0.2, '5': 0.1 },
        '3': { '1': 0.8, '2': 0.1, '0': 0.1 },
        '4': { '1': 0.5, '3': 0.3, '2': 0.2 },
        '5': { '1': 0.5, '3': 0.3, '2': 0.2 },
      };

      // Typical duration ranges per state (ms)
      const durations = {
        '0': [120000, 1800000],      // 2 min - 30 min
        '1': [600000, 14400000],     // 10 min - 4 hours
        '2': [60000, 600000],        // 1 min - 10 min
        '3': [300000, 3600000],      // 5 min - 1 hour
        '4': [1800000, 7200000],     // 30 min - 2 hours
        '5': [1800000, 28800000],    // 30 min - 8 hours
      };

      let currentState = '1'; // Start producing

      while (t.getTime() < end) {
        history.push({ value: currentState, time: new Date(t.getTime()) });

        // Duration for this state
        const dur = durations[currentState] || [60000, 600000];
        const stateDuration = dur[0] + Math.random() * (dur[1] - dur[0]);
        t = new Date(t.getTime() + stateDuration);

        // Pick next state based on transition probabilities
        const trans = transitions[currentState] || { '1': 1 };
        const r = Math.random();
        let acc = 0;
        let nextState = '1';
        for (const [state, prob] of Object.entries(trans)) {
          acc += prob;
          if (r < acc) { nextState = state; break; }
        }
        currentState = nextState;
      }
    }

    return Promise.resolve(history);
  }

  // ── Compute time per state + transition count ───────────────
  function _computeStateStats(history, stateDefinitions, tStart, tEnd) {
    const stats = {};

    // Initialize from state definitions
    (stateDefinitions || []).forEach(sd => {
      stats[sd.value] = {
        value: sd.value,
        label: sd.label,
        category: sd.category,
        color: sd.color,
        isPlanned: sd.isPlanned,
        totalSeconds: 0,
        transitionCount: 0,
      };
    });

    if (history.length === 0) return stats;

    const startMs = tStart.getTime();
    const endMs = tEnd.getTime();

    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const val = String(entry.value);
      const entryMs = entry.time.getTime();

      // Determine end of this segment
      let segEnd;
      if (i + 1 < history.length) {
        segEnd = history[i + 1].time.getTime();
      } else {
        segEnd = endMs;
      }

      // Clip to visualization window
      const segStart = Math.max(entryMs, startMs);
      segEnd = Math.min(segEnd, endMs);

      if (segEnd <= segStart) continue;

      const durationSec = (segEnd - segStart) / 1000;

      // Skip microstop sentinel entries — they don't count as any state
      if (val === '__MICROSTOP__') continue;

      if (!stats[val]) {
        stats[val] = {
          value: val,
          label: 'State ' + val,
          category: 'UNKNOWN',
          color: '#999',
          isPlanned: false,
          totalSeconds: 0,
          transitionCount: 0,
        };
      }

      stats[val].totalSeconds += durationSec;
      stats[val].transitionCount += 1;
    }

    return stats;
  }

  // ── Compute cause stats ─────────────────────────────────────
  function _computeCauseStats(causeHistory, causeDefinitions, tStart, tEnd) {
    const stats = {};

    (causeDefinitions || []).forEach(cd => {
      stats[cd.code] = {
        code: cd.code,
        label: cd.label,
        category: cd.category,
        totalSeconds: 0,
        occurrences: 0,
      };
    });

    if (causeHistory.length === 0) return stats;

    const startMs = tStart.getTime();
    const endMs = tEnd.getTime();

    for (let i = 0; i < causeHistory.length; i++) {
      const entry = causeHistory[i];
      const code = String(entry.value);
      const entryMs = entry.time.getTime();

      let segEnd = (i + 1 < causeHistory.length)
        ? causeHistory[i + 1].time.getTime()
        : endMs;

      const segStart = Math.max(entryMs, startMs);
      segEnd = Math.min(segEnd, endMs);

      if (segEnd <= segStart) continue;

      const durationSec = (segEnd - segStart) / 1000;

      if (!stats[code]) {
        stats[code] = {
          code: code,
          label: 'Cause ' + code,
          category: 'OTHER',
          totalSeconds: 0,
          occurrences: 0,
        };
      }

      stats[code].totalSeconds += durationSec;
      stats[code].occurrences += 1;
    }

    return stats;
  }

  // ── Microstop filtering ─────────────────────────────────────
  // Identify stops shorter than the threshold and reclassify them.
  // Returns { filtered: modified stateHistory, microstopCount, microstopTotalSec }
  function _filterMicrostops(stateHistory, stateDefinitions, tStart, tEnd, thresholdSec) {
    if (!thresholdSec || thresholdSec <= 0 || !stateHistory || stateHistory.length === 0) {
      return { filtered: stateHistory, microstopCount: 0, microstopTotalSec: 0 };
    }

    const unplannedStates = new Set();
    (stateDefinitions || []).forEach(sd => {
      if (sd.category === 'UNPLANNED_STOP' || (!sd.isPlanned && sd.category !== 'PRODUCING' && sd.category !== 'IDLE')) {
        unplannedStates.add(String(sd.value));
      }
    });

    const startMs = tStart.getTime();
    const endMs = tEnd.getTime();
    let microstopCount = 0;
    let microstopTotalSec = 0;

    // Mark microstop entries
    const isMicrostop = new Array(stateHistory.length).fill(false);
    for (let i = 0; i < stateHistory.length; i++) {
      const val = String(stateHistory[i].value);
      if (!unplannedStates.has(val)) continue;

      const segStartMs = Math.max(stateHistory[i].time.getTime(), startMs);
      const segEndMs = i + 1 < stateHistory.length
        ? Math.min(stateHistory[i + 1].time.getTime(), endMs)
        : endMs;
      if (segEndMs <= segStartMs) continue;

      const durationSec = (segEndMs - segStartMs) / 1000;
      if (durationSec < thresholdSec) {
        isMicrostop[i] = true;
        microstopCount++;
        microstopTotalSec += durationSec;
      }
    }

    // Build filtered history: microstops become PRODUCING (or the previous non-stop state)
    const filtered = stateHistory.map((entry, i) => {
      if (isMicrostop[i]) {
        return { value: '__MICROSTOP__', time: entry.time, _original: entry.value };
      }
      return entry;
    });

    return { filtered, microstopCount, microstopTotalSec };
  }

  // ── Compute OEE from raw archive data ───────────────────────
  async function _computeOeeFromArchive(oeeConf, machine, stateStats, tRange) {
    const totalPeriodSec = (tRange.end.getTime() - tRange.start.getTime()) / 1000;
    const plannedSec = oeeConf.plannedHours * 3600 * (totalPeriodSec / 86400);

    // ── Availability ──────────────────────────────────────────
    let producingTime = 0;
    let unplannedDowntime = 0;
    let plannedDowntime = 0;

    for (const st of Object.values(stateStats)) {
      if (st.category === 'PRODUCING') {
        producingTime += st.totalSeconds;
      } else if (st.category === 'UNPLANNED_STOP' || (!st.isPlanned && st.category !== 'PRODUCING')) {
        unplannedDowntime += st.totalSeconds;
      } else {
        plannedDowntime += st.totalSeconds;
      }
    }

    const effectivePlanned = Math.max(plannedSec - plannedDowntime, 1);
    const availability = Math.min(Math.max(
      (effectivePlanned - unplannedDowntime) / effectivePlanned, 0), 1);

    // ── Performance ───────────────────────────────────────────
    let performance = 1;
    const sources = SourceConfig.getAll();

    if (oeeConf.piecesSourceRef) {
      const piecesSrc = sources.find(s => s.id === oeeConf.piecesSourceRef);
      if (piecesSrc) {
        const piecesHistory = await _queryStateHistory(piecesSrc.dpSource, tRange.start, tRange.end);
        const totalPieces = _getCounterDelta(piecesHistory);

        const runTime = producingTime > 0 ? producingTime : 1;

        if (oeeConf.perfMethod === 'CYCLE_TIME') {
          const idealCycle = oeeConf.idealCycleTime || 1;
          performance = (idealCycle * totalPieces) / runTime;
        } else {
          const designSpeed = oeeConf.designSpeed || 1;
          performance = totalPieces / (designSpeed * (runTime / 3600));
        }
        performance = Math.min(Math.max(performance, 0), 1.5);
      }
    }

    // ── Quality ───────────────────────────────────────────────
    let quality = 1;

    if (oeeConf.qualityMethod === 'FIXED_RATIO') {
      quality = (oeeConf.fixedQuality || 100) / 100;
    } else if (oeeConf.qualityMethod === 'GOOD_PIECES' && oeeConf.goodSourceRef && oeeConf.piecesSourceRef) {
      const goodSrc = sources.find(s => s.id === oeeConf.goodSourceRef);
      const piecesSrc = sources.find(s => s.id === oeeConf.piecesSourceRef);
      if (goodSrc && piecesSrc) {
        const goodHist = await _queryStateHistory(goodSrc.dpSource, tRange.start, tRange.end);
        const piecesHist = await _queryStateHistory(piecesSrc.dpSource, tRange.start, tRange.end);
        const good = _getCounterDelta(goodHist);
        const total = _getCounterDelta(piecesHist);
        quality = total > 0 ? good / total : 1;
      }
    } else if (oeeConf.qualityMethod === 'REJECT_PIECES' && oeeConf.rejectSourceRef && oeeConf.piecesSourceRef) {
      const rejSrc = sources.find(s => s.id === oeeConf.rejectSourceRef);
      const piecesSrc = sources.find(s => s.id === oeeConf.piecesSourceRef);
      if (rejSrc && piecesSrc) {
        const rejHist = await _queryStateHistory(rejSrc.dpSource, tRange.start, tRange.end);
        const piecesHist = await _queryStateHistory(piecesSrc.dpSource, tRange.start, tRange.end);
        const rejects = _getCounterDelta(rejHist);
        const total = _getCounterDelta(piecesHist);
        quality = total > 0 ? (total - rejects) / total : 1;
      }
    }

    quality = Math.min(Math.max(quality, 0), 1);
    const oee = availability * performance * quality;

    return {
      availability,
      performance,
      quality,
      oee,
      producingTime,
      unplannedDowntime,
      plannedDowntime,
      effectivePlanned,
    };
  }

  // ── MTBF / MTTR calculation ─────────────────────────────────
  // MTBF = sum of uptime intervals between failures / number of failures
  // MTTR = total unplanned downtime / number of failures
  function _computeMtbfMttr(stateHistory, stateDefinitions, tStart, tEnd) {
    if (!stateHistory || stateHistory.length === 0) {
      return { mtbf: null, mttr: null, failureCount: 0 };
    }

    // Build a set of unplanned stop state values
    const unplannedStates = new Set();
    (stateDefinitions || []).forEach(sd => {
      if (sd.category === 'UNPLANNED_STOP' || (!sd.isPlanned && sd.category !== 'PRODUCING' && sd.category !== 'IDLE')) {
        unplannedStates.add(String(sd.value));
      }
    });

    const startMs = tStart.getTime();
    const endMs = tEnd.getTime();

    let failureCount = 0;
    let totalUptime = 0;       // total time between failures (in seconds)
    let totalRepairTime = 0;   // total time in failure state (in seconds)
    let inFailure = false;

    for (let i = 0; i < stateHistory.length; i++) {
      const val = String(stateHistory[i].value);
      const entryMs = Math.max(stateHistory[i].time.getTime(), startMs);
      const nextMs = i + 1 < stateHistory.length
        ? Math.min(stateHistory[i + 1].time.getTime(), endMs)
        : endMs;
      if (nextMs <= entryMs) continue;

      const durationSec = (nextMs - entryMs) / 1000;
      const isFail = unplannedStates.has(val);

      if (isFail) {
        if (!inFailure) {
          failureCount++;
          inFailure = true;
        }
        totalRepairTime += durationSec;
      } else {
        inFailure = false;
        totalUptime += durationSec;
      }
    }

    return {
      mtbf: failureCount > 0 ? totalUptime / failureCount : null,
      mttr: failureCount > 0 ? totalRepairTime / failureCount : null,
      failureCount: failureCount,
    };
  }

  // ── TEEP calculation ──────────────────────────────────────────
  // TEEP = OEE x (Planned Production Time / Total Calendar Time)
  function _computeTeep(oeeResult, oeeConf, tRange) {
    const calendarSec = (tRange.end.getTime() - tRange.start.getTime()) / 1000;
    if (calendarSec <= 0) return null;
    const periodDays = calendarSec / 86400;
    const plannedSec = (oeeConf.plannedHours || 24) * 3600 * periodDays;
    const loading = Math.min(plannedSec / calendarSec, 1);
    return oeeResult.oee * loading;
  }

  // ── Previous period range ─────────────────────────────────────
  function _getPreviousPeriodRange(tRange) {
    const durationMs = tRange.end.getTime() - tRange.start.getTime();
    return {
      start: new Date(tRange.start.getTime() - durationMs),
      end: new Date(tRange.start.getTime()),
    };
  }

  function _getCounterDelta(history) {
    if (!history || history.length < 2) return 0;
    // For mock mode, generate a plausible counter
    if (KPI.getMode() === 'mock') {
      const durationH = (history[history.length - 1].time.getTime() - history[0].time.getTime()) / 3600000;
      return Math.round(durationH * (200 + Math.random() * 300)); // ~200-500 pieces/h
    }
    const first = parseFloat(history[0].value) || 0;
    const last = parseFloat(history[history.length - 1].value) || 0;
    let delta = last - first;
    if (delta < 0) delta = (4294967295 - first) + last;
    return delta;
  }

  // ── Render the full analysis view ───────────────────────────
  function _renderAnalysis(machine, stateStats, causeStats, oeeResult, tRange,
    stateHistory, mtbfMttr, teep, prevOeeResult, prevMtbfMttr, microstopResult) {
    const container = document.getElementById('analysisResults');
    if (!container) return;

    const totalSec = (tRange.end.getTime() - tRange.start.getTime()) / 1000;

    // Store data for CSV export
    _storeExportData(machine, stateStats, causeStats, oeeResult, tRange, mtbfMttr, teep, microstopResult);

    // Export toolbar
    let html = '<div class="analysis-export-bar">' +
      '<span class="analysis-export-label">Export:</span>' +
      (oeeResult ? '<button class="btn btn-sm btn-secondary" onclick="OeeAnalysis.exportOeeCsv()">OEE Summary</button>' : '') +
      '<button class="btn btn-sm btn-secondary" onclick="OeeAnalysis.exportStatesCsv()">State Analysis</button>' +
      (causeStats ? '<button class="btn btn-sm btn-secondary" onclick="OeeAnalysis.exportCausesCsv()">Cause Analysis</button>' : '') +
    '</div>';

    // ── OEE Gauges + MTBF/MTTR/TEEP (if available) ───────────
    if (oeeResult) {
      const limits = _currentOeeId ? _getOeeLimits(_currentOeeId) : null;
      html += _renderOeeGauges(oeeResult, teep, mtbfMttr, prevOeeResult, prevMtbfMttr, limits, microstopResult);
    }

    // ── Gantt Chart (state timeline) ──────────────────────────
    if (stateHistory && stateHistory.length > 0) {
      html += _renderGanttChart(stateHistory, machine.states, tRange);
    }

    // ── Time Model Breakdown ────────────────────────────────
    html += _renderTimeModel(stateStats, totalSec, oeeResult);

    // ── State Timeline Bar ────────────────────────────────────
    html += _renderTimelineBar(stateStats, totalSec);

    // ── State Statistics Table ─────────────────────────────────
    html += _renderStateTable(stateStats, totalSec);

    // ── Cause Pareto (if available) ───────────────────────────
    if (causeStats) {
      html += _renderCausePareto(causeStats, totalSec, machine.causes);
    }

    container.innerHTML = html;
  }

  // ── Get OEE limits from config ──────────────────────────────
  function _getOeeLimits(oeeId) {
    const oee = OeeConfig.getById(oeeId);
    if (!oee || !oee.limits) return null;
    return oee.limits;
  }

  function _renderOeeGauges(r, teep, mtbfMttr, prevR, prevMtbf, limits, microstopResult) {
    const fmtPct = (v) => (v * 100).toFixed(1) + '%';
    const fmtTime = (sec) => {
      if (sec == null) return '--';
      if (sec >= 3600) return (sec / 3600).toFixed(1) + 'h';
      if (sec >= 60) return (sec / 60).toFixed(0) + 'min';
      return sec.toFixed(0) + 's';
    };
    const fmtDelta = (cur, prev) => {
      if (prev == null) return '';
      const delta = (cur - prev) * 100;
      const sign = delta >= 0 ? '+' : '';
      const cls = delta >= 0 ? 'delta-positive' : 'delta-negative';
      return '<span class="gauge-delta ' + cls + '">' + sign + delta.toFixed(1) + 'pp</span>';
    };

    // OEE core gauges with limits and previous period
    let html = '<div class="analysis-section">' +
      '<h3 class="analysis-title">OEE — Live Calculation</h3>' +
      '<p class="analysis-hint">Calculated on the fly from raw archive data for the selected period. ' +
        'Previous period values shown for reference.</p>' +
      '<div class="oee-gauges">' +
        _gauge('Availability', r.availability, '#17a2b8', prevR ? prevR.availability : null, limits) +
        _gauge('Performance', r.performance, '#6f42c1', prevR ? prevR.performance : null, limits) +
        _gauge('Quality', r.quality, '#28a745', prevR ? prevR.quality : null, limits) +
        _gauge('OEE', r.oee, '#009999', prevR ? prevR.oee : null, limits) +
      '</div>';

    // Other KPIs: TEEP, MTBF, MTTR
    html += '<div class="kpi-other-row">';
    if (teep != null) {
      const prevTeep = prevR && prevR.oee != null ? prevR.oee * (prevR.effectivePlanned > 0 ? 1 : 0) : null;
      html += _kpiCard('TEEP', fmtPct(teep), 'Total Effective Equipment Performance', _limitClass(teep, limits, 'teep'));
    }
    if (mtbfMttr) {
      html += _kpiCard('MTBF', fmtTime(mtbfMttr.mtbf),
        'Mean Time Between Failures' + (mtbfMttr.failureCount > 0 ? ' (' + mtbfMttr.failureCount + ' failures)' : ' (no failures)'),
        _limitClassTime(mtbfMttr.mtbf, limits, 'mtbf'));
      html += _kpiCard('MTTR', fmtTime(mtbfMttr.mttr),
        'Mean Time To Repair',
        _limitClassTime(mtbfMttr.mttr, limits, 'mttr'));
    }
    // Microstop info
    if (microstopResult && microstopResult.microstopCount > 0) {
      html += _kpiCard('Microstops', microstopResult.microstopCount + 'x',
        fmtTime(microstopResult.microstopTotalSec) + ' total (filtered from downtime)', '');
    }
    html += '</div>';

    // Time breakdown
    html += '<div class="oee-time-breakdown">' +
      '<span>Run time: <strong>' + fmtTime(r.producingTime) + '</strong></span>' +
      '<span>Unplanned stops: <strong>' + fmtTime(r.unplannedDowntime) + '</strong></span>' +
      '<span>Planned stops: <strong>' + fmtTime(r.plannedDowntime) + '</strong></span>' +
    '</div>' +
    '</div>';

    return html;
  }

  function _kpiCard(label, value, hint, limitCls) {
    return '<div class="kpi-other-card ' + (limitCls || '') + '">' +
      '<div class="kpi-other-label">' + label + '</div>' +
      '<div class="kpi-other-value">' + value + '</div>' +
      '<div class="kpi-other-hint">' + Utils.escapeHtml(hint) + '</div>' +
    '</div>';
  }

  function _limitClass(value, limits, kpi) {
    if (!limits) return '';
    const key = kpi.toLowerCase();
    const warn = limits[key + 'Warn'];
    const alarm = limits[key + 'Alarm'];
    if (alarm != null && value * 100 < alarm) return 'limit-alarm';
    if (warn != null && value * 100 < warn) return 'limit-warn';
    return 'limit-ok';
  }

  function _limitClassTime(valueSec, limits, kpi) {
    if (!limits || valueSec == null) return '';
    const key = kpi.toLowerCase();
    // For MTBF: alarm if below threshold; for MTTR: alarm if above threshold
    if (kpi === 'mtbf') {
      const warnSec = limits.mtbfWarn;
      const alarmSec = limits.mtbfAlarm;
      if (alarmSec != null && valueSec < alarmSec) return 'limit-alarm';
      if (warnSec != null && valueSec < warnSec) return 'limit-warn';
      return 'limit-ok';
    } else { // mttr — lower is better
      const warnSec = limits.mttrWarn;
      const alarmSec = limits.mttrAlarm;
      if (alarmSec != null && valueSec > alarmSec) return 'limit-alarm';
      if (warnSec != null && valueSec > warnSec) return 'limit-warn';
      return 'limit-ok';
    }
  }

  function _gauge(label, value, color, prevValue, limits) {
    const pct = Math.min(value * 100, 100);
    const displayPct = (value * 100).toFixed(1);
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct / 100);

    // Determine limit status for color override
    const lCls = _limitClass(value, limits, label.toLowerCase());
    let strokeColor = color;
    if (lCls === 'limit-alarm') strokeColor = '#d9363e';
    else if (lCls === 'limit-warn') strokeColor = '#e68a00';

    // Previous period delta
    let deltaHtml = '';
    if (prevValue != null) {
      const delta = (value - prevValue) * 100;
      const sign = delta >= 0 ? '+' : '';
      const cls = delta >= 0 ? 'delta-positive' : 'delta-negative';
      deltaHtml = '<div class="gauge-delta ' + cls + '">' + sign + delta.toFixed(1) + 'pp</div>';
    }

    // Limit indicator icon
    let limitIcon = '';
    if (lCls === 'limit-alarm') limitIcon = '<text x="50" y="76" text-anchor="middle" fill="#d9363e" font-size="10">&#9888;</text>';
    else if (lCls === 'limit-warn') limitIcon = '<text x="50" y="76" text-anchor="middle" fill="#e68a00" font-size="10">&#9888;</text>';

    return '<div class="oee-gauge">' +
      '<svg viewBox="0 0 100 100" class="gauge-svg">' +
        '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="#edf0f3" stroke-width="8"/>' +
        '<circle cx="50" cy="50" r="' + radius + '" fill="none" ' +
          'stroke="' + strokeColor + '" stroke-width="8" ' +
          'stroke-dasharray="' + circumference + '" ' +
          'stroke-dashoffset="' + offset + '" ' +
          'stroke-linecap="round" ' +
          'transform="rotate(-90 50 50)"/>' +
        '<text x="50" y="48" text-anchor="middle" class="gauge-value" fill="' + strokeColor + '">' + displayPct + '%</text>' +
        '<text x="50" y="62" text-anchor="middle" class="gauge-label">' + label + '</text>' +
        limitIcon +
      '</svg>' +
      deltaHtml +
    '</div>';
  }

  // ── Timeline bar (proportional colored segments) ────────────
  function _renderTimelineBar(stateStats, totalSec) {
    if (totalSec <= 0) return '';

    // Sort by category priority for consistent ordering
    const catOrder = ['PRODUCING', 'IDLE', 'SETUP', 'MAINTENANCE', 'PLANNED_STOP', 'UNPLANNED_STOP'];
    const entries = Object.values(stateStats)
      .filter(s => s.totalSeconds > 0)
      .sort((a, b) => {
        const ia = catOrder.indexOf(a.category);
        const ib = catOrder.indexOf(b.category);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

    let barSegments = '';
    let legendItems = '';

    entries.forEach(s => {
      const pct = (s.totalSeconds / totalSec * 100);
      if (pct < 0.2) return; // Skip tiny slices
      barSegments += '<div class="timeline-segment" ' +
        'style="width:' + pct.toFixed(2) + '%;background:' + Utils.escapeHtml(s.color) + ';" ' +
        'title="' + Utils.escapeHtml(s.label) + ': ' + pct.toFixed(1) + '%">' +
        (pct > 5 ? '<span>' + pct.toFixed(0) + '%</span>' : '') +
      '</div>';

      legendItems += '<span class="timeline-legend-item">' +
        '<span class="state-dot" style="background:' + Utils.escapeHtml(s.color) + '"></span>' +
        Utils.escapeHtml(s.label) +
      '</span>';
    });

    return '<div class="analysis-section">' +
      '<h3 class="analysis-title">State Distribution</h3>' +
      '<div class="timeline-bar">' + barSegments + '</div>' +
      '<div class="timeline-legend">' + legendItems + '</div>' +
    '</div>';
  }

  // ── State stats table ───────────────────────────────────────
  function _renderStateTable(stateStats, totalSec) {
    const fmtDuration = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'min';
      if (m > 0) return m + 'min ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    };

    const entries = Object.values(stateStats).sort((a, b) => b.totalSeconds - a.totalSeconds);

    let rows = '';
    entries.forEach(s => {
      const pct = totalSec > 0 ? (s.totalSeconds / totalSec * 100) : 0;
      const catInfo = Utils.STATE_CATEGORIES[s.category] || { label: s.category };

      rows += '<tr>' +
        '<td>' +
          '<span class="state-dot" style="background:' + Utils.escapeHtml(s.color) + ';display:inline-block;vertical-align:middle;margin-right:6px;"></span>' +
          '<strong>' + Utils.escapeHtml(s.label) + '</strong>' +
        '</td>' +
        '<td>' + Utils.escapeHtml(catInfo.label || s.category) + '</td>' +
        '<td>' + fmtDuration(s.totalSeconds) + '</td>' +
        '<td>' +
          '<div class="stat-bar-bg"><div class="stat-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + Utils.escapeHtml(s.color) + ';"></div></div>' +
        '</td>' +
        '<td class="stat-pct">' + pct.toFixed(1) + '%</td>' +
        '<td class="stat-count">' + s.transitionCount + '</td>' +
      '</tr>';
    });

    return '<div class="analysis-section">' +
      '<h3 class="analysis-title">Time per State</h3>' +
      '<table class="config-table analysis-table">' +
        '<thead><tr>' +
          '<th>State</th><th>Category</th><th>Duration</th><th>Distribution</th><th>%</th><th>Transitions</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // ── Cause Pareto chart (horizontal bars, hierarchical) ──────
  function _renderCausePareto(causeStats, totalSec, causeDefinitions) {
    const entries = Object.values(causeStats)
      .filter(c => c.totalSeconds > 0 || c.occurrences > 0)
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    if (entries.length === 0) {
      return '<div class="analysis-section">' +
        '<h3 class="analysis-title">Downtime Causes</h3>' +
        '<p class="analysis-hint">No downtime cause data for this period.</p>' +
      '</div>';
    }

    const maxDuration = entries.reduce((max, c) => Math.max(max, c.totalSeconds), 1);

    const fmtDuration = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'min';
      return m + 'min';
    };

    const catColors = {
      MECHANICAL: '#d9363e',
      ELECTRICAL: '#fd7e14',
      PROCESS: '#6f42c1',
      OPERATOR: '#17a2b8',
      QUALITY: '#28a745',
      SUPPLY: '#e68a00',
      PLANNED: '#6b7c8e',
      OTHER: '#adb5bd',
    };

    // Build parentCode lookup from cause definitions
    const parentMap = {};
    (causeDefinitions || []).forEach(cd => {
      if (cd.parentCode) parentMap[cd.code] = cd.parentCode;
    });

    // Build tree structure: group children under parents
    const rootEntries = [];
    const childrenOf = {};
    entries.forEach(c => {
      const parent = parentMap[c.code];
      if (parent && entries.some(e => e.code === parent)) {
        if (!childrenOf[parent]) childrenOf[parent] = [];
        childrenOf[parent].push(c);
      } else {
        rootEntries.push(c);
      }
    });

    // Render a Pareto row
    function renderParetoRow(c, indent) {
      const barPct = (c.totalSeconds / maxDuration * 100);
      const color = catColors[c.category] || '#6b7c8e';
      const indentPx = indent * 20;

      return '<div class="pareto-row" style="padding-left:' + indentPx + 'px;">' +
        '<div class="pareto-label">' +
          (indent > 0 ? '<span class="pareto-indent">&#x251C; </span>' : '') +
          '<span class="pareto-cause">' + Utils.escapeHtml(c.label) + '</span>' +
          '<span class="pareto-cat">' + Utils.escapeHtml(Utils.CAUSE_CATEGORIES[c.category] || c.category) + '</span>' +
        '</div>' +
        '<div class="pareto-bar-container">' +
          '<div class="pareto-bar" style="width:' + barPct.toFixed(1) + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<div class="pareto-values">' +
          '<span class="pareto-duration">' + fmtDuration(c.totalSeconds) + '</span>' +
          '<span class="pareto-count">' + c.occurrences + 'x</span>' +
        '</div>' +
      '</div>';
    }

    let bars = '';
    rootEntries.forEach(c => {
      bars += renderParetoRow(c, 0);
      // Render children sorted by duration
      const children = (childrenOf[c.code] || []).sort((a, b) => b.totalSeconds - a.totalSeconds);
      children.forEach(child => {
        bars += renderParetoRow(child, 1);
      });
    });

    return '<div class="analysis-section">' +
      '<h3 class="analysis-title">Downtime Causes — Pareto</h3>' +
      '<p class="analysis-hint">Sorted by total duration. Hierarchical cause grouping based on parent relationships.</p>' +
      '<div class="pareto-chart">' + bars + '</div>' +
    '</div>';
  }

  // ── Gantt Chart (SVG timeline) ──────────────────────────────
  function _renderGanttChart(stateHistory, stateDefinitions, tRange) {
    const startMs = tRange.start.getTime();
    const endMs = tRange.end.getTime();
    const totalMs = endMs - startMs;
    if (totalMs <= 0 || stateHistory.length === 0) return '';

    // Build state color/label map
    const stateMap = {};
    (stateDefinitions || []).forEach(sd => {
      stateMap[String(sd.value)] = { color: sd.color, label: sd.label, category: sd.category };
    });

    const barHeight = 28;
    const labelWidth = 0; // no left labels, use legend
    const chartWidth = 100; // percentage based
    const fmtTime = (ms) => {
      const d = new Date(ms);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const fmtDateTime = (ms) => {
      const d = new Date(ms);
      return d.toLocaleDateString() + ' ' + fmtTime(ms);
    };

    // Build segments
    let segments = '';
    for (let i = 0; i < stateHistory.length; i++) {
      const entry = stateHistory[i];
      const val = String(entry.value);
      const segStartMs = Math.max(entry.time.getTime(), startMs);
      const segEndMs = i + 1 < stateHistory.length
        ? Math.min(stateHistory[i + 1].time.getTime(), endMs)
        : endMs;

      if (segEndMs <= segStartMs) continue;

      const xPct = ((segStartMs - startMs) / totalMs * 100);
      const wPct = ((segEndMs - segStartMs) / totalMs * 100);
      const info = stateMap[val] || { color: '#999', label: 'State ' + val, category: 'UNKNOWN' };
      const durationSec = (segEndMs - segStartMs) / 1000;
      const durLabel = durationSec >= 3600
        ? (durationSec / 3600).toFixed(1) + 'h'
        : durationSec >= 60 ? Math.floor(durationSec / 60) + 'min' : Math.floor(durationSec) + 's';

      segments += '<div class="gantt-segment" ' +
        'style="left:' + xPct.toFixed(3) + '%;width:' + wPct.toFixed(3) + '%;background:' + Utils.escapeHtml(info.color) + ';" ' +
        'title="' + Utils.escapeHtml(info.label) + ' (' + durLabel + ')\n' +
          fmtDateTime(segStartMs) + ' — ' + fmtDateTime(segEndMs) + '">' +
      '</div>';
    }

    // Time axis labels (up to 8 labels)
    let axisLabels = '';
    const labelCount = Math.min(8, Math.max(2, Math.floor(totalMs / 3600000)));
    for (let j = 0; j <= labelCount; j++) {
      const t = startMs + (totalMs * j / labelCount);
      const leftPct = (j / labelCount * 100);
      axisLabels += '<span class="gantt-time-label" style="left:' + leftPct.toFixed(1) + '%">' + fmtTime(t) + '</span>';
    }

    // Legend
    const uniqueStates = {};
    stateHistory.forEach(e => { uniqueStates[String(e.value)] = true; });
    let legend = '';
    Object.keys(uniqueStates).forEach(val => {
      const info = stateMap[val] || { color: '#999', label: 'State ' + val };
      legend += '<span class="timeline-legend-item">' +
        '<span class="state-dot" style="background:' + Utils.escapeHtml(info.color) + '"></span>' +
        Utils.escapeHtml(info.label) +
      '</span>';
    });

    return '<div class="analysis-section">' +
      '<h3 class="analysis-title">Machine State Timeline — Gantt</h3>' +
      '<p class="analysis-hint">Hover over segments for details. Each segment represents a continuous state period.</p>' +
      '<div class="gantt-container">' +
        '<div class="gantt-bar">' + segments + '</div>' +
        '<div class="gantt-axis">' + axisLabels + '</div>' +
      '</div>' +
      '<div class="timeline-legend" style="margin-top:8px;">' + legend + '</div>' +
    '</div>';
  }

  // ── Time Model Breakdown ──────────────────────────────────────
  // Hierarchical: Calendar Time → Planned Time → Production, Planned Stops, Unplanned Stops
  function _renderTimeModel(stateStats, totalSec, oeeResult) {
    if (totalSec <= 0) return '';

    // Categorize state time into 3 categories
    let productionTime = 0;   // PRODUCING + IDLE + SETUP
    let plannedDown = 0;      // PLANNED_STOP + MAINTENANCE (isPlanned)
    let unplannedDown = 0;    // UNPLANNED_STOP

    Object.values(stateStats).forEach(s => {
      if (s.category === 'PRODUCING') {
        productionTime += s.totalSeconds;
      } else if (s.category === 'UNPLANNED_STOP') {
        unplannedDown += s.totalSeconds;
      } else if (s.isPlanned || s.category === 'PLANNED_STOP' || s.category === 'MAINTENANCE') {
        plannedDown += s.totalSeconds;
      } else {
        // IDLE, SETUP — count as operational (part of planned production time)
        productionTime += s.totalSeconds;
      }
    });

    const calendarTime = totalSec;
    const plannedProdTime = oeeResult
      ? oeeResult.effectivePlanned
      : calendarTime - plannedDown;
    const netProdTime = productionTime;

    const fmtDur = (sec) => {
      if (sec >= 3600) return (sec / 3600).toFixed(1) + 'h';
      if (sec >= 60) return Math.floor(sec / 60) + 'min';
      return Math.floor(sec) + 's';
    };
    const pct = (part, total) => total > 0 ? (part / total * 100).toFixed(1) + '%' : '0%';

    // Render as stacked horizontal breakdown
    return '<div class="analysis-section">' +
      '<h3 class="analysis-title">Time Model</h3>' +
      '<p class="analysis-hint">Hierarchical time breakdown per the OEE time model (ISO 22400).</p>' +
      '<div class="time-model">' +
        // Level 1: Calendar Time
        '<div class="tm-row tm-level-0">' +
          '<div class="tm-label">Calendar Time</div>' +
          '<div class="tm-bar-full"><div class="tm-bar-seg" style="width:100%;background:#36454f;"></div></div>' +
          '<div class="tm-value">' + fmtDur(calendarTime) + '</div>' +
        '</div>' +
        // Level 2: Planned Production vs Planned Downtime
        '<div class="tm-row tm-level-1">' +
          '<div class="tm-label">Planned Production</div>' +
          '<div class="tm-bar-full">' +
            '<div class="tm-bar-seg" style="width:' + pct(plannedProdTime, calendarTime) + ';background:#17a2b8;"></div>' +
          '</div>' +
          '<div class="tm-value">' + fmtDur(plannedProdTime) + ' <small>(' + pct(plannedProdTime, calendarTime) + ')</small></div>' +
        '</div>' +
        '<div class="tm-row tm-level-1">' +
          '<div class="tm-label">Planned Downtime</div>' +
          '<div class="tm-bar-full">' +
            '<div class="tm-bar-seg" style="width:' + pct(plannedDown, calendarTime) + ';background:#6b7c8e;"></div>' +
          '</div>' +
          '<div class="tm-value">' + fmtDur(plannedDown) + ' <small>(' + pct(plannedDown, calendarTime) + ')</small></div>' +
        '</div>' +
        // Level 3: Net Production vs Unplanned Downtime (within Planned Production)
        '<div class="tm-row tm-level-2">' +
          '<div class="tm-label">Net Production</div>' +
          '<div class="tm-bar-full">' +
            '<div class="tm-bar-seg" style="width:' + pct(netProdTime, plannedProdTime) + ';background:#28a745;"></div>' +
          '</div>' +
          '<div class="tm-value">' + fmtDur(netProdTime) + ' <small>(' + pct(netProdTime, plannedProdTime) + ' of planned)</small></div>' +
        '</div>' +
        '<div class="tm-row tm-level-2">' +
          '<div class="tm-label">Unplanned Downtime</div>' +
          '<div class="tm-bar-full">' +
            '<div class="tm-bar-seg" style="width:' + pct(unplannedDown, plannedProdTime) + ';background:#d9363e;"></div>' +
          '</div>' +
          '<div class="tm-value">' + fmtDur(unplannedDown) + ' <small>(' + pct(unplannedDown, plannedProdTime) + ' of planned)</small></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── CSV Export ────────────────────────────────────────────────
  // Stores latest analysis data for export
  let _lastExportData = null;

  function _storeExportData(machine, stateStats, causeStats, oeeResult, tRange, mtbfMttr, teep, microstopResult) {
    _lastExportData = { machine, stateStats, causeStats, oeeResult, tRange, mtbfMttr, teep, microstopResult };
  }

  function _downloadCsv(filename, csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportStatesCsv() {
    if (!_lastExportData) { Utils.toast('No analysis data to export', 'error'); return; }
    const d = _lastExportData;
    const totalSec = (d.tRange.end.getTime() - d.tRange.start.getTime()) / 1000;
    const entries = Object.values(d.stateStats).sort((a, b) => b.totalSeconds - a.totalSeconds);

    let csv = 'State,Category,Duration (s),Percentage (%),Transitions\n';
    entries.forEach(s => {
      const pct = totalSec > 0 ? (s.totalSeconds / totalSec * 100).toFixed(2) : '0';
      csv += '"' + s.label + '","' + s.category + '",' + s.totalSeconds.toFixed(1) + ',' + pct + ',' + s.transitionCount + '\n';
    });
    _downloadCsv('state_analysis_' + _formatFilenameDate(d.tRange) + '.csv', csv);
    Utils.toast('State analysis exported', 'success');
  }

  function exportCausesCsv() {
    if (!_lastExportData || !_lastExportData.causeStats) { Utils.toast('No cause data to export', 'error'); return; }
    const d = _lastExportData;
    const entries = Object.values(d.causeStats)
      .filter(c => c.totalSeconds > 0 || c.occurrences > 0)
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    let csv = 'Cause,Category,Duration (s),Occurrences\n';
    entries.forEach(c => {
      csv += '"' + c.label + '","' + c.category + '",' + c.totalSeconds.toFixed(1) + ',' + c.occurrences + '\n';
    });
    _downloadCsv('cause_analysis_' + _formatFilenameDate(d.tRange) + '.csv', csv);
    Utils.toast('Cause analysis exported', 'success');
  }

  function exportOeeCsv() {
    if (!_lastExportData || !_lastExportData.oeeResult) { Utils.toast('No OEE data to export', 'error'); return; }
    const d = _lastExportData;
    const r = d.oeeResult;
    const fmtPct = (v) => (v * 100).toFixed(2);

    let csv = 'KPI,Value\n';
    csv += 'Machine,"' + d.machine.name + '"\n';
    csv += 'Period Start,"' + d.tRange.start.toISOString() + '"\n';
    csv += 'Period End,"' + d.tRange.end.toISOString() + '"\n';
    csv += 'Availability (%),' + fmtPct(r.availability) + '\n';
    csv += 'Performance (%),' + fmtPct(r.performance) + '\n';
    csv += 'Quality (%),' + fmtPct(r.quality) + '\n';
    csv += 'OEE (%),' + fmtPct(r.oee) + '\n';
    if (d.teep != null) csv += 'TEEP (%),' + fmtPct(d.teep) + '\n';
    if (d.mtbfMttr) {
      csv += 'MTBF (s),' + (d.mtbfMttr.mtbf != null ? d.mtbfMttr.mtbf.toFixed(1) : '') + '\n';
      csv += 'MTTR (s),' + (d.mtbfMttr.mttr != null ? d.mtbfMttr.mttr.toFixed(1) : '') + '\n';
      csv += 'Failure Count,' + d.mtbfMttr.failureCount + '\n';
    }
    if (d.microstopResult && d.microstopResult.microstopCount > 0) {
      csv += 'Microstop Count,' + d.microstopResult.microstopCount + '\n';
      csv += 'Microstop Total (s),' + d.microstopResult.microstopTotalSec.toFixed(1) + '\n';
    }
    csv += 'Producing Time (s),' + r.producingTime.toFixed(1) + '\n';
    csv += 'Unplanned Downtime (s),' + r.unplannedDowntime.toFixed(1) + '\n';
    csv += 'Planned Downtime (s),' + r.plannedDowntime.toFixed(1) + '\n';

    _downloadCsv('oee_summary_' + _formatFilenameDate(d.tRange) + '.csv', csv);
    Utils.toast('OEE summary exported', 'success');
  }

  function _formatFilenameDate(tRange) {
    const fmt = (d) => d.toISOString().slice(0, 10);
    return fmt(tRange.start) + '_to_' + fmt(tRange.end);
  }

  function _renderEmpty(msg) {
    const container = document.getElementById('analysisResults');
    if (container) {
      container.innerHTML = '<div class="analysis-empty">' + Utils.escapeHtml(msg) + '</div>';
    }
  }

  // ── Populate machine select ─────────────────────────────────
  function refreshMachineSelect() {
    const select = document.getElementById('analysisMachineSelect');
    if (!select) return;
    const machines = MachineStateConfig.getAll();
    Utils.populateMachineSelect(select, machines, _currentMachineId);
  }

  // ── Period preset toggle ────────────────────────────────────
  function _onPresetChange() {
    const preset = document.getElementById('analysisPreset').value;
    const customRow = document.getElementById('analysisCustomRange');
    if (customRow) {
      customRow.style.display = preset === 'CUSTOM' ? 'flex' : 'none';
    }
  }

  // ── Time Comparison ────────────────────────────────────────
  async function _refreshTimeComparison() {
    const container = document.getElementById('timeCompareResults');
    if (!container) return;

    const machineId = document.getElementById('analysisMachineSelect')
      ? document.getElementById('analysisMachineSelect').value : null;
    if (!machineId) {
      container.innerHTML = '<div class="analysis-empty">Select a machine to view time comparison.</div>';
      return;
    }

    const machine = MachineStateConfig.getById(machineId);
    if (!machine) {
      container.innerHTML = '<div class="analysis-empty">Machine configuration not found.</div>';
      return;
    }

    const oeeConfigs = OeeConfig.getAll();
    const oeeConf = oeeConfigs.find(o => o.machineRef === machineId) || null;
    if (!oeeConf) {
      container.innerHTML = '<div class="analysis-empty">No OEE configuration found for this machine.</div>';
      return;
    }

    container.innerHTML = '<div class="analysis-empty">Calculating time comparison...</div>';

    // Define 3 periods: Yesterday, Last 7 days, Last 30 days
    const now = new Date();
    const periods = [
      {
        label: 'Yesterday',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      },
      {
        label: 'Last 7 Days',
        start: new Date(now.getTime() - 7 * 86400000),
        end: now,
      },
      {
        label: 'Last 30 Days',
        start: new Date(now.getTime() - 30 * 86400000),
        end: now,
      },
    ];

    // Compute OEE for each period
    const results = [];
    for (const p of periods) {
      const stateHistory = await _queryStateHistory(machine.stateDp, p.start, p.end);
      const stateStats = _computeStateStats(stateHistory, machine.states, p.start, p.end);
      const oeeResult = await _computeOeeFromArchive(oeeConf, machine, stateStats,
        { start: p.start, end: p.end });
      const mtbfMttr = _computeMtbfMttr(stateHistory, machine.states, p.start, p.end);
      results.push({ label: p.label, oee: oeeResult, mtbf: mtbfMttr });
    }

    // Render comparison grid
    const fmtPct = (v) => v != null ? (v * 100).toFixed(1) + '%' : '--';
    const fmtTime = (sec) => {
      if (sec == null) return '--';
      if (sec >= 3600) return (sec / 3600).toFixed(1) + 'h';
      if (sec >= 60) return Math.floor(sec / 60) + 'min';
      return Math.floor(sec) + 's';
    };

    let html = '<div class="analysis-section">' +
      '<h3 class="analysis-title">Time Comparison</h3>' +
      '<p class="analysis-hint">OEE KPIs for yesterday, last 7 days, and last 30 days.</p>' +
      '<div class="time-compare-grid">';

    results.forEach(r => {
      html += '<div class="time-compare-col">' +
        '<h4>' + Utils.escapeHtml(r.label) + '</h4>' +
        _tcRow('OEE', fmtPct(r.oee ? r.oee.oee : null)) +
        _tcRow('Availability', fmtPct(r.oee ? r.oee.availability : null)) +
        _tcRow('Performance', fmtPct(r.oee ? r.oee.performance : null)) +
        _tcRow('Quality', fmtPct(r.oee ? r.oee.quality : null)) +
        _tcRow('MTBF', fmtTime(r.mtbf ? r.mtbf.mtbf : null)) +
        _tcRow('MTTR', fmtTime(r.mtbf ? r.mtbf.mttr : null)) +
        _tcRow('Failures', r.mtbf ? String(r.mtbf.failureCount) : '--') +
      '</div>';
    });

    html += '</div></div>';
    container.innerHTML = html;
  }

  function _tcRow(label, value) {
    return '<div class="tc-kpi-row">' +
      '<span class="tc-kpi-label">' + label + '</span>' +
      '<span class="tc-kpi-value">' + value + '</span>' +
    '</div>';
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    const machineSelect = document.getElementById('analysisMachineSelect');
    const preset = document.getElementById('analysisPreset');
    const btnRefresh = document.getElementById('btnAnalysisRefresh');

    if (machineSelect) machineSelect.addEventListener('change', () => { refresh(); _refreshTimeComparison(); });
    if (preset) preset.addEventListener('change', () => { _onPresetChange(); refresh(); });
    if (btnRefresh) btnRefresh.addEventListener('click', () => { refresh(); _refreshTimeComparison(); });

    // Custom range date inputs
    const startInput = document.getElementById('analysisStart');
    const endInput = document.getElementById('analysisEnd');
    if (startInput) startInput.addEventListener('change', refresh);
    if (endInput) endInput.addEventListener('change', refresh);

    // Analysis view sub-navigation
    document.querySelectorAll('.analysis-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.analysis-view-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.analysis-view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        const viewId = btn.getAttribute('data-view');
        const viewEl = document.getElementById('analysisView' + viewId.charAt(0).toUpperCase() + viewId.slice(1));
        if (viewEl) viewEl.classList.add('active');
      });
    });

    // React to machine config changes
    MachineStateConfig.onChange(() => {
      refreshMachineSelect();
    });
    SourceConfig.onChange(() => {
      // OEE might need source data
    });

    // Initial populate
    refreshMachineSelect();
  }

  return { init, refresh, refreshMachineSelect, exportStatesCsv, exportCausesCsv, exportOeeCsv };
})();
