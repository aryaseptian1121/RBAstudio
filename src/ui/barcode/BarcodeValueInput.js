// Barcode value input component — registers to window.BarcodeValueInput
(function(){
  function init(){
    const ta = document.getElementById('barcode-values-input');
    if(!ta) return;
    if(typeof window.syncBarcodeTextareaToState==='function') ta.addEventListener('input', function(){ if(window._barcodeInputDebounce) clearTimeout(window._barcodeInputDebounce); window._barcodeInputDebounce = setTimeout(()=>{ window.syncBarcodeTextareaToState && window.syncBarcodeTextareaToState(); },200); });
    const importBtn = document.getElementById('barcode-import-csv'); if(importBtn) importBtn.addEventListener('click', ()=> document.getElementById('barcode-csv-input') && document.getElementById('barcode-csv-input').click());
  }
  window.BarcodeValueInput = { init };
})();
