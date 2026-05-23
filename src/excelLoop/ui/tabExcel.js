/**
 * Tab Excel & Tab Delay UI Renderer
 * RBA Studio Pro 2.0 - Electron renderer process
 */

const electronAPI = (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.invoke === 'function') ? window.electronAPI : null;
const safeInvoke = async (channel, data) => {
  if (electronAPI) return electronAPI.invoke(channel, data);
  if (typeof window.require === 'function') {
    try {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer.invoke(channel, data);
    } catch (err) {
      console.warn('safeInvoke require error:', err);
    }
  }
  throw new Error('IPC tidak tersedia');
};
const { computeTotalLoop } = require('../excelLoop.config.js');

/**
 * Render Tab Excel with Excel file config and read options
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 * @param {Function} onChange - Callback when config changes
 */
function renderTabExcel(container, config, onChange) {
  container.innerHTML = '';
  container.style.padding = '16px';

  // ═══ SEKSI "Sumber File Excel" ═══
  const sourceSection = createSection('📄 Sumber File Excel');

  // 1. Path File
  const pathGroup = createFormGroup('Path File', 'Path absolut ke file .xlsx atau .xls');
  const pathContainer = document.createElement('div');
  pathContainer.style.display = 'flex';
  pathContainer.style.gap = '8px';
  pathContainer.style.alignItems = 'center';

  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.value = config.excel_path;
  pathInput.placeholder = 'C:\\Users\\user\\data.xlsx';
  pathInput.style.flex = '1';
  styleInput(pathInput);

  pathInput.addEventListener('change', () => {
    config.excel_path = pathInput.value;
    onChange(config);
  });

  const browseBtn = document.createElement('button');
  browseBtn.textContent = '📂 Browse';
  browseBtn.style.padding = '8px 12px';
  browseBtn.style.background = '#89b4fa';
  browseBtn.style.color = '#1e1e2e';
  browseBtn.style.border = 'none';
  browseBtn.style.borderRadius = '4px';
  browseBtn.style.cursor = 'pointer';
  browseBtn.style.fontWeight = 'bold';

  browseBtn.addEventListener('click', () => {
    safeInvoke('open-file-dialog', {
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }]
    }).then(result => {
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        config.excel_path = result.filePaths[0];
        pathInput.value = config.excel_path;
        onChange(config);
      }
    }).catch(err => console.error('File dialog error:', err));
  });

  pathContainer.appendChild(pathInput);
  pathContainer.appendChild(browseBtn);
  pathGroup.appendChild(pathContainer);
  sourceSection.appendChild(pathGroup);

  // 2. Nama Sheet
  const sheetGroup = createFormGroup('Nama Sheet', '');
  const sheetInput = document.createElement('input');
  sheetInput.type = 'text';
  sheetInput.value = config.sheet_name;
  styleInput(sheetInput);

  sheetInput.addEventListener('change', () => {
    config.sheet_name = sheetInput.value;
    onChange(config);
  });

  sheetGroup.appendChild(sheetInput);
  sourceSection.appendChild(sheetGroup);

  // 3. Grid: Kolom Target, Row Mulai, Row Akhir, Total Loop
  const gridGroup = createFormGroup('', '');
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.style.gap = '12px';

  // Kolom Target
  const colGroup = createGridItem('Kolom Target', 'Huruf kolom: A, B, C ...');
  const colInput = document.createElement('input');
  colInput.type = 'text';
  colInput.maxLength = '3';
  colInput.value = config.kolom;
  styleInput(colInput);
  colInput.addEventListener('input', () => {
    config.kolom = colInput.value.toUpperCase();
    colInput.value = config.kolom;
    config.total_loop = computeTotalLoop(config);
    totalInput.value = config.total_loop;
    onChange(config);
  });
  colGroup.appendChild(colInput);
  grid.appendChild(colGroup);

  // Row Mulai
  const rowStartGroup = createGridItem('Row Mulai', 'Baris data pertama');
  const rowStartInput = document.createElement('input');
  rowStartInput.type = 'number';
  rowStartInput.min = '1';
  rowStartInput.value = config.row_start;
  styleInput(rowStartInput);
  rowStartInput.addEventListener('change', () => {
    config.row_start = parseInt(rowStartInput.value) || 1;
    config.total_loop = computeTotalLoop(config);
    totalInput.value = config.total_loop;
    onChange(config);
  });
  rowStartGroup.appendChild(rowStartInput);
  grid.appendChild(rowStartGroup);

  // Row Akhir
  const rowEndGroup = createGridItem('Row Akhir', 'Baris data terakhir');
  const rowEndInput = document.createElement('input');
  rowEndInput.type = 'number';
  rowEndInput.min = '1';
  rowEndInput.value = config.row_end;
  styleInput(rowEndInput);
  rowEndInput.addEventListener('change', () => {
    config.row_end = parseInt(rowEndInput.value) || 100;
    config.total_loop = computeTotalLoop(config);
    totalInput.value = config.total_loop;
    onChange(config);
  });
  rowEndGroup.appendChild(rowEndInput);
  grid.appendChild(rowEndGroup);

  // Total Loop (readonly)
  const totalGroup = createGridItem('Total Loop', 'Otomatis dihitung');
  const totalInput = document.createElement('input');
  totalInput.type = 'number';
  totalInput.readOnly = true;
  totalInput.value = config.total_loop;
  styleInput(totalInput);
  totalInput.style.background = '#181825';
  totalInput.style.cursor = 'not-allowed';
  totalGroup.appendChild(totalInput);
  grid.appendChild(totalGroup);

  gridGroup.appendChild(grid);
  sourceSection.appendChild(gridGroup);

  container.appendChild(sourceSection);

  // ═══ SEKSI "Opsi Baca" ═══
  const optionsSection = createSection('⚙️ Opsi Baca');
  optionsSection.style.marginTop = '24px';

  // 4. Skip baris kosong
  const skipEmptyRow = createToggleRow(
    'Skip baris kosong',
    config.skip_empty,
    (value) => {
      config.skip_empty = value;
      onChange(config);
    }
  );
  optionsSection.appendChild(skipEmptyRow);

  // 5. Trim spasi
  const trimSpacesRow = createToggleRow(
    'Trim spasi (hapus awal/akhir)',
    config.trim_spaces,
    (value) => {
      config.trim_spaces = value;
      onChange(config);
    }
  );
  optionsSection.appendChild(trimSpacesRow);

  // 6. Hentikan otomatis jika N baris kosong
  const stopEmptyContainer = document.createElement('div');
  stopEmptyContainer.style.borderTop = '1px solid #313244';
  stopEmptyContainer.style.paddingTop = '12px';
  stopEmptyContainer.style.marginTop = '12px';

  const stopEmptyRow = createToggleRow(
    'Hentikan otomatis jika N baris kosong',
    config.stop_on_consecutive_empty,
    (value) => {
      config.stop_on_consecutive_empty = value;
      limitInput.parentElement.style.display = value ? 'block' : 'none';
      onChange(config);
    }
  );
  stopEmptyContainer.appendChild(stopEmptyRow);

  // Conditional input for consecutive empty limit
  const limitGroup = createFormGroup('Batas baris kosong berurutan', '');
  limitGroup.style.display = config.stop_on_consecutive_empty ? 'block' : 'none';
  limitGroup.style.marginTop = '12px';
  limitGroup.style.paddingLeft = '12px';

  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.min = '1';
  limitInput.max = '100';
  limitInput.value = config.consecutive_empty_limit;
  styleInput(limitInput);

  limitInput.addEventListener('change', () => {
    config.consecutive_empty_limit = parseInt(limitInput.value) || 5;
    onChange(config);
  });

  limitGroup.appendChild(limitInput);
  stopEmptyContainer.appendChild(limitGroup);
  optionsSection.appendChild(stopEmptyContainer);

  container.appendChild(optionsSection);
}

