const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 8000;

function parseBounds(boundsString) {
  const match = String(boundsString).match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
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

function normalizeString(value) {
  return value == null ? '' : String(value);
}

function toBoolean(value) {
  return String(value).toLowerCase() === 'true';
}

function buildXPath(pathIndices) {
  return pathIndices.map((index) => `node[${index}]`).join('/');
}

async function execAdbCommand(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  console.log(`[uiDumpService] execAdbCommand: adb ${args.join(' ')}`);
  try {
    const { stdout, stderr } = await execFileAsync('adb', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`[uiDumpService] adb stdout: ${String(stdout).trim()}`);
    console.log(`[uiDumpService] adb stderr: ${String(stderr).trim()}`);
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const output = String(error.stderr || error.stdout || error.message || error);
    if (error.killed || error.signal === 'SIGTERM' || error.signal === 'SIGKILL') {
      throw new Error(`ADB command timeout after ${timeoutMs}ms: ${output.trim()}`);
    }
    throw new Error(output.trim() || `ADB command failed: ${error.message || String(error)}`);
  }
}

function isRetryableDumpError(message) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('uiautomator') || normalized.includes('device not ready') || normalized.includes('unable to start uiautomator') || normalized.includes('no devices') || normalized.includes('device') && normalized.includes('not found');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dumpUIHierarchy(deviceId) {
  const deviceArgs = deviceId ? ['-s', deviceId] : [];
  const dumpArgs = [...deviceArgs, 'shell', 'uiautomator', 'dump', '--compressed', '/sdcard/window_dump.xml'];
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`[uiDumpService] dumpUIHierarchy attempt=${attempt} deviceId=${deviceId || '<default>'}`);
      const { stderr } = await execAdbCommand(dumpArgs, DEFAULT_TIMEOUT_MS);
      if (stderr && /device\s+not\s+found|error:\s+.*not\s+found/i.test(stderr)) {
        throw new Error(stderr);
      }
      if (stderr && stderr.trim() !== '' && !stderr.toLowerCase().includes('uiautomator dump:')) {
        console.log(`[uiDumpService] dump hierarchy warning: ${stderr.trim()}`);
      }
      const tempLocalPath = path.join(os.tmpdir(), `rba-uiauto-${Date.now()}-${Math.random().toString(16).slice(2)}.xml`);
      try {
        console.log(`[uiDumpService] pulling UI dump to ${tempLocalPath}`);
        await execAdbCommand([...deviceArgs, 'pull', '/sdcard/window_dump.xml', tempLocalPath], DEFAULT_TIMEOUT_MS);
        const xmlString = await fs.promises.readFile(tempLocalPath, 'utf8');
        console.log('[uiDumpService] UI hierarchy dump read successfully');
        return xmlString;
      } finally {
        try {
          await fs.promises.rm(tempLocalPath, { force: true });
          console.log(`[uiDumpService] removed temp file ${tempLocalPath}`);
        } catch (cleanupError) {
          console.warn(`[uiDumpService] failed to remove temp file ${tempLocalPath}: ${cleanupError.message || cleanupError}`);
        }
      }
    } catch (error) {
      lastError = error;
      const message = String(error.message || error).trim();
      console.warn(`[uiDumpService] dumpUIHierarchy failed attempt=${attempt}: ${message}`);
      if (attempt < 3 && isRetryableDumpError(message)) {
        await sleep(1000);
        continue;
      }
      if (/device\s+not\s+found|error:\s+.*not\s+found/i.test(message)) {
        throw new Error(`Device tidak ditemukan: ${message}`);
      }
      if (/timeout/i.test(message)) {
        throw new Error(`Timeout saat mengambil UI hierarchy: ${message}`);
      }
      throw new Error(`Gagal mengambil UI hierarchy: ${message}`);
    }
  }
  throw lastError || new Error('Gagal mengambil UI hierarchy tanpa detail error');
}

function buildNodeObject(rawNode, pathIndices = [0]) {
  const node = {
    index: Number(rawNode.index ?? 0),
    text: normalizeString(rawNode.text),
    'resource-id': normalizeString(rawNode['resource-id'] ?? rawNode['resource_id']),
    class: normalizeString(rawNode.class),
    package: normalizeString(rawNode.package),
    'content-desc': normalizeString(rawNode['content-desc'] ?? rawNode.contentDesc ?? rawNode.content_desc),
    checkable: toBoolean(rawNode.checkable),
    bounds: parseBounds(rawNode.bounds),
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

function parseXMLToTree(xmlString) {
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
    console.error(`[uiDumpService] parseXMLToTree invalid XML: ${error.message || error}`);
    throw new Error(`Gagal parse XML: ${error.message || String(error)}`);
  }

  const hierarchy = parsed?.hierarchy;
  if (!hierarchy) {
    throw new Error('XML tidak berisi elemen hierarchy');
  }

  const rootNodeData = hierarchy.node;
  if (!rootNodeData) {
    throw new Error('XML hierarchy tidak berisi node');
  }

  const rootNode = Array.isArray(rootNodeData)
    ? buildNodeObject({ node: rootNodeData }, [0])
    : buildNodeObject(rootNodeData, [0]);

  return rootNode;
}

function isPointInBounds(bounds, x, y) {
  if (!bounds || typeof bounds !== 'object') return false;
  return x >= bounds.x1 && x <= bounds.x2 && y >= bounds.y1 && y <= bounds.y2;
}

function findNodeByCoordinate(tree, x, y) {
  if (!tree || typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('tree, x, dan y harus disediakan');
  }

  let bestMatch = null;

  function traverse(node) {
    if (!node || !node.bounds) return;
    if (!isPointInBounds(node.bounds, x, y)) return;

    let childMatch = null;
    for (const child of node.children || []) {
      const match = traverse(child);
      if (match) {
        childMatch = match;
      }
    }

    if (childMatch) {
      return childMatch;
    }

    bestMatch = node;
    return node;
  }

  if (Array.isArray(tree)) {
    for (const rootNode of tree) {
      traverse(rootNode);
    }
  } else {
    traverse(tree);
  }

  if (!bestMatch) {
    return null;
  }

  return bestMatch;
}

module.exports = {
  dumpUIHierarchy,
  parseXMLToTree,
  findNodeByCoordinate,
};
