const assert = require('assert');
const { resetQuickViewPanelState } = require('../src/ui/quick-view-xml');

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...names) {
    names.forEach((name) => this.classes.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.classes.delete(name));
  }
  contains(name) {
    return this.classes.has(name);
  }
}

const removed = [];
const backdrop = {
  classList: new FakeClassList(),
  parentNode: {
    removeChild(node) {
      removed.push(node);
    }
  }
};

const elements = {
  backdrop,
  xmlStatus: { textContent: 'old' },
  screenshotStatus: { textContent: 'old' },
  xmlLines: { innerHTML: '<div>old</div>' },
  screenshotImg: { src: 'old-src' },
  selectBtn: { disabled: false },
  footerHint: { textContent: 'old' }
};

const state = {
  currentlySelectedNode: { xpath: '/node[1]' },
  currentXml: '<xml />',
  currentTree: { type: 'tree' },
  currentDeviceId: 'device-1',
  screenshotMeta: { width: 100, height: 200, displayWidth: 100, displayHeight: 200 },
  xmlLineHandlersAttached: true,
  xpathToLineMap: { '/node[1]': 1 },
  isLoading: true,
  isOpen: true
};

resetQuickViewPanelState(elements, state);

assert.deepStrictEqual(state.currentlySelectedNode, null);
assert.strictEqual(state.currentXml, '');
assert.strictEqual(state.currentTree, null);
assert.strictEqual(state.currentDeviceId, '');
assert.deepStrictEqual(state.screenshotMeta, { width: 0, height: 0, displayWidth: 0, displayHeight: 0 });
assert.strictEqual(state.xmlLineHandlersAttached, false);
assert.deepStrictEqual(state.xpathToLineMap, {});
assert.strictEqual(state.isLoading, false);
assert.strictEqual(state.isOpen, false);
assert.strictEqual(removed[0], backdrop);
assert.strictEqual(elements.backdrop, null);

console.log('quickViewXml test passed');
