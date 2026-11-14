const { renderTemplate } = require('./whatsappBot/whatsappEngine');

function normalizeStatusKey(value = '') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return 'unknown';
  }
  if (['ready', 'sent', 'success', 'done', 'completed', 'cleared'].includes(text)) {
    return 'ready';
  }
  if (['pending', 'waiting', 'hold', 'review'].includes(text)) {
    return 'pending';
  }
  if (['failed', 'fail', 'cancel', 'cancelled', 'rejected', 'problem', 'error'].includes(text)) {
    return 'failed';
  }
  return text;
}

function getDefaultLogicFixTemplate() {
  return `Halo {{cp_name}},

Grup: {{group_name}}
Total AWB: {{awb_count}}

Status:
{{status_summary}}

Detail AWB:
{{awb_list}}`;
}

function uniqueAwbs(awbs = []) {
  const items = (Array.isArray(awbs) ? awbs : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return [...new Set(items)];
}

function getStatusSummary(statuses = {}) {
  const counts = Object.entries(statuses || {})
    .map(([key, value]) => ({
      key: normalizeStatusKey(key),
      count: Number(value) || 0
    }))
    .filter((item) => item.count > 0);

  if (!counts.length) {
    return 'Tidak ada status tersedia';
  }

  const ordered = ['ready', 'pending', 'failed'];
  const grouped = {};

  counts.forEach((item) => {
    grouped[item.key] = (grouped[item.key] || 0) + item.count;
  });

  return ordered
    .filter((key) => grouped[key])
    .map((key) => `${key}: ${grouped[key]} AWB`)
    .concat(Object.keys(grouped)
      .filter((key) => !ordered.includes(key))
      .sort()
      .map((key) => `${key}: ${grouped[key]} AWB`))
    .join('\n');
}

function buildLogicFixTemplateContext(groupInfo = {}, rowData = {}) {
  const cpName = String(groupInfo.cpName || rowData.cp_name || rowData.cp || rowData.nama || '').trim() || 'Penerima';
  const groupName = String(groupInfo.groupName || rowData.group_name || '').trim() || 'Monitoring';
  const awbs = uniqueAwbs(groupInfo.awbs || rowData.awbs || []);
  const statuses = groupInfo.statuses || rowData.statuses || {};
  const statusSummary = getStatusSummary(statuses);

  return {
    cp_name: cpName,
    cpName,
    group_name: groupName,
    groupName,
    awb_count: awbs.length,
    awb_list: awbs.join(', ') || 'Tidak ada AWB',
    status_summary: statusSummary,
    ready_count: Number(statuses.ready || 0) || 0,
    pending_count: Number(statuses.pending || 0) || 0,
    failed_count: Number(statuses.failed || 0) || 0,
    total_count: awbs.length,
    ...rowData
  };
}

function buildLogicFixMessage(groupInfo = {}, options = {}) {
  const mode = options.mode === 'manual' ? 'manual' : 'auto';
  const template = mode === 'manual' && options.template ? options.template : getDefaultLogicFixTemplate();
  const context = buildLogicFixTemplateContext(groupInfo, options.rowData || {});
  return renderTemplate(template, context);
}

function getLogicFixTemplateVariables() {
  return [
    '{{cp_name}}',
    '{{group_name}}',
    '{{awb_count}}',
    '{{awb_list}}',
    '{{status_summary}}',
    '{{ready_count}}',
    '{{pending_count}}',
    '{{failed_count}}',
    '{{total_count}}'
  ];
}

module.exports = {
  getDefaultLogicFixTemplate,
  buildLogicFixTemplateContext,
  buildLogicFixMessage,
  getLogicFixTemplateVariables,
  uniqueAwbs,
  getStatusSummary
};
