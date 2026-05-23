/**
 * Tab Preview & Tab Run - Execution UI
 * RBA Studio Pro 2.0 - Electron renderer process
 */

const fs = require('fs');
const { ExcelLoopEngine } = require('../excelLoop.engine.js');
const { formatDuration, estimateTime, computeTotalLoop } = require('../excelLoop.config.js');

/**
 * Render Tab Preview with read-only workflow summary
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 */
function renderTabPreview(container, config) {
  container.innerHTML = '';
  container.style.padding = '16px';

  // Summary section
  const summarySection = createSection('Ringkasan');
  
  const summaryItems = [
    { label: 'File', value: truncatePath(config.excel_path) },
    { label: 'Sheet', value: config.sheet_name },
    { label: 'Range', value: `${config.kolom}${config.row_start}:${config.kolom}${config.row_end}` },
    { label: 'Total Loop', value: computeTotalLoop(config).toString() }
  ];

  summaryItems.forEach(item => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.paddingBottom = '8px';
    row.style.borderBottom = '1px solid #313244';

    const label = document.createElement('span');
    label.textContent = item.label;
    label.style.color = '#7f8b9a';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';

    const value = document.createElement('span');
    value.textContent = item.value;
    value.style.color = '#cdd6f4';
    value.style.fontSize = '12px';
    value.style.fontFamily = 'monospace';
    value.style.textAlign = 'right';

    row.appendChild(label);
    row.appendChild(value);
    summarySection.appendChild(row);
  });

  container.appendChild(summarySection);

  // Normal Flow section
  const normalSection = createSection('Alur Normal Flow');
  normalSection.style.marginTop = '24px';

  const normalList = document.createElement('ol');
  normalList.style.margin = '0';
  normalList.style.paddingLeft = '20px';

  // Step 1: Read cell
  let stepNum = 1;
  const step1 = createListItem(`Baca cell ${config.kolom}{row} dari Excel`);
  normalList.appendChild(step1);

  // Step 2: Copy
  const step2 = createListItem(`Copy nilai → delay ${config.d_after_copy}ms`);
  normalList.appendChild(step2);

  // Step 3: Switch tab
  const step3 = createListItem(`Pindah ke tab: "${config.tab_normal}" → delay ${config.d_tab_switch}ms`);
  normalList.appendChild(step3);

  // Steps for normal_steps
  stepNum = 4;
  const enabledSteps = config.normal_steps.filter(s => s.enabled);
  enabledSteps.forEach(step => {
    const targetStr = step.target_type === 'selector' 
      ? `CSS: ${step.css_selector}` 
      : `XY: ${step.x},${step.y}`;
    
    if (step.type === 'paste_field') {
      const pStep = createListItem(
        `[${stepNum}] Klik "${step.label}" (${targetStr}) → delay ${config.d_before_paste}ms, lalu Paste → delay ${config.d_after_paste}ms`
      );
      normalList.appendChild(pStep);
    } else {
      const delay = step.delay_after > 0 ? step.delay_after : config.d_between_clicks;
      const cStep = createListItem(
        `[${stepNum}] Klik "${step.label}" (${targetStr}) → delay ${delay}ms`
      );
      normalList.appendChild(cStep);
    }
    stepNum++;
  });

  // Final step: Back to Excel
  const finalStep = createListItem(`[${stepNum}] Kembali ke tab Excel → delay ${config.d_end_loop}ms`);
  normalList.appendChild(finalStep);

  normalSection.appendChild(normalList);
  container.appendChild(normalSection);

  // Periodic Flow section (if enabled)
  if (config.periodic_enabled && config.periodic_steps.length > 0) {
    const periodicSection = createSection('Alur Periodic Flow');
    periodicSection.style.marginTop = '24px';

    const periodicText = document.createElement('p');
    periodicText.textContent = `Setiap ${config.periodic_every} loop sesudah normal flow:`;
    periodicText.style.color = '#cdd6f4';
    periodicText.style.fontSize = '12px';
    periodicText.style.marginBottom = '12px';
    periodicSection.appendChild(periodicText);

    const periodicList = document.createElement('ol');
    periodicList.style.margin = '0';
    periodicList.style.paddingLeft = '20px';

    const p1 = createListItem(`[P1] Delay ${config.d_pre_periodic}ms`);
    periodicList.appendChild(p1);

    const p2 = createListItem(`[P2] Pindah ke tab: "${config.tab_periodic}" → delay ${config.d_periodic_tab_switch}ms`);
    periodicList.appendChild(p2);

    const enabledPeriodicSteps = config.periodic_steps.filter(s => s.enabled);
    let pNum = 3;
    enabledPeriodicSteps.forEach(step => {
      const targetStr = step.target_type === 'selector'
        ? `CSS: ${step.css_selector}`
        : `XY: ${step.x},${step.y}`;
      const pStep = createListItem(
        `[P${pNum}] Klik "${step.label}" (${targetStr}) → delay ${step.delay_after}ms`
      );
      periodicList.appendChild(pStep);
      pNum++;
    });

    const pFinal = createListItem(`[P${pNum}] Delay ${config.d_post_periodic}ms → kembali ke tab Excel`);
    periodicList.appendChild(pFinal);

    periodicSection.appendChild(periodicList);
    container.appendChild(periodicSection);
  }

  // Time Estimate section
  const timeSection = createSection('Estimasi Waktu');
  timeSection.style.marginTop = '24px';

  const est = estimateTime(config);

  const timeItems = [
    { label: 'Per loop', value: formatDuration(est.perLoop) },
    { label: 'Total (tanpa periodic)', value: formatDuration(est.totalNormal) },
    { label: 'Total (dengan periodic)', value: formatDuration(est.totalWithPeriodic) }
  ];

  timeItems.forEach(item => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.paddingBottom = '8px';
    row.style.borderBottom = '1px solid #313244';

    const label = document.createElement('span');
    label.textContent = item.label;
    label.style.color = '#7f8b9a';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';

    const value = document.createElement('span');
    value.textContent = item.value;
    value.style.color = '#a6e3a1';
    value.style.fontSize = '12px';
    value.style.fontWeight = 'bold';

    row.appendChild(label);
    row.appendChild(value);
    timeSection.appendChild(row);
  });

  container.appendChild(timeSection);
}

