/* ═══════════════════════════════════════════════════════════════
   assetConfig.js — Asset tree & context provider
   ═══════════════════════════════════════════════════════════════
   Organizational hierarchy for the plant:
     SITE → AREA → LINE → MACHINE

   This module is **self-contained**: it does NOT import or depend
   on other config modules. Other modules consume the context API
   to filter their data.

   Responsibilities:
   - Tree CRUD (add, edit, remove, reorder)
   - Asset context (current selection, persisted across pages)
   - Reference links (which machines/sources/etc belong to an asset)
   - Calendar resolution (walk up the tree for inheritance)
   ═══════════════════════════════════════════════════════════════ */

const AssetConfig = (() => {
  'use strict';

  let _assets = [];
  let _contextId = null;          // Currently selected asset ID
  let _contextCallbacks = [];

  // ── Asset types (ordered by depth) ─────────────────────────
  const ASSET_TYPES = {
    SITE:    { label: 'Site',    icon: '\u{1F3ED}', depth: 0 },
    AREA:    { label: 'Area',    icon: '\u{1F4CD}', depth: 1 },
    LINE:    { label: 'Line',    icon: '\u{2699}',  depth: 2 },
    MACHINE: { label: 'Machine', icon: '\u{23F8}',  depth: 3 },
  };

  // Allowed child types per parent type
  const ALLOWED_CHILDREN = {
    null:      ['SITE'],
    'SITE':    ['AREA', 'LINE'],
    'AREA':    ['LINE', 'MACHINE'],
    'LINE':    ['MACHINE'],
    'MACHINE': [],
  };

  // ── Persistence ─────────────────────────────────────────────
  async function load() {
    const data = await KPI.loadConfig('assets');
    _assets = Array.isArray(data) ? data : [];
    // Restore context from localStorage (survives page navigation)
    const saved = localStorage.getItem('kpi_asset_context');
    if (saved && _assets.some(a => a.id === saved)) {
      _contextId = saved;
    } else if (_contextId && !_assets.some(a => a.id === _contextId)) {
      _contextId = null;
    }
    render();
  }

  async function save() {
    await KPI.saveConfig('assets', _assets);
  }

  // ── Getters ─────────────────────────────────────────────────
  function getAll()    { return _assets.slice(); }
  function getById(id) { return _assets.find(a => a.id === id) || null; }

  function getRoots() {
    return _assets.filter(a => !a.parentId);
  }

  function getChildren(parentId) {
    return _assets.filter(a => a.parentId === parentId);
  }

  function getAncestors(id) {
    const path = [];
    let current = getById(id);
    while (current) {
      path.unshift(current);
      current = current.parentId ? getById(current.parentId) : null;
    }
    return path;
  }

  function getDescendantIds(id) {
    const ids = [];
    const queue = [id];
    while (queue.length > 0) {
      const parentId = queue.shift();
      const children = getChildren(parentId);
      children.forEach(c => {
        ids.push(c.id);
        queue.push(c.id);
      });
    }
    return ids;
  }

  function getAllowedChildTypes(parentId) {
    if (!parentId) return ALLOWED_CHILDREN[null];
    const parent = getById(parentId);
    if (!parent) return [];
    return ALLOWED_CHILDREN[parent.type] || [];
  }

  // ── Context API ─────────────────────────────────────────────
  // The "context" is the currently selected asset.
  // Other modules call getContext() / getContextAsset() to filter.

  function setContext(assetId) {
    const prev = _contextId;
    _contextId = assetId || null;
    localStorage.setItem('kpi_asset_context', _contextId || '');
    if (prev !== _contextId) {
      _contextCallbacks.forEach(cb => cb(_contextId));
    }
  }

  function getContext()      { return _contextId; }
  function getContextAsset() { return _contextId ? getById(_contextId) : null; }

  function getContextPath() {
    if (!_contextId) return [];
    return getAncestors(_contextId);
  }

  function onContextChange(cb) {
    _contextCallbacks.push(cb);
  }

  // Get all ref IDs for the current context + its descendants.
  // Returns { machines: [...], sources: [...], aggregations: [...], oeeConfigs: [...] }
  function getRefsForContext() {
    const result = { machines: [], sources: [], aggregations: [], oeeConfigs: [] };
    if (!_contextId) {
      // No context = everything
      _assets.forEach(a => _mergeRefs(result, a.refs));
      return result;
    }
    const asset = getById(_contextId);
    if (!asset) return result;
    _mergeRefs(result, asset.refs);
    const descIds = getDescendantIds(_contextId);
    descIds.forEach(did => {
      const d = getById(did);
      if (d) _mergeRefs(result, d.refs);
    });
    return result;
  }

  function _mergeRefs(target, refs) {
    if (!refs) return;
    ['machines', 'sources', 'aggregations', 'oeeConfigs'].forEach(key => {
      if (Array.isArray(refs[key])) {
        refs[key].forEach(id => {
          if (!target[key].includes(id)) target[key].push(id);
        });
      }
    });
  }

  // ── Calendar resolution ─────────────────────────────────────
  // Walk up the tree to find the nearest assigned calendar.
  function resolveCalendar(assetId) {
    let current = getById(assetId);
    while (current) {
      if (current.calendarRef) return current.calendarRef;
      current = current.parentId ? getById(current.parentId) : null;
    }
    return null; // No calendar assigned anywhere in the chain
  }

  // ── CRUD ────────────────────────────────────────────────────
  async function add(data) {
    _assets.push(data);
    await save();
    render();
    return data;
  }

  async function update(id, data) {
    const idx = _assets.findIndex(a => a.id === id);
    if (idx < 0) return null;
    _assets[idx] = { ..._assets[idx], ...data, id: id };
    await save();
    render();
    return _assets[idx];
  }

  async function remove(id) {
    // Remove the asset and all its descendants
    const toRemove = new Set([id, ...getDescendantIds(id)]);
    _assets = _assets.filter(a => !toRemove.has(a.id));
    if (_contextId && toRemove.has(_contextId)) {
      setContext(null);
    }
    await save();
    render();
  }

  function addRef(assetId, refType, refId) {
    const asset = getById(assetId);
    if (!asset) return;
    if (!asset.refs) asset.refs = {};
    if (!asset.refs[refType]) asset.refs[refType] = [];
    if (!asset.refs[refType].includes(refId)) {
      asset.refs[refType].push(refId);
    }
  }

  function removeRef(assetId, refType, refId) {
    const asset = getById(assetId);
    if (!asset || !asset.refs || !asset.refs[refType]) return;
    asset.refs[refType] = asset.refs[refType].filter(id => id !== refId);
  }

  async function saveRefs(assetId) {
    await save();
    render();
  }

  // ── Render (tree view) ─────────────────────────────────────
  function render() {
    const container = document.getElementById('assetTree');
    if (!container) return; // Data-only mode

    const empty = document.getElementById('assetEmpty');
    const roots = getRoots();

    if (roots.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';
    container.innerHTML = roots.map(r => _renderNode(r, 0)).join('');
  }

  function _renderNode(asset, depth) {
    const children = getChildren(asset.id);
    const hasChildren = children.length > 0;
    const isContext = asset.id === _contextId;
    const typeDef = ASSET_TYPES[asset.type] || ASSET_TYPES.MACHINE;
    const allowedChildren = ALLOWED_CHILDREN[asset.type] || [];
    const calRef = asset.calendarRef;
    const resolved = resolveCalendar(asset.id);
    const calLabel = calRef
      ? '<span class="asset-cal own">calendar assigned</span>'
      : (resolved ? '<span class="asset-cal inherited">inherited</span>' : '');

    // Refs summary
    const refs = asset.refs || {};
    const refCounts = [];
    if (refs.machines && refs.machines.length) refCounts.push(refs.machines.length + ' machine' + (refs.machines.length > 1 ? 's' : ''));
    if (refs.sources && refs.sources.length)   refCounts.push(refs.sources.length + ' source' + (refs.sources.length > 1 ? 's' : ''));
    if (refs.oeeConfigs && refs.oeeConfigs.length) refCounts.push(refs.oeeConfigs.length + ' OEE');
    const refSummary = refCounts.length > 0
      ? '<span class="asset-refs">' + refCounts.join(' | ') + '</span>'
      : '';

    // Expanded state from localStorage
    const expandKey = 'kpi_asset_expand_' + asset.id;
    const expanded = localStorage.getItem(expandKey) !== 'false';

    let html = '<div class="asset-node' + (isContext ? ' asset-context' : '') + '" data-id="' + asset.id + '" data-depth="' + depth + '">';
    html += '<div class="asset-row" style="padding-left:' + (depth * 24 + 8) + 'px;">';

    // Expand/collapse toggle
    if (hasChildren) {
      html += '<button class="asset-toggle' + (expanded ? ' expanded' : '') + '" onclick="AssetConfig.toggleExpand(\'' + asset.id + '\', this)">&#9656;</button>';
    } else {
      html += '<span class="asset-toggle-spacer"></span>';
    }

    // Icon + name
    html += '<span class="asset-icon">' + typeDef.icon + '</span>';
    html += '<span class="asset-name" onclick="AssetConfig.setContext(\'' + asset.id + '\')">' + Utils.escapeHtml(asset.name) + '</span>';
    html += '<span class="asset-type-badge">' + typeDef.label + '</span>';
    html += calLabel;
    html += refSummary;

    // Actions
    html += '<span class="asset-actions">';
    if (allowedChildren.length > 0) {
      html += '<button class="btn-icon" onclick="AssetConfig.openAddChild(\'' + asset.id + '\')" title="Add child">&#43;</button>';
    }
    html += '<button class="btn-icon" onclick="AssetConfig.openEdit(\'' + asset.id + '\')" title="Edit">&#9998;</button>';
    html += '<button class="btn-icon" onclick="AssetConfig.openLinkRefs(\'' + asset.id + '\')" title="Link configs">&#128279;</button>';
    html += '<button class="btn-icon danger" onclick="AssetConfig.confirmRemove(\'' + asset.id + '\')" title="Delete">&#128465;</button>';
    html += '</span>';
    html += '</div>'; // .asset-row

    // Children
    if (hasChildren) {
      html += '<div class="asset-children' + (expanded ? '' : ' collapsed') + '">';
      html += children.map(c => _renderNode(c, depth + 1)).join('');
      html += '</div>';
    }

    html += '</div>'; // .asset-node
    return html;
  }

  function toggleExpand(assetId, btn) {
    const node = btn.closest('.asset-node');
    const childContainer = node.querySelector(':scope > .asset-children');
    if (!childContainer) return;
    const key = 'kpi_asset_expand_' + assetId;
    const isExpanded = !childContainer.classList.contains('collapsed');
    if (isExpanded) {
      childContainer.classList.add('collapsed');
      btn.classList.remove('expanded');
      localStorage.setItem(key, 'false');
    } else {
      childContainer.classList.remove('collapsed');
      btn.classList.add('expanded');
      localStorage.setItem(key, 'true');
    }
  }

  // ── Modal helpers ──────────────────────────────────────────

  function openAddRoot() {
    _openModal(null, null);
  }

  function openAddChild(parentId) {
    _openModal(null, parentId);
  }

  function openEdit(id) {
    _openModal(id, null);
  }

  function _openModal(editId, parentId) {
    const titleEl = document.getElementById('modalAssetTitle');
    const form = document.getElementById('formAsset');
    form.reset();
    document.getElementById('assetEditId').value = editId || '';
    document.getElementById('assetParentId').value = parentId || '';

    const typeSelect = document.getElementById('assetType');

    if (editId) {
      // Edit existing
      const a = getById(editId);
      if (!a) return;
      titleEl.textContent = 'Edit Asset';
      document.getElementById('assetName').value = a.name;
      document.getElementById('assetCalendarRef').value = a.calendarRef || '';
      // Populate type options based on parent
      _populateTypeOptions(typeSelect, a.parentId);
      typeSelect.value = a.type;
    } else {
      // Add new
      titleEl.textContent = parentId ? 'Add Child Asset' : 'Add Root Asset';
      _populateTypeOptions(typeSelect, parentId);
    }

    // Populate calendar select
    _populateCalendarSelect();

    Utils.openModal('modalAsset');
  }

  function _populateTypeOptions(select, parentId) {
    const allowed = getAllowedChildTypes(parentId);
    select.innerHTML = allowed.map(t => {
      const def = ASSET_TYPES[t];
      return '<option value="' + t + '">' + def.label + '</option>';
    }).join('');
  }

  function _populateCalendarSelect() {
    const select = document.getElementById('assetCalendarRef');
    if (!select) return;
    // Get calendars from CalendarConfig if available, otherwise just show IDs
    let options = '<option value="">(inherit from parent)</option>';
    if (typeof CalendarConfig !== 'undefined') {
      const shifts = CalendarConfig.getShifts();
      // Calendar as a whole — use "assigned" flag
      options += '<option value="__assigned__">Assign calendar to this level</option>';
    } else {
      options += '<option value="__assigned__">Assign calendar to this level</option>';
    }
    select.innerHTML = options;
  }

  async function saveFromForm(e) {
    e.preventDefault();
    const editId = document.getElementById('assetEditId').value;
    const parentId = document.getElementById('assetParentId').value || null;

    const data = {
      id: editId || Utils.generateId(),
      name: document.getElementById('assetName').value.trim(),
      type: document.getElementById('assetType').value,
      parentId: editId ? getById(editId).parentId : parentId,
      calendarRef: document.getElementById('assetCalendarRef').value || null,
      refs: editId ? (getById(editId).refs || {}) : {},
    };

    if (editId) {
      await update(editId, data);
    } else {
      await add(data);
    }

    Utils.closeModal('modalAsset');
    Utils.toast('Asset "' + data.name + '" saved', 'success');
    if (typeof EventLog !== 'undefined') EventLog.log(editId ? 'update' : 'create', 'assets', data.name, data.type);
  }

  async function confirmRemove(id) {
    const a = getById(id);
    if (!a) return;
    const descCount = getDescendantIds(id).length;
    const msg = descCount > 0
      ? 'Delete "' + a.name + '" and its ' + descCount + ' child asset(s)?'
      : 'Delete "' + a.name + '"?';
    if (!confirm(msg)) return;
    await remove(id);
    Utils.toast('Asset deleted', 'info');
    if (typeof EventLog !== 'undefined') EventLog.log('delete', 'assets', a.name);
  }

  // ── Link refs modal ────────────────────────────────────────
  let _linkAssetId = null;

  function openLinkRefs(assetId) {
    _linkAssetId = assetId;
    const asset = getById(assetId);
    if (!asset) return;

    document.getElementById('linkAssetName').textContent = asset.name;
    const refs = asset.refs || {};

    // Populate available items from each config module
    _renderLinkSection('linkMachines', 'machines',
      typeof MachineStateConfig !== 'undefined' ? MachineStateConfig.getAll() : [],
      refs.machines || []);
    _renderLinkSection('linkSources', 'sources',
      typeof SourceConfig !== 'undefined' ? SourceConfig.getAll() : [],
      refs.sources || []);
    _renderLinkSection('linkAggregations', 'aggregations',
      typeof AggregationConfig !== 'undefined' ? AggregationConfig.getAll() : [],
      refs.aggregations || []);
    _renderLinkSection('linkOeeConfigs', 'oeeConfigs',
      typeof OeeConfig !== 'undefined' ? OeeConfig.getAll() : [],
      refs.oeeConfigs || []);

    Utils.openModal('modalLinkRefs');
  }

  function _renderLinkSection(containerId, refType, allItems, linkedIds) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (allItems.length === 0) {
      container.innerHTML = '<p class="form-hint">No items available.</p>';
      return;
    }
    container.innerHTML = allItems.map(item => {
      const checked = linkedIds.includes(item.id) ? ' checked' : '';
      return '<label class="checkbox-label" style="margin-top:4px;">' +
        '<input type="checkbox" class="link-cb" data-ref-type="' + refType + '" data-ref-id="' + item.id + '"' + checked + '> ' +
        Utils.escapeHtml(item.name) +
      '</label>';
    }).join('');
  }

  async function saveLinkRefs() {
    if (!_linkAssetId) return;
    const asset = getById(_linkAssetId);
    if (!asset) return;

    asset.refs = asset.refs || {};
    document.querySelectorAll('#modalLinkRefs .link-cb').forEach(cb => {
      const refType = cb.getAttribute('data-ref-type');
      const refId = cb.getAttribute('data-ref-id');
      if (!asset.refs[refType]) asset.refs[refType] = [];
      if (cb.checked && !asset.refs[refType].includes(refId)) {
        asset.refs[refType].push(refId);
      } else if (!cb.checked) {
        asset.refs[refType] = asset.refs[refType].filter(id => id !== refId);
      }
    });

    await save();
    render();
    Utils.closeModal('modalLinkRefs');
    Utils.toast('References updated', 'success');
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    const btnAdd = document.getElementById('btnAddAssetRoot');
    if (btnAdd) {
      btnAdd.addEventListener('click', openAddRoot);
      document.getElementById('formAsset').addEventListener('submit', saveFromForm);
      document.getElementById('btnSaveLinkRefs').addEventListener('click', saveLinkRefs);
    }
    load();
  }

  return {
    // Core
    init, load, getAll, getById,
    // Tree
    getRoots, getChildren, getAncestors, getDescendantIds, getAllowedChildTypes,
    ASSET_TYPES, ALLOWED_CHILDREN,
    // Context
    setContext, getContext, getContextAsset, getContextPath,
    onContextChange, getRefsForContext,
    // Calendar
    resolveCalendar,
    // CRUD
    add, update, remove, addRef, removeRef, saveRefs,
    // UI
    render, toggleExpand,
    openAddRoot, openAddChild, openEdit, confirmRemove,
    openLinkRefs, saveLinkRefs,
  };
})();
