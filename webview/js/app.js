/* ═══════════════════════════════════════════════════════════════
   app.js — Main entry point
   Tab routing, sub-tab routing, DP browser, initialization
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
  'use strict';

  let _dpBrowserCallback = null;
  let _selectedDp = null;

  // ── Tab Navigation ──────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Deactivate all tabs
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        // Activate clicked tab
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById('tab-' + tabId).classList.add('active');
      });
    });

    // Sub-tabs (within the OEE tab)
    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.tab-pane');
        parent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.sub-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const subId = btn.getAttribute('data-subtab');
        document.getElementById('subtab-' + subId).classList.add('active');

        // Refresh analysis selects when switching to analysis tab
        if (subId === 'oeeAnalysis') {
          OeeAnalysis.refreshMachineSelect();
        }
      });
    });
  }

  // ── Datapoint Browser ──────────────────────────────────────
  function initDpBrowser() {
    const filterInput = document.getElementById('dpBrowserFilter');
    const tree = document.getElementById('dpBrowserTree');

    // Browse button for source config
    document.getElementById('btnBrowseDp').addEventListener('click', () => {
      openDpBrowser((dp) => {
        document.getElementById('srcDp').value = dp;
      });
    });

    // Browse button for machine state DP
    document.getElementById('btnBrowseMachDp').addEventListener('click', () => {
      openDpBrowser((dp) => {
        document.getElementById('machStateDp').value = dp;
      });
    });

    // Filter input
    filterInput.addEventListener('input', () => {
      _loadDpTree(filterInput.value);
    });

    // Select button
    document.getElementById('btnDpBrowserSelect').addEventListener('click', () => {
      if (_selectedDp && _dpBrowserCallback) {
        _dpBrowserCallback(_selectedDp);
        Utils.closeModal('modalDpBrowser');
      }
    });
  }

  function openDpBrowser(callback) {
    _dpBrowserCallback = callback;
    _selectedDp = null;
    document.getElementById('dpBrowserFilter').value = '';
    _loadDpTree('');
    Utils.openModal('modalDpBrowser');
  }

  async function _loadDpTree(filter) {
    const tree = document.getElementById('dpBrowserTree');
    tree.innerHTML = '<p style="color:#6b7c8e;padding:8px;">Loading...</p>';

    try {
      const dps = await OABridge.browseDatapoints(filter);
      if (dps.length === 0) {
        tree.innerHTML = '<p style="color:#6b7c8e;padding:8px;">No datapoints found.</p>';
        return;
      }

      tree.innerHTML = dps.map(dp => {
        return '<div class="dp-item" data-dp="' + Utils.escapeHtml(dp) + '">' +
          Utils.escapeHtml(dp) + '</div>';
      }).join('');

      tree.querySelectorAll('.dp-item').forEach(item => {
        item.addEventListener('click', () => {
          tree.querySelectorAll('.dp-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          _selectedDp = item.getAttribute('data-dp');
        });

        item.addEventListener('dblclick', () => {
          _selectedDp = item.getAttribute('data-dp');
          if (_dpBrowserCallback) {
            _dpBrowserCallback(_selectedDp);
            Utils.closeModal('modalDpBrowser');
          }
        });
      });
    } catch (err) {
      tree.innerHTML = '<p style="color:#d9363e;padding:8px;">Error loading datapoints: ' + err.message + '</p>';
    }
  }

  // ── Connection status ───────────────────────────────────────
  function updateConnectionStatus(mode) {
    const badge = document.getElementById('connectionStatus');
    if (mode === 'live') {
      badge.textContent = 'CONNECTED';
      badge.className = 'status-badge status-connected';
    } else {
      badge.textContent = 'SIMULATION MODE';
      badge.className = 'status-badge status-mock';
    }
  }

  // ── Boot ────────────────────────────────────────────────────
  function init() {
    // Initialize OA bridge
    const mode = OABridge.init();
    updateConnectionStatus(mode);

    // Initialize UI components
    Utils.initModalCloseButtons();
    initTabs();
    initDpBrowser();

    // Initialize config modules (order matters: sources first)
    SourceConfig.init();
    AggregationConfig.init();
    MachineStateConfig.init();
    OeeConfig.init();

    // Initialize display-time analysis module
    OeeAnalysis.init();

    // Initialize correction manager
    CorrectionManager.init();

    console.log('[App] KPI Configuration initialized (' + mode + ' mode)');
  }

  // ── Start on DOM ready ──────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, openDpBrowser };
})();