/**
 * Render Tab Run with execution controls and log panel
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 * @param {Object} engineRef - Reference object { engine: null }
 */
function renderTabRun(container, config, engineRef) {
  container.innerHTML = '';
  container.style.padding = '16px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '16px';

  // Initialize state display elements
  const bannerEl = document.createElement('div');
  bannerEl.style.padding = '12px 16px';
  bannerEl.style.borderRadius = '6px';
  bannerEl.style.background = '#313244';
  bannerEl.style.color = '#cdd6f4';
  bannerEl.style.fontSize = '13px';
  bannerEl.style.fontWeight = 'bold';
  bannerEl.textContent = 'Siap dijalankan';

  const statsGrid = document.createElement('div');
  statsGrid.style.display = 'grid';
  statsGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  statsGrid.style.gap = '12px';

  const loopCard = createStatCard('Loop', '0 / 0');
  const rowCard = createStatCard('Baris', '0');
  const processedCard = createStatCard('Diproses', '0');
  const skippedCard = createStatCard('Dilewati', '0');

  statsGrid.appendChild(loopCard);
  statsGrid.appendChild(rowCard);
  statsGrid.appendChild(processedCard);
  statsGrid.appendChild(skippedCard);

  const currentValueSection = document.createElement('div');
  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Nilai Cell Aktif:';
  valueLabel.style.display = 'block';
  valueLabel.style.color = '#cdd6f4';
  valueLabel.style.fontSize = '12px';
  valueLabel.style.fontWeight = '600';
  valueLabel.style.marginBottom = '6px';

  const valueDisplay = document.createElement('div');
  valueDisplay.style.fontFamily = 'monospace';
  valueDisplay.style.fontSize = '12px';
  valueDisplay.style.background = '#313244';
  valueDisplay.style.color = '#a6e3a1';
  valueDisplay.style.padding = '8px 10px';
  valueDisplay.style.borderRadius = '4px';
  valueDisplay.style.minHeight = '24px';
  valueDisplay.textContent = '(belum ada)';

  currentValueSection.appendChild(valueLabel);
  currentValueSection.appendChild(valueDisplay);

  // Control buttons
  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.gap = '8px';
  buttonGroup.style.flexWrap = 'wrap';

  const runBtn = document.createElement('button');
  runBtn.textContent = '▶ JALANKAN';
  runBtn.style.flex = '1';
  runBtn.style.minWidth = '100px';
  styleControlButton(runBtn, '#a6e3a1', false);

  const pauseBtn = document.createElement('button');
  pauseBtn.textContent = '⏸ JEDA';
  pauseBtn.style.flex = '1';
  pauseBtn.style.minWidth = '100px';
  styleControlButton(pauseBtn, '#f9e2af', true);

  const resumeBtn = document.createElement('button');
  resumeBtn.textContent = '▶ LANJUT';
  resumeBtn.style.flex = '1';
  resumeBtn.style.minWidth = '100px';
  styleControlButton(resumeBtn, '#89b4fa', true);

  const stopBtn = document.createElement('button');
  stopBtn.textContent = '⏹ STOP';
  stopBtn.style.flex = '1';
  stopBtn.style.minWidth = '100px';
  styleControlButton(stopBtn, '#f38ba8', true);

  buttonGroup.appendChild(runBtn);
  buttonGroup.appendChild(pauseBtn);
  buttonGroup.appendChild(resumeBtn);
  buttonGroup.appendChild(stopBtn);

  // Log panel
  const logSection = document.createElement('div');
  logSection.style.display = 'flex';
  logSection.style.flexDirection = 'column';
  logSection.style.gap = '8px';
  logSection.style.marginTop = '8px';

  const logHeader = document.createElement('div');
  logHeader.style.display = 'flex';
  logHeader.style.justifyContent = 'space-between';
  logHeader.style.alignItems = 'center';

  const logTitle = document.createElement('span');
  logTitle.textContent = '📋 Execution Log';
  logTitle.style.color = '#cdd6f4';
  logTitle.style.fontSize = '12px';
  logTitle.style.fontWeight = 'bold';

  const clearLogBtn = document.createElement('button');
  clearLogBtn.textContent = 'Clear';
  clearLogBtn.style.padding = '4px 8px';
  clearLogBtn.style.background = '#313244';
  clearLogBtn.style.color = '#cdd6f4';
  clearLogBtn.style.border = '1px solid #313244';
  clearLogBtn.style.borderRadius = '3px';
  clearLogBtn.style.fontSize = '11px';
  clearLogBtn.style.cursor = 'pointer';

  logHeader.appendChild(logTitle);
  logHeader.appendChild(clearLogBtn);

  const logDiv = document.createElement('div');
  logDiv.style.maxHeight = '280px';
  logDiv.style.overflowY = 'auto';
  logDiv.style.fontFamily = 'monospace';
  logDiv.style.fontSize = '12px';
  logDiv.style.background = '#181825';
  logDiv.style.padding = '8px';
  logDiv.style.borderRadius = '4px';
  logDiv.style.border = '1px solid #313244';
  logDiv.style.color = '#cdd6f4';
  logDiv.style.minHeight = '120px';

  logSection.appendChild(logHeader);
  logSection.appendChild(logDiv);

  container.appendChild(bannerEl);
  container.appendChild(statsGrid);
  container.appendChild(currentValueSection);
  container.appendChild(buttonGroup);
  container.appendChild(logSection);

  // Helper functions to update UI
  function updateBanner(state) {
    let text, color;

    if (state.is_running && state.is_paused) {
      text = `⏸ Dijeda pada loop ${state.counter}`;
      color = '#f9e2af';
    } else if (state.is_running) {
      text = `▶ Berjalan — Loop ${state.counter}/${config.total_loop} | Baris ${state.current_row}`;
      color = '#a6e3a1';
      bannerEl.style.animation = 'pulse 1.5s infinite';
    } else if (!state.is_running && state.counter > 0 && !state.errors.length) {
      text = `✅ Selesai — ${state.total_processed} baris diproses`;
      color = '#89b4fa';
      bannerEl.style.animation = 'none';
    } else {
      text = 'Siap dijalankan';
      color = '#313244';
      bannerEl.style.animation = 'none';
    }

    bannerEl.textContent = text;
    bannerEl.style.background = color;
    bannerEl.style.color = '#1e1e2e';
  }

  function updateStats(state) {
    loopCard.querySelector('div:last-child').textContent = `${state.counter} / ${config.total_loop}`;
    rowCard.querySelector('div:last-child').textContent = state.current_row.toString();
    processedCard.querySelector('div:last-child').textContent = state.total_processed.toString();
    skippedCard.querySelector('div:last-child').textContent = state.total_skipped.toString();
  }

  function updateCurrentValue(state) {
    valueDisplay.textContent = state.current_value || '(kosong)';
  }

  function updateButtons(state) {
    runBtn.disabled = state.is_running;
    pauseBtn.disabled = !state.is_running || state.is_paused;
    resumeBtn.disabled = !state.is_paused;
    stopBtn.disabled = !state.is_running && !state.is_paused;

    styleControlButton(runBtn, '#a6e3a1', runBtn.disabled);
    styleControlButton(pauseBtn, '#f9e2af', pauseBtn.disabled);
    styleControlButton(resumeBtn, '#89b4fa', resumeBtn.disabled);
    styleControlButton(stopBtn, '#f38ba8', stopBtn.disabled);
  }

  function appendLog(level, message) {
    const time = new Date().toTimeString().slice(0, 8);
    const entry = document.createElement('div');

    let color = '#cdd6f4';
    if (level === 'SUCCESS') color = '#a6e3a1';
    if (level === 'WARN') color = '#f9e2af';
    if (level === 'ERROR') color = '#f38ba8';

    entry.innerHTML = `<span style="color: ${color}">[${time}] [${level}] ${message}</span>`;
    entry.style.marginBottom = '2px';
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  // Button event handlers
  runBtn.addEventListener('click', async () => {
    // STEP 1: Validation
    appendLog('INFO', '═══ VALIDASI KONFIGURASI ═══');
    
    if (!config.excel_path || config.excel_path.trim() === '') {
      appendLog('ERROR', '❌ Path file Excel kosong. Buka tab Excel dan pilih file.');
      return;
    }

    if (!fs.existsSync(config.excel_path)) {
      appendLog('ERROR', `❌ File tidak ditemukan: ${config.excel_path}`);
      return;
    }

    if (!config.sheet_name || config.sheet_name.trim() === '') {
      appendLog('ERROR', '❌ Nama sheet kosong.');
      return;
    }

    if (!config.kolom || config.kolom.trim() === '') {
      appendLog('ERROR', '❌ Kolom target kosong.');
      return;
    }

    if (config.row_start < 1 || isNaN(config.row_start)) {
      appendLog('ERROR', `❌ Baris Mulai tidak valid: ${config.row_start}`);
      return;
    }

    if (config.row_end < config.row_start || isNaN(config.row_end)) {
      appendLog('ERROR', `❌ Baris Selesai tidak valid: ${config.row_end}`);
      return;
    }

    if (!config.tab_normal || config.tab_normal.trim() === '') {
      appendLog('WARN', '⚠️ Tab Normal Flow kosong, akan skip paste');
    }

    if (!config.normal_steps || config.normal_steps.length === 0) {
      appendLog('WARN', '⚠️ Normal Flow kosong, tidak ada step yang akan dijalankan');
    }

    // STEP 2: Log config summary
    appendLog('INFO', '═══ KONFIGURASI LOADED ═══');
    appendLog('INFO', `📄 File: ${config.excel_path}`);
    appendLog('INFO', `📋 Sheet: ${config.sheet_name}`);
    appendLog('INFO', `📍 Kolom: ${config.kolom} | Baris: ${config.row_start}-${config.row_end}`);
    appendLog('INFO', `🔢 Total Loop: ${config.total_loop}`);
    appendLog('INFO', `📑 Tab Normal: ${config.tab_normal || '(kosong)'}`);
    appendLog('INFO', `⚙️ Steps: ${(config.normal_steps || []).filter(s => s.enabled).length} aktif`);

    // STEP 3: Create engine
    appendLog('INFO', '═══ INISIALISASI ENGINE ═══');
    appendLog('INFO', '⏳ Membuat Excel Loop Engine...');

    engineRef.engine = new ExcelLoopEngine(config, appendLog, (state) => {
      updateBanner(state);
      updateStats(state);
      updateCurrentValue(state);
      updateButtons(state);
    });

    // STEP 4: Run engine
    appendLog('INFO', '═══ EKSEKUSI DIMULAI ═══');
    
    try {
      // Disable run button, enable stop
      runBtn.disabled = true;
      stopBtn.disabled = false;

      // Run
      await engineRef.engine.run();

      appendLog('SUCCESS', '✅ Eksekusi selesai');
    } catch (err) {
      appendLog('ERROR', `❌ Eksekusi gagal: ${err.message}`);
      appendLog('ERROR', `Stack: ${err.stack || '(no stack)'}`);
    } finally {
      // Re-enable buttons
      runBtn.disabled = false;
      stopBtn.disabled = true;
      engineRef.engine = null;
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (engineRef.engine) {
      appendLog('WARN', '⏸ Pause diminta...');
      engineRef.engine.pause();
    }
  });

  resumeBtn.addEventListener('click', () => {
    if (engineRef.engine) {
      appendLog('INFO', '▶ Resume diminta...');
      engineRef.engine.resume();
    }
  });

  stopBtn.addEventListener('click', () => {
    if (engineRef.engine) {
      appendLog('WARN', '⏹ Stop diminta...');
      engineRef.engine.stop();
    }
  });

  clearLogBtn.addEventListener('click', () => {
    logDiv.innerHTML = '';
  });

  // Add pulse animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════

function createSection(title) {
  const section = document.createElement('div');
  section.style.border = '1px solid #313244';
  section.style.borderRadius = '8px';
  section.style.padding = '16px';
  section.style.background = '#0f1318';

  if (title) {
    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.margin = '0 0 16px 0';
    titleEl.style.color = '#cdd6f4';
    titleEl.style.fontSize = '14px';
    titleEl.style.fontWeight = '600';
    titleEl.style.borderBottom = '1px solid #313244';
    titleEl.style.paddingBottom = '12px';
    section.appendChild(titleEl);
  }

  return section;
}

function createListItem(text) {
  const li = document.createElement('li');
  li.textContent = text;
  li.style.color = '#cdd6f4';
  li.style.fontSize = '12px';
  li.style.marginBottom = '6px';
  li.style.lineHeight = '1.5';
  return li;
}

function createStatCard(label, value) {
  const card = document.createElement('div');
  card.style.border = '1px solid #313244';
  card.style.borderRadius = '6px';
  card.style.background = '#0f1318';
  card.style.padding = '12px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '6px';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.color = '#7f8b9a';
  labelEl.style.fontSize = '11px';
  labelEl.style.fontWeight = '600';
  labelEl.style.textTransform = 'uppercase';

  const valueEl = document.createElement('div');
  valueEl.textContent = value;
  valueEl.style.color = '#cdd6f4';
  valueEl.style.fontSize = '14px';
  valueEl.style.fontWeight = 'bold';
  valueEl.style.fontFamily = 'monospace';

  card.appendChild(labelEl);
  card.appendChild(valueEl);

  return card;
}

function styleControlButton(button, bgColor, disabled) {
  button.style.padding = '10px 16px';
  button.style.background = disabled ? '#313244' : bgColor;
  button.style.color = '#1e1e2e';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.cursor = disabled ? 'not-allowed' : 'pointer';
  button.style.fontWeight = 'bold';
  button.style.fontSize = '12px';
  button.style.opacity = disabled ? '0.5' : '1';
  button.style.transition = 'opacity 0.2s';
}

function truncatePath(path) {
  if (path.length > 50) {
    return '...' + path.slice(-47);
  }
  return path;
}

module.exports = { renderTabPreview, renderTabRun };
