/* ═══════════════════════════════════════════════════════════════
   machineStateConfig.js — Machine state definitions, downtime
   cause tracking, state categorization for OEE
   ═══════════════════════════════════════════════════════════════ */

const MachineStateConfig = (() => {
  'use strict';

  let _machines = [];
  let _onChangeCallbacks = [];

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('machines');
    _machines = Array.isArray(data) ? data : [];
    render();
    _notifyChange();
  }

  async function save() {
    await KPI.saveConfig('machines', _machines);
  }

  function getAll() { return _machines.slice(); }
  function getById(id) { return _machines.find(m => m.id === id) || null; }

  function onChange(cb) { _onChangeCallbacks.push(cb); }
  function _notifyChange() { _onChangeCallbacks.forEach(cb => cb(_machines)); }

  // ── Default states preset ───────────────────────────────────
  const DEFAULT_STATES = [
    { value: '0', label: 'Stopped', category: 'UNPLANNED_STOP', color: '#d9363e', isPlanned: false },
    { value: '1', label: 'Producing', category: 'PRODUCING', color: '#28a745', isPlanned: false },
    { value: '2', label: 'Idle', category: 'IDLE', color: '#ffc107', isPlanned: false },
    { value: '3', label: 'Setup / Changeover', category: 'SETUP', color: '#6f42c1', isPlanned: true },
    { value: '4', label: 'Planned Maintenance', category: 'MAINTENANCE', color: '#fd7e14', isPlanned: true },
    { value: '5', label: 'Planned Stop', category: 'PLANNED_STOP', color: '#17a2b8', isPlanned: true },
  ];

  const DEFAULT_CAUSES = [
    { code: '1', label: 'Mechanical failure', category: 'MECHANICAL' },
    { code: '2', label: 'Electrical failure', category: 'ELECTRICAL' },
    { code: '3', label: 'Material jam', category: 'PROCESS' },
    { code: '4', label: 'Operator error', category: 'OPERATOR' },
    { code: '5', label: 'Quality issue', category: 'QUALITY' },
    { code: '6', label: 'No material supply', category: 'SUPPLY' },
    { code: '7', label: 'Shift break', category: 'PLANNED' },
    { code: '8', label: 'Planned maintenance', category: 'PLANNED' },
    { code: '0', label: 'Unknown / Other', category: 'OTHER' },
  ];

  // ── Render machine list ─────────────────────────────────────
  function render() {
    const container = document.getElementById('machineList');
    if (!container) return; // Data-only mode: no DOM on this page
    const empty = document.getElementById('machineEmpty');

    if (_machines.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    container.innerHTML = _machines.map(m => {
      const stateChips = (m.states || []).map(st => {
        return '<span class="state-chip">' +
          '<span class="state-dot" style="background:' + Utils.escapeHtml(st.color) + '"></span>' +
          Utils.escapeHtml(st.label) + ' <small>(' + Utils.escapeHtml(st.value) + ')</small>' +
          '</span>';
      }).join('');

      const causeInfo = m.trackCauses
        ? '<p style="margin-top:8px;font-size:12px;color:#6b7c8e;">Cause tracking: <strong>enabled</strong> — ' +
          (m.causes || []).length + ' causes defined</p>'
        : '';

      return '<div class="machine-card">' +
        '<div class="machine-card-header">' +
          '<h3>' + Utils.escapeHtml(m.name) + '</h3>' +
          '<div>' +
            '<button class="btn-icon" onclick="MachineStateConfig.exportGantt(\'' + m.id + '\')" title="Export Gantt mapping for Dashboard">&#128202;</button>' +
            '<button class="btn-icon" onclick="MachineStateConfig.edit(\'' + m.id + '\')" title="Edit">&#9998;</button>' +
            '<button class="btn-icon danger" onclick="MachineStateConfig.remove(\'' + m.id + '\')" title="Delete">&#128465;</button>' +
          '</div>' +
        '</div>' +
        '<div class="machine-card-body">' +
          '<p style="font-size:12px;color:#6b7c8e;margin-bottom:8px;">DP: <code>' + Utils.escapeHtml(m.stateDp) + '</code> | Type: ' + Utils.escapeHtml(m.stateType) + '</p>' +
          '<div class="state-list">' + stateChips + '</div>' +
          causeInfo +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── State definition rows in modal ──────────────────────────
  function _renderStateRows(states) {
    const tbody = document.getElementById('stateDefBody');
    tbody.innerHTML = (states || []).map((st, i) => {
      const catOptions = Object.entries(Utils.STATE_CATEGORIES).map(([key, cat]) => {
        const sel = st.category === key ? ' selected' : '';
        return '<option value="' + key + '"' + sel + '>' + cat.label + '</option>';
      }).join('');

      return '<tr>' +
        '<td><input type="text" class="state-val" value="' + Utils.escapeHtml(st.value) + '" style="width:60px;padding:4px 6px;font-size:12px;"></td>' +
        '<td><input type="text" class="state-label" value="' + Utils.escapeHtml(st.label) + '" style="width:140px;padding:4px 6px;font-size:12px;"></td>' +
        '<td><select class="state-cat" style="padding:4px 6px;font-size:12px;">' + catOptions + '</select></td>' +
        '<td><input type="color" class="state-color" value="' + (st.color || '#cccccc') + '"></td>' +
        '<td><input type="checkbox" class="state-planned" ' + (st.isPlanned ? 'checked' : '') + '></td>' +
        '<td><button type="button" class="btn-icon danger" onclick="MachineStateConfig.removeStateRow(this)">&#128465;</button></td>' +
      '</tr>';
    }).join('');
  }

  function addStateRow() {
    const tbody = document.getElementById('stateDefBody');
    const idx = tbody.rows.length;
    const catOptions = Object.entries(Utils.STATE_CATEGORIES).map(([key, cat]) => {
      return '<option value="' + key + '">' + cat.label + '</option>';
    }).join('');

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" class="state-val" value="' + idx + '" style="width:60px;padding:4px 6px;font-size:12px;"></td>' +
      '<td><input type="text" class="state-label" value="" placeholder="State name" style="width:140px;padding:4px 6px;font-size:12px;"></td>' +
      '<td><select class="state-cat" style="padding:4px 6px;font-size:12px;">' + catOptions + '</select></td>' +
      '<td><input type="color" class="state-color" value="#cccccc"></td>' +
      '<td><input type="checkbox" class="state-planned"></td>' +
      '<td><button type="button" class="btn-icon danger" onclick="MachineStateConfig.removeStateRow(this)">&#128465;</button></td>';
    tbody.appendChild(tr);
  }

  function removeStateRow(btn) {
    btn.closest('tr').remove();
  }

  // ── Cause definition rows in modal ──────────────────────────
  function _renderCauseRows(causes) {
    const tbody = document.getElementById('causeDefBody');
    const allCauses = causes || [];

    tbody.innerHTML = allCauses.map((c) => {
      const catOptions = Object.entries(Utils.CAUSE_CATEGORIES).map(([key, label]) => {
        const sel = c.category === key ? ' selected' : '';
        return '<option value="' + key + '"' + sel + '>' + label + '</option>';
      }).join('');

      // Parent code selector — allows building a tree of causes
      const parentOptions = '<option value="">(root)</option>' +
        allCauses.filter(pc => pc.code !== c.code).map(pc => {
          const sel = c.parentCode === pc.code ? ' selected' : '';
          return '<option value="' + Utils.escapeHtml(pc.code) + '"' + sel + '>' +
            Utils.escapeHtml(pc.code + ' — ' + pc.label) + '</option>';
        }).join('');

      return '<tr>' +
        '<td><input type="text" class="cause-code" value="' + Utils.escapeHtml(c.code) + '" style="width:60px;padding:4px 6px;font-size:12px;"></td>' +
        '<td><input type="text" class="cause-label" value="' + Utils.escapeHtml(c.label) + '" style="width:140px;padding:4px 6px;font-size:12px;"></td>' +
        '<td><select class="cause-cat" style="padding:4px 6px;font-size:12px;">' + catOptions + '</select></td>' +
        '<td><select class="cause-parent" style="padding:4px 6px;font-size:12px;">' + parentOptions + '</select></td>' +
        '<td><button type="button" class="btn-icon danger" onclick="MachineStateConfig.removeCauseRow(this)">&#128465;</button></td>' +
      '</tr>';
    }).join('');
  }

  function addCauseRow() {
    const tbody = document.getElementById('causeDefBody');
    const catOptions = Object.entries(Utils.CAUSE_CATEGORIES).map(([key, label]) => {
      return '<option value="' + key + '">' + label + '</option>';
    }).join('');

    // Build parent options from existing rows
    const existingCodes = Array.from(tbody.querySelectorAll('.cause-code')).map(input => ({
      code: input.value.trim(),
      label: input.closest('tr').querySelector('.cause-label').value.trim(),
    })).filter(c => c.code);
    const parentOptions = '<option value="">(root)</option>' +
      existingCodes.map(pc => '<option value="' + Utils.escapeHtml(pc.code) + '">' +
        Utils.escapeHtml(pc.code + ' — ' + pc.label) + '</option>').join('');

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" class="cause-code" value="" placeholder="Code" style="width:60px;padding:4px 6px;font-size:12px;"></td>' +
      '<td><input type="text" class="cause-label" value="" placeholder="Cause label" style="width:140px;padding:4px 6px;font-size:12px;"></td>' +
      '<td><select class="cause-cat" style="padding:4px 6px;font-size:12px;">' + catOptions + '</select></td>' +
      '<td><select class="cause-parent" style="padding:4px 6px;font-size:12px;">' + parentOptions + '</select></td>' +
      '<td><button type="button" class="btn-icon danger" onclick="MachineStateConfig.removeCauseRow(this)">&#128465;</button></td>';
    tbody.appendChild(tr);
  }

  function removeCauseRow(btn) {
    btn.closest('tr').remove();
  }

  // ── Collect state definitions from modal table ──────────────
  function _collectStatesFromModal() {
    const rows = document.querySelectorAll('#stateDefBody tr');
    return Array.from(rows).map(row => ({
      value: row.querySelector('.state-val').value.trim(),
      label: row.querySelector('.state-label').value.trim(),
      category: row.querySelector('.state-cat').value,
      color: row.querySelector('.state-color').value,
      isPlanned: row.querySelector('.state-planned').checked,
    })).filter(s => s.label);
  }

  function _collectCausesFromModal() {
    const rows = document.querySelectorAll('#causeDefBody tr');
    return Array.from(rows).map(row => ({
      code: row.querySelector('.cause-code').value.trim(),
      label: row.querySelector('.cause-label').value.trim(),
      category: row.querySelector('.cause-cat').value,
      parentCode: row.querySelector('.cause-parent') ? row.querySelector('.cause-parent').value || null : null,
    })).filter(c => c.label);
  }

  // ── Open modal for add ──────────────────────────────────────
  function openAdd() {
    document.getElementById('modalMachineTitle').textContent = 'Add Machine';
    document.getElementById('formMachine').reset();
    document.getElementById('machEditId').value = '';
    _renderStateRows(DEFAULT_STATES);
    _renderCauseRows(DEFAULT_CAUSES);
    document.getElementById('causeDefSection').style.display = 'none';
    Utils.openModal('modalMachine');
  }

  // ── Open modal for edit ─────────────────────────────────────
  function edit(id) {
    const m = getById(id);
    if (!m) return;

    document.getElementById('modalMachineTitle').textContent = 'Edit Machine';
    document.getElementById('machEditId').value = id;
    document.getElementById('machName').value = m.name;
    document.getElementById('machStateDp').value = m.stateDp;
    document.getElementById('machStateType').value = m.stateType || 'INT_CODE';
    document.getElementById('machTrackCauses').checked = !!m.trackCauses;
    document.getElementById('machCauseDp').value = m.causeDp || '';
    document.getElementById('causeDefSection').style.display = m.trackCauses ? 'block' : 'none';

    _renderStateRows(m.states || DEFAULT_STATES);
    _renderCauseRows(m.causes || DEFAULT_CAUSES);

    Utils.openModal('modalMachine');
  }

  // ── Save from form ──────────────────────────────────────────
  async function saveFromForm(e) {
    e.preventDefault();

    const editId = document.getElementById('machEditId').value;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('machName').value.trim(),
      stateDp: document.getElementById('machStateDp').value.trim(),
      stateType: document.getElementById('machStateType').value,
      states: _collectStatesFromModal(),
      trackCauses: document.getElementById('machTrackCauses').checked,
      causeDp: document.getElementById('machCauseDp').value.trim() || null,
      causes: document.getElementById('machTrackCauses').checked ? _collectCausesFromModal() : [],
    };

    if (editId) {
      const idx = _machines.findIndex(m => m.id === editId);
      if (idx >= 0) _machines[idx] = data;
    } else {
      _machines.push(data);
    }

    await save();
    render();
    _notifyChange();
    Utils.closeModal('modalMachine');
    Utils.toast('Machine "' + data.name + '" saved', 'success');
  }

  // ── Delete ──────────────────────────────────────────────────
  async function remove(id) {
    const m = getById(id);
    if (!m) return;
    if (!confirm('Delete machine "' + m.name + '"?')) return;

    _machines = _machines.filter(x => x.id !== id);
    await save();
    render();
    _notifyChange();
    Utils.toast('Machine deleted', 'info');
  }

  // ── Cause tracking toggle ───────────────────────────────────
  function _onTrackCausesChange() {
    const checked = document.getElementById('machTrackCauses').checked;
    document.getElementById('causeDefSection').style.display = checked ? 'block' : 'none';
  }

  // ── Export Gantt mapping for Dashboard ──────────────────────
  async function exportGantt(id) {
    const m = getById(id);
    if (!m) return;

    const mapping = KPI.buildGanttMapping(m);
    if (!mapping) {
      Utils.toast('No state definitions to export', 'error');
      return;
    }

    // Export to WinCC OA DP (or localStorage in mock)
    await KPI.exportGanttMapping(id, mapping);

    // Also build the full Dashboard widget config for reference
    const dashConfig = KPI.buildDashboardGanttConfig(m);

    // Show the config in a downloadable format
    const configJson = JSON.stringify(dashConfig, null, 2);
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gantt_' + m.name.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);

    Utils.toast('Gantt mapping exported for "' + m.name + '"', 'success');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    const btn = document.getElementById('btnAddMachine');
    if (btn) {
      btn.addEventListener('click', openAdd);
      document.getElementById('formMachine').addEventListener('submit', saveFromForm);
      document.getElementById('btnAddStateDef').addEventListener('click', addStateRow);
      document.getElementById('btnAddCauseDef').addEventListener('click', addCauseRow);
      document.getElementById('machTrackCauses').addEventListener('change', _onTrackCausesChange);
    }
    load();
  }

  return { init, load, getAll, getById, onChange, edit, remove, exportGantt, addStateRow, removeStateRow, addCauseRow, removeCauseRow };
})();
