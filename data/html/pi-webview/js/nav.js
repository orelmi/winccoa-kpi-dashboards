/* ═══════════════════════════════════════════════════════════════
   nav.js — Shared page navigation + asset context breadcrumb
   Renders the header, navigation bar, and context indicator.
   Navigation is handled by CTRL (loadSnippet) in live mode,
   or by browser location change in simulation mode.
   ═══════════════════════════════════════════════════════════════ */

const Nav = (() => {
  'use strict';

  const PAGES = [
    { id: 'assets',        label: 'Assets',         icon: '&#127970;' },
    { id: 'sources',       label: 'Sources',        icon: '&#9881;' },
    { id: 'aggregations',  label: 'Aggregations',   icon: '&#931;' },
    { id: 'machines',      label: 'Machine States',  icon: '&#9208;' },
    { id: 'calendar',      label: 'Calendar',        icon: '&#128197;' },
    { id: 'oee-config',    label: 'OEE Config',      icon: '&#9733;' },
    { id: 'oee-analysis',  label: 'OEE Analysis',    icon: '&#128202;' },
    { id: 'event-log',     label: 'Event Log',       icon: '&#128220;' },
  ];

  function render(activePageId) {
    // ── Header ──────────────────────────────────────────────
    const headerEl = document.getElementById('appHeader');
    if (headerEl) {
      headerEl.innerHTML =
        '<div class="header-left">' +
          '<h1 class="app-title">KPI Configuration</h1>' +
          '<span class="app-subtitle">WinCC OA Performance Manager</span>' +
        '</div>' +
        '<div class="header-right">' +
          '<span id="navContextBadge" class="nav-context-badge" style="display:none;"></span>' +
          '<span id="connectionStatus" class="status-badge status-mock">SIMULATION MODE</span>' +
        '</div>';
    }

    // ── Navigation bar ──────────────────────────────────────
    const navEl = document.getElementById('appNav');
    if (navEl) {
      navEl.innerHTML = PAGES.map(p => {
        const cls = p.id === activePageId ? 'tab-btn active' : 'tab-btn';
        return '<button class="' + cls + '" onclick="KPI.navigate(\'' + p.id + '\')">' +
          '<span class="tab-icon">' + p.icon + '</span> ' + p.label +
        '</button>';
      }).join('');
    }

    // ── Asset context badge (shows current asset in header) ──
    _refreshContextBadge();
  }

  function _refreshContextBadge() {
    const badge = document.getElementById('navContextBadge');
    if (!badge) return;
    // AssetConfig may not be loaded on all pages
    if (typeof AssetConfig === 'undefined') {
      // Read from localStorage directly
      const ctxId = localStorage.getItem('kpi_asset_context');
      if (ctxId) {
        badge.style.display = 'inline-block';
        badge.textContent = 'Asset: ' + ctxId;
        badge.title = 'Asset context active (load AssetConfig for full info)';
      }
      return;
    }
    const ctx = AssetConfig.getContext();
    if (!ctx) {
      badge.style.display = 'none';
      return;
    }
    const path = AssetConfig.getContextPath();
    const label = path.map(a => a.name).join(' > ');
    badge.style.display = 'inline-block';
    badge.innerHTML = label;
    badge.title = 'Current asset context — click Assets page to change';
    badge.style.cursor = 'pointer';
    badge.onclick = function() { KPI.navigate('assets'); };
  }

  // ── Context filter bar (shows active filter below nav) ──────
  function renderContextFilter(reRenderCallbacks) {
    let bar = document.getElementById('contextFilterBar');
    if (!bar) {
      const nav = document.getElementById('appNav');
      if (!nav) return;
      bar = document.createElement('div');
      bar.id = 'contextFilterBar';
      bar.className = 'context-filter-bar';
      nav.parentNode.insertBefore(bar, nav.nextSibling);
    }

    if (typeof AssetConfig === 'undefined' || !AssetConfig.getContext()) {
      bar.style.display = 'none';
      return;
    }

    const path = AssetConfig.getContextPath();
    const label = path.map(a => a.name).join(' &rsaquo; ');
    const asset = AssetConfig.getContextAsset();
    const typeDef = AssetConfig.ASSET_TYPES[asset.type] || {};
    bar.style.display = 'flex';
    bar.innerHTML =
      '<span class="context-filter-label">' +
        '<span class="context-filter-icon">' + (typeDef.icon || '') + '</span> ' +
        'Filtered by: <strong>' + label + '</strong>' +
      '</span>' +
      '<button class="btn btn-sm btn-secondary" id="btnClearContext">Show all</button>';

    document.getElementById('btnClearContext').addEventListener('click', function() {
      AssetConfig.setContext(null);
      _refreshContextBadge();
      renderContextFilter(reRenderCallbacks);
      if (Array.isArray(reRenderCallbacks)) {
        reRenderCallbacks.forEach(function(cb) { cb(); });
      }
    });
  }

  function updateConnectionStatus(mode) {
    const badge = document.getElementById('connectionStatus');
    if (!badge) return;
    if (mode === 'live') {
      badge.textContent = 'CONNECTED';
      badge.className = 'status-badge status-connected';
    } else {
      badge.textContent = 'SIMULATION MODE';
      badge.className = 'status-badge status-mock';
    }
  }

  return { render, updateConnectionStatus, renderContextFilter, PAGES };
})();
