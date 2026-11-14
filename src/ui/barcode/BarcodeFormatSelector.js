// Lightweight selector component — registers to window.BarcodeFormatSelector
(function(){
  function init(){
    if(typeof window.renderBarcodeFormatSelector==='function') window.renderBarcodeFormatSelector();
    const search = document.getElementById('barcode-search');
    if(search) search.addEventListener('input', function(){ if(typeof window.renderBarcodeFormatSelector==='function') window.renderBarcodeFormatSelector(); });
  }
  window.BarcodeFormatSelector = { init };
})();
