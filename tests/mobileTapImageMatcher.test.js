const assert = require('assert');
const { buildImageSearchRegion } = require('../utils/imageMatcher');

const region = buildImageSearchRegion({
  captureCoordX: 400,
  captureCoordY: 400,
  captureScreenWidth: 1000,
  captureScreenHeight: 1000,
  liveScreenWidth: 1000,
  liveScreenHeight: 1000,
  templateWidth: 60,
  templateHeight: 60
});

assert.deepStrictEqual(region, { x: 200, y: 200, width: 400, height: 400 });
console.log('mobileTapImageMatcher test passed');