/**
 * Render Tab Delay with delay configurations
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 * @param {Function} onChange - Callback when config changes
 */
function renderTabDelay(container, config, onChange) {
  container.innerHTML = '';
  container.style.padding = '16px';

  // Add CSS for styling if not already present
  if (!document.getElementById('excel-loop-delay-styles')) {
    const style = document.createElement('style');
    style.id = 'excel-loop-delay-styles';
    style.textContent = `
      .delay-card {
        background: #0f1318;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .delay-card-label {
        color: #cdd6f4;
        font-weight: 600;
        font-size: 14px;
      }
      .delay-card-desc {
        color: #7f8b9a;
        font-size: 12px;
      }
      .delay-input-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .delay-input-group input {
        flex: 1;
        background: #181825;
        border: 1px solid #313244;
        color: #cdd6f4;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 12px;
      }
      .delay-input-group input:focus {
        outline: none;
        border-color: #89b4fa;
      }
      .delay-suffix {
        color: #7f8b9a;
        font-size: 12px;
        min-width: 24px;
      }
    `;
    document.head.appendChild(style);
  }

  // ═══ SEKSI "Normal Flow Delays" ═══
  const normalSection = createSection('🔄 Normal Flow Delays');

  const normalDelays = [
    { field: 'd_after_copy', label: 'Delay setelah copy' },
    { field: 'd_tab_switch', label: 'Delay pindah tab' },
    { field: 'd_before_paste', label: 'Delay sebelum paste' },
    { field: 'd_after_paste', label: 'Delay setelah paste' },
    { field: 'd_between_clicks', label: 'Delay antar klik' },
    { field: 'd_end_loop', label: 'Delay akhir loop' }
  ];

  const normalGrid = document.createElement('div');
  normalGrid.style.display = 'grid';
  normalGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  normalGrid.style.gap = '12px';

  normalDelays.forEach(({ field, label }) => {
    const card = createDelayCard(field, label, config, onChange);
    normalGrid.appendChild(card);
  });

  normalSection.appendChild(normalGrid);
  container.appendChild(normalSection);

  // ═══ SEKSI "Periodic Flow Delays" ═══
  const periodicSection = createSection('🔔 Periodic Flow Delays');
  periodicSection.style.marginTop = '24px';

  const periodicDelays = [
    { field: 'd_pre_periodic', label: 'Delay sebelum periodic' },
    { field: 'd_periodic_tab_switch', label: 'Delay pindah tab periodic' },
    { field: 'd_post_periodic', label: 'Delay setelah periodic' }
  ];

  const periodicGrid = document.createElement('div');
  periodicGrid.style.display = 'grid';
  periodicGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  periodicGrid.style.gap = '12px';

  periodicDelays.forEach(({ field, label }) => {
    const card = createDelayCard(field, label, config, onChange);
    periodicGrid.appendChild(card);
  });

  periodicSection.appendChild(periodicGrid);
  container.appendChild(periodicSection);

  // ═══ SEKSI "Opsi Global" ═══
  const globalSection = createSection('🌐 Opsi Global');
  globalSection.style.marginTop = '24px';

  const randomDelayRow = createToggleRow(
    'Random Delay ±20%',
    config.random_delay,
    (value) => {
      config.random_delay = value;
      infoBox.style.display = value ? 'block' : 'none';
      onChange(config);
    }
  );
  globalSection.appendChild(randomDelayRow);

  // Info box for random delay
  const infoBox = document.createElement('div');
  infoBox.style.display = config.random_delay ? 'block' : 'none';
  infoBox.style.marginTop = '12px';
  infoBox.style.padding = '12px';
  infoBox.style.background = '#b8860b22';
  infoBox.style.border = '1px solid #f9e2af';
  infoBox.style.borderRadius = '4px';
  infoBox.style.color = '#f9e2af';
  infoBox.style.fontSize = '12px';
  infoBox.style.lineHeight = '1.5';
  infoBox.innerHTML = `
    ℹ️ Setiap delay akan divariasikan acak ±20%<br>
    <strong>Contoh:</strong> 500ms → antara 400ms–600ms
  `;
  globalSection.appendChild(infoBox);

  container.appendChild(globalSection);
}

