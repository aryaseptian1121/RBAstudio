/**
 * Tab Normal Flow & Tab Periodic Flow UI Renderer
 * RBA Studio Pro 2.0 - Electron renderer process
 */

const { createNormalStepClick, createNormalStepPaste, createPeriodicStep } = require('../excelLoop.config.js');
const safeInvoke = async (channel, payload) => {
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    return window.electronAPI.invoke(channel, payload);
  }
  if (typeof window.require === 'function') {
    try {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer.invoke(channel, payload);
    } catch (err) {
      console.warn('safeInvoke require error:', err);
    }
  }
  throw new Error('IPC tidak tersedia');
};

/**
 * Render Tab Normal Flow with step builder
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 * @param {Function} onChange - Callback when config changes
 */
function renderTabNormalFlow(container, config, onChange) {
  container.innerHTML = '';
  container.style.padding = '16px';

  // Header text
  const header = document.createElement('div');
  header.textContent = 'Langkah dijalankan SETIAP loop untuk setiap baris Excel';
  header.style.color = '#7f8b9a';
  header.style.fontSize = '12px';
  header.style.fontStyle = 'italic';
  header.style.marginBottom = '16px';
  container.appendChild(header);

  // ═══ BROWSER TEST TOOLS SECTION ═══
  const browserSection = createSection('🌐 Browser Test Tools');
  browserSection.style.marginBottom = '24px';

  const browserDesc = document.createElement('p');
  browserDesc.textContent = 'Klik tombol untuk test koneksi browser sebelum menjalankan Excel Loop.';
  browserDesc.style.color = '#7f8b9a';
  browserDesc.style.fontSize = '12px';
  browserDesc.style.marginBottom = '12px';
  browserSection.appendChild(browserDesc);

  const browserBtnGroup = document.createElement('div');
  browserBtnGroup.style.display = 'flex';
  browserBtnGroup.style.gap = '8px';
  browserBtnGroup.style.flexWrap = 'wrap';

  // Tombol: Buka Chrome Debug
  const openChromeBtn = document.createElement('button');
  openChromeBtn.textContent = '🔓 Buka Chrome Debug';
  openChromeBtn.style.padding = '8px 12px';
  openChromeBtn.style.background = '#3b82f6';
  openChromeBtn.style.color = '#ffffff';
  openChromeBtn.style.border = 'none';
  openChromeBtn.style.borderRadius = '4px';
  openChromeBtn.style.cursor = 'pointer';
  openChromeBtn.style.fontSize = '12px';
  openChromeBtn.style.fontWeight = 'bold';

  let testStatus = null;

  openChromeBtn.addEventListener('click', async () => {
    openChromeBtn.disabled = true;
    openChromeBtn.textContent = '⏳...';

    try {
      let result;
      try {
        result = await safeInvoke('openChromDebug', 9222);
      } catch (err) {
        result = { ok: false, message: err.message || 'Electron IPC tidak tersedia' };
      }
      
      if (testStatus) browserSection.removeChild(testStatus);
      testStatus = document.createElement('div');
      testStatus.style.padding = '8px 12px';
      testStatus.style.borderRadius = '4px';
      testStatus.style.marginTop = '8px';
      testStatus.style.fontSize = '12px';
      
      if (result.ok) {
        testStatus.style.background = '#064e3b';
        testStatus.style.color = '#6ee7b7';
        testStatus.textContent = `✓ ${result.message}`;
      } else {
        testStatus.style.background = '#450a0a';
        testStatus.style.color = '#fca5a5';
        testStatus.textContent = `✗ ${result.message}`;
      }
      browserSection.appendChild(testStatus);
    } catch (err) {
      if (testStatus) browserSection.removeChild(testStatus);
      testStatus = document.createElement('div');
      testStatus.style.padding = '8px 12px';
      testStatus.style.borderRadius = '4px';
      testStatus.style.marginTop = '8px';
      testStatus.style.background = '#450a0a';
      testStatus.style.color = '#fca5a5';
      testStatus.style.fontSize = '12px';
      testStatus.textContent = `✗ Error: ${err.message}`;
      browserSection.appendChild(testStatus);
    } finally {
      openChromeBtn.disabled = false;
      openChromeBtn.textContent = '🔓 Buka Chrome Debug';
    }
  });

  browserBtnGroup.appendChild(openChromeBtn);

  // Tombol: Test Browser URL
  const testUrlBtn = document.createElement('button');
  testUrlBtn.textContent = '✓ Test Browser URL';
  testUrlBtn.style.padding = '8px 12px';
  testUrlBtn.style.background = '#10b981';
  testUrlBtn.style.color = '#ffffff';
  testUrlBtn.style.border = 'none';
  testUrlBtn.style.borderRadius = '4px';
  testUrlBtn.style.cursor = 'pointer';
  testUrlBtn.style.fontSize = '12px';
  testUrlBtn.style.fontWeight = 'bold';

  testUrlBtn.addEventListener('click', async () => {
    testUrlBtn.disabled = true;
    testUrlBtn.textContent = '⏳...';

    try {
      let result;
      try {
        result = await safeInvoke('testBrowserUrl', {
          url: config.tab_normal || 'localhost',
          matchMode: 'contains',
          port: 9222
        });
      } catch (err) {
        result = { ok: false, message: err.message || 'Electron IPC tidak tersedia' };
      }
      
      if (testStatus) browserSection.removeChild(testStatus);
      testStatus = document.createElement('div');
      testStatus.style.padding = '8px 12px';
      testStatus.style.borderRadius = '4px';
      testStatus.style.marginTop = '8px';
      testStatus.style.fontSize = '12px';
      
      if (result.ok) {
        testStatus.style.background = '#064e3b';
        testStatus.style.color = '#6ee7b7';
        testStatus.textContent = `✓ ${result.message}`;
      } else {
        testStatus.style.background = '#450a0a';
        testStatus.style.color = '#fca5a5';
        testStatus.textContent = `✗ ${result.message}`;
      }
      browserSection.appendChild(testStatus);
    } catch (err) {
      if (testStatus) browserSection.removeChild(testStatus);
      testStatus = document.createElement('div');
      testStatus.style.padding = '8px 12px';
      testStatus.style.borderRadius = '4px';
      testStatus.style.marginTop = '8px';
      testStatus.style.background = '#450a0a';
      testStatus.style.color = '#fca5a5';
      testStatus.style.fontSize = '12px';
      testStatus.textContent = `✗ Error: ${err.message}`;
      browserSection.appendChild(testStatus);
    } finally {
      testUrlBtn.disabled = false;
      testUrlBtn.textContent = '✓ Test Browser URL';
    }
  });

  browserBtnGroup.appendChild(testUrlBtn);
  browserSection.appendChild(browserBtnGroup);
  container.appendChild(browserSection);

  // Tab Normal field
  const tabGroup = createFormGroup('Tab Normal', 'URL atau identifier tab browser untuk aksi normal flow');
  const tabInput = document.createElement('input');
  tabInput.type = 'text';
  tabInput.value = config.tab_normal;
  styleInput(tabInput);
  tabInput.addEventListener('change', () => {
    config.tab_normal = tabInput.value;
    onChange(config);
  });
  tabGroup.appendChild(tabInput);
  container.appendChild(tabGroup);

  // Step Builder
  const builderSection = createSection('Langkah Normal Flow');
  builderSection.style.marginTop = '24px';

  // Add buttons
  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.gap = '8px';
  buttonGroup.style.marginBottom = '16px';

  const hasPasteField = config.normal_steps.some(s => s.enabled && s.type === 'paste_field');

  const addPasteBtn = document.createElement('button');
  addPasteBtn.textContent = '+ Tambah Paste Field';
  addPasteBtn.disabled = hasPasteField;
  styleButton(addPasteBtn, '#89b4fa', hasPasteField);
  addPasteBtn.addEventListener('click', () => {
    config.normal_steps.unshift(createNormalStepPaste());
    onChange(config);
    renderTabNormalFlow(container, config, onChange);
  });
  buttonGroup.appendChild(addPasteBtn);

  const addClickBtn = document.createElement('button');
  addClickBtn.textContent = '+ Tambah Klik';
  styleButton(addClickBtn, '#a6e3a1', false);
  addClickBtn.addEventListener('click', () => {
    config.normal_steps.push(createNormalStepClick());
    onChange(config);
    renderTabNormalFlow(container, config, onChange);
  });
  buttonGroup.appendChild(addClickBtn);

  builderSection.appendChild(buttonGroup);

  // Render steps
  const stepsContainer = document.createElement('div');
  stepsContainer.style.display = 'flex';
  stepsContainer.style.flexDirection = 'column';
  stepsContainer.style.gap = '12px';

  config.normal_steps.forEach((step, index) => {
    const card = renderStepCard(step, index, config, 'normal_steps', onChange, true);
    stepsContainer.appendChild(card);
  });

  builderSection.appendChild(stepsContainer);
  container.appendChild(builderSection);
}

