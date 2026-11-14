// Output preview component — registers to window.BarcodeOutputPreview
(function(){
  function init(){ if(typeof window.renderBarcodePreview==='function') window.renderBarcodePreview(); }
  window.BarcodeOutputPreview = { init };
})();
