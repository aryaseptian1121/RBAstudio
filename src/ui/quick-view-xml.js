const fs = require('fs');
const path = require('path');
const _quickviewHtml = fs.readFileSync(path.join(__dirname, 'quick-view-xml.html'), 'utf8');

let quickViewState = {
  currentlySelectedNode: null,  // Current selected node (unified state)
  currentXml: '',
  currentTree: null,
  currentDeviceId: '',
  screenshotMeta: { width: 0, height: 0, displayWidth: 0, displayHeight: 0 },
  xmlLineHandlersAttached: false,
  xpathToLineMap: {},  // Map xpath -> DOM line element
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
  quickViewElements.doneBtn = document.getElementById('quickview-done-btn');
  quickViewElements.footerHint = document.getElementById('quickview-footer-hint');

  quickViewElements.closeBtn.addEventListener('click', closeQuickViewPanel);
  quickViewElements.backdrop.addEventListener('click', (event) => {
    if (event.target === quickViewElements.backdrop) closeQuickViewPanel();
  });
  quickViewElements.copyBtn.addEventListener('click', copyXmlToClipboard);
  quickViewElements.screenshotClickmask.addEventListener('click', handleScreenshotClick);
  quickViewElements.screenshotImg.addEventListener('load', updateScreenshotLayout);
  quickViewElements.selectBtn.addEventListener('click', selectCurrentNode);
  quickViewElements.doneBtn.addEventListener('click', closeQuickViewPanel);
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
  quickViewState.currentlySelectedNode = null;
  quickViewState.currentDeviceId = deviceId || '';
  quickViewState.xmlLineHandlersAttached = false;
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

    // Parse XML string (compressed, one-liner) into tree structure
    quickViewState.currentXml = dumpResult.xml || '';
    quickViewState.currentTree = parseXMLToTree(quickViewState.currentXml);
    
    // Format tree as readable multi-line XML and render
    if (quickViewElements.xmlLines) {
      quickViewElements.xmlLines.innerHTML = buildXmlLinesFromTree(quickViewState.currentTree);
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

function parseXMLToTree(xmlString) {
  // Copy of parseXMLToTree from uiDumpService for client-side use
  const { XMLParser } = require('fast-xml-parser');
  
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('XML string kosong atau tidak valid');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    parseTagValue: false,
  });

  let parsed;
  try {
    parsed = parser.parse(xmlString);
  } catch (error) {
    console.error('[QuickViewXML] parseXMLToTree invalid XML:', error.message);
    throw new Error(`Gagal parse XML: ${error.message}`);
  }

  const hierarchy = parsed?.hierarchy;
  if (!hierarchy) {
    throw new Error('XML tidak berisi elemen hierarchy');
  }

  const rootNodeData = hierarchy.node;
  if (!rootNodeData) {
    throw new Error('XML hierarchy tidak berisi node');
  }

  function buildNodeObject(rawNode, pathIndices = [0]) {
    const node = {
      index: Number(rawNode.index ?? 0),
      text: String(rawNode.text ?? ''),
      'resource-id': String(rawNode['resource-id'] ?? rawNode['resource_id'] ?? ''),
      class: String(rawNode.class ?? ''),
      package: String(rawNode.package ?? ''),
      'content-desc': String(rawNode['content-desc'] ?? rawNode.contentDesc ?? rawNode.content_desc ?? ''),
      checkable: String(rawNode.checkable ?? 'false').toLowerCase() === 'true',
      bounds: parseBoundsFromString(rawNode.bounds),
      children: [],
      xpath: buildXPath(pathIndices),
    };

    const childNodes = rawNode.node || rawNode.child || [];
    const normalizedChildren = Array.isArray(childNodes) ? childNodes : [childNodes];

    for (let idx = 0; idx < normalizedChildren.length; idx += 1) {
      const child = normalizedChildren[idx];
      if (!child || (typeof child === 'string' && child.trim() === '')) continue;
      node.children.push(buildNodeObject(child, [...pathIndices, idx]));
    }

    return node;
  }

  function buildXPath(pathIndices) {
    return pathIndices.map((index) => `node[${index}]`).join('/');
  }

  function parseBoundsFromString(boundsString) {
    const match = String(boundsString || '').match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
    if (!match) {
      return { x1: 0, y1: 0, x2: 0, y2: 0 };
    }
    return {
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
    };
  }

  const rootNode = Array.isArray(rootNodeData)
    ? buildNodeObject({ node: rootNodeData }, [0])
    : buildNodeObject(rootNodeData, [0]);

  return rootNode;
}

