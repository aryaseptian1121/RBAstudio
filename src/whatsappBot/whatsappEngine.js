const STORAGE_KEY = 'rba-whatsapp-bot-settings';

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: false, normalized: '', reason: 'Kosong' };

  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return { valid: false, normalized: '', reason: 'Format tidak valid' };

  let normalized = '';
  if (digits.startsWith('62')) {
    normalized = `+${digits}`;
  } else if (digits.startsWith('0')) {
    normalized = `+62${digits.slice(1)}`;
  } else if (digits.length >= 10) {
    normalized = `+62${digits}`;
  }

  const valid = /^\+62\d{8,13}$/.test(normalized);
  return {
    valid,
    normalized,
    reason: valid ? 'Valid' : 'Format tidak valid'
  };
}

function normalizeHeader(label) {
  const text = String(label ?? 'kolom').trim();
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `kolom_${Math.random().toString(36).slice(2, 7)}`;
}

function detectPhoneColumn(headers, rows) {
  const lowerHeaders = headers.map((header) => String(header ?? '').toLowerCase());
  const preferred = ['phone', 'nomor', 'no hp', 'whatsapp', 'wa', 'mobile', 'telp', 'telephone'];

  for (let i = 0; i < lowerHeaders.length; i++) {
    const header = lowerHeaders[i];
    for (const term of preferred) {
      if (header.includes(term)) return i;
    }
  }

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i++) {
    let score = 0;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const value = String(rows[r]?.[i] ?? '');
      const parsed = normalizePhone(value);
      if (parsed.valid) score += 2;
      if (value.includes('08') || value.includes('+62')) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildRows(headers, rows) {
  return rows.map((row, index) => {
    const rowData = {};
    headers.forEach((header, columnIndex) => {
      rowData[String(header)] = row[columnIndex] ?? '';
    });
    rowData.__index = index + 1;
    return rowData;
  });
}

function rowsToDisplay(rows) {
  return rows.map((row) => ({
    __index: row.__index,
    ...row
  }));
}

function applyFilters(rows, filters = [], mode = 'AND') {
  if (!filters.length) return rows;

  return rows.filter((row) => {
    const checks = filters.map((filter) => {
      const column = filter.column;
      const value = String(filter.value ?? '').trim();
      const currentValue = String(row[column] ?? '');

      if (!column) return true;
      if (!value) {
        return filter.operator === 'not-empty';
      }

      switch (filter.operator) {
        case 'eq':
          return currentValue === value;
        case 'contains':
          return currentValue.toLowerCase().includes(value.toLowerCase());
        case 'gt':
          return Number(currentValue || 0) > Number(value || 0);
        case 'lt':
          return Number(currentValue || 0) < Number(value || 0);
        case 'not-empty':
          return currentValue !== '';
        default:
          return true;
      }
    });

    return mode === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
  });
}

function sortRows(rows, column, direction = 'asc') {
  if (!column) return rows;
  const sorted = [...rows].sort((a, b) => {
    const left = String(a[column] ?? '');
    const right = String(b[column] ?? '');
    const leftNum = Number(left);
    const rightNum = Number(right);

    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) && left !== '' && right !== '') {
      return direction === 'asc' ? leftNum - rightNum : rightNum - leftNum;
    }

    return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
  });

  return sorted;
}

function searchRows(rows, query = '') {
  if (!query.trim()) return rows;
  const search = query.toLowerCase();
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(search)));
}

function deleteColumns(rows, headers, deleteIndexes = []) {
  const deleteSet = new Set(deleteIndexes.map(Number));
  const keptIndex = headers
    .map((_, index) => index)
    .filter((index) => !deleteSet.has(index));

  const keptHeaders = keptIndex.map((index) => headers[index]);
  const newRows = rows.map((row) => {
    const nextRow = {};
    keptHeaders.forEach((header, offset) => {
      nextRow[header] = row[header];
    });
    nextRow.__index = row.__index;
    return nextRow;
  });

  return { headers: keptHeaders, rows: newRows };
}

function buildVariableMap(headers) {
  return headers.map((header, index) => ({
    header,
    key: normalizeHeader(header),
    index
  }));
}

function applyMappings(row, mapping = {}) {
  const clone = { ...row };
  Object.entries(mapping).forEach(([header, variableName]) => {
    const safeName = String(variableName || '').trim();
    if (!safeName) return;
    clone[safeName] = row[header] ?? '';
  });
  return clone;
}

function renderTemplate(template = '', row = {}) {
  let output = String(template ?? '');
  Object.keys(row).forEach((key) => {
    const value = row[key] ?? '';
    output = output.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  });
  return output;
}

function createRecipientOptions(rawRows, headers, phoneColumnIndex, mapping = {}) {
  const rows = buildRows(headers, rawRows);
  return rows.map((row) => {
    const mapped = applyMappings(row, mapping);
    const phone = normalizePhone(mapped[headers[phoneColumnIndex]] ?? row[headers[phoneColumnIndex]] ?? '');
    return {
      id: `excel-${row.__index}`,
      displayName: String(mapped.nama || mapped.name || row[headers[0]] || `Penerima ${row.__index}`),
      type: 'number',
      valid: phone.valid,
      normalized: phone.normalized,
      reason: phone.reason,
      rowData: mapped,
      raw: row
    };
  });
}

function validateRecipients(numbersText = '') {
  const lines = String(numbersText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results = lines.map((line) => {
    const phone = normalizePhone(line);
    return {
      raw: line,
      valid: phone.valid,
      normalized: phone.normalized,
      reason: phone.reason
    };
  });

  return results;
}

function buildReportRows(recipients, status, error = '') {
  return recipients.map((recipient, index) => ({
    id: recipient.id || recipient.normalized || `recipient-${index + 1}`,
    number: recipient.normalized || recipient.id || recipient.raw || '',
    name: recipient.displayName || recipient.normalized || recipient.raw || 'Unknown',
    status,
    time: new Date().toISOString(),
    error
  }));
}

function exportCsv(rows = []) {
  const headers = ['Name', 'Number', 'Status', 'Time', 'Error'];
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach((row) => {
    lines.push([
      row.name,
      row.number || row.id || '',
      row.status,
      row.time,
      row.error || ''
    ].map(escapeCsv).join(','));
  });
  return lines.join('\n');
}

function summarizeReport(report = []) {
  const total = report.length;
  const success = report.filter((row) => row.status === 'success').length;
  const failed = report.filter((row) => row.status === 'failed').length;
  const pending = total - success - failed;
  return {
    total,
    success,
    failed,
    pending,
    successRate: total ? Math.round((success / total) * 100) : 0
  };
}

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    return {};
  }
}

function saveSettings(settings = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // ignore
  }
}

module.exports = {
  escapeCsv,
  normalizePhone,
  detectPhoneColumn,
  buildRows,
  rowsToDisplay,
  applyFilters,
  sortRows,
  searchRows,
  deleteColumns,
  buildVariableMap,
  applyMappings,
  renderTemplate,
  createRecipientOptions,
  validateRecipients,
  buildReportRows,
  exportCsv,
  summarizeReport,
  loadSettings,
  saveSettings
};
