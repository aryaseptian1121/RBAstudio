const fs = require('fs');
const path = require('path');
const _quickviewHtml = fs.readFileSync(path.join(__dirname, 'quick-view-xml.html'), 'utf8');

let quickViewState = {
  selectedNode: null,
  currentXml: '',
  currentTree: null,
  currentDeviceId: '',
  screenshotMeta: { width: 0, height: 0, displayWidth: 0, displayHeight: 0 },
};

const quickViewElements = {};

function mountQuickViewPanel() {
  if (document.getElementById('quick-view-xml-backdrop')) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = _quickviewHtml;
  document.body.appendChild(wrapper.firstElementChild);

  quickViewElements.backdrop = document.getElementById('quick-view-xml-backdrop');
  quickViewElements.closeBtn = document.getElementById('quickview-close-btn');
  quickViewElements.screenshotImg = document.getElementById('quickview-screenshot-img');
  quickViewElements.screenshotClickmask = document.getElementById('quickview-screenshot-clickmask');
  quickViewElements.screenshotHighlight = document.getElementById('quickview-screenshot-highlight');
  quickViewElements.screenshotStatus = document.getElementById('quickview-screenshot-status');
  quickViewElements.xmlStatus = document.getElementById('quickview-xml-status');
  quickViewElements.xmlLines = document.getElementById('quickview-xml-lines');
  quickViewElements.copyBtn = document.getElementById('quickview-copy-btn');
  quickViewElements.selectBtn = document.getElementById('quickview-select-btn');
  quickViewElements.footerHint = document.getElementById('quickview-footer-hint');

  quickViewElements.closeBtn.addEventListener('click', closeQuickViewPanel);
  quickViewElements.backdrop.addEventListener('click', (event) => {
    if (event.target === quickViewElements.backdrop) closeQuickViewPanel();
  });
  quickViewElements.copyBtn.addEventListener('click', copyXmlToClipboard);
  quickViewElements.screenshotClickmask.addEventListener('click', handleScreenshotClick);
  quickViewElements.screenshotImg.addEventListener('load', updateScreenshotLayout);
  quickViewElements.selectBtn.addEventListener('click', selectCurrentNode);
}

function getElectronApi() {
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    return window.electronAPI;
  }
  if (typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined') {
    return {
      invoke: (channel, data) => window.ipcRenderer.invoke(channel, data),
    };
  }
  throw new Error('Electron IPC tidak tersedia');
}

function openQuickViewPanel(deviceId) {
  mountQuickViewPanel();
  quickViewState.selectedNode = null;
  quickViewState.currentDeviceId = deviceId || '';
  if (quickViewElements.xmlLines) quickViewElements.xmlLines.innerHTML = '';
  else console.error('[QuickViewXML] xmlLines element not mounted');
  if (quickViewElements.screenshotHighlight) quickViewElements.screenshotHighlight.style.display = 'none';
  if (quickViewElements.selectBtn) quickViewElements.selectBtn.disabled = true;
  if (quickViewElements.footerHint) quickViewElements.footerHint.textContent = 'Pilih elemen dari screenshot atau XML.';
  if (quickViewElements.xmlStatus) quickViewElements.xmlStatus.textContent = 'Fetching UI hierarchy...';
  if (quickViewElements.screenshotStatus) quickViewElements.screenshotStatus.textContent = 'Loading screenshot...';
  if (quickViewElements.backdrop) quickViewElements.backdrop.classList.remove('hidden');
  loadQuickViewContent(deviceId);
}