function formatTreeAsXml(node, depth = 0) {
  // Generate formatted XML string dari tree object dengan proper indentation
  // Returns array of { lineText, node } untuk setiap baris
  const lines = [];
  const indent = '  '.repeat(depth);

  // Build opening tag with attributes
  const attrs = [];
  if (node.index !== undefined) attrs.push(`index="${node.index}"`);
  if (node.text) attrs.push(`text="${escapeHtml(node.text)}"`);
  if (node['resource-id']) attrs.push(`resource-id="${escapeHtml(node['resource-id'])}"`);
  if (node.class) attrs.push(`class="${escapeHtml(node.class)}"`);
  if (node.package) attrs.push(`package="${escapeHtml(node.package)}"`);
  if (node['content-desc']) attrs.push(`content-desc="${escapeHtml(node['content-desc'])}"`);
  if (node.checkable) attrs.push(`checkable="true"`);
  if (node.bounds) {
    attrs.push(`bounds="[${node.bounds.x1},${node.bounds.y1}][${node.bounds.x2},${node.bounds.y2}]"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const openTag = `${indent}<node${attrStr}${node.children.length === 0 ? ' /' : ''}>`;
  
  lines.push({
    lineText: openTag,
    node: node,
    xpath: node.xpath,
  });

  // Add children
  if (node.children.length > 0) {
    for (const child of node.children) {
      const childLines = formatTreeAsXml(child, depth + 1);
      lines.push(...childLines);
    }
    
    const closeTag = `${indent}</node>`;
    lines.push({
      lineText: closeTag,
      node: null,
      xpath: null,
    });
  }

  return lines;
}

function buildXmlLinesFromTree(tree) {
  // Build HTML for XML display dengan mapping xpath -> element
  const formattedLines = formatTreeAsXml(tree);
  quickViewState.xpathToLineMap = {};  // Reset map

  const htmlLines = formattedLines.map((lineInfo, idx) => {
    const lineNumber = idx + 1;
    const { lineText, node, xpath } = lineInfo;
    
    // Store xpath -> line mapping untuk quick lookup
    if (xpath) {
      quickViewState.xpathToLineMap[xpath] = lineNumber;
    }

    return `<div class="line" data-line-index="${lineNumber}" data-xpath="${escapeHtml(xpath || '')}">
      <div class="line-number">${lineNumber}</div>
      <div class="line-content">${escapeHtml(lineText)}</div>
    </div>`;
  }).join('');

  return htmlLines;
}

function attachXmlLineHandlers() {
  // Clean up old handlers first
  detachXmlLineHandlers();
  
  // Attach fresh handlers to each line
  const lineElements = quickViewElements.xmlLines.querySelectorAll('.line');
  lineElements.forEach((lineEl) => {
    const handler = () => {
      selectXmlLine(lineEl);
    };
    lineEl.addEventListener('click', handler);
    // Store handler reference for cleanup
    lineEl._quickviewHandler = handler;
  });
  
  quickViewState.xmlLineHandlersAttached = true;
}

function detachXmlLineHandlers() {
  if (!quickViewElements.xmlLines) return;
  const lineElements = quickViewElements.xmlLines.querySelectorAll('.line');
  lineElements.forEach((lineEl) => {
    if (lineEl._quickviewHandler) {
      lineEl.removeEventListener('click', lineEl._quickviewHandler);
      delete lineEl._quickviewHandler;
    }
  });
  quickViewState.xmlLineHandlersAttached = false;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateScreenshotLayout() {
  const img = quickViewElements.screenshotImg;
  const rect = img.getBoundingClientRect();
  quickViewState.screenshotMeta.displayWidth = rect.width;
  quickViewState.screenshotMeta.displayHeight = rect.height;
}

function closeQuickViewPanel() {
  detachXmlLineHandlers();
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

  // Calculate scale factors EVERY click to handle window resizing
  const displayRect = img.getBoundingClientRect();
  const displayWidth = displayRect.width;
  const displayHeight = displayRect.height;
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;

  // Calculate relative click position within the image element
  const clickXRelative = event.clientX - displayRect.left;
  const clickYRelative = event.clientY - displayRect.top;

  // Calculate scale factors (device coords / display coords)
  const scaleX = naturalWidth / displayWidth;
  const scaleY = naturalHeight / displayHeight;

  // Calculate actual device coordinates
  const deviceX = Math.round(clickXRelative * scaleX);
  const deviceY = Math.round(clickYRelative * scaleY);

  // DEBUG: Log calculation details for verification
  console.log('[QuickViewXML] Click calculation:', {
    displayWidth,
    displayHeight,
    naturalWidth,
    naturalHeight,
    clickXRelative,
    clickYRelative,
    scaleX: scaleX.toFixed(4),
    scaleY: scaleY.toFixed(4),
    deviceX,
    deviceY,
  });

  quickViewElements.screenshotStatus.textContent = `Coordinates: ${deviceX}, ${deviceY}`;
  
  // Use backend to find node at coordinate
  const electronApi = getElectronApi();
  const result = await electronApi.invoke('ui:findNodeAtCoordinate', { 
    xmlString: quickViewState.currentXml, 
    x: deviceX, 
    y: deviceY 
  });
  
  if (!result.success) {
    quickViewElements.footerHint.textContent = result.error || 'Node tidak ditemukan pada koordinat ini.';
    return;
  }

  if (!result.node) {
    quickViewElements.footerHint.textContent = 'Tidak ada node yang cocok pada koordinat tersebut.';
    return;
  }

  // Update global selection state with node from backend
  quickViewState.currentlySelectedNode = result.node;
  quickViewElements.selectBtn.disabled = false;

  // Highlight screenshot with bounds from selected node
  highlightScreenshotNode(result.node.bounds);
  
  // Highlight matching line in XML view by xpath
  highlightXmlNodeByXpath(result.node);
  
  quickViewElements.footerHint.textContent = `Selected: ${result.node.xpath}`;
}

function findNodeByXpath(tree, xpath) {
  // Find node object from tree by xpath
  if (!tree || !xpath) return null;

  function traverse(node) {
    if (node.xpath === xpath) {
      return node;
    }
    for (const child of node.children || []) {
      const found = traverse(child);
      if (found) return found;
    }
    return null;
  }

  return traverse(tree);
}

function selectXmlLine(lineEl) {
  // User clicked on XML line manually
  const xpath = lineEl.dataset.xpath;
  
  if (!xpath) {
    console.warn('[QuickViewXML] Clicked line has no xpath');
    return;
  }

  // Find corresponding node in tree
  const node = findNodeByXpath(quickViewState.currentTree, xpath);
  if (!node) {
    console.warn(`[QuickViewXML] Node not found for xpath: ${xpath}`);
    return;
  }

  // Update global selection state
  quickViewState.currentlySelectedNode = node;
  quickViewElements.selectBtn.disabled = false;

  // Visual feedback
  highlightXmlLine(lineEl);
  if (node.bounds) {
    highlightScreenshotNode(node.bounds);
  } else {
    quickViewElements.screenshotHighlight.style.display = 'none';
  }
  
  quickViewElements.footerHint.textContent = `Selected: ${node.xpath}`;
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

function highlightXmlLine(lineEl) {
  // Remove old highlight
  quickViewElements.xmlLines.querySelectorAll('.line').forEach((el) => {
    el.classList.remove('line-selected');
  });

  // Add highlight to this line
  lineEl.classList.add('line-selected');
  lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function highlightXmlNodeByXpath(node) {
  // Find line element with matching xpath and highlight it
  if (!node || !node.xpath) return;

  const lineEl = quickViewElements.xmlLines.querySelector(`[data-xpath="${escapeHtml(node.xpath)}"]`);
  if (lineEl) {
    highlightXmlLine(lineEl);
  }
}

function selectCurrentNode() {
  // Handler for "USE THIS ELEMENT" button
  if (!quickViewState.currentlySelectedNode) {
    quickViewElements.footerHint.textContent = 'Tidak ada elemen yang dipilih. Klik screenshot atau baris XML terlebih dahulu.';
    return;
  }

  const node = quickViewState.currentlySelectedNode;
  const payload = {
    xpath: node.xpath || '',
    resourceId: node['resource-id'] || '',
    textToFind: node.text || '',
    contentDesc: node['content-desc'] || ''
  };
  
  console.log('[QuickViewXML] selectCurrentNode payload:', payload);
  
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
