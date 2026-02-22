/* ═══════════════════════════════════════════════════════════════
   eventLog.js — Event log / audit trail
   ═══════════════════════════════════════════════════════════════
   Records configuration changes and user actions for traceability.
   Each event stores: timestamp, action, module, item name, details.

   Events are persisted in KPI_Config.eventLog (or localStorage).
   Max 500 events retained (oldest are pruned).
   ═══════════════════════════════════════════════════════════════ */

const EventLog = (() => {
  'use strict';

  const MAX_EVENTS = 500;
  let _events = [];

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('eventLog');
    _events = Array.isArray(data) ? data : [];
    render();
  }

  async function save() {
    // Prune to max events
    if (_events.length > MAX_EVENTS) {
      _events = _events.slice(_events.length - MAX_EVENTS);
    }
    await KPI.saveConfig('eventLog', _events);
  }

  function getAll() { return _events.slice(); }

  // ── Log an event ──────────────────────────────────────────
  // action: 'create', 'update', 'delete', 'correction', 'recalc', etc.
  // module: 'sources', 'machines', 'oee', 'aggregations', 'calendar', 'assets'
  async function log(action, module, itemName, details) {
    const event = {
      id: _generateEventId(),
      timestamp: new Date().toISOString(),
      action: action,
      module: module,
      item: itemName || '',
      details: details || '',
    };
    _events.push(event);
    await save();
    render();
  }

  function _generateEventId() {
    return 'evt_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  // ── Clear log ─────────────────────────────────────────────
  async function clear() {
    if (!confirm('Clear all event log entries?')) return;
    _events = [];
    await save();
    render();
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    const tbody = document.getElementById('eventLogBody');
    if (!tbody) return; // Data-only mode

    const empty = document.getElementById('eventLogEmpty');
    const table = document.getElementById('eventLogTable');

    if (_events.length === 0) {
      if (table) table.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (table) table.style.display = 'table';
    if (empty) empty.style.display = 'none';

    // Show most recent first
    const reversed = _events.slice().reverse();

    // Apply filter
    const filterEl = document.getElementById('eventLogFilter');
    const filter = filterEl ? filterEl.value : '';

    let filtered = reversed;
    if (filter) {
      filtered = reversed.filter(function(e) {
        return e.module === filter;
      });
    }

    tbody.innerHTML = filtered.map(function(e) {
      const dt = new Date(e.timestamp);
      const timeStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString();
      const actionBadge = _actionBadge(e.action);

      return '<tr>' +
        '<td style="white-space:nowrap;font-size:12px;">' + Utils.escapeHtml(timeStr) + '</td>' +
        '<td>' + actionBadge + '</td>' +
        '<td><span class="tag">' + Utils.escapeHtml(e.module) + '</span></td>' +
        '<td>' + Utils.escapeHtml(e.item) + '</td>' +
        '<td style="font-size:12px;color:#6b7c8e;">' + Utils.escapeHtml(e.details) + '</td>' +
        '</tr>';
    }).join('');
  }

  function _actionBadge(action) {
    var cls = 'tag';
    if (action === 'create') cls += ' tag-enabled';
    else if (action === 'delete') cls += ' tag-disabled';
    else if (action === 'update') cls += ' tag-warning';
    else if (action === 'correction') cls += ' tag-warning';
    return '<span class="' + cls + '">' + Utils.escapeHtml(action) + '</span>';
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    var btnClear = document.getElementById('btnClearEventLog');
    if (btnClear) {
      btnClear.addEventListener('click', clear);
    }
    var filterEl = document.getElementById('eventLogFilter');
    if (filterEl) {
      filterEl.addEventListener('change', render);
    }
    load();
  }

  return { init, load, log, getAll, clear, render };
})();
