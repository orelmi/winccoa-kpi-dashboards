/* ═══════════════════════════════════════════════════════════════
   correctionManager.js — Archive value correction management
   ═══════════════════════════════════════════════════════════════
   WinCC OA archive model:
     _original.._value   — raw value written by archiving
     _corr.._value       — corrected value written via dpSetTimed()
     _offline.._value    — abstraction: returns _corr if
                           present, else _original

   This module lets operators:
   1. View original vs corrected values for a source DP
   2. Write corrections at specific timestamps (dpSetTimed)
   3. Trigger KPI recalculation for the corrected period
   ═══════════════════════════════════════════════════════════════ */

const CorrectionManager = (() => {
  'use strict';

  let _currentSourceId = null;
  let _currentDp = null;

  // ── Open the correction modal for a given source ────────────
  function openForSource(sourceId) {
    const src = SourceConfig.getById(sourceId);
    if (!src) return;

    _currentSourceId = sourceId;
    _currentDp = src.dpSource;

    document.getElementById('corrSourceName').textContent = src.name;
    document.getElementById('corrDpName').textContent = src.dpSource;

    // Set default period: last 24h
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    document.getElementById('corrStart').value = _toLocalDatetimeStr(yesterday);
    document.getElementById('corrEnd').value = _toLocalDatetimeStr(now);

    // Clear previous state
    document.getElementById('corrHistoryBody').innerHTML = '';
    document.getElementById('corrSingleTime').value = _toLocalDatetimeStr(now);
    document.getElementById('corrSingleValue').value = '';
    document.getElementById('corrRecalcStatus').innerHTML = '';

    Utils.openModal('modalCorrection');
  }

  // ── Load and display history: original vs correction ────────
  async function loadHistory() {
    const startStr = document.getElementById('corrStart').value;
    const endStr = document.getElementById('corrEnd').value;
    if (!startStr || !endStr || !_currentDp) return;

    const tStart = new Date(startStr);
    const tEnd = new Date(endStr);
    const tbody = document.getElementById('corrHistoryBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7c8e;">Loading...</td></tr>';

    try {
      let rows = [];

      if (KPI.getMode() === 'live') {
        rows = await _loadLiveHistory(_currentDp, tStart, tEnd);
      } else {
        rows = _loadMockHistory(_currentDp, tStart, tEnd);
      }

      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7c8e;">No archive data for this period.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const hasCorr = r.corrected !== null && r.corrected !== undefined;
        const corrClass = hasCorr ? 'corr-changed' : '';
        const effective = hasCorr ? r.corrected : r.original;

        return '<tr class="' + corrClass + '">' +
          '<td>' + _fmtTime(r.time) + '</td>' +
          '<td>' + _fmtVal(r.original) + '</td>' +
          '<td>' + (hasCorr ? '<strong>' + _fmtVal(r.corrected) + '</strong>' : '<span class="text-muted">—</span>') + '</td>' +
          '<td><strong>' + _fmtVal(effective) + '</strong></td>' +
          '<td>' +
            '<button class="btn-icon" onclick="CorrectionManager.editSingle(\'' +
              r.time.toISOString() + '\', ' + effective + ')" title="Correct this value">&#9998;</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#d9363e;">' + Utils.escapeHtml(err.message) + '</td></tr>';
    }
  }

  // ── Live mode: query _original and _corr in parallel ────────
  async function _loadLiveHistory(dp, tStart, tEnd) {
    const [origEntries, corrEntries] = await Promise.all([
      KPI.readOriginalHistory(dp, tStart, tEnd),
      KPI.readCorrectionHistory(dp, tStart, tEnd),
    ]);

    // Build map of corrections by timestamp
    const corrMap = {};
    corrEntries.forEach(entry => {
      const key = entry.time instanceof Date ? entry.time.getTime() : new Date(entry.time).getTime();
      corrMap[key] = entry.value;
    });

    return origEntries.map(entry => {
      const tObj = entry.time instanceof Date ? entry.time : new Date(entry.time);
      const tKey = tObj.getTime();
      return {
        time: tObj,
        original: entry.value,
        corrected: corrMap[tKey] !== undefined ? corrMap[tKey] : null,
      };
    });
  }

  // ── Mock mode: generate plausible original + any saved corrections
  function _loadMockHistory(dp, tStart, tEnd) {
    const rows = [];
    const corrections = KPI.getCorrections(dp);
    const corrMap = {};
    corrections.forEach(c => { corrMap[c.time] = c.value; });

    // Generate mock original data (every 30s)
    let t = new Date(tStart.getTime());
    let val = 100 + Math.random() * 50;
    const isCtr = dp.toLowerCase().includes('counter') || dp.toLowerCase().includes('piece') || dp.toLowerCase().includes('energy');

    while (t.getTime() <= tEnd.getTime()) {
      if (isCtr) {
        val += Math.random() * 5;
      } else {
        val += (Math.random() - 0.5) * 4;
      }

      const tKey = t.getTime();
      rows.push({
        time: new Date(tKey),
        original: Math.round(val * 100) / 100,
        corrected: corrMap[tKey] !== undefined ? corrMap[tKey] : null,
      });

      t = new Date(t.getTime() + 30000);

      // Limit to 200 rows for display
      if (rows.length >= 200) break;
    }

    return rows;
  }

  // ── Edit a single value: pre-fill the correction form ───────
  function editSingle(isoTime, currentValue) {
    const t = new Date(isoTime);
    document.getElementById('corrSingleTime').value = _toLocalDatetimeStr(t);
    document.getElementById('corrSingleValue').value = currentValue;
    document.getElementById('corrSingleValue').focus();
  }

  // ── Apply a single correction ───────────────────────────────
  async function applySingleCorrection() {
    const timeStr = document.getElementById('corrSingleTime').value;
    const valStr = document.getElementById('corrSingleValue').value;
    if (!timeStr || valStr === '' || !_currentDp) return;

    const timestamp = new Date(timeStr);
    const value = parseFloat(valStr);
    if (isNaN(value)) {
      Utils.toast('Invalid value', 'error');
      return;
    }

    try {
      await KPI.writeCorrection(_currentDp, timestamp, value);
      Utils.toast('Correction applied at ' + _fmtTime(timestamp), 'success');
      loadHistory(); // Refresh
    } catch (err) {
      Utils.toast('Correction failed: ' + err.message, 'error');
    }
  }

  // ── Trigger KPI recalculation for the corrected period ──────
  // Writes recalculated KPI results to _corr.._value
  // so that _offline reads return the corrected KPI values.
  async function triggerRecalculation() {
    const statusEl = document.getElementById('corrRecalcStatus');
    const startStr = document.getElementById('corrStart').value;
    const endStr = document.getElementById('corrEnd').value;
    if (!startStr || !endStr || !_currentSourceId) return;

    const tStart = new Date(startStr);
    const tEnd = new Date(endStr);

    statusEl.innerHTML = '<span class="text-muted">Recalculating KPIs...</span>';

    try {
      // Find all aggregations that reference this source
      const aggregations = AggregationConfig.getAll();
      const affectedAggs = aggregations.filter(a => a.sourceRef === _currentSourceId && a.enabled);

      // Find all OEE configs that reference this source (pieces, good, reject)
      const oeeConfigs = OeeConfig.getAll();
      const affectedOees = oeeConfigs.filter(o => o.enabled && (
        o.piecesSourceRef === _currentSourceId ||
        o.goodSourceRef === _currentSourceId ||
        o.rejectSourceRef === _currentSourceId
      ));

      if (affectedAggs.length === 0 && affectedOees.length === 0) {
        statusEl.innerHTML = '<span class="text-muted">No active aggregations or OEE configs reference this source.</span>';
        return;
      }

      // Request KPI recalculation via CTRL engines
      await KPI.requestRecalculation({
        sourceId: _currentSourceId,
        sourceDp: _currentDp,
        periodStart: tStart.toISOString(),
        periodEnd: tEnd.toISOString(),
        aggregationIds: affectedAggs.map(a => a.id),
      });

      // Build status display
      let details = '';
      if (affectedAggs.length > 0) {
        details += 'Affected KPIs: <strong>' + affectedAggs.map(a => a.name).join(', ') + '</strong><br>';
      }
      if (affectedOees.length > 0) {
        details += 'Affected OEE: <strong>' + affectedOees.map(o => o.name).join(', ') + '</strong><br>';
      }

      const totalCount = affectedAggs.length + affectedOees.length;
      statusEl.innerHTML =
        '<span class="tag tag-enabled">Recalculation requested</span>' +
        '<p style="margin-top:6px;font-size:12px;">' +
          details +
          'Period: ' + _fmtTime(tStart) + ' — ' + _fmtTime(tEnd) + '<br>' +
          'The CTRL engines will recompute from <code>_offline</code> (which now includes corrections) ' +
          'and write results into <code>_corr.._value</code> of the target DPs.' +
        '</p>';

      Utils.toast(totalCount + ' KPI/OEE config(s) marked for recalculation', 'success');
    } catch (err) {
      statusEl.innerHTML = '<span style="color:#d9363e;">Error: ' + Utils.escapeHtml(err.message) + '</span>';
    }
  }

  // ── Helpers ─────────────────────────────────────────────────
  function _fmtTime(d) {
    if (!(d instanceof Date)) d = new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function _fmtVal(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return v.toFixed(2);
    return String(v);
  }

  function _toLocalDatetimeStr(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    const btnLoad = document.getElementById('btnCorrLoadHistory');
    const btnApply = document.getElementById('btnCorrApply');
    const btnRecalc = document.getElementById('btnCorrRecalc');

    if (btnLoad) btnLoad.addEventListener('click', loadHistory);
    if (btnApply) btnApply.addEventListener('click', applySingleCorrection);
    if (btnRecalc) btnRecalc.addEventListener('click', triggerRecalculation);
  }

  return { init, openForSource, loadHistory, editSingle, applySingleCorrection, triggerRecalculation };
})();
