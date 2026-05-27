const { buildLogicFixMessage } = require('../messageTemplates');
const { resolveGroupByCP, extractKeyword } = require('./groupResolver');

function cpNameToDisplayName(value = '') {
  const text = String(value ?? '').trim();
  if (!text) return 'Penerima';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStatus(value = '') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (['ready', 'sent', 'success', 'done', 'completed', 'cleared'].includes(text)) return 'ready';
  if (['pending', 'waiting', 'hold', 'review'].includes(text)) return 'pending';
  if (['failed', 'fail', 'cancel', 'cancelled', 'rejected', 'problem', 'error'].includes(text)) return 'failed';
  return text;
}

function getRowIdentifier(row = {}) {
  return (
    row.resi ||
    row.awb ||
    row.invoice ||
    row.order_id ||
    row.orderId ||
    row.order_no ||
    row.orderNo ||
    row.id ||
    row.kode ||
    row.code ||
    row.__index ||
    'Item'
  );
}

function getCpNameFromRow(row = {}) {
  if (!row || typeof row !== 'object') {
    return '';
  }

  const candidates = [
    row.cp,
    row.CP,
    row['cp name'],
    row['cp_name'],
    row.CP_Name,
    row.cp_name,
    row.cpName,
    row.cpname,
    row.nama,
    row.name,
    row.customer,
    row.customer_name,
    row.customerName
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const normalizedKey = Object.keys(row).find((key) => key.toLowerCase().replace(/[^a-z0-9]/g, '') === 'cpname');
  if (normalizedKey) {
    const value = row[normalizedKey];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function buildStatusBuckets(rows = []) {
  return rows.reduce(
    (acc, row) => {
      const status = normalizeStatus(row.status || row['status'] || '');
      if (!acc[status]) {
        acc[status] = [];
      }
      acc[status].push(row);
      return acc;
    },
    { ready: [], pending: [], failed: [], unknown: [] }
  );
}

function buildReminderMessageGrouped(cpName, buckets = {}, options = {}) {
  const ready = buckets.ready || [];
  const pending = buckets.pending || [];
  const failed = buckets.failed || [];
  const firstRow = ready[0] || pending[0] || failed[0] || {};

  const awbs = [
    ...ready.map((row) => row.awb || row.resi || row.invoice || row.order_id || row.orderId || row.order_no || row.orderNo || row.id || row.kode || row.code || getRowIdentifier(row)),
    ...pending.map((row) => row.awb || row.resi || row.invoice || row.order_id || row.orderId || row.order_no || row.orderNo || row.id || row.kode || row.code || getRowIdentifier(row)),
    ...failed.map((row) => row.awb || row.resi || row.invoice || row.order_id || row.orderId || row.order_no || row.orderNo || row.id || row.kode || row.code || getRowIdentifier(row))
  ].filter(Boolean);

  return buildLogicFixMessage(
    {
      cpName,
      groupName: cpNameToDisplayName(cpName),
      awbs,
      statuses: {
        ready: ready.length,
        pending: pending.length,
        failed: failed.length
      }
    },
    {
      mode: options.mode || 'auto',
      template: options.template,
      rowData: firstRow
    }
  );
}

function buildLogicFixPreview(rows = [], options = {}) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const groups = cleanRows.reduce((acc, row) => {
    const cpName = getCpNameFromRow(row);
    if (!cpName) {
      return acc;
    }
    if (!acc[cpName]) {
      acc[cpName] = [];
    }
    acc[cpName].push(row);
    return acc;
  }, {});

  return Object.entries(groups).map(([cpName, groupRows]) => {
    const buckets = buildStatusBuckets(groupRows);
    const message = buildReminderMessageGrouped(cpName, buckets, options);
    const firstRow = groupRows[0] || {};

    return {
      cpName,
      keyword: extractKeyword(cpName),
      totalRows: groupRows.length,
      readyCount: buckets.ready.length,
      pendingCount: buckets.pending.length,
      failedCount: buckets.failed.length,
      message,
      rowData: firstRow
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoSendByLogicFix(rows, options = {}) {
  const sendMessage = typeof options.sendMessage === 'function' ? options.sendMessage : null;
  const dryRun = Boolean(options.dryRun);
  const retryCount = Number.isFinite(Number(options.retry)) ? Math.max(0, Number(options.retry)) : 0;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Math.max(0, Number(options.delayMs)) : 0;
  const allGroups = Array.isArray(options.allGroups) ? options.allGroups : [];
  const preview = buildLogicFixPreview(rows, { template: options.template });

  if (!preview.length) {
    return {
      sent: [],
      skipped: [{ cpName: '(none)', reason: 'Tidak ada data CP yang dapat diproses' }],
      failed: [],
      totalGroups: 0,
      totalRecipients: 0
    };
  }

  const summary = { sent: [], skipped: [], failed: [], totalGroups: preview.length, totalRecipients: 0 };

  for (const item of preview) {
    if (!item.totalRows) {
      summary.skipped.push({ cpName: item.cpName, reason: 'Tidak ada baris aktif untuk dikirim' });
      continue;
    }

    const resolved = resolveGroupByCP(item.cpName, allGroups);
    const keyword = item.keyword || extractKeyword(item.cpName);

    if (!resolved.found) {
      summary.skipped.push({ cpName: item.cpName, keyword, reason: resolved.reason || 'NO_GROUP_FOUND' });
      options.onProgress?.({ type: 'skipped', cpName: item.cpName, keyword, reason: resolved.reason || 'NO_GROUP_FOUND' });
      console.log(`[LOGIC FIX] ${item.cpName} → keyword: "${keyword}" → NOT FOUND, skipped`);
      continue;
    }

    summary.totalRecipients += 1;

    if (resolved.ambiguous) {
      options.onProgress?.({
        type: 'ambiguous',
        cpName: item.cpName,
        keyword,
        used: resolved.group.name,
        matches: resolved.allMatches.length
      });
      console.log(`[LOGIC FIX] ${item.cpName} → keyword: "${keyword}" → ambiguous match, used: "${resolved.group.name}"`);
    } else {
      console.log(`[LOGIC FIX] ${item.cpName} → keyword: "${keyword}" → found: "${resolved.group.name}" (id: ${resolved.group.id})`);
    }

    if (dryRun) {
      summary.skipped.push({ cpName: item.cpName, groupName: resolved.group.name, reason: 'Dry run' });
      options.onProgress?.({
        type: 'dry-run',
        cpName: item.cpName,
        keyword,
        groupName: resolved.group.name,
        groupId: resolved.group.id,
        message: item.message
      });
      continue;
    }

    if (!sendMessage) {
      const error = 'sendMessage callback tidak tersedia';
      summary.failed.push({ cpName: item.cpName, groupName: resolved.group.name, error });
      options.onProgress?.({ type: 'failed', cpName: item.cpName, groupName: resolved.group.name, error });
      continue;
    }

    let lastError = '';
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const recipient = {
          id: resolved.group.id,
          displayName: resolved.group.name || cpNameToDisplayName(item.cpName),
          type: 'group',
          valid: true,
          rowData: item.rowData || {}
        };

        await sendMessage(recipient, item.message);
        summary.sent.push({ cpName: item.cpName, groupName: resolved.group.name, message: item.message });
        options.onProgress?.({
          type: 'success',
          cpName: item.cpName,
          groupName: resolved.group.name,
          groupId: resolved.group.id,
          attempt
        });
        lastError = '';
        break;
      } catch (error) {
        lastError = error.message || String(error);
        if (attempt >= retryCount) {
          summary.failed.push({ cpName: item.cpName, groupName: resolved.group.name, error: lastError });
          options.onProgress?.({ type: 'failed', cpName: item.cpName, groupName: resolved.group.name, error: lastError });
          break;
        }
        options.onProgress?.({
          type: 'retry',
          cpName: item.cpName,
          groupName: resolved.group.name,
          groupId: resolved.group.id,
          attempt: attempt + 1,
          error: lastError
        });
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  }

  return summary;
}

module.exports = {
  cpNameToDisplayName,
  normalizeStatus,
  getCpNameFromRow,
  buildLogicFixPreview,
  autoSendByLogicFix
};
