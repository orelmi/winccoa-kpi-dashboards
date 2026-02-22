/* ═══════════════════════════════════════════════════════════════
   demoSeed.js — Populate localStorage with coherent demo data
   ═══════════════════════════════════════════════════════════════
   Load this script ONCE via the browser console or include it
   temporarily in any page.  After seeding, remove or comment out.

   Usage in console:
     DemoSeed.seed();      // populate all demo data
     DemoSeed.clear();     // wipe all demo data
   ═══════════════════════════════════════════════════════════════ */

const DemoSeed = (() => {
  'use strict';

  // ── Deterministic IDs (so cross-references are consistent) ──
  const ID = {
    // Sites / Areas / Lines / Machines
    site_munich:     'ast_site_munich',
    area_bldgA:      'ast_area_bldgA',
    area_bldgB:      'ast_area_bldgB',
    line_pkg1:       'ast_line_pkg1',
    line_pkg2:       'ast_line_pkg2',
    line_fill:       'ast_line_fill',
    mach_labeler:    'ast_mach_labeler',
    mach_palletizer: 'ast_mach_palletizer',
    mach_filler:     'ast_mach_filler',
    mach_capper:     'ast_mach_capper',
    // Sources
    src_water_cnt:   'src_water_cnt',
    src_water_flow:  'src_water_flow',
    src_elec_energy: 'src_elec_energy',
    src_elec_power:  'src_elec_power',
    src_line1_state: 'src_line1_state',
    src_line1_piece: 'src_line1_piece',
    src_line1_rej:   'src_line1_rej',
    src_line2_state: 'src_line2_state',
    src_line2_piece: 'src_line2_piece',
    src_fill_state:  'src_fill_state',
    src_fill_piece:  'src_fill_piece',
    src_temp_supply: 'src_temp_supply',
    // Aggregations
    agg_water_hourly: 'agg_water_hourly',
    agg_water_daily:  'agg_water_daily',
    agg_elec_shift:   'agg_elec_shift',
    agg_temp_avg:     'agg_temp_avg',
    // Machines
    mach_line1:  'mach_line1',
    mach_line2:  'mach_line2',
    mach_filler_cfg: 'mach_filler_cfg',
    // OEE
    oee_line1:  'oee_line1',
    oee_line2:  'oee_line2',
    oee_filler: 'oee_filler',
  };

  // ── Sources ──────────────────────────────────────────────────
  const sources = [
    {
      id: ID.src_water_cnt, name: 'Water Counter Bldg A',
      dpSource: 'System1:Plant.Water.Counter', dataType: 'FLOAT',
      characterization: 'COUNTER', unit: 'm³',
      archEnabled: true, archClass: '_1min', smoothMode: 'DEADBAND_ABS', smoothValue: 0.1,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_water_flow, name: 'Water Flow Rate',
      dpSource: 'System1:Plant.Water.FlowRate', dataType: 'FLOAT',
      characterization: 'FLOW_RATE', unit: 'm³/h',
      archEnabled: true, archClass: '_10s', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: 500,
    },
    {
      id: ID.src_elec_energy, name: 'Electricity Meter',
      dpSource: 'System1:Plant.Elec.EnergyMeter', dataType: 'FLOAT',
      characterization: 'ENERGY', unit: 'kWh',
      archEnabled: true, archClass: '_1min', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_elec_power, name: 'Active Power',
      dpSource: 'System1:Plant.Elec.Power', dataType: 'FLOAT',
      characterization: 'PROCESS_VALUE', unit: 'kW',
      archEnabled: true, archClass: '_5s', smoothMode: 'DEADBAND_REL', smoothValue: 1,
      minValid: 0, maxValid: 10000,
    },
    {
      id: ID.src_line1_state, name: 'Packaging Line 1 — State',
      dpSource: 'System1:Line1.MachineState', dataType: 'INT',
      characterization: 'MACHINE_STATE', unit: '',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: null, maxValid: null,
    },
    {
      id: ID.src_line1_piece, name: 'Packaging Line 1 — Piece Counter',
      dpSource: 'System1:Line1.PieceCounter', dataType: 'FLOAT',
      characterization: 'COUNTER', unit: 'pcs',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_line1_rej, name: 'Packaging Line 1 — Reject Counter',
      dpSource: 'System1:Line1.RejectCounter', dataType: 'FLOAT',
      characterization: 'COUNTER', unit: 'pcs',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_line2_state, name: 'Packaging Line 2 — State',
      dpSource: 'System1:Line2.MachineState', dataType: 'INT',
      characterization: 'MACHINE_STATE', unit: '',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: null, maxValid: null,
    },
    {
      id: ID.src_line2_piece, name: 'Packaging Line 2 — Piece Counter',
      dpSource: 'System1:Line2.PieceCounter', dataType: 'FLOAT',
      characterization: 'COUNTER', unit: 'pcs',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_fill_state, name: 'Filling Machine — State',
      dpSource: 'System1:Line1.FillerState', dataType: 'INT',
      characterization: 'MACHINE_STATE', unit: '',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: null, maxValid: null,
    },
    {
      id: ID.src_fill_piece, name: 'Filling Machine — Bottle Counter',
      dpSource: 'System1:Line1.FillerCounter', dataType: 'FLOAT',
      characterization: 'COUNTER', unit: 'bottles',
      archEnabled: true, archClass: '_EVENT', smoothMode: 'NONE', smoothValue: 0,
      minValid: 0, maxValid: null,
    },
    {
      id: ID.src_temp_supply, name: 'HVAC Supply Temperature',
      dpSource: 'System1:Plant.HVAC.TempSupply', dataType: 'FLOAT',
      characterization: 'PROCESS_VALUE', unit: '°C',
      archEnabled: true, archClass: '_30s', smoothMode: 'DEADBAND_ABS', smoothValue: 0.5,
      minValid: -20, maxValid: 80,
    },
  ];

  // ── Aggregations ─────────────────────────────────────────────
  const aggregations = [
    {
      id: ID.agg_water_hourly, name: 'Hourly Water Consumption',
      sourceRef: ID.src_water_cnt, method: 'DELTA',
      periodType: 'CALENDAR_ALIGNED', alignment: 'HOUR', slidingSeconds: null,
      targetDp: 'KPI_Agg.Water_Hourly', enabled: true, expression: '',
    },
    {
      id: ID.agg_water_daily, name: 'Daily Water Consumption',
      sourceRef: ID.src_water_cnt, method: 'DELTA',
      periodType: 'CALENDAR_ALIGNED', alignment: 'DAY', slidingSeconds: null,
      targetDp: 'KPI_Agg.Water_Daily', enabled: true, expression: '',
    },
    {
      id: ID.agg_elec_shift, name: 'Shift Electricity Consumption',
      sourceRef: ID.src_elec_energy, method: 'DELTA',
      periodType: 'CALENDAR_ALIGNED', alignment: 'SHIFT', slidingSeconds: null,
      targetDp: 'KPI_Agg.Elec_Shift', enabled: true, expression: '',
    },
    {
      id: ID.agg_temp_avg, name: 'Hourly Avg Supply Temperature',
      sourceRef: ID.src_temp_supply, method: 'TIME_WEIGHTED_AVG',
      periodType: 'CALENDAR_ALIGNED', alignment: 'HOUR', slidingSeconds: null,
      targetDp: 'KPI_Agg.Temp_Avg', enabled: true, expression: '',
    },
  ];

  // ── Machine state definitions (Packaging preset) ─────────────
  const defaultStates = [
    { value: 0, label: 'Off',              category: 'IDLE',           color: '#6c757d', isPlanned: false },
    { value: 1, label: 'Producing',         category: 'PRODUCING',      color: '#28a745', isPlanned: false },
    { value: 2, label: 'Idle',              category: 'IDLE',           color: '#ffc107', isPlanned: false },
    { value: 3, label: 'Planned Stop',      category: 'PLANNED_STOP',   color: '#17a2b8', isPlanned: true  },
    { value: 4, label: 'Unplanned Stop',    category: 'UNPLANNED_STOP', color: '#d9363e', isPlanned: false },
    { value: 5, label: 'Setup / Changeover',category: 'SETUP',          color: '#6f42c1', isPlanned: true  },
    { value: 6, label: 'Maintenance',       category: 'MAINTENANCE',    color: '#fd7e14', isPlanned: true  },
    { value: 7, label: 'Cleaning',          category: 'PLANNED_STOP',   color: '#20c997', isPlanned: true  },
  ];

  const defaultCauses = [
    { id: 'c1', value: 101, label: 'Motor failure',     category: 'MECHANICAL', parentId: null },
    { id: 'c2', value: 102, label: 'Belt breakage',     category: 'MECHANICAL', parentId: null },
    { id: 'c3', value: 201, label: 'Sensor fault',      category: 'ELECTRICAL', parentId: null },
    { id: 'c4', value: 202, label: 'PLC error',         category: 'ELECTRICAL', parentId: null },
    { id: 'c5', value: 301, label: 'Material jam',      category: 'PROCESS',    parentId: null },
    { id: 'c6', value: 302, label: 'Label misfeed',     category: 'PROCESS',    parentId: null },
    { id: 'c7', value: 401, label: 'Operator error',    category: 'OPERATOR',   parentId: null },
    { id: 'c8', value: 501, label: 'Defective material',category: 'QUALITY',    parentId: null },
    { id: 'c9', value: 601, label: 'No material supply',category: 'SUPPLY',     parentId: null },
  ];

  const machines = [
    {
      id: ID.mach_line1, name: 'Packaging Line 1',
      stateDp: 'System1:Line1.MachineState', causeDp: 'System1:Line1.StopCause',
      states: defaultStates,
      causeTracking: true,
      causes: defaultCauses,
    },
    {
      id: ID.mach_line2, name: 'Packaging Line 2',
      stateDp: 'System1:Line2.MachineState', causeDp: 'System1:Line2.StopCause',
      states: defaultStates.slice(0, 7),  // 7 states (no Cleaning)
      causeTracking: true,
      causes: defaultCauses.slice(0, 7),
    },
    {
      id: ID.mach_filler_cfg, name: 'Filling Machine',
      stateDp: 'System1:Line1.FillerState', causeDp: '',
      states: [
        { value: 0, label: 'Stopped',    category: 'IDLE',           color: '#6c757d', isPlanned: false },
        { value: 1, label: 'Running',     category: 'PRODUCING',      color: '#28a745', isPlanned: false },
        { value: 2, label: 'CIP Cleaning',category: 'PLANNED_STOP',   color: '#20c997', isPlanned: true  },
        { value: 3, label: 'Breakdown',   category: 'UNPLANNED_STOP', color: '#d9363e', isPlanned: false },
        { value: 4, label: 'Changeover',  category: 'SETUP',          color: '#6f42c1', isPlanned: true  },
      ],
      causeTracking: false,
      causes: [],
    },
  ];

  // ── OEE Configurations ───────────────────────────────────────
  const oeeConfigs = [
    {
      id: ID.oee_line1, name: 'Packaging Line 1 OEE',
      machineRef: ID.mach_line1,
      calendarMode: 'CALENDAR',
      plannedHours: 16,
      availMethod: 'FROM_STATES',
      perfMethod: 'CYCLE_TIME',
      idealCycleTime: 0.8,
      designSpeed: null,
      piecesSourceRef: ID.src_line1_piece,
      qualityMethod: 'REJECT_PIECES',
      goodSourceRef: null,
      rejectSourceRef: ID.src_line1_rej,
      fixedQuality: null,
      period: 'SHIFT',
      targetDp: 'KPI_OEE.Packaging_Line_1',
      enabled: true,
      microstopThresholdSec: 120,
      limits: {
        oeeWarn: 65, oeeAlarm: 50,
        availabilityWarn: 85, availabilityAlarm: 70,
        performanceWarn: 80, performanceAlarm: 60,
        qualityWarn: 95, qualityAlarm: 90,
        mtbfWarn: 7200, mtbfAlarm: 3600,
        mttrWarn: 1800, mttrAlarm: 3600,
      },
    },
    {
      id: ID.oee_line2, name: 'Packaging Line 2 OEE',
      machineRef: ID.mach_line2,
      calendarMode: 'CALENDAR',
      plannedHours: 16,
      availMethod: 'FROM_STATES',
      perfMethod: 'DESIGN_SPEED',
      idealCycleTime: null,
      designSpeed: 4000,
      piecesSourceRef: ID.src_line2_piece,
      qualityMethod: 'FIXED_RATIO',
      goodSourceRef: null,
      rejectSourceRef: null,
      fixedQuality: 98.5,
      period: 'SHIFT',
      targetDp: 'KPI_OEE.Packaging_Line_2',
      enabled: true,
      microstopThresholdSec: 60,
      limits: {
        oeeWarn: 60, oeeAlarm: 45,
        availabilityWarn: 80, availabilityAlarm: 65,
        performanceWarn: 75, performanceAlarm: 55,
        qualityWarn: 95, qualityAlarm: 90,
        mtbfWarn: null, mtbfAlarm: null,
        mttrWarn: null, mttrAlarm: null,
      },
    },
    {
      id: ID.oee_filler, name: 'Filling Machine OEE',
      machineRef: ID.mach_filler_cfg,
      calendarMode: 'FIXED',
      plannedHours: 20,
      availMethod: 'FROM_STATES',
      perfMethod: 'CYCLE_TIME',
      idealCycleTime: 0.5,
      designSpeed: null,
      piecesSourceRef: ID.src_fill_piece,
      qualityMethod: 'FIXED_RATIO',
      goodSourceRef: null,
      rejectSourceRef: null,
      fixedQuality: 99.2,
      period: 'DAY',
      targetDp: 'KPI_OEE.Filling_Machine',
      enabled: true,
      microstopThresholdSec: 0,
      limits: {
        oeeWarn: 70, oeeAlarm: 55,
        availabilityWarn: 90, availabilityAlarm: 75,
        performanceWarn: 85, performanceAlarm: 70,
        qualityWarn: 98, qualityAlarm: 95,
        mtbfWarn: null, mtbfAlarm: null,
        mttrWarn: null, mttrAlarm: null,
      },
    },
  ];

  // ── Production Calendar ──────────────────────────────────────
  const calendar = {
    shifts: [
      {
        id: 'shift_morning', name: 'Morning Shift',
        startTime: '06:00', endTime: '14:00',
        category: 'PRODUCTION', days: [1, 2, 3, 4, 5], enabled: true,
      },
      {
        id: 'shift_afternoon', name: 'Afternoon Shift',
        startTime: '14:00', endTime: '22:00',
        category: 'PRODUCTION', days: [1, 2, 3, 4, 5], enabled: true,
      },
      {
        id: 'shift_night', name: 'Night Shift',
        startTime: '22:00', endTime: '06:00',
        category: 'PRODUCTION', days: [1, 2, 3, 4], enabled: true,
      },
      {
        id: 'shift_maint', name: 'Saturday Maintenance',
        startTime: '08:00', endTime: '16:00',
        category: 'MAINTENANCE', days: [6], enabled: true,
      },
    ],
    exceptions: [
      {
        id: 'ex_xmas', name: 'Christmas Day', date: '2026-12-25',
        category: 'HOLIDAY', recurring: true, recurringMonth: 12, recurringDay: 25,
      },
      {
        id: 'ex_newyear', name: 'New Year', date: '2027-01-01',
        category: 'HOLIDAY', recurring: true, recurringMonth: 1, recurringDay: 1,
      },
      {
        id: 'ex_shutdown', name: 'Annual Plant Shutdown 2026',
        date: '2026-08-01', category: 'PLANT_SHUTDOWN',
        recurring: false, recurringMonth: null, recurringDay: null,
      },
    ],
    connector: null,
  };

  // ── Asset Hierarchy ──────────────────────────────────────────
  const assets = [
    {
      id: ID.site_munich, name: 'Munich Factory', type: 'SITE',
      parentId: null, calendarRef: '__assigned__',
      refs: { machines: [], sources: [ID.src_water_cnt, ID.src_water_flow, ID.src_elec_energy, ID.src_elec_power, ID.src_temp_supply], aggregations: [ID.agg_water_hourly, ID.agg_water_daily, ID.agg_elec_shift, ID.agg_temp_avg], oeeConfigs: [] },
    },
    {
      id: ID.area_bldgA, name: 'Building A — Production', type: 'AREA',
      parentId: ID.site_munich, calendarRef: '',
      refs: { machines: [], sources: [], aggregations: [], oeeConfigs: [] },
    },
    {
      id: ID.area_bldgB, name: 'Building B — Utilities', type: 'AREA',
      parentId: ID.site_munich, calendarRef: '',
      refs: { machines: [], sources: [ID.src_temp_supply], aggregations: [ID.agg_temp_avg], oeeConfigs: [] },
    },
    {
      id: ID.line_pkg1, name: 'Packaging Line 1', type: 'LINE',
      parentId: ID.area_bldgA, calendarRef: '',
      refs: { machines: [ID.mach_line1], sources: [ID.src_line1_state, ID.src_line1_piece, ID.src_line1_rej], aggregations: [], oeeConfigs: [ID.oee_line1] },
    },
    {
      id: ID.line_pkg2, name: 'Packaging Line 2', type: 'LINE',
      parentId: ID.area_bldgA, calendarRef: '',
      refs: { machines: [ID.mach_line2], sources: [ID.src_line2_state, ID.src_line2_piece], aggregations: [], oeeConfigs: [ID.oee_line2] },
    },
    {
      id: ID.line_fill, name: 'Filling Line', type: 'LINE',
      parentId: ID.area_bldgA, calendarRef: '',
      refs: { machines: [ID.mach_filler_cfg], sources: [ID.src_fill_state, ID.src_fill_piece], aggregations: [], oeeConfigs: [ID.oee_filler] },
    },
    {
      id: ID.mach_labeler, name: 'Labeler', type: 'MACHINE',
      parentId: ID.line_pkg1, calendarRef: '',
      refs: { machines: [], sources: [], aggregations: [], oeeConfigs: [] },
    },
    {
      id: ID.mach_palletizer, name: 'Palletizer', type: 'MACHINE',
      parentId: ID.line_pkg1, calendarRef: '',
      refs: { machines: [], sources: [], aggregations: [], oeeConfigs: [] },
    },
    {
      id: ID.mach_filler, name: 'Filler Unit', type: 'MACHINE',
      parentId: ID.line_fill, calendarRef: '',
      refs: { machines: [], sources: [], aggregations: [], oeeConfigs: [] },
    },
    {
      id: ID.mach_capper, name: 'Capper', type: 'MACHINE',
      parentId: ID.line_fill, calendarRef: '',
      refs: { machines: [], sources: [], aggregations: [], oeeConfigs: [] },
    },
  ];

  // ── Event Log (some sample entries) ──────────────────────────
  function _demoEvents() {
    const now = Date.now();
    const h = 3600000;
    return [
      { id: 'evt_d1', timestamp: new Date(now - 48 * h).toISOString(), action: 'create', module: 'sources', item: 'Water Counter Bldg A', details: 'System1:Plant.Water.Counter' },
      { id: 'evt_d2', timestamp: new Date(now - 47 * h).toISOString(), action: 'create', module: 'sources', item: 'Packaging Line 1 — State', details: 'System1:Line1.MachineState' },
      { id: 'evt_d3', timestamp: new Date(now - 46 * h).toISOString(), action: 'create', module: 'machines', item: 'Packaging Line 1', details: '8 states, 9 causes' },
      { id: 'evt_d4', timestamp: new Date(now - 44 * h).toISOString(), action: 'create', module: 'machines', item: 'Packaging Line 2', details: '7 states, 7 causes' },
      { id: 'evt_d5', timestamp: new Date(now - 42 * h).toISOString(), action: 'create', module: 'calendar', item: 'Morning Shift', details: 'shift 06:00-14:00' },
      { id: 'evt_d6', timestamp: new Date(now - 42 * h).toISOString(), action: 'create', module: 'calendar', item: 'Afternoon Shift', details: 'shift 14:00-22:00' },
      { id: 'evt_d7', timestamp: new Date(now - 42 * h).toISOString(), action: 'create', module: 'calendar', item: 'Night Shift', details: 'shift 22:00-06:00' },
      { id: 'evt_d8', timestamp: new Date(now - 40 * h).toISOString(), action: 'create', module: 'oee', item: 'Packaging Line 1 OEE', details: 'SHIFT' },
      { id: 'evt_d9', timestamp: new Date(now - 40 * h).toISOString(), action: 'create', module: 'oee', item: 'Packaging Line 2 OEE', details: 'SHIFT' },
      { id: 'evt_d10', timestamp: new Date(now - 38 * h).toISOString(), action: 'create', module: 'assets', item: 'Munich Factory', details: 'SITE' },
      { id: 'evt_d11', timestamp: new Date(now - 37 * h).toISOString(), action: 'create', module: 'assets', item: 'Building A — Production', details: 'AREA' },
      { id: 'evt_d12', timestamp: new Date(now - 24 * h).toISOString(), action: 'update', module: 'oee', item: 'Packaging Line 1 OEE', details: 'Switched to CALENDAR mode' },
      { id: 'evt_d13', timestamp: new Date(now - 12 * h).toISOString(), action: 'create', module: 'aggregations', item: 'Hourly Water Consumption', details: 'DELTA / HOUR' },
      { id: 'evt_d14', timestamp: new Date(now - 6 * h).toISOString(), action: 'update', module: 'machines', item: 'Filling Machine', details: 'Added CIP Cleaning state' },
      { id: 'evt_d15', timestamp: new Date(now - 2 * h).toISOString(), action: 'create', module: 'calendar', item: 'Christmas Day', details: 'exception recurring' },
    ];
  }

  // ── Seed / Clear ─────────────────────────────────────────────
  function seed() {
    localStorage.setItem('kpi_config_sources', JSON.stringify(sources));
    localStorage.setItem('kpi_config_aggregations', JSON.stringify(aggregations));
    localStorage.setItem('kpi_config_machines', JSON.stringify(machines));
    localStorage.setItem('kpi_config_oee', JSON.stringify(oeeConfigs));
    localStorage.setItem('kpi_config_calendar', JSON.stringify(calendar));
    localStorage.setItem('kpi_config_assets', JSON.stringify(assets));
    localStorage.setItem('kpi_config_eventLog', JSON.stringify(_demoEvents()));

    // Set default context to Building A so context filtering is visible
    localStorage.setItem('kpi_asset_context', ID.area_bldgA);

    console.log('[DemoSeed] Demo data seeded. Reload any page to see the data.');
    if (typeof location !== 'undefined') location.reload();
  }

  function clear() {
    [
      'kpi_config_sources', 'kpi_config_aggregations', 'kpi_config_machines',
      'kpi_config_oee', 'kpi_config_calendar', 'kpi_config_assets',
      'kpi_config_eventLog', 'kpi_config_stateTemplates',
      'kpi_asset_context', 'kpi_corrections',
    ].forEach(key => localStorage.removeItem(key));

    console.log('[DemoSeed] All demo data cleared. Reload any page.');
    if (typeof location !== 'undefined') location.reload();
  }

  return { seed, clear };
})();