async function loadQuickViewContent(deviceId) {
  try {
    const screenshotResp = await ipcRenderer.invoke('adb:screenshot', { device: deviceId });
    if (!screenshotResp.success) {
      throw new Error(screenshotResp.error || 'Gagal mengambil screenshot');
    }
    const sizeResp = await ipcRenderer.invoke('adb:get-screen-size', { device: deviceId });
    if (!sizeResp.success) {
      throw new Error(sizeResp.error || 'Gagal membaca ukuran layar');
    }

    quickViewState.screenshotMeta.width = sizeResp.width;
    quickViewState.screenshotMeta.height = sizeResp.height;
    if (quickViewElements.screenshotImg) {
      quickViewElements.screenshotImg.src = 'data:image/png;base64,' + screenshotResp.imageBase64;
    } else {
      console.error('[QuickViewXML] screenshotImg element not mounted');
    }
    if (quickViewElements.screenshotStatus) quickViewElements.screenshotStatus.textContent = 'Screenshot siap. Klik area untuk memilih elemen.';

    const electronApi = getElectronApi();
    const dumpResult = await electronApi.invoke('ui:dumpHierarchy', deviceId);
    if (!dumpResult.success) {
      throw new Error(dumpResult.error || 'Gagal mengambil UI hierarchy');
    }

    quickViewState.currentXml = dumpResult.xml || '';
    if (quickViewElements.xmlLines) {
      quickViewElements.xmlLines.innerHTML = buildXmlLines(quickViewState.currentXml);
    } else {
      console.error('[QuickViewXML] xmlLines element not mounted');
    }
    if (quickViewElements.xmlStatus) quickViewElements.xmlStatus.textContent = 'UI hierarchy loaded. Klik baris XML untuk pilih.';
    if (quickViewElements.xmlLines) attachXmlLineHandlers();
    updateScreenshotLayout();
  } catch (error) {
    if (quickViewElements.xmlStatus) quickViewElements.xmlStatus.textContent = error.message || 'Gagal memuat data.';
    if (quickViewElements.screenshotStatus) quickViewElements.screenshotStatus.textContent = error.message || 'Gagal memuat data.';
    if (quickViewElements.xmlLines) {
      quickViewElements.xmlLines.innerHTML = `<div class="quickview-status-text">${escapeHtml(error.message || 'Terjadi kesalahan saat membuka Quick View XML.')}</div>`;
    } else {
      console.error('[QuickViewXML] xmlLines element not mounted when showing error');
    }
    console.error('[QuickViewXML]', error);
  }
}

function formatXmlLines(xmlString) {
  return xmlString.replace(/\r\n?/g, '\n').split('\n');
}

function buildXmlLines(xmlString) {
  const lines = formatXmlLines(xmlString);
  return lines.map((line, idx) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'line';
    lineEl.dataset.line = String(idx + 1);
    lineEl.innerHTML = `
      <div class="line-number">${idx + 1}</div>
      <div class="line-content">${escapeHtml(line)}</div>
    `;
    return lineEl.outerHTML;
  }).join('');
}

