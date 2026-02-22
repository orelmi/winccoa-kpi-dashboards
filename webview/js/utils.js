/* ═══════════════════════════════════════════════════════════════
   utils.js — Shared helpers: IDs, formatting, toasts, modals
   ═══════════════════════════════════════════════════════════════ */

const Utils = (() => {
  'use strict';

  // ── Unique ID generator ─────────────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  // ── Toast Notifications ─────────────────────────────────────
  function toast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = '0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ── Modal helpers ───────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  function initModalCloseButtons() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close'));
      });
    });
    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
  }

  // ── Characterization display ────────────────────────────────
  const CHARACTERIZATION_LABELS = {
    PROCESS_VALUE: 'Process Value',
    COUNTER: 'Counter',
    FLOW_RATE: 'Flow Rate',
    STATUS: 'Status',
    SETPOINT: 'Setpoint',
    ENERGY: 'Energy Meter',
    MACHINE_STATE: 'Machine State',
  };

  function characterizationTag(type) {
    const label = CHARACTERIZATION_LABELS[type] || type;
    const cls = 'tag-' + (type || 'process').toLowerCase();
    return '<span class="tag ' + cls + '">' + escapeHtml(label) + '</span>';
  }

  // ── Aggregation method labels ───────────────────────────────
  const METHOD_LABELS = {
    SUM: 'Sum',
    AVG: 'Average',
    MIN: 'Minimum',
    MAX: 'Maximum',
    COUNT: 'Count',
    DELTA: 'Delta (Counter)',
    TIME_WEIGHTED_AVG: 'Time-Weighted Avg',
    FLOW_FROM_COUNTER: 'Flow from Counter',
    UPTIME_RATIO: 'Uptime Ratio',
    STDDEV: 'Std Deviation',
  };

  // ── Period labels ───────────────────────────────────────────
  const PERIOD_LABELS = {
    MINUTE_15: '15 min',
    HOUR: 'Hourly',
    SHIFT: 'Per Shift',
    DAY: 'Daily',
    WEEK: 'Weekly',
    MONTH: 'Monthly',
  };

  // ── State category labels & colors ──────────────────────────
  const STATE_CATEGORIES = {
    PRODUCING: { label: 'Producing', color: '#28a745' },
    IDLE: { label: 'Idle', color: '#ffc107' },
    PLANNED_STOP: { label: 'Planned Stop', color: '#17a2b8' },
    UNPLANNED_STOP: { label: 'Unplanned Stop', color: '#d9363e' },
    SETUP: { label: 'Setup / Changeover', color: '#6f42c1' },
    MAINTENANCE: { label: 'Maintenance', color: '#fd7e14' },
  };

  // ── Downtime cause categories ───────────────────────────────
  const CAUSE_CATEGORIES = {
    MECHANICAL: 'Mechanical',
    ELECTRICAL: 'Electrical',
    PROCESS: 'Process',
    OPERATOR: 'Operator',
    QUALITY: 'Quality',
    SUPPLY: 'Supply / Logistics',
    PLANNED: 'Planned',
    OTHER: 'Other',
  };

  // ── HTML escaping ───────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Format period for display ───────────────────────────────
  function formatPeriod(agg) {
    if (agg.periodType === 'SLIDING') {
      return 'Sliding ' + agg.slidingSeconds + 's';
    }
    return PERIOD_LABELS[agg.alignment] || agg.alignment;
  }

  // ── Populate a <select> from source list ────────────────────
  function populateSourceSelect(selectEl, sources, selectedId) {
    const firstOption = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (firstOption) selectEl.appendChild(firstOption);

    sources.forEach(src => {
      const opt = document.createElement('option');
      opt.value = src.id;
      opt.textContent = src.name + ' (' + src.dpSource + ')';
      if (selectedId && src.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  // ── Populate a <select> from machine list ───────────────────
  function populateMachineSelect(selectEl, machines, selectedId) {
    const firstOption = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (firstOption) selectEl.appendChild(firstOption);

    machines.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (selectedId && m.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  return {
    generateId,
    toast,
    openModal,
    closeModal,
    initModalCloseButtons,
    characterizationTag,
    escapeHtml,
    formatPeriod,
    populateSourceSelect,
    populateMachineSelect,
    CHARACTERIZATION_LABELS,
    METHOD_LABELS,
    PERIOD_LABELS,
    STATE_CATEGORIES,
    CAUSE_CATEGORIES,
  };
})();
