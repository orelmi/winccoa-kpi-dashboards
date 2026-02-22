/* ═══════════════════════════════════════════════════════════════
   oeeConfig.js — OEE (Overall Equipment Effectiveness)
   configuration: Availability, Performance, Quality
   ═══════════════════════════════════════════════════════════════ */

const OeeConfig = (() => {
  'use strict';

  let _oeeConfigs = [];

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('oee');
    _oeeConfigs = Array.isArray(data) ? data : [];
    render();
  }

  async function save() {
    await KPI.saveConfig('oee', _oeeConfigs);
  }

  function getAll() { return _oeeConfigs.slice(); }
  function getById(id) { return _oeeConfigs.find(o => o.id === id) || null; }

  // ── Render OEE list ─────────────────────────────────────────
  function render() {
    const container = document.getElementById('oeeList');
    const empty = document.getElementById('oeeEmpty');
    const machines = MachineStateConfig.getAll();
    const sources = SourceConfig.getAll();

    if (_oeeConfigs.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    container.innerHTML = _oeeConfigs.map(oee => {
      const machine = machines.find(m => m.id === oee.machineRef);
      const machLabel = machine ? machine.name : 'Unknown';

      const piecesSource = sources.find(s => s.id === oee.piecesSourceRef);
      const piecesLabel = piecesSource ? piecesSource.name : '-';

      const periodLabel = Utils.PERIOD_LABELS[oee.period] || oee.period;
      const enabledBadge = oee.enabled
        ? '<span class="tag tag-enabled">ON</span>'
        : '<span class="tag tag-disabled">OFF</span>';

      const perfDetail = oee.perfMethod === 'CYCLE_TIME'
        ? 'Ideal cycle: ' + oee.idealCycleTime + 's'
        : 'Design speed: ' + oee.designSpeed + ' u/h';

      let qualDetail;
      if (oee.qualityMethod === 'FIXED_RATIO') {
        qualDetail = 'Fixed: ' + oee.fixedQuality + '%';
      } else if (oee.qualityMethod === 'REJECT_PIECES') {
        const rejSrc = sources.find(s => s.id === oee.rejectSourceRef);
        qualDetail = 'Rejects: ' + (rejSrc ? rejSrc.name : '-');
      } else {
        const goodSrc = sources.find(s => s.id === oee.goodSourceRef);
        qualDetail = 'Good: ' + (goodSrc ? goodSrc.name : '-');
      }

      return '<div class="oee-card">' +
        '<div class="oee-card-header">' +
          '<h3>' + Utils.escapeHtml(oee.name) + ' ' + enabledBadge + '</h3>' +
          '<div>' +
            '<button class="btn-icon" onclick="OeeConfig.edit(\'' + oee.id + '\')" title="Edit">&#9998;</button>' +
            '<button class="btn-icon danger" onclick="OeeConfig.remove(\'' + oee.id + '\')" title="Delete">&#128465;</button>' +
          '</div>' +
        '</div>' +
        '<div class="oee-card-body">' +
          '<div class="oee-factors">' +
            '<div class="oee-factor">' +
              '<div class="oee-factor-label">Availability</div>' +
              '<div class="oee-factor-value availability">A</div>' +
            '</div>' +
            '<div class="oee-factor">' +
              '<div class="oee-factor-label">Performance</div>' +
              '<div class="oee-factor-value performance">P</div>' +
            '</div>' +
            '<div class="oee-factor">' +
              '<div class="oee-factor-label">Quality</div>' +
              '<div class="oee-factor-value quality">Q</div>' +
            '</div>' +
            '<div class="oee-factor">' +
              '<div class="oee-factor-label">OEE</div>' +
              '<div class="oee-factor-value oee-total">--</div>' +
            '</div>' +
          '</div>' +
          '<div class="oee-detail-row">' +
            '<div class="oee-detail-item">Machine: <span>' + Utils.escapeHtml(machLabel) + '</span></div>' +
            '<div class="oee-detail-item">Period: <span>' + Utils.escapeHtml(periodLabel) + '</span></div>' +
            '<div class="oee-detail-item">Pieces: <span>' + Utils.escapeHtml(piecesLabel) + '</span></div>' +
          '</div>' +
          '<div class="oee-detail-row">' +
            '<div class="oee-detail-item">Planned hours: <span>' + oee.plannedHours + 'h/day</span></div>' +
            '<div class="oee-detail-item">Performance: <span>' + Utils.escapeHtml(perfDetail) + '</span></div>' +
            '<div class="oee-detail-item">Quality: <span>' + Utils.escapeHtml(qualDetail) + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Refresh selects ─────────────────────────────────────────
  function _refreshSelects(oee) {
    const machines = MachineStateConfig.getAll();
    const sources = SourceConfig.getAll();
    const counterSources = sources.filter(s =>
      s.characterization === 'COUNTER' || s.characterization === 'ENERGY'
    );

    Utils.populateMachineSelect(
      document.getElementById('oeeMachine'),
      machines,
      oee ? oee.machineRef : null
    );

    Utils.populateSourceSelect(
      document.getElementById('oeePiecesSource'),
      counterSources,
      oee ? oee.piecesSourceRef : null
    );

    Utils.populateSourceSelect(
      document.getElementById('oeeGoodSource'),
      counterSources,
      oee ? oee.goodSourceRef : null
    );

    Utils.populateSourceSelect(
      document.getElementById('oeeRejectSource'),
      counterSources,
      oee ? oee.rejectSourceRef : null
    );
  }

  // ── Performance method toggle ───────────────────────────────
  function _onPerfMethodChange() {
    const method = document.getElementById('oeePerfMethod').value;
    document.getElementById('grpCycleTime').style.display = method === 'CYCLE_TIME' ? 'flex' : 'none';
    document.getElementById('grpDesignSpeed').style.display = method === 'DESIGN_SPEED' ? 'flex' : 'none';
  }

  // ── Quality method toggle ───────────────────────────────────
  function _onQualityMethodChange() {
    const method = document.getElementById('oeeQualityMethod').value;
    document.getElementById('grpGoodPieces').style.display = method === 'GOOD_PIECES' ? 'flex' : 'none';
    document.getElementById('grpRejectPieces').style.display = method === 'REJECT_PIECES' ? 'flex' : 'none';
    document.getElementById('grpFixedRatio').style.display = method === 'FIXED_RATIO' ? 'flex' : 'none';
  }

  // ── Open modal for add ──────────────────────────────────────
  function openAdd() {
    document.getElementById('modalOeeTitle').textContent = 'Add OEE Configuration';
    document.getElementById('formOee').reset();
    document.getElementById('oeeEditId').value = '';
    document.getElementById('oeeEnabled').checked = true;
    document.getElementById('oeePlannedHours').value = 24;
    document.getElementById('oeeIdealCycle').value = 1;
    document.getElementById('grpDesignSpeed').style.display = 'none';
    document.getElementById('grpRejectPieces').style.display = 'none';
    document.getElementById('grpFixedRatio').style.display = 'none';
    _refreshSelects(null);
    Utils.openModal('modalOee');
  }

  // ── Open modal for edit ─────────────────────────────────────
  function edit(id) {
    const oee = getById(id);
    if (!oee) return;

    document.getElementById('modalOeeTitle').textContent = 'Edit OEE Configuration';
    document.getElementById('oeeEditId').value = id;
    document.getElementById('oeeName').value = oee.name;
    document.getElementById('oeePlannedHours').value = oee.plannedHours;
    document.getElementById('oeeAvailMethod').value = oee.availMethod || 'FROM_STATES';
    document.getElementById('oeePerfMethod').value = oee.perfMethod || 'CYCLE_TIME';
    document.getElementById('oeeIdealCycle').value = oee.idealCycleTime || 1;
    document.getElementById('oeeDesignSpeed').value = oee.designSpeed || 1000;
    document.getElementById('oeeQualityMethod').value = oee.qualityMethod || 'GOOD_PIECES';
    document.getElementById('oeeFixedQuality').value = oee.fixedQuality || 100;
    document.getElementById('oeePeriod').value = oee.period || 'SHIFT';
    document.getElementById('oeeTargetDp').value = oee.targetDp || '';
    document.getElementById('oeeEnabled').checked = oee.enabled !== false;

    _refreshSelects(oee);
    _onPerfMethodChange();
    _onQualityMethodChange();

    Utils.openModal('modalOee');
  }

  // ── Save from form ──────────────────────────────────────────
  async function saveFromForm(e) {
    e.preventDefault();

    const editId = document.getElementById('oeeEditId').value;
    const perfMethod = document.getElementById('oeePerfMethod').value;
    const qualityMethod = document.getElementById('oeeQualityMethod').value;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('oeeName').value.trim(),
      machineRef: document.getElementById('oeeMachine').value,
      plannedHours: parseFloat(document.getElementById('oeePlannedHours').value) || 24,
      availMethod: document.getElementById('oeeAvailMethod').value,
      perfMethod: perfMethod,
      idealCycleTime: perfMethod === 'CYCLE_TIME'
        ? parseFloat(document.getElementById('oeeIdealCycle').value) || 1
        : null,
      designSpeed: perfMethod === 'DESIGN_SPEED'
        ? parseFloat(document.getElementById('oeeDesignSpeed').value) || 1000
        : null,
      piecesSourceRef: document.getElementById('oeePiecesSource').value || null,
      qualityMethod: qualityMethod,
      goodSourceRef: qualityMethod === 'GOOD_PIECES'
        ? document.getElementById('oeeGoodSource').value || null
        : null,
      rejectSourceRef: qualityMethod === 'REJECT_PIECES'
        ? document.getElementById('oeeRejectSource').value || null
        : null,
      fixedQuality: qualityMethod === 'FIXED_RATIO'
        ? parseFloat(document.getElementById('oeeFixedQuality').value) || 100
        : null,
      period: document.getElementById('oeePeriod').value,
      targetDp: document.getElementById('oeeTargetDp').value.trim() || null,
      enabled: document.getElementById('oeeEnabled').checked,
    };

    // Auto-generate target DP prefix
    if (!data.targetDp) {
      data.targetDp = 'KPI_OEE.' + data.name.replace(/[^a-zA-Z0-9]/g, '_');
    }

    if (editId) {
      const idx = _oeeConfigs.findIndex(o => o.id === editId);
      if (idx >= 0) _oeeConfigs[idx] = data;
    } else {
      _oeeConfigs.push(data);
    }

    await save();
    render();
    Utils.closeModal('modalOee');
    Utils.toast('OEE "' + data.name + '" saved', 'success');
  }

  // ── Delete ──────────────────────────────────────────────────
  async function remove(id) {
    const oee = getById(id);
    if (!oee) return;
    if (!confirm('Delete OEE config "' + oee.name + '"?')) return;

    _oeeConfigs = _oeeConfigs.filter(o => o.id !== id);
    await save();
    render();
    Utils.toast('OEE configuration deleted', 'info');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    document.getElementById('btnAddOee').addEventListener('click', openAdd);
    document.getElementById('formOee').addEventListener('submit', saveFromForm);
    document.getElementById('oeePerfMethod').addEventListener('change', _onPerfMethodChange);
    document.getElementById('oeeQualityMethod').addEventListener('change', _onQualityMethodChange);

    // Re-render when dependencies change
    SourceConfig.onChange(() => { render(); });
    MachineStateConfig.onChange(() => { render(); });

    load();
  }

  return { init, load, getAll, getById, edit, remove, render };
})();
