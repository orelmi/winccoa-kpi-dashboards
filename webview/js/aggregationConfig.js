/* ═══════════════════════════════════════════════════════════════
   aggregationConfig.js — KPI Aggregation configuration
   CRUD for aggregation rules: method, period, expression
   ═══════════════════════════════════════════════════════════════ */

const AggregationConfig = (() => {
  'use strict';

  let _aggregations = [];

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('aggregations');
    _aggregations = Array.isArray(data) ? data : [];
    render();
  }

  async function save() {
    await KPI.saveConfig('aggregations', _aggregations);
  }

  function getAll() { return _aggregations.slice(); }
  function getById(id) { return _aggregations.find(a => a.id === id) || null; }

  // ── Render ──────────────────────────────────────────────────
  function render() {
    const tbody = document.getElementById('aggTableBody');
    const empty = document.getElementById('aggEmpty');
    const table = document.getElementById('aggTable');
    const sources = SourceConfig.getAll();

    if (_aggregations.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = _aggregations.map(agg => {
      const src = sources.find(s => s.id === agg.sourceRef);
      const srcLabel = src ? src.name : '<em>unknown</em>';
      const methodLabel = Utils.METHOD_LABELS[agg.method] || agg.method;
      const periodLabel = Utils.formatPeriod(agg);
      const enabledBadge = agg.enabled
        ? '<span class="tag tag-enabled">ON</span>'
        : '<span class="tag tag-disabled">OFF</span>';

      return '<tr data-id="' + agg.id + '">' +
        '<td><strong>' + Utils.escapeHtml(agg.name) + '</strong></td>' +
        '<td>' + srcLabel + '</td>' +
        '<td>' + Utils.escapeHtml(methodLabel) + '</td>' +
        '<td>' + Utils.escapeHtml(periodLabel) + '</td>' +
        '<td><code>' + Utils.escapeHtml(agg.dpTarget || 'auto') + '</code></td>' +
        '<td>' + enabledBadge + '</td>' +
        '<td class="actions">' +
          '<button class="btn-icon" onclick="AggregationConfig.edit(\'' + agg.id + '\')" title="Edit">&#9998;</button>' +
          '<button class="btn-icon danger" onclick="AggregationConfig.remove(\'' + agg.id + '\')" title="Delete">&#128465;</button>' +
        '</td></tr>';
    }).join('');
  }

  // ── Refresh source selects ──────────────────────────────────
  function refreshSourceSelects(selectedId) {
    const sources = SourceConfig.getAll();
    Utils.populateSourceSelect(document.getElementById('aggSource'), sources, selectedId);
  }

  // ── Open modal for add ──────────────────────────────────────
  function openAdd() {
    document.getElementById('modalAggTitle').textContent = 'Add Aggregation';
    document.getElementById('formAggregation').reset();
    document.getElementById('aggEditId').value = '';
    document.getElementById('aggEnabled').checked = true;
    document.getElementById('rowSlidingDuration').style.display = 'none';
    refreshSourceSelects();
    Utils.openModal('modalAggregation');
  }

  // ── Open modal for edit ─────────────────────────────────────
  function edit(id) {
    const agg = getById(id);
    if (!agg) return;

    document.getElementById('modalAggTitle').textContent = 'Edit Aggregation';
    document.getElementById('aggEditId').value = id;
    document.getElementById('aggName').value = agg.name;
    refreshSourceSelects(agg.sourceRef);
    document.getElementById('aggMethod').value = agg.method;
    document.getElementById('aggPeriodType').value = agg.periodType || 'CALENDAR_ALIGNED';
    document.getElementById('aggAlignment').value = agg.alignment || 'HOUR';
    document.getElementById('aggSlidingSeconds').value = agg.slidingSeconds || 3600;
    document.getElementById('aggTargetDp').value = agg.dpTarget || '';
    document.getElementById('aggEnabled').checked = agg.enabled !== false;
    document.getElementById('aggExpression').value = agg.expression || '';

    const isSlidingType = agg.periodType === 'SLIDING';
    document.getElementById('rowSlidingDuration').style.display = isSlidingType ? 'flex' : 'none';

    Utils.openModal('modalAggregation');
  }

  // ── Save from form ──────────────────────────────────────────
  async function saveFromForm(e) {
    e.preventDefault();

    const editId = document.getElementById('aggEditId').value;
    const periodType = document.getElementById('aggPeriodType').value;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('aggName').value.trim(),
      sourceRef: document.getElementById('aggSource').value,
      method: document.getElementById('aggMethod').value,
      periodType: periodType,
      alignment: document.getElementById('aggAlignment').value,
      slidingSeconds: periodType === 'SLIDING' ? parseInt(document.getElementById('aggSlidingSeconds').value) : null,
      dpTarget: document.getElementById('aggTargetDp').value.trim() || null,
      enabled: document.getElementById('aggEnabled').checked,
      expression: document.getElementById('aggExpression').value.trim() || null,
    };

    // Auto-generate target DP name if not specified
    if (!data.dpTarget) {
      data.dpTarget = 'KPI_Result.' + data.name.replace(/[^a-zA-Z0-9]/g, '_');
    }

    if (editId) {
      const idx = _aggregations.findIndex(a => a.id === editId);
      if (idx >= 0) _aggregations[idx] = data;
    } else {
      _aggregations.push(data);
    }

    await save();
    render();
    Utils.closeModal('modalAggregation');
    Utils.toast('Aggregation "' + data.name + '" saved', 'success');
  }

  // ── Delete ──────────────────────────────────────────────────
  async function remove(id) {
    const agg = getById(id);
    if (!agg) return;
    if (!confirm('Delete aggregation "' + agg.name + '"?')) return;

    _aggregations = _aggregations.filter(a => a.id !== id);
    await save();
    render();
    Utils.toast('Aggregation deleted', 'info');
  }

  // ── Period type toggle ──────────────────────────────────────
  function _onPeriodTypeChange() {
    const isSlidingType = document.getElementById('aggPeriodType').value === 'SLIDING';
    document.getElementById('rowSlidingDuration').style.display = isSlidingType ? 'flex' : 'none';
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    document.getElementById('btnAddAggregation').addEventListener('click', openAdd);
    document.getElementById('formAggregation').addEventListener('submit', saveFromForm);
    document.getElementById('aggPeriodType').addEventListener('change', _onPeriodTypeChange);

    // Re-render when sources change
    SourceConfig.onChange(() => { render(); });

    load();
  }

  return { init, load, getAll, getById, edit, remove, render };
})();
