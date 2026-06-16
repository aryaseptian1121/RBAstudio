const quickView = require('./quick-view-xml');

function initQuickViewXml() {
  try {
    quickView.attachQuickViewToButton('btnQuickViewXml', 'pe-device-id');
  } catch (error) {
    console.error('[QuickViewXML] init failed', error);
  }
}

module.exports = {
  initQuickViewXml,
};