// ═══════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════

/**
 * Create a section with title
 */
function createSection(title) {
  const section = document.createElement('div');
  section.style.border = '1px solid #313244';
  section.style.borderRadius = '8px';
  section.style.padding = '16px';
  section.style.background = '#0f1318';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  titleEl.style.margin = '0 0 16px 0';
  titleEl.style.color = '#cdd6f4';
  titleEl.style.fontSize = '14px';
  titleEl.style.fontWeight = '600';
  titleEl.style.borderBottom = '1px solid #313244';
  titleEl.style.paddingBottom = '12px';

  section.appendChild(titleEl);
  return section;
}

/**
 * Create a form group with label and hint
 */
function createFormGroup(label, hint) {
  const group = document.createElement('div');
  group.style.marginBottom = '12px';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.display = 'block';
    labelEl.style.color = '#cdd6f4';
    labelEl.style.fontSize = '12px';
    labelEl.style.fontWeight = '600';
    labelEl.style.marginBottom = '6px';
    group.appendChild(labelEl);
  }

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.textContent = hint;
    hintEl.style.color = '#7f8b9a';
    hintEl.style.fontSize = '11px';
    hintEl.style.marginBottom = '6px';
    group.appendChild(hintEl);
  }

  return group;
}

/**
 * Create a grid item (used in 4-column layout)
 */