/**
 * Render Tab Periodic Flow with configuration and step builder
 * @param {HTMLElement} container - Container to render into
 * @param {Object} config - Configuration object
 * @param {Function} onChange - Callback when config changes
 */
function renderTabPeriodicFlow(container, config, onChange) {
  container.innerHTML = '';
  container.style.padding = '16px';

  // Main toggle
  const toggleSection = createSection('Periodic Flow');
  const toggleRow = createToggleRow(
    'Aktifkan Periodic Flow',
    config.periodic_enabled,
    (value) => {
      config.periodic_enabled = value;
      onChange(config);
      renderTabPeriodicFlow(container, config, onChange);
    }
  );
  toggleSection.appendChild(toggleRow);
  container.appendChild(toggleSection);

  // Content (disabled if periodic_enabled is false)
  const contentWrapper = document.createElement('div');
  contentWrapper.style.opacity = config.periodic_enabled ? '1' : '0.4';
  contentWrapper.style.pointerEvents = config.periodic_enabled ? 'auto' : 'none';
  contentWrapper.style.transition = 'opacity 0.3s';

  // Configuration section
  if (config.periodic_enabled) {
    const configSection = createSection('Konfigurasi');
    configSection.style.marginTop = '24px';

    // "Jalankan setiap" config
    const everyGroup = document.createElement('div');
    everyGroup.style.display = 'flex';
    everyGroup.style.alignItems = 'center';
    everyGroup.style.gap = '8px';
    everyGroup.style.marginBottom = '12px';

    const everyLabel = document.createElement('label');
    everyLabel.textContent = 'Jalankan setiap';
    everyLabel.style.color = '#cdd6f4';
    everyLabel.style.fontSize = '12px';
    everyLabel.style.fontWeight = '600';
    everyGroup.appendChild(everyLabel);

    const everyInput = document.createElement('input');
    everyInput.type = 'number';
    everyInput.min = '1';
    everyInput.value = config.periodic_every;
    everyInput.style.width = '60px';
    styleInput(everyInput);
    everyInput.addEventListener('change', () => {
      config.periodic_every = parseInt(everyInput.value) || 1;
      onChange(config);
    });
    everyGroup.appendChild(everyInput);

    const loopLabel = document.createElement('label');
    loopLabel.textContent = 'loop';
    loopLabel.style.color = '#cdd6f4';
    loopLabel.style.fontSize = '12px';
    everyGroup.appendChild(loopLabel);

    configSection.appendChild(everyGroup);

    // Tab Periodic field
    const tabGroup = createFormGroup('Tab Periodic', 'URL atau identifier tab browser untuk aksi periodic');
    const tabInput = document.createElement('input');
    tabInput.type = 'text';
    tabInput.value = config.tab_periodic;
    styleInput(tabInput);
    tabInput.addEventListener('change', () => {
      config.tab_periodic = tabInput.value;
      onChange(config);
    });
    tabGroup.appendChild(tabInput);
    configSection.appendChild(tabGroup);

    // Timing (readonly)
    const timingGroup = createFormGroup('Timing', '');
    const timingReadonly = document.createElement('div');
    timingReadonly.textContent = 'Sesudah Normal Flow';
    timingReadonly.style.color = '#89b4fa';
    timingReadonly.style.fontSize = '12px';
    timingReadonly.style.padding = '8px 10px';
    timingReadonly.style.background = '#181825';
    timingReadonly.style.border = '1px solid #313244';
    timingReadonly.style.borderRadius = '4px';
    timingGroup.appendChild(timingReadonly);
    configSection.appendChild(timingGroup);

    contentWrapper.appendChild(configSection);

    // Step Builder
    const builderSection = createSection('Langkah Periodic Flow');
    builderSection.style.marginTop = '24px';

    // Add button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Tambah Langkah';
    styleButton(addBtn, '#fab387', false);
    addBtn.addEventListener('click', () => {
      config.periodic_steps.push(createPeriodicStep());
      onChange(config);
      renderTabPeriodicFlow(container, config, onChange);
    });
    builderSection.appendChild(addBtn);

    // Render steps
    const stepsContainer = document.createElement('div');
    stepsContainer.style.display = 'flex';
    stepsContainer.style.flexDirection = 'column';
    stepsContainer.style.gap = '12px';
    stepsContainer.style.marginTop = '16px';

    config.periodic_steps.forEach((step, index) => {
      const card = renderStepCard(step, index, config, 'periodic_steps', onChange, false);
      stepsContainer.appendChild(card);
    });

    builderSection.appendChild(stepsContainer);
    contentWrapper.appendChild(builderSection);
  }

  container.appendChild(contentWrapper);
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
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#313244';
  });
}

