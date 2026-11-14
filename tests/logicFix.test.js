const assert = require('assert');
const { buildLogicFixPreview } = require('../src/whatsappBot/logicFix');

const rows = [
  { cp: 'CP ANCOL BARAT 2', status: 'ready', resi: 'AWB-1001' },
  { cp: 'CP ANCOL BARAT 2', status: 'pending', resi: 'AWB-1002' },
  { cp: 'CP JAKARTA PUSAT', status: 'failed', resi: 'AWB-1003' }
];

const preview = buildLogicFixPreview(rows, { template: 'Halo {{nama}}\n{{summary}}' });

assert.strictEqual(preview.length, 2, 'Preview harus menghasilkan 2 grup CP');
assert.strictEqual(preview[0].cpName, 'CP ANCOL BARAT 2');
assert.strictEqual(preview[0].readyCount, 1);
assert.strictEqual(preview[0].pendingCount, 1);
assert.ok(preview[0].message.includes('Halo CP ANCOL BARAT 2'), 'Template harus diproses dengan nama CP');
assert.strictEqual(preview[1].failedCount, 1);

console.log('Logic Fix preview test passed');
