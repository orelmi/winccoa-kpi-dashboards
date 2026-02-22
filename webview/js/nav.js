/* ═══════════════════════════════════════════════════════════════
   nav.js — Shared page navigation
   Renders the header and navigation bar on each page.
   Navigation is handled by CTRL (loadSnippet) in live mode,
   or by browser location change in simulation mode.
   ═══════════════════════════════════════════════════════════════ */

const Nav = (() => {
  'use strict';

  const PAGES = [
    { id: 'sources',       label: 'Sources',        icon: '&#9881;' },
    { id: 'aggregations',  label: 'Aggregations',   icon: '&#931;' },
    { id: 'machines',      label: 'Machine States',  icon: '&#9208;' },
    { id: 'calendar',      label: 'Calendar',        icon: '&#128197;' },
    { id: 'oee-config',    label: 'OEE Config',      icon: '&#9733;' },
    { id: 'oee-analysis',  label: 'OEE Analysis',    icon: '&#128202;' },
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

  return { render, updateConnectionStatus, PAGES };
})();
