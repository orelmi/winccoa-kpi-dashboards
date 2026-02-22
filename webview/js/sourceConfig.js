/* ═══════════════════════════════════════════════════════════════
   sourceConfig.js — Source datapoint configuration management
   CRUD for KPI source datapoints, archiving, characterization
   ═══════════════════════════════════════════════════════════════ */

const SourceConfig = (() => {
  'use strict';

  let _sources = [];
  let _onChangeCallbacks = [];

  // ── Load from persistence ───────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('sources');
    _sources = Array.isArray(data) ? data : [];
    render();
    _notifyChange();
  }

  // ── Save to persistence ─────────────────────────────────────
  async function save() {
    await KPI.saveConfig('sources', _sources);
  }

  // ── Get all sources ─────────────────────────────────────────
  function getAll() { return _sources.slice(); }

  function getById(id) { return _sources.find(s => s.id === id) || null; }

  // ── Change notification ─────────────────────────────────────
  function onChange(cb) { _onChangeCallbacks.push(cb); }
  function _notifyChange() { _onChangeCallbacks.forEach(cb => cb(_sources)); }

  // ── Render table ────────────────────────────────────────────
  function render() {
    const tbody = document.getElementById('sourceTableBody');
    const empty = document.getElementById('sourceEmpty');
    const table = document.getElementById('sourceTable');

    if (_sources.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = _sources.map(src => {
      const archBadge = src.archiving && src.archiving.enabled
        ? '<span class="tag tag-enabled">' + Utils.escapeHtml(src.archiving.archiveClass || 'ON') + '</span>'
        : '<span class="tag tag-disabled">OFF</span>';

      return '<tr data-id="' + src.id + '">' +
        '<td><strong>' + Utils.escapeHtml(src.name) + '</strong></td>' +
        '<td><code>' + Utils.escapeHtml(src.dpSource) + '</code></td>' +
        '<td>' + Utils.escapeHtml(src.dataType) + '</td>' +
        '<td>' + Utils.characterizationTag(src.characterization) + '</td>' +
        '<td>' + Utils.escapeHtml(src.unit || '-') + '</td>' +
        '<td>' + archBadge + '</td>' +
        '<td class="actions">' +
          '<button class="btn-icon" onclick="CorrectionManager.openForSource(\'' + src.id + '\')" title="Correct data">&#128269;</button>' +
          '<button class="btn-icon" onclick="SourceConfig.edit(\'' + src.id + '\')" title="Edit">&#9998;</button>' +
          '<button class="btn-icon danger" onclick="SourceConfig.remove(\'' + src.id + '\')" title="Delete">&#128465;</button>' +
        '</td></tr>';
    }).join('');
  }

  // ── Open modal for add ──────────────────────────────────────
  function openAdd() {
    document.getElementById('modalSourceTitle').textContent = 'Add Source';
    document.getElementById('formSource').reset();
    document.getElementById('srcEditId').value = '';
    document.getElementById('srcArchEnabled').checked = true;
    Utils.openModal('modalSource');
  }

  // ── Open modal for edit ─────────────────────────────────────
  function edit(id) {
    const src = getById(id);
    if (!src) return;

    document.getElementById('modalSourceTitle').textContent = 'Edit Source';
    document.getElementById('srcEditId').value = id;
    document.getElementById('srcName').value = src.name;
    document.getElementById('srcDp').value = src.dpSource;
    document.getElementById('srcDataType').value = src.dataType;
    document.getElementById('srcCharacterization').value = src.characterization;
    document.getElementById('srcUnit').value = src.unit || '';

    if (src.archiving) {
      document.getElementById('srcArchEnabled').checked = src.archiving.enabled;
      document.getElementById('srcArchClass').value = src.archiving.archiveClass || '_EVENT';
      document.getElementById('srcSmoothMode').value = src.archiving.smoothMode || 'NONE';
      document.getElementById('srcSmoothValue').value = src.archiving.smoothValue || 0;
    }

    if (src.limits) {
      document.getElementById('srcMinValid').value = src.limits.minValid != null ? src.limits.minValid : '';
      document.getElementById('srcMaxValid').value = src.limits.maxValid != null ? src.limits.maxValid : '';
    }

    Utils.openModal('modalSource');
  }

  // ── Save from form ──────────────────────────────────────────
  async function saveFromForm(e) {
    e.preventDefault();

    const editId = document.getElementById('srcEditId').value;
    const minVal = document.getElementById('srcMinValid').value;
    const maxVal = document.getElementById('srcMaxValid').value;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('srcName').value.trim(),
      dpSource: document.getElementById('srcDp').value.trim(),
      dataType: document.getElementById('srcDataType').value,
      characterization: document.getElementById('srcCharacterization').value,
      unit: document.getElementById('srcUnit').value.trim(),
      archiving: {
        enabled: document.getElementById('srcArchEnabled').checked,
        archiveClass: document.getElementById('srcArchClass').value,
        smoothMode: document.getElementById('srcSmoothMode').value,
        smoothValue: parseFloat(document.getElementById('srcSmoothValue').value) || 0,
      },
      limits: {
        minValid: minVal !== '' ? parseFloat(minVal) : null,
        maxValid: maxVal !== '' ? parseFloat(maxVal) : null,
      },
    };

    if (editId) {
      const idx = _sources.findIndex(s => s.id === editId);
      if (idx >= 0) _sources[idx] = data;
    } else {
      _sources.push(data);
    }

    await save();
    render();
    _notifyChange();
    Utils.closeModal('modalSource');
    Utils.toast('Source "' + data.name + '" saved', 'success');
  }

  // ── Delete ──────────────────────────────────────────────────
  async function remove(id) {
    const src = getById(id);
    if (!src) return;
    if (!confirm('Delete source "' + src.name + '"?')) return;

    _sources = _sources.filter(s => s.id !== id);
    await save();
    render();
    _notifyChange();
    Utils.toast('Source deleted', 'info');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    document.getElementById('btnAddSource').addEventListener('click', openAdd);
    document.getElementById('formSource').addEventListener('submit', saveFromForm);
    load();
  }

  return { init, load, getAll, getById, onChange, edit, remove };
})();
