const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLogicFixMessage,
  buildLogicFixTemplateContext,
  getDefaultLogicFixTemplate,
  getStatusSummary,
  uniqueAwbs
} = require('../src/messageTemplates');

test('buildLogicFixTemplateContext includes grouped AWB data', () => {
  const context = buildLogicFixTemplateContext({
    cpName: 'CP Jawa',
    groupName: 'Monitoring CP_JAWA',
    awbs: ['AWB-1', 'AWB-1', 'AWB-2'],
    statuses: { ready: 2, failed: 1 }
  });

  assert.equal(context.cp_name, 'CP Jawa');
  assert.equal(context.group_name, 'Monitoring CP_JAWA');
  assert.equal(context.awb_count, 2);
  assert.equal(context.awb_list, 'AWB-1, AWB-2');
  assert.equal(context.ready_count, 2);
  assert.equal(context.failed_count, 1);
});

test('buildLogicFixMessage uses manual template when requested', () => {
  const message = buildLogicFixMessage(
    {
      cpName: 'CP A',
      groupName: 'Monitoring CP_A',
      awbs: ['001'],
      statuses: { pending: 1 }
    },
    {
      mode: 'manual',
      template: 'Halo {{cp_name}} :: {{awb_count}} :: {{awb_list}}'
    }
  );

  assert.equal(message, 'Halo CP A :: 1 :: 001');
});

test('buildLogicFixMessage falls back to default template in auto mode', () => {
  const message = buildLogicFixMessage(
    {
      cpName: 'CP B',
      groupName: 'Monitoring CP_B',
      awbs: ['A1', 'A2'],
      statuses: { ready: 2 }
    },
    { mode: 'auto' }
  );

  assert.match(message, /Halo CP B/);
  assert.match(message, /Total AWB: 2/);
  assert.match(message, /A1, A2/);
});

test('getStatusSummary and uniqueAwbs behave predictably', () => {
  assert.equal(getStatusSummary({ ready: 2, pending: 1 }), 'ready: 2 AWB\npending: 1 AWB');
  assert.deepEqual(uniqueAwbs(['A', 'A', 'B']), ['A', 'B']);
  assert.equal(getDefaultLogicFixTemplate().includes('{{awb_list}}'), true);
});
