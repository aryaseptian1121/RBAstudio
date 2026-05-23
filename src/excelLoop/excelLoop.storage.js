/**
 * Excel Loop Storage & Persistence
 * RBA Studio Pro 2.0 - Electron renderer process (uses localStorage)
 */

const CONFIG_KEY = 'rba_excel_loop_v1';
const FLOWS_KEY = 'rba_excel_loop_flows';
const LAST_FLOW_KEY = 'rba_excel_loop_last';

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function saveConfig(config) {
  try {
    if (!config || typeof config !== 'object') {
      console.error('[Excel Loop Storage] Invalid config object');
      return false;
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch (err) {
    console.error('[Excel Loop Storage] Error saving config:', err.message);
    return false;
  }
}

function loadConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) return null;
    return safeParse(stored);
  } catch (err) {
    console.error('[Excel Loop Storage] Error loading config:', err.message);
    return null;
  }
}

function clearConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
    return true;
  } catch (err) {
    console.error('[Excel Loop Storage] Error clearing config:', err.message);
    return false;
  }
}

function loadFlows() {
  try {
    const stored = localStorage.getItem(FLOWS_KEY);
    if (!stored) return [];
    const flows = safeParse(stored);
    return Array.isArray(flows) ? flows : [];
  } catch (err) {
    console.error('[Excel Loop Storage] Error loading flows:', err.message);
    return [];
  }
}

function saveFlows(flows) {
  try {
    localStorage.setItem(FLOWS_KEY, JSON.stringify(flows));
    return flows;
  } catch (err) {
    console.error('[Excel Loop Storage] Error saving flows:', err.message);
    return [];
  }
}

function saveFlow(flow) {
  if (!flow || typeof flow !== 'object') {
    console.error('[Excel Loop Storage] Invalid flow object');
    return null;
  }

  const flows = loadFlows();
  const now = new Date().toISOString();
  const normalized = {
    id: String(flow.id || `flow-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(flow.name || `Flow ${new Date().toLocaleString()}`),
    createdAt: flow.createdAt || now,
    config: flow.config || {}
  };

  const existingIndex = flows.findIndex(item => item.id === normalized.id);
  if (existingIndex >= 0) {
    flows[existingIndex] = { ...flows[existingIndex], ...normalized, config: normalized.config };
  } else {
    flows.push(normalized);
  }

  saveFlows(flows);
  saveLastFlow(normalized.id);
  return normalized;
}

function deleteFlow(id) {
  try {
    const flows = loadFlows().filter(flow => flow.id !== id);
    saveFlows(flows);
    const lastFlowId = localStorage.getItem(LAST_FLOW_KEY);
    if (lastFlowId === String(id)) {
      localStorage.removeItem(LAST_FLOW_KEY);
    }
    return flows;
  } catch (err) {
    console.error('[Excel Loop Storage] Error deleting flow:', err.message);
    return loadFlows();
  }
}

function loadLastFlow() {
  try {
    const id = localStorage.getItem(LAST_FLOW_KEY);
    if (!id) return null;
    const flows = loadFlows();
    return flows.find(flow => flow.id === id) || null;
  } catch (err) {
    console.error('[Excel Loop Storage] Error loading last flow:', err.message);
    return null;
  }
}

function saveLastFlow(id) {
  try {
    if (!id) return false;
    localStorage.setItem(LAST_FLOW_KEY, String(id));
    return true;
  } catch (err) {
    console.error('[Excel Loop Storage] Error saving last flow:', err.message);
    return false;
  }
}

function exportToJSON(config) {
  try {
    if (!config || typeof config !== 'object') {
      console.error('[Excel Loop Storage] Invalid config for export');
      return;
    }

    const jsonString = JSON.stringify({ config }, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'excel-loop-config.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[Excel Loop Storage] Error exporting config:', err.message);
  }
}

function importFromJSON() {
  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (event) => {
        try {
          const file = event.target.files[0];
          if (!file) {
            resolve(null);
            return;
          }

          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const parsed = JSON.parse(e.target.result);
              const config = parsed?.config || parsed;
              resolve(config);
            } catch (parseErr) {
              console.error('[Excel Loop Storage] Error parsing JSON file:', parseErr.message);
              resolve(null);
            }
          };
          reader.onerror = () => {
            console.error('[Excel Loop Storage] Error reading file');
            resolve(null);
          };
          reader.readAsText(file);
        } catch (err) {
          console.error('[Excel Loop Storage] Error in onchange handler:', err.message);
          resolve(null);
        }
      };
      input.click();
    } catch (err) {
      console.error('[Excel Loop Storage] Error creating file picker:', err.message);
      resolve(null);
    }
  });
}

module.exports = {
  saveConfig,
  loadConfig,
  clearConfig,
  loadFlows,
  saveFlow,
  deleteFlow,
  loadLastFlow,
  saveLastFlow,
  exportToJSON,
  importFromJSON
};
