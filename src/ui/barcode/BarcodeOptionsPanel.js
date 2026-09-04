// Options panel component — registers to window.BarcodeOptionsPanel
(function(){
  function init(){
    if(typeof window.assignBarcodeOptionsToInputs==='function') window.assignBarcodeOptionsToInputs();
    const ids = ['barcode-show-text','barcode-max-width','barcode-height','barcode-margin','barcode-color','barcode-bg-color','barcode-font-size','barcode-text-align','barcode-rotation'];
    ids.forEach(id=>{ const el=document.getElementById(id); if(!el) return; el.addEventListener('input', ()=>{ if(typeof window.updateBarcodeOptionsFromInput==='function') window.updateBarcodeOptionsFromInput(); if(typeof window.renderBarcodePreview==='function') window.renderBarcodePreview(); }); el.addEventListener('change', ()=>{ if(typeof window.updateBarcodeOptionsFromInput==='function') window.updateBarcodeOptionsFromInput(); if(typeof window.renderBarcodePreview==='function') window.renderBarcodePreview(); }); });
  }
  window.BarcodeOptionsPanel = { init };
})();