function attachXmlLineHandlers() {
  quickViewElements.xmlLines.querySelectorAll('.line').forEach((lineEl) => {
    lineEl.addEventListener('click', async () => {
      const lineIndex = Number(lineEl.dataset.line) - 1;
      selectXmlLine(lineEl, lineIndex);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseBoundsFromLine(lineText) {
  const match = lineText.match(/bounds="\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]"/);
  if (!match) return null;
  return { x1: Number(match[1]), y1: Number(match[2]), x2: Number(match[3]), y2: Number(match[4]) };
}

function findXmlLineByNode(node) {
  if (!node || !node.xpath) return null;
  const terms = [node['resource-id'], node['content-desc'], node.class, node.text].filter(Boolean);
  const lines = quickViewState.currentXml.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (terms.some(term => term && text.includes(term))) {
      return i;
    }
  }
  return null;
}

function updateScreenshotLayout() {
  const img = quickViewElements.screenshotImg;
  const rect = img.getBoundingClientRect();
  quickViewState.screenshotMeta.displayWidth = rect.width;
  quickViewState.screenshotMeta.displayHeight = rect.height;
}

function closeQuickViewPanel() {
  quickViewElements.backdrop.classList.add('hidden');
}

function copyXmlToClipboard() {
  if (!quickViewState.currentXml) return;
  navigator.clipboard.writeText(quickViewState.currentXml).then(() => {
    quickViewElements.footerHint.textContent = 'XML berhasil disalin ke clipboard.';
  }).catch((err) => {
    quickViewElements.footerHint.textContent = 'Gagal menyalin XML.';
    console.error('[QuickViewXML] copyXmlToClipboard', err);
  });
}

async function handleScreenshotClick(event) {
  const img = quickViewElements.screenshotImg;
  if (!img.src || !quickViewState.currentXml) return;

  updateScreenshotLayout();
  const rect = img.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  const deviceX = Math.round((clickX / rect.width) * quickViewState.screenshotMeta.width);
  const deviceY = Math.round((clickY / rect.height) * quickViewState.screenshotMeta.height);

  quickViewElements.screenshotStatus.textContent = `Coordinates: ${deviceX}, ${deviceY}`;
  const electronApi = getElectronApi();
  const result = await electronApi.invoke('ui:findNodeAtCoordinate', { xmlString: quickViewState.currentXml, x: deviceX, y: deviceY });
  if (!result.success) {
    quickViewElements.footerHint.textContent = result.error || 'Node tidak ditemukan pada koordinat ini.';
    return;
  }

  if (!result.node) {
    quickViewElements.footerHint.textContent = 'Tidak ada node yang cocok pada koordinat tersebut.';
    return;
  }

  quickViewState.selectedNode = result.node;
  highlightScreenshotNode(result.node.bounds);
  highlightXmlNodeByXpath(result.node);
  quickViewElements.selectBtn.disabled = false;
  quickViewElements.footerHint.textContent = `Selected: ${result.node.xpath}`;
}

function selectXmlLine(lineEl, lineIndex) {
  const lineText = lineEl.querySelector('.line-content')?.textContent || '';
  const bounds = parseBoundsFromLine(lineText);
  quickViewState.selectedNode = {
    xpath: `line:${lineIndex + 1}`,
    'resource-id': '',
    text: lineText.trim(),
    bounds,
  };

  quickViewElements.xmlLines.querySelectorAll('.line').forEach((el) => el.classList.remove('line-selected'));
  lineEl.classList.add('line-selected');
  quickViewElements.selectBtn.disabled = false;
  quickViewElements.footerHint.textContent = `Selected line ${lineIndex + 1}`;

  if (bounds) {
    highlightScreenshotNode(bounds);
  } else {
    quickViewElements.screenshotHighlight.style.display = 'none';
  }
}

function highlightScreenshotNode(bounds) {
  if (!bounds || bounds.x1 == null || bounds.y1 == null || bounds.x2 == null || bounds.y2 == null) {
    quickViewElements.screenshotHighlight.style.display = 'none';
    return;
  }

  const rect = quickViewElements.screenshotImg.getBoundingClientRect();
  const scaleX = rect.width / quickViewState.screenshotMeta.width;
  const scaleY = rect.height / quickViewState.screenshotMeta.height;
  const x = bounds.x1 * scaleX;
  const y = bounds.y1 * scaleY;
  const w = (bounds.x2 - bounds.x1) * scaleX;
  const h = (bounds.y2 - bounds.y1) * scaleY;

  quickViewElements.screenshotHighlight.style.display = 'block';
  quickViewElements.screenshotHighlight.style.left = `${x}px`;
  quickViewElements.screenshotHighlight.style.top = `${y}px`;
  quickViewElements.screenshotHighlight.style.width = `${w}px`;
  quickViewElements.screenshotHighlight.style.height = `${h}px`;
}

function highlightXmlNodeByXpath(node) {
  quickViewElements.xmlLines.querySelectorAll('.line').forEach((el) => el.classList.remove('line-selected'));
  const lineIndex = findXmlLineByNode(node);
  if (lineIndex == null) return;
  const match = quickViewElements.xmlLines.querySelector(`.line[data-line="${lineIndex + 1}"]`);
  if (match) {
    match.classList.add('line-selected');
    match.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function selectCurrentNode() {
  if (!quickViewState.selectedNode) return;
  const payload = {
    xpath: quickViewState.selectedNode.xpath || '',
    resourceId: quickViewState.selectedNode['resource-id'] || '',
    textToFind: quickViewState.selectedNode.text || '',
    contentDesc: quickViewState.selectedNode['content-desc'] || ''
  };
  const event = new CustomEvent('quickview-select-element', { detail: payload });
  document.dispatchEvent(event);
  closeQuickViewPanel();
}

function attachQuickViewToButton(buttonId, deviceIdInputId) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.addEventListener('click', () => {
    const deviceId = document.getElementById(deviceIdInputId)?.value || '';
    openQuickViewPanel(deviceId);
  });
}

module.exports = {
  attachQuickViewToButton,
  openQuickViewPanel,
};
