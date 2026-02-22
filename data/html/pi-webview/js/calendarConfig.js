/* ═══════════════════════════════════════════════════════════════
   calendarConfig.js — Production Calendar / Shift Configuration
   ═══════════════════════════════════════════════════════════════
   Defines shift schedules, production periods, maintenance windows,
   and holiday/exception days.

   Optional: can be connected to an external MES/ERP system via
   predefined connectors (SAP, SQL, CSV import).

   Calendar data is used by:
   - OEE engine to determine planned production time per shift
   - Aggregation engine for shift-aligned periods
   - Time model for accurate planned vs actual breakdown
   ═══════════════════════════════════════════════════════════════ */

const CalendarConfig = (() => {
  'use strict';

  let _calendar = {
    shifts: [],
    exceptions: [],
    connector: null,
  };
  let _onChangeCallbacks = [];

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('calendar');
    if (data && typeof data === 'object') {
      _calendar = {
        shifts: Array.isArray(data.shifts) ? data.shifts : [],
        exceptions: Array.isArray(data.exceptions) ? data.exceptions : [],
        connector: data.connector || null,
      };
    }
    render();
    _notifyChange();
  }

  async function save() {
    await KPI.saveConfig('calendar', _calendar);
  }

  function getAll() { return JSON.parse(JSON.stringify(_calendar)); }
  function getShifts() { return _calendar.shifts.slice(); }
  function getExceptions() { return _calendar.exceptions.slice(); }
  function getConnector() { return _calendar.connector; }

  function onChange(cb) { _onChangeCallbacks.push(cb); }
  function _notifyChange() { _onChangeCallbacks.forEach(cb => cb(_calendar)); }

  // ── Resolve time category for a given datetime ──────────────
  // Returns the active shift or exception for the given timestamp.
  function resolveTimeCategory(datetime) {
    const d = datetime instanceof Date ? datetime : new Date(datetime);
    const dateStr = d.toISOString().slice(0, 10);

    // Check exceptions first (holidays, special days)
    const exception = _calendar.exceptions.find(ex => {
      if (ex.date === dateStr) return true;
      if (ex.recurring && ex.recurringMonth === (d.getMonth() + 1) && ex.recurringDay === d.getDate()) return true;
      return false;
    });
    if (exception) {
      return { type: 'EXCEPTION', label: exception.name, category: exception.category };
    }

    // Check day of week
    const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ...
    const timeMinutes = d.getHours() * 60 + d.getMinutes();

    // Find matching shift
    for (const shift of _calendar.shifts) {
      if (!shift.enabled) continue;
      if (!shift.days || !shift.days.includes(dayOfWeek)) continue;

      const shiftStart = _parseTimeToMinutes(shift.startTime);
      let shiftEnd = _parseTimeToMinutes(shift.endTime);

      // Handle overnight shifts (e.g. 22:00 - 06:00)
      if (shiftEnd <= shiftStart) {
        if (timeMinutes >= shiftStart || timeMinutes < shiftEnd) {
          return { type: 'SHIFT', label: shift.name, category: shift.category, shiftId: shift.id };
        }
      } else {
        if (timeMinutes >= shiftStart && timeMinutes < shiftEnd) {
          return { type: 'SHIFT', label: shift.name, category: shift.category, shiftId: shift.id };
        }
      }
    }

    // No matching shift = non-production time
    return { type: 'NONE', label: 'Non-Production', category: 'NON_PRODUCTION' };
  }

  function _parseTimeToMinutes(timeStr) {
    const parts = (timeStr || '00:00').split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
  }

  // ── Render ─────────────────────────────────────────────────
  function render() {
    const shiftContainer = document.getElementById('calendarShiftList');
    if (!shiftContainer) return; // Data-only mode

    const emptyShift = document.getElementById('calendarShiftEmpty');
    const exContainer = document.getElementById('calendarExceptionList');
    const emptyEx = document.getElementById('calendarExceptionEmpty');

    // Render shifts
    if (_calendar.shifts.length === 0) {
      shiftContainer.innerHTML = '';
      emptyShift.style.display = 'block';
    } else {
      emptyShift.style.display = 'none';
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      shiftContainer.innerHTML = _calendar.shifts.map(s => {
        const daysStr = (s.days || []).map(d => dayLabels[d]).join(', ');
        const catLabel = SHIFT_CATEGORIES[s.category] || s.category;
        const enabledBadge = s.enabled
          ? '<span class="tag tag-enabled">ON</span>'
          : '<span class="tag tag-disabled">OFF</span>';

        return '<div class="machine-card">' +
          '<div class="machine-card-header">' +
            '<h3>' + Utils.escapeHtml(s.name) + ' ' + enabledBadge + '</h3>' +
            '<div>' +
              '<button class="btn-icon" onclick="CalendarConfig.editShift(\'' + s.id + '\')" title="Edit">&#9998;</button>' +
              '<button class="btn-icon danger" onclick="CalendarConfig.removeShift(\'' + s.id + '\')" title="Delete">&#128465;</button>' +
            '</div>' +
          '</div>' +
          '<div class="machine-card-body">' +
            '<p style="font-size:12px;color:#6b7c8e;">' +
              '<strong>' + Utils.escapeHtml(s.startTime) + ' — ' + Utils.escapeHtml(s.endTime) + '</strong>' +
              ' | ' + Utils.escapeHtml(daysStr) +
              ' | Category: <strong>' + Utils.escapeHtml(catLabel) + '</strong>' +
            '</p>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Render exceptions
    if (_calendar.exceptions.length === 0) {
      exContainer.innerHTML = '';
      emptyEx.style.display = 'block';
    } else {
      emptyEx.style.display = 'none';
      exContainer.innerHTML = _calendar.exceptions.map(ex => {
        const recurLabel = ex.recurring ? ' (recurring)' : '';
        const catLabel = EXCEPTION_CATEGORIES[ex.category] || ex.category;
        return '<tr>' +
          '<td><strong>' + Utils.escapeHtml(ex.name) + '</strong></td>' +
          '<td>' + Utils.escapeHtml(ex.date || '-') + recurLabel + '</td>' +
          '<td>' + Utils.escapeHtml(catLabel) + '</td>' +
          '<td class="actions">' +
            '<button class="btn-icon" onclick="CalendarConfig.editException(\'' + ex.id + '\')" title="Edit">&#9998;</button>' +
            '<button class="btn-icon danger" onclick="CalendarConfig.removeException(\'' + ex.id + '\')" title="Delete">&#128465;</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    // Render connector status
    _renderConnectorStatus();
  }

  // ── Shift CRUD ────────────────────────────────────────────
  const SHIFT_CATEGORIES = {
    PRODUCTION: 'Production',
    MAINTENANCE: 'Planned Maintenance',
    CLEANING: 'Cleaning',
    CHANGEOVER: 'Changeover',
    NON_PRODUCTION: 'Non-Production',
  };

  const EXCEPTION_CATEGORIES = {
    HOLIDAY: 'Public Holiday',
    PLANT_SHUTDOWN: 'Plant Shutdown',
    SPECIAL_MAINTENANCE: 'Special Maintenance',
    OVERTIME: 'Overtime / Extra Shift',
    OTHER: 'Other',
  };

  function openAddShift() {
    document.getElementById('modalShiftTitle').textContent = 'Add Shift';
    document.getElementById('formShift').reset();
    document.getElementById('shiftEditId').value = '';
    document.getElementById('shiftEnabled').checked = true;
    // Default: Mon-Fri checked
    [1, 2, 3, 4, 5].forEach(d => {
      const cb = document.getElementById('shiftDay' + d);
      if (cb) cb.checked = true;
    });
    [0, 6].forEach(d => {
      const cb = document.getElementById('shiftDay' + d);
      if (cb) cb.checked = false;
    });
    Utils.openModal('modalShift');
  }

  function editShift(id) {
    const s = _calendar.shifts.find(x => x.id === id);
    if (!s) return;
    document.getElementById('modalShiftTitle').textContent = 'Edit Shift';
    document.getElementById('shiftEditId').value = id;
    document.getElementById('shiftName').value = s.name;
    document.getElementById('shiftStart').value = s.startTime;
    document.getElementById('shiftEnd').value = s.endTime;
    document.getElementById('shiftCategory').value = s.category || 'PRODUCTION';
    document.getElementById('shiftEnabled').checked = s.enabled !== false;
    for (let d = 0; d <= 6; d++) {
      const cb = document.getElementById('shiftDay' + d);
      if (cb) cb.checked = (s.days || []).includes(d);
    }
    Utils.openModal('modalShift');
  }

  async function saveShiftFromForm(e) {
    e.preventDefault();
    const editId = document.getElementById('shiftEditId').value;
    const days = [];
    for (let d = 0; d <= 6; d++) {
      const cb = document.getElementById('shiftDay' + d);
      if (cb && cb.checked) days.push(d);
    }

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('shiftName').value.trim(),
      startTime: document.getElementById('shiftStart').value,
      endTime: document.getElementById('shiftEnd').value,
      category: document.getElementById('shiftCategory').value,
      days: days,
      enabled: document.getElementById('shiftEnabled').checked,
    };

    if (editId) {
      const idx = _calendar.shifts.findIndex(x => x.id === editId);
      if (idx >= 0) _calendar.shifts[idx] = data;
    } else {
      _calendar.shifts.push(data);
    }

    await save();
    render();
    _notifyChange();
    Utils.closeModal('modalShift');
    Utils.toast('Shift "' + data.name + '" saved', 'success');
    if (typeof EventLog !== 'undefined') EventLog.log(editId ? 'update' : 'create', 'calendar', data.name, 'shift ' + data.startTime + '-' + data.endTime);
  }

  async function removeShift(id) {
    const s = _calendar.shifts.find(x => x.id === id);
    if (!s || !confirm('Delete shift "' + s.name + '"?')) return;
    _calendar.shifts = _calendar.shifts.filter(x => x.id !== id);
    await save();
    render();
    _notifyChange();
    Utils.toast('Shift deleted', 'info');
    if (typeof EventLog !== 'undefined') EventLog.log('delete', 'calendar', s.name, 'shift');
  }

  // ── Exception CRUD ────────────────────────────────────────
  function openAddException() {
    document.getElementById('modalExceptionTitle').textContent = 'Add Exception';
    document.getElementById('formException').reset();
    document.getElementById('exEditId').value = '';
    Utils.openModal('modalException');
  }

  function editException(id) {
    const ex = _calendar.exceptions.find(x => x.id === id);
    if (!ex) return;
    document.getElementById('modalExceptionTitle').textContent = 'Edit Exception';
    document.getElementById('exEditId').value = id;
    document.getElementById('exName').value = ex.name;
    document.getElementById('exDate').value = ex.date || '';
    document.getElementById('exCategory').value = ex.category || 'HOLIDAY';
    document.getElementById('exRecurring').checked = !!ex.recurring;
    Utils.openModal('modalException');
  }

  async function saveExceptionFromForm(e) {
    e.preventDefault();
    const editId = document.getElementById('exEditId').value;
    const dateVal = document.getElementById('exDate').value;
    const d = dateVal ? new Date(dateVal) : null;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('exName').value.trim(),
      date: dateVal || null,
      category: document.getElementById('exCategory').value,
      recurring: document.getElementById('exRecurring').checked,
      recurringMonth: d ? d.getMonth() + 1 : null,
      recurringDay: d ? d.getDate() : null,
    };

    if (editId) {
      const idx = _calendar.exceptions.findIndex(x => x.id === editId);
      if (idx >= 0) _calendar.exceptions[idx] = data;
    } else {
      _calendar.exceptions.push(data);
    }

    await save();
    render();
    _notifyChange();
    Utils.closeModal('modalException');
    Utils.toast('Exception "' + data.name + '" saved', 'success');
    if (typeof EventLog !== 'undefined') EventLog.log(editId ? 'update' : 'create', 'calendar', data.name, 'exception ' + (data.date || 'recurring'));
  }

  async function removeException(id) {
    const ex = _calendar.exceptions.find(x => x.id === id);
    if (!ex || !confirm('Delete exception "' + ex.name + '"?')) return;
    _calendar.exceptions = _calendar.exceptions.filter(x => x.id !== id);
    await save();
    render();
    _notifyChange();
    Utils.toast('Exception deleted', 'info');
    if (typeof EventLog !== 'undefined') EventLog.log('delete', 'calendar', ex.name, 'exception');
  }

  // ── External Connector ────────────────────────────────────
  // Predefined mappings for MES/ERP/DB calendar import
  const CONNECTOR_TYPES = {
    NONE: { label: 'None (manual)', description: 'Calendar is configured manually in this UI.' },
    SAP_PP: {
      label: 'SAP PP (Production Planning)',
      description: 'Reads shift calendar from SAP PP via RFC/BAPI. Requires SAP connector config.',
      fields: [
        { key: 'sapHost', label: 'SAP Host', type: 'text' },
        { key: 'sapClient', label: 'Client', type: 'text' },
        { key: 'sapUser', label: 'User', type: 'text' },
        { key: 'factoryCalendarId', label: 'Factory Calendar ID', type: 'text' },
      ],
    },
    SQL_DATABASE: {
      label: 'SQL Database',
      description: 'Reads shift definitions from a SQL table. Supports SQL Server, PostgreSQL, Oracle.',
      fields: [
        { key: 'connectionString', label: 'Connection String', type: 'text' },
        { key: 'shiftTable', label: 'Shift Table', type: 'text', placeholder: 'e.g. dbo.ShiftCalendar' },
        { key: 'shiftNameCol', label: 'Shift Name Column', type: 'text', placeholder: 'e.g. ShiftName' },
        { key: 'startTimeCol', label: 'Start Time Column', type: 'text', placeholder: 'e.g. StartTime' },
        { key: 'endTimeCol', label: 'End Time Column', type: 'text', placeholder: 'e.g. EndTime' },
        { key: 'syncIntervalMin', label: 'Sync Interval (min)', type: 'number', placeholder: '60' },
      ],
    },
    CSV_IMPORT: {
      label: 'CSV File Import',
      description: 'Import shift calendar from a CSV file. Columns: Name, StartTime, EndTime, Days, Category.',
      fields: [
        { key: 'filePath', label: 'CSV File Path', type: 'text', placeholder: '/data/calendar.csv' },
        { key: 'delimiter', label: 'Delimiter', type: 'text', placeholder: ',' },
        { key: 'autoReload', label: 'Auto-reload on change', type: 'checkbox' },
      ],
    },
    OPC_UA: {
      label: 'OPC UA Calendar Node',
      description: 'Reads production calendar from an OPC UA server (e.g., MES system).',
      fields: [
        { key: 'opcuaEndpoint', label: 'OPC UA Endpoint', type: 'text', placeholder: 'opc.tcp://mes-server:4840' },
        { key: 'calendarNodeId', label: 'Calendar Node ID', type: 'text', placeholder: 'ns=2;s=ProductionCalendar' },
        { key: 'syncIntervalMin', label: 'Sync Interval (min)', type: 'number', placeholder: '30' },
      ],
    },
    REST_API: {
      label: 'REST API (MES/ERP)',
      description: 'Fetches calendar data from a REST API endpoint (JSON). Suitable for modern MES systems.',
      fields: [
        { key: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'https://mes.local/api/v1/calendar' },
        { key: 'apiKey', label: 'API Key (header)', type: 'text' },
        { key: 'syncIntervalMin', label: 'Sync Interval (min)', type: 'number', placeholder: '60' },
        { key: 'shiftJsonPath', label: 'Shifts JSON Path', type: 'text', placeholder: '$.data.shifts' },
      ],
    },
  };

  function _renderConnectorStatus() {
    const container = document.getElementById('connectorStatus');
    if (!container) return;

    const conn = _calendar.connector;
    if (!conn || conn.type === 'NONE') {
      container.innerHTML = '<p class="form-hint">No external connector configured. Calendar is managed manually.</p>';
      return;
    }

    const typeDef = CONNECTOR_TYPES[conn.type];
    const label = typeDef ? typeDef.label : conn.type;

    container.innerHTML =
      '<div style="padding:10px 14px;background:var(--primary-light);border-left:3px solid var(--primary);border-radius:0 var(--radius) var(--radius) 0;margin-top:8px;">' +
        '<p style="font-size:13px;"><strong>Connector:</strong> ' + Utils.escapeHtml(label) + '</p>' +
        '<p class="form-hint">' + Utils.escapeHtml(typeDef ? typeDef.description : '') + '</p>' +
        (conn.lastSync ? '<p class="form-hint">Last sync: ' + Utils.escapeHtml(conn.lastSync) + '</p>' : '') +
      '</div>';
  }

  function openConnectorConfig() {
    const select = document.getElementById('connectorType');
    const conn = _calendar.connector || { type: 'NONE' };
    select.value = conn.type || 'NONE';
    _renderConnectorFields(conn);
    Utils.openModal('modalConnector');
  }

  function _renderConnectorFields(conn) {
    const container = document.getElementById('connectorFields');
    const typeDef = CONNECTOR_TYPES[conn.type || 'NONE'];

    if (!typeDef || !typeDef.fields) {
      container.innerHTML = '<p class="form-hint">No additional configuration needed.</p>';
      return;
    }

    container.innerHTML = typeDef.fields.map(f => {
      const val = conn[f.key] || '';
      if (f.type === 'checkbox') {
        return '<div class="form-group">' +
          '<label class="checkbox-label"><input type="checkbox" class="conn-field" data-key="' + f.key + '" ' +
            (val ? 'checked' : '') + '> ' + Utils.escapeHtml(f.label) + '</label>' +
        '</div>';
      }
      return '<div class="form-group">' +
        '<label>' + Utils.escapeHtml(f.label) + '</label>' +
        '<input type="' + f.type + '" class="conn-field" data-key="' + f.key + '" ' +
          'value="' + Utils.escapeHtml(val) + '" ' +
          (f.placeholder ? 'placeholder="' + Utils.escapeHtml(f.placeholder) + '"' : '') + '>' +
      '</div>';
    }).join('');
  }

  function _onConnectorTypeChange() {
    const type = document.getElementById('connectorType').value;
    _renderConnectorFields({ type: type });
  }

  async function saveConnectorFromForm(e) {
    e.preventDefault();
    const type = document.getElementById('connectorType').value;
    const conn = { type: type };

    document.querySelectorAll('.conn-field').forEach(el => {
      const key = el.getAttribute('data-key');
      if (el.type === 'checkbox') {
        conn[key] = el.checked;
      } else {
        conn[key] = el.value.trim();
      }
    });

    _calendar.connector = type === 'NONE' ? null : conn;
    await save();
    render();
    _notifyChange();
    Utils.closeModal('modalConnector');
    Utils.toast('Connector configuration saved', 'success');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    const btnShift = document.getElementById('btnAddShift');
    if (btnShift) {
      btnShift.addEventListener('click', openAddShift);
      document.getElementById('formShift').addEventListener('submit', saveShiftFromForm);
      document.getElementById('btnAddException').addEventListener('click', openAddException);
      document.getElementById('formException').addEventListener('submit', saveExceptionFromForm);
      document.getElementById('btnConfigConnector').addEventListener('click', openConnectorConfig);
      document.getElementById('connectorType').addEventListener('change', _onConnectorTypeChange);
      document.getElementById('formConnector').addEventListener('submit', saveConnectorFromForm);
    }
    load();
  }

  return {
    init, load, getAll, getShifts, getExceptions, getConnector,
    resolveTimeCategory, onChange,
    editShift, removeShift, editException, removeException,
    SHIFT_CATEGORIES, EXCEPTION_CATEGORIES, CONNECTOR_TYPES,
  };
})();