function createGridItem(label, hint) {
  const item = document.createElement('div');

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.style.display = 'block';
  labelEl.style.color = '#cdd6f4';
  labelEl.style.fontSize = '12px';
  labelEl.style.fontWeight = '600';
  labelEl.style.marginBottom = '6px';
  item.appendChild(labelEl);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.textContent = hint;
    hintEl.style.color = '#7f8b9a';
    hintEl.style.fontSize = '11px';
    hintEl.style.marginBottom = '6px';
    item.appendChild(hintEl);
  }

  return item;
}

/**
 * Style input element
 */
function styleInput(input) {
  input.style.background = '#181825';
  input.style.border = '1px solid #313244';
  input.style.color = '#cdd6f4';
  input.style.padding = '8px 10px';
  input.style.borderRadius = '4px';
  input.style.fontSize = '12px';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.addEventListener('focus', () => {
    input.style.borderColor = '#89b4fa';
    input.style.outline = 'none';
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#313244';
  });
}

/**
 * Create a toggle row (label + toggle switch)
 */
function createToggleRow(label, checked, onChange) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.justifyContent = 'space-between';
  row.style.alignItems = 'center';
  row.style.paddingBottom = '12px';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.style.color = '#cdd6f4';
  labelEl.style.fontSize = '12px';
  labelEl.style.fontWeight = '600';
  row.appendChild(labelEl);

  const toggleSwitch = document.createElement('label');
  toggleSwitch.className = 'toggle-switch';
  toggleSwitch.style.position = 'relative';
  toggleSwitch.style.width = '44px';
  toggleSwitch.style.height = '24px';
  toggleSwitch.style.display = 'inline-block';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.style.opacity = '0';
  checkbox.style.width = '0';
  checkbox.style.height = '0';

  checkbox.addEventListener('change', () => {
    onChange(checkbox.checked);
  });

  const slider = document.createElement('span');
  slider.style.position = 'absolute';
  slider.style.inset = '0';
  slider.style.background = checkbox.checked ? '#89b4fa' : '#313244';
  slider.style.borderRadius = '24px';
  slider.style.transition = '0.3s';
  slider.style.cursor = 'pointer';

  const sliderBefore = document.createElement('span');
  sliderBefore.style.content = "''";
  sliderBefore.style.position = 'absolute';
  sliderBefore.style.height = '18px';
  sliderBefore.style.width = '18px';
  sliderBefore.style.left = checkbox.checked ? '23px' : '3px';
  sliderBefore.style.bottom = '3px';
  sliderBefore.style.background = '#cdd6f4';
  sliderBefore.style.borderRadius = '50%';
  sliderBefore.style.transition = '0.3s';
  slider.appendChild(sliderBefore);

  checkbox.addEventListener('change', () => {
    slider.style.background = checkbox.checked ? '#89b4fa' : '#313244';
    sliderBefore.style.left = checkbox.checked ? '23px' : '3px';
  });

  toggleSwitch.appendChild(checkbox);
  toggleSwitch.appendChild(slider);
  row.appendChild(toggleSwitch);

  return row;
}

/**
 * Create a delay config card
 */
function createDelayCard(field, label, config, onChange) {
  const card = document.createElement('div');
  card.className = 'delay-card';

  const cardLabel = document.createElement('div');
  cardLabel.className = 'delay-card-label';
  cardLabel.textContent = label;
  card.appendChild(cardLabel);

  const cardDesc = document.createElement('div');
  cardDesc.className = 'delay-card-desc';
  cardDesc.textContent = `Default: ${config[field]}ms`;
  card.appendChild(cardDesc);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'delay-input-group';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '30000';
  input.step = '100';
  input.value = config[field];

  input.addEventListener('change', () => {
    config[field] = parseInt(input.value) || 0;
    onChange(config);
  });

  const suffix = document.createElement('span');
  suffix.className = 'delay-suffix';
  suffix.textContent = 'ms';

  inputGroup.appendChild(input);
  inputGroup.appendChild(suffix);
  card.appendChild(inputGroup);

  return card;
}

module.exports = { renderTabExcel, renderTabDelay };