/**
 * Style button element
 */
function styleButton(button, bgColor, disabled) {
  button.style.padding = '8px 12px';
  button.style.background = disabled ? '#313244' : bgColor;
  button.style.color = '#1e1e2e';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.cursor = disabled ? 'not-allowed' : 'pointer';
  button.style.fontWeight = 'bold';
  button.style.fontSize = '12px';
  button.style.opacity = disabled ? '0.5' : '1';
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
    onChange(checkbox.checked);
  });

  toggleSwitch.appendChild(checkbox);
  toggleSwitch.appendChild(slider);
  row.appendChild(toggleSwitch);

  return row;
}

/**
 * Render a step card with move, badge, label, toggle, delete buttons
 */
function renderStepCard(step, index, config, stepsArrayName, onChange, showBadge) {
  const card = document.createElement('div');
  card.style.border = '1px solid #313244';
  card.style.borderRadius = '6px';
  card.style.background = '#0f1318';
  card.style.padding = '12px';

  // Header
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '12px';
  header.style.paddingBottom = '12px';
  header.style.borderBottom = '1px solid #313244';

  // Move buttons
  const moveGroup = document.createElement('div');
  moveGroup.style.display = 'flex';
  moveGroup.style.gap = '4px';

  const moveUpBtn = document.createElement('button');
  moveUpBtn.textContent = '▲';
  moveUpBtn.disabled = index === 0 || (showBadge && index === 1 && config[stepsArrayName][0].type === 'paste_field');
  styleButton(moveUpBtn, '#89b4fa', moveUpBtn.disabled);
  moveUpBtn.addEventListener('click', () => {
    const steps = config[stepsArrayName];
    [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
    onChange(config);
  });
  moveGroup.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.textContent = '▼';
  moveDownBtn.disabled = index === config[stepsArrayName].length - 1;
  styleButton(moveDownBtn, '#89b4fa', moveDownBtn.disabled);
  moveDownBtn.addEventListener('click', () => {
    const steps = config[stepsArrayName];
    [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
    onChange(config);
  });
  moveGroup.appendChild(moveDownBtn);

  header.appendChild(moveGroup);

  // Badge
  if (showBadge) {
    const badge = document.createElement('span');
    badge.textContent = step.type === 'paste_field' ? '[PASTE]' : '[KLIK]';
    badge.style.padding = '4px 8px';
    badge.style.background = step.type === 'paste_field' ? '#89b4fa' : '#a6e3a1';
    badge.style.color = '#1e1e2e';
    badge.style.borderRadius = '3px';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = 'bold';
    header.appendChild(badge);
  }

  // Label input
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = step.label;
  labelInput.style.flex = '1';
  labelInput.style.background = '#181825';
  labelInput.style.border = '1px solid #313244';
  labelInput.style.color = '#cdd6f4';
  labelInput.style.padding = '6px 8px';
  labelInput.style.borderRadius = '3px';
  labelInput.style.fontSize = '12px';
  labelInput.style.marginX = '8px';
  labelInput.addEventListener('change', () => {
    step.label = labelInput.value;
    onChange(config);
  });
  header.appendChild(labelInput);

  // Toggle enabled
  const toggleLabel = document.createElement('label');
  toggleLabel.style.position = 'relative';
  toggleLabel.style.width = '36px';
  toggleLabel.style.height = '20px';
  toggleLabel.style.display = 'inline-block';
  toggleLabel.style.marginLeft = '8px';

  const toggleCheckbox = document.createElement('input');
  toggleCheckbox.type = 'checkbox';
  toggleCheckbox.checked = step.enabled;
  toggleCheckbox.style.opacity = '0';
  toggleCheckbox.style.width = '0';
  toggleCheckbox.style.height = '0';

  const toggleSlider = document.createElement('span');
  toggleSlider.style.position = 'absolute';
  toggleSlider.style.inset = '0';
  toggleSlider.style.background = toggleCheckbox.checked ? '#89b4fa' : '#313244';
  toggleSlider.style.borderRadius = '20px';
  toggleSlider.style.transition = '0.3s';

  const toggleBefore = document.createElement('span');
  toggleBefore.style.position = 'absolute';
  toggleBefore.style.height = '16px';
  toggleBefore.style.width = '16px';
  toggleBefore.style.left = toggleCheckbox.checked ? '18px' : '2px';
  toggleBefore.style.bottom = '2px';
  toggleBefore.style.background = '#cdd6f4';
  toggleBefore.style.borderRadius = '50%';
  toggleBefore.style.transition = '0.3s';
  toggleSlider.appendChild(toggleBefore);

  toggleCheckbox.addEventListener('change', () => {
    step.enabled = toggleCheckbox.checked;
    toggleSlider.style.background = toggleCheckbox.checked ? '#89b4fa' : '#313244';
    toggleBefore.style.left = toggleCheckbox.checked ? '18px' : '2px';
    onChange(config);
  });

  toggleLabel.appendChild(toggleCheckbox);
  toggleLabel.appendChild(toggleSlider);
  header.appendChild(toggleLabel);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑';
  deleteBtn.disabled = showBadge && step.type === 'paste_field';
  deleteBtn.style.padding = '6px 8px';
  deleteBtn.style.background = deleteBtn.disabled ? '#313244' : '#f38ba8';
  deleteBtn.style.color = '#1e1e2e';
  deleteBtn.style.border = 'none';
  deleteBtn.style.borderRadius = '3px';
  deleteBtn.style.cursor = deleteBtn.disabled ? 'not-allowed' : 'pointer';
  deleteBtn.style.opacity = deleteBtn.disabled ? '0.5' : '1';
  deleteBtn.addEventListener('click', () => {
    config[stepsArrayName].splice(index, 1);
    onChange(config);
  });
  header.appendChild(deleteBtn);

  card.appendChild(header);

  // Body - Target Type
  const bodyDiv = document.createElement('div');
  bodyDiv.style.display = 'flex';
  bodyDiv.style.flexDirection = 'column';
  bodyDiv.style.gap = '8px';

  const targetLabel = document.createElement('label');
  targetLabel.textContent = 'Target Type';
  targetLabel.style.color = '#cdd6f4';
  targetLabel.style.fontSize = '11px';
  targetLabel.style.fontWeight = '600';
  bodyDiv.appendChild(targetLabel);

  const targetSelect = document.createElement('select');
  targetSelect.style.background = '#181825';
  targetSelect.style.border = '1px solid #313244';
  targetSelect.style.color = '#cdd6f4';
  targetSelect.style.padding = '6px 8px';
  targetSelect.style.borderRadius = '3px';
  targetSelect.style.fontSize = '12px';

  const selectorOpt = document.createElement('option');
  selectorOpt.value = 'selector';
  selectorOpt.textContent = 'CSS Selector';
  targetSelect.appendChild(selectorOpt);

  const coordOpt = document.createElement('option');
  coordOpt.value = 'coordinate';
  coordOpt.textContent = 'Koordinat XY';
  targetSelect.appendChild(coordOpt);

  targetSelect.value = step.target_type;
  targetSelect.addEventListener('change', () => {
    step.target_type = targetSelect.value;
    onChange(config);
  });

  bodyDiv.appendChild(targetSelect);

  // Target input (conditional)
  if (step.target_type === 'selector') {
    const selectorGroup = createFormGroup('', 'CSS selector elemen yang akan diklik/difokus');
    const selectorInput = document.createElement('input');
    selectorInput.type = 'text';
    selectorInput.placeholder = '#input-field atau .btn-submit';
    selectorInput.value = step.css_selector;
    styleInput(selectorInput);
    selectorInput.addEventListener('change', () => {
      step.css_selector = selectorInput.value;
      onChange(config);
    });
    selectorGroup.appendChild(selectorInput);
    bodyDiv.appendChild(selectorGroup);
  } else {
    const coordGroup = createFormGroup('', 'Koordinat piksel di layar');
    const coordContainer = document.createElement('div');
    coordContainer.style.display = 'flex';
    coordContainer.style.gap = '8px';

    const xInput = document.createElement('input');
    xInput.type = 'number';
    xInput.placeholder = 'X';
    xInput.value = step.x;
    xInput.style.flex = '1';
    styleInput(xInput);
    xInput.addEventListener('change', () => {
      step.x = parseInt(xInput.value) || 0;
      onChange(config);
    });
    coordContainer.appendChild(xInput);

    const yInput = document.createElement('input');
    yInput.type = 'number';
    yInput.placeholder = 'Y';
    yInput.value = step.y;
    yInput.style.flex = '1';
    styleInput(yInput);
    yInput.addEventListener('change', () => {
      step.y = parseInt(yInput.value) || 0;
      onChange(config);
    });
    coordContainer.appendChild(yInput);

    coordGroup.appendChild(coordContainer);
    bodyDiv.appendChild(coordGroup);
  }

  // Delay input
  const delayGroup = createFormGroup('Delay setelah step (ms)', 'Jika 0, akan menggunakan delay global');
  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.min = '0';
  delayInput.max = '30000';
  delayInput.step = '50';
  delayInput.value = step.delay_after;
  styleInput(delayInput);
  delayInput.addEventListener('change', () => {
    step.delay_after = parseInt(delayInput.value) || 0;
    onChange(config);
  });
  delayGroup.appendChild(delayInput);
  bodyDiv.appendChild(delayGroup);

  card.appendChild(bodyDiv);

  return card;
}

module.exports = { renderTabNormalFlow, renderTabPeriodicFlow };
