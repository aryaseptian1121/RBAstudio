// Barcode module for RBA — mounts into existing #barcode-generator in index.html
(function(){
  const safeRequire = (name) => {
    try { if (typeof require === 'function') return require(name); } catch (e) {}
    return (typeof window !== 'undefined') ? window[name] : null;
  };

  // Validators helpers
  function validateDigits(min, max){
    return function(v){
      if(!/^\d+$/.test(String(v||''))) return 'Hanya boleh angka';
      const len = String(v||'').length;
      if(len < min || len > max) return `Panjang harus ${min}-${max} digit`;
      return null;
    };
  }

  function validateEvenDigits(v){
    if(!/^\d+$/.test(String(v||''))) return 'Hanya boleh angka';
    if((String(v||'').length % 2) !== 0) return 'Jumlah digit harus genap';
    return null;
  }

  const JsBarcode = safeRequire('jsbarcode') || (window && window.JsBarcode) || null;
  const _jspdf = safeRequire('jspdf') || (window && window.jspdf) || null;
  const jsPDF = _jspdf && (_jspdf.jsPDF || _jspdf.default) ? (_jspdf.jsPDF || _jspdf.default) : null;
  const JSZip = safeRequire('jszip') || (window && window.JSZip) || null;

  const BARCODE_TYPE_MAP = {
    custom: { jsBarcodeFormat: 'CODE128', validate: () => null, example: 'ABC-abc-1234' },
    code128: { jsBarcodeFormat: 'CODE128', validate: (v)=>v?null:'Value tidak boleh kosong', example: 'ABC-abc-1234' },
    code128a: { jsBarcodeFormat: 'CODE128A', validate: (v)=>/^[A-Z0-9\s]+$/.test(v)?null:'Code128A hanya A-Z0-9', example: 'ABC123' },
    code128b: { jsBarcodeFormat: 'CODE128B', validate: (v)=>v?null:'Value tidak boleh kosong', example: 'Hello World!' },
    code128c: { jsBarcodeFormat: 'CODE128C', validate: validateEvenDigits, example: '12345678' },
    ean13: { jsBarcodeFormat: 'EAN13', validate: validateDigits(12,13), example: '5901234123457' },
    ean8: { jsBarcodeFormat: 'EAN8', validate: validateDigits(7,8), example: '96385074' },
    upca: { jsBarcodeFormat: 'UPC', validate: validateDigits(11,12), example: '042100005264' },
    code39: { jsBarcodeFormat: 'CODE39', validate: (v)=>/^[A-Z0-9\-.$/+%\s]+$/.test(v)?null:'Code39 charset invalid', example: 'CODE39' },
    itf14: { jsBarcodeFormat: 'ITF14', validate: validateEvenDigits, example: '10012345000017' },
    msi: { jsBarcodeFormat: 'MSI', validate: (v)=>/^\d+$/.test(v)?null:'MSI hanya angka', example: '1234567' },
    pharmacode: { jsBarcodeFormat: 'pharmacode', validate: (v)=>/^\d+$/.test(v) && Number(v)>=3 && Number(v)<=131070?null:'Pharmacode 3-131070', example: '12345' },
    codabar: { jsBarcodeFormat: 'codabar', validate: (v)=>/^[A-D0-9\-.$/:+\s]+$/.test(v)?null:'Codabar charset invalid', example: 'A123456A' },
    gs1_128: { jsBarcodeFormat: 'CODE128', validate: (v)=>v?null:'GS1-128 tidak boleh kosong', example: '(01)09521234543213(3103)000123' },
    qr: { jsBarcodeFormat: 'QR', validate: (v)=>v?null:'QR tidak boleh kosong', example: 'https://rba.app' },
    datamatrix: { jsBarcodeFormat: 'DATAMATRIX', validate: (v)=>v?null:'Data Matrix tidak boleh kosong', example: 'RBA-123' }
  };

  const barcodeState = {
    selectedFormat: 'custom', entries: [], options: {
      showText: true, maxWidth: 260, height: 80, margin: 10, color: '#111827', background:'#ffffff', fontSize:18, textAlign:'center', rotation:0
    }
  };
  // runtime UI helpers
  let prevEntriesLen = 0;
  let isAutoPlaying = false;
  let autoScrollSpeed = 150; // px per second default
  const rafRef = { id: null };

  function normalizeBarcodeValue(value, formatId){
    let text = String(value||'').trim(); if(!text) return '';
    if(formatId==='gs1_128') return parseGS1Input(text);
    return text;
  }

  function parseGS1Input(raw){
    let text = String(raw||'').trim(); if(!text) return '';
    text = text.replace(/\s+/g,'');
    const aiMatches = [...text.matchAll(/\((\d{2,4})\)/g)];
    if(!aiMatches.length) return text;
    let result=''; let cursor=0;
    for(const m of aiMatches){ const idx=m.index, ai=m[1]; if(idx>cursor) result+=text.slice(cursor,idx); result += '\u00f1'+ai; cursor = idx + m[0].length; }
    if(cursor<text.length) result += text.slice(cursor);
    return result.replace(/\u00f1+/g,'\u00f1');
  }

  function validateValue(v, formatId){
    const validator = (BARCODE_TYPE_MAP[formatId]||BARCODE_TYPE_MAP.code128).validate;
    if(!v||!String(v).trim()) return 'Value tidak boleh kosong';
    return validator(String(v).trim())||null;
  }

  function parseBarcodeTextarea(){
    const ta = document.getElementById('barcode-values-input'); if(!ta) return;
    const raw = ta.value || '';
    const lines = raw.split(/\r?\n/).filter(l=>l.trim()!== '');
    barcodeState.entries = lines.map(line=>{
      const parts = line.split('\t'); const value = (parts[0]||'').trim(); const caption = (parts[1]||'').trim(); const error = validateValue(value, barcodeState.selectedFormat);
      return { id: (crypto&&crypto.randomUUID)?crypto.randomUUID():'e-'+Date.now()+Math.random().toString(16).slice(2), value, caption, error };
    }).filter(e=>e.value);
  }

  function serializeEntriesToTextarea(){
    const ta=document.getElementById('barcode-values-input'); if(!ta) return;
    ta.value = barcodeState.entries.map(e=> e.caption? e.value+'\t'+e.caption : e.value).join('\n');
  }

  function createBarcodeSvg(value, caption, formatId){
    const safeFormat = formatId==='custom'? 'CODE128' : (BARCODE_TYPE_MAP[formatId]||BARCODE_TYPE_MAP.code128).jsBarcodeFormat;
    const normalized = normalizeBarcodeValue(value, formatId);
    if(!JsBarcode) {
      const wrap = document.createElement('div'); wrap.textContent='JsBarcode unavailable'; return wrap;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg'); svg.setAttribute('viewBox','0 0 320 180'); svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
      const opts = { format: safeFormat, 
                     // Always disable JsBarcode's built-in text; we render caption/value separately
                     displayValue: false, 
                     text: normalized, 
                     fontSize: barcodeState.options.fontSize, 
                     height: barcodeState.options.height, 
                     width: Math.max(1.2, Math.min(3.2, Math.max(1, barcodeState.options.maxWidth/180))), 
                     margin: barcodeState.options.margin, 
                     background: barcodeState.options.background, 
                     lineColor: barcodeState.options.color, 
                     textAlign: barcodeState.options.textAlign, 
                     flat:false, 
                     rotation:barcodeState.options.rotation 
                   };
    try{ JsBarcode(svg, normalized, opts); } catch(e){ const txt = document.createElementNS('http://www.w3.org/2000/svg','text'); txt.setAttribute('x','160'); txt.setAttribute('y','100'); txt.setAttribute('text-anchor','middle'); txt.setAttribute('fill','#dc2626'); txt.textContent='Invalid'; svg.appendChild(txt);}    
    return svg;
  }

  function renderBarcodePreview(){
    const preview = document.getElementById('barcode-preview'); if(!preview) return;
    const allEntries = barcodeState.entries.filter(e=>e.value && e.value.trim());
    if(!allEntries.length){ preview.innerHTML = '<div class="barcode-empty"><div class="barcode-empty-icon">📦</div><div><strong>Barcode Values masih kosong</strong></div><div>Masukkan value pertama Anda untuk mulai membuat barcode.</div></div>'; return; }
    const LIMIT = 200;
    const showAll = allEntries.length <= LIMIT;
    const entries = showAll ? allEntries : allEntries.slice(0, LIMIT);
    const infoHtml = !showAll ? '<div class="preview-info">Menampilkan '+LIMIT+' dari '+allEntries.length+' barcode — gunakan pagination atau export untuk semua.</div>' : '';
    const html = entries.map(entry=>{
      const formatId = barcodeState.selectedFormat||'custom';
      const validationError = validateValue(entry.value, formatId);
      const safeValue = normalizeBarcodeValue(entry.value, formatId);
      const wrapper = document.createElement('div'); wrapper.className='barcode-output-card';
      try{ const svg = createBarcodeSvg(entry.value, entry.caption, formatId); wrapper.appendChild(svg);}catch(e){ wrapper.innerHTML='<div style="color:#dc2626;font-weight:600;">Preview failed</div>'; }
      const label = document.createElement('div'); label.className='barcode-output-text'; label.textContent = entry.caption || safeValue || 'No value'; wrapper.appendChild(label);
      if(validationError){ const err = document.createElement('div'); err.className='barcode-output-error'; err.textContent = validationError; wrapper.appendChild(err); }
      return wrapper.outerHTML;
    }).join('');
    preview.innerHTML = infoHtml + html;
    // auto-scroll to bottom when new entries appended
    try{
      const currentLen = entries.length;
      if (currentLen > prevEntriesLen) {
        preview.scrollTo({ top: preview.scrollHeight, behavior: 'smooth' });
      }
      prevEntriesLen = currentLen;
    }catch(e){}
  }

  function renderBarcodeFormatSelector(){
    const search = (document.getElementById('barcode-search')||{value:''}).value.toLowerCase(); const list = document.getElementById('barcode-format-list'); if(!list) return;
    const formats = Object.keys(BARCODE_TYPE_MAP).map(id=>({ id, title: id, example: BARCODE_TYPE_MAP[id].example || '' }));
    const grouped = {}; formats.forEach(f=>{ if(search && !(f.id+ ' '+f.title).includes(search)) return; const cat = f.id==='qr'||f.id==='datamatrix' ? '2D' : (f.id.startsWith('code128') || f.id==='gs1_128') ? 'Code 128' : (f.id.startsWith('ean')||f.id.startsWith('upc'))? 'EAN / UPC' : 'Others'; (grouped[cat]||(grouped[cat]=[])).push(f); });
    const html = Object.keys(grouped).map(cat=>{ const items = grouped[cat].map(item=>{
      const active = barcodeState.selectedFormat===item.id? 'active':'';
      return '<div class="barcode-format-card '+active+'" data-format="'+item.id+'" onclick="selectBarcodeFormat(\''+item.id+'\')"><div class="barcode-format-card-top"><strong>'+item.title+'</strong></div><div class="barcode-mini-preview">'+renderMiniBarcode(item.example,item.id)+'</div></div>';
    }).join(''); return '<div class="barcode-category"><div class="barcode-category-header">'+cat+'<span></span></div><div class="barcode-category-items">'+items+'</div></div>'; }).join('');
    list.innerHTML = html;
  }

  function renderMiniBarcode(value, formatId){ if(!value) return '<span style="color:#475569;font-size:11px;">N/A</span>'; const normalized = normalizeBarcodeValue(value, formatId); const safeFormat = formatId==='custom'? 'CODE128': (BARCODE_TYPE_MAP[formatId]||BARCODE_TYPE_MAP.code128).jsBarcodeFormat; const svgId = 'mini-'+formatId+'-'+Math.random().toString(16).slice(2); setTimeout(()=>{ try{ const el = document.getElementById(svgId); if(el && typeof JsBarcode==='function') JsBarcode(el, normalized, { format: safeFormat, displayValue:false, background:'#ffffff', lineColor:'#111827', width:1.2, height:28, margin:4 }); }catch(e){} },0); return '<svg id="'+svgId+'" xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32"></svg>'; }

  function updateBarcodeOptionsFromInput(){ const opt = barcodeState.options; opt.showText = document.getElementById('barcode-show-text').checked; opt.maxWidth = Number(document.getElementById('barcode-max-width').value||260); opt.height = Number(document.getElementById('barcode-height').value||80); opt.margin = Number(document.getElementById('barcode-margin').value||10); opt.color = document.getElementById('barcode-color').value||'#111827'; opt.background = document.getElementById('barcode-bg-color').value||'#ffffff'; opt.fontSize = Number(document.getElementById('barcode-font-size').value||18); opt.textAlign = document.getElementById('barcode-text-align').value||'center'; opt.rotation = Number(document.getElementById('barcode-rotation').value||0); }

  function generateSequence({ prefix='', start=1, count=10, step=1, padding=0, suffix='' }){ const values=[]; let cur = Number(start)||1; for(let i=0;i<Number(count);i++){ const raw = String(cur); const padded = padding>0? raw.padStart(Number(padding),'0') : raw; values.push(String(prefix||'')+padded+String(suffix||'')); cur += Number(step)||1; } return values; }

  function svgToBlob(svgString, format){ const svgBlob = new Blob([svgString], { type:'image/svg+xml;charset=utf-8' }); if(format==='svg') return Promise.resolve(svgBlob); return new Promise((resolve)=>{ const url = URL.createObjectURL(svgBlob); const img = new Image(); img.onload = ()=>{ const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 300; const ctx = canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); canvas.toBlob((b)=>{ URL.revokeObjectURL(url); resolve(b); }, format==='jpeg'?'image/jpeg':'image/png', 0.92); }; img.src = url; }); }

  function triggerDownload(blob, filename){ const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),400); }

  function performBarcodeDownload(format){ const entries = barcodeState.entries.filter(e=>e.value && e.value.trim()); if(!entries.length) return; if(format==='pdf'){ if(!jsPDF){ console.warn('jspdf missing'); return; } const doc = new jsPDF({ unit:'mm', format:'a4' }); entries.forEach((entry,idx)=>{ if(idx>0) doc.addPage(); const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat); const serialized = new XMLSerializer().serializeToString(svg); const blob = new Blob([serialized], { type:'image/svg+xml' }); const url = URL.createObjectURL(blob); const img = new Image(); img.onload = ()=>{ const canvas = document.createElement('canvas'); canvas.width=600; canvas.height=200; const ctx = canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); const d = canvas.toDataURL('image/png'); doc.addImage(d,'PNG',20,30,170,80); if(idx===entries.length-1) doc.save('barcode-export.pdf'); }; img.src = url; }); return; }
    const zip = JSZip? new JSZip(): null; const tasks=[]; entries.forEach((entry,idx)=>{ const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat); const xml = new XMLSerializer().serializeToString(svg); const fileName = 'barcode-'+String(idx+1).padStart(3,'0')+'.'+format; if(format==='svg'){ if(zip) zip.file(fileName, xml); else triggerDownload(new Blob([xml],{type:'image/svg+xml'}), fileName); } else { tasks.push(svgToBlob(xml, format).then(blob=>{ if(entries.length===1) triggerDownload(blob,'barcode-export.'+format); else if(zip) zip.file(fileName, blob); })); } });
    Promise.all(tasks).then(()=>{ if(zip) zip.generateAsync({type:'blob'}).then(content=> triggerDownload(content,'barcode-export.zip')); });
  }

  function renderPrintLabels(){ const view = document.getElementById('barcode-print-view'); if(!view) return; const entries = barcodeState.entries.filter(e=>e.value && e.value.trim()); if(!entries.length) return; view.innerHTML = '<div class="barcode-print-grid">'+ entries.map(entry=>{ const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat); const xml = new XMLSerializer().serializeToString(svg); const display = entry.caption || entry.value; return '<div class="barcode-print-card">'+xml+'<div class="caption">'+display+'</div></div>'; }).join('') +'</div>'; }

  // debounce helper
  function debounce(fn,wait){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),wait); }; }

  function initBarcodeGenerator(){
    try{
      const barcodeView = document.getElementById('barcode-generator');
      if (barcodeView && barcodeView.dataset.barcodeInit === 'true') {
        if (document.getElementById('barcode-play-toggle') && document.getElementById('barcode-play-toggle').dataset.bound === 'true') {
          return;
        }
      }
      
      // Ensure modal and related helpers live inside the barcode view to avoid leaking across routes
      const modal = document.getElementById('barcode-sequence-modal');
      const csvInput = document.getElementById('barcode-csv-input');
      const printView = document.getElementById('barcode-print-view');
      if(barcodeView){
        try{ if(modal && modal.parentNode !== barcodeView) barcodeView.appendChild(modal); }catch(e){}
        try{ if(csvInput && csvInput.parentNode !== barcodeView) barcodeView.appendChild(csvInput); }catch(e){}
        try{ if(printView && printView.parentNode !== barcodeView) barcodeView.appendChild(printView); }catch(e){}
        barcodeView.dataset.barcodeInit = 'true';
      }

      // Fix potential escaped-newline placeholders (literal "\\n") in textarea
      const ta = document.getElementById('barcode-values-input');
      if (ta && ta.value) {
        // replace double-escaped and single-escaped newline sequences with real newlines
        ta.value = String(ta.value).replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r/g, '');
      }

      parseBarcodeTextarea(); renderBarcodeFormatSelector(); renderBarcodePreview(); assignDefaultsAndWire();
    }catch(e){ console.error('initBarcodeGenerator',e); }
  }

  function assignDefaultsAndWire(){
    const root = document.getElementById('barcode-generator');
    if (root && root.dataset.barcodeBound === 'true') {
      return;
    }
    if (root) root.dataset.barcodeBound = 'true';

    assignBarcodeOptionsToInputs();
    const textarea = document.getElementById('barcode-values-input'); if(textarea){ textarea.addEventListener('input', debounce(()=>{ parseBarcodeTextarea(); renderBarcodePreview(); },200)); }
    const search = document.getElementById('barcode-search'); if(search) search.addEventListener('input', debounce(()=> renderBarcodeFormatSelector(),150));
    const importBtn = document.getElementById('barcode-import-csv'); if(importBtn) importBtn.addEventListener('click', ()=> document.getElementById('barcode-csv-input').click());
    const csvInput = document.getElementById('barcode-csv-input'); if(csvInput) csvInput.addEventListener('change', (ev)=>{ const f= ev.target.files && ev.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = (e)=>{ const text = String(e.target.result||'').replace(/\r/g,'').trim(); const ta = document.getElementById('barcode-values-input'); if(ta) ta.value = text; parseBarcodeTextarea(); renderBarcodePreview(); }; r.readAsText(f); });
    const seqBtn = document.getElementById('barcode-create-sequence');
    const seqCancel = document.getElementById('barcode-sequence-cancel');
    const seqApply = document.getElementById('barcode-sequence-apply');
    const modal = document.getElementById('barcode-sequence-modal');
    const barcodeView = document.getElementById('barcode-generator') || document.body;
    function openSequenceModal(){ if(!modal) return; try{ if(modal.parentNode !== barcodeView) barcodeView.appendChild(modal); }catch(e){} modal.classList.add('active'); modal.setAttribute('aria-hidden','false'); }
    function closeSequenceModal(){
      if (!modal) return;
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden','true');
      // keep modal in DOM (inside barcode view) to avoid leaking into other routes
    }
    if(seqBtn) seqBtn.addEventListener('click', ()=> openSequenceModal());
    if(seqCancel) seqCancel.addEventListener('click', ()=> closeSequenceModal());
    if(seqApply) seqApply.addEventListener('click', ()=>{ const prefix = document.getElementById('sequence-prefix').value||''; const suffix = document.getElementById('sequence-suffix').value||''; const start = Number(document.getElementById('sequence-start').value||1); const count = Number(document.getElementById('sequence-count').value||10); const step = Number(document.getElementById('sequence-step').value||1); const padding = Number(document.getElementById('sequence-padding').value||0); const vals = generateSequence({prefix,start,count,step,padding,suffix}); const ta = document.getElementById('barcode-values-input'); if(ta) { ta.value = vals.join('\n'); parseBarcodeTextarea(); renderBarcodePreview(); } closeSequenceModal(); });
    // click outside modal (overlay) closes it
    if(modal){ modal.addEventListener('click', (ev)=>{ if(ev.target === modal) closeSequenceModal(); }); }
    const downloadBtn = document.getElementById('barcode-download-btn'); if(downloadBtn) downloadBtn.addEventListener('click', ()=>{ const fmt = document.getElementById('barcode-download-format').value; performBarcodeDownload(fmt); });
    const copyBtn = document.getElementById('barcode-copy-output'); if(copyBtn) copyBtn.addEventListener('click', async ()=>{ const svg = document.querySelector('#barcode-preview svg'); if(!svg) return; const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type:'image/svg+xml' }); try{ await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': blob })]); }catch(e){ console.warn('clipboard write failed',e); } });
    // improved copy: try SVG, fallback to PNG raster
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const svg = document.querySelector('#barcode-preview svg');
      if (!svg) return;
      const svgStr = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': svgBlob })]);
        return;
      } catch (err) {
        // fallback to PNG
        try {
          const url = URL.createObjectURL(svgBlob);
          const img = new Image();
          img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 800;
            canvas.height = img.naturalHeight || 200;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = barcodeState.options.background || '#ffffff';
            ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(async (blob) => {
              try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); } catch (e) { console.warn('clipboard png fallback failed', e); }
            }, 'image/png');
            URL.revokeObjectURL(url);
          };
          img.src = url;
        } catch (e2) { console.warn('clipboard fallback error', e2); }
      }
    });
    const printBtn = document.getElementById('barcode-print-labels'); if(printBtn) printBtn.addEventListener('click', ()=>{ renderPrintLabels(); setTimeout(()=> window.print(), 300); });
    // options wiring
    ['barcode-show-text','barcode-max-width','barcode-height','barcode-margin','barcode-color','barcode-bg-color','barcode-font-size','barcode-text-align','barcode-rotation'].forEach(id=>{ const el = document.getElementById(id); if(!el) return; el.addEventListener('input', debounce(()=>{ updateBarcodeOptionsFromInput(); renderBarcodePreview(); },120)); el.addEventListener('change', debounce(()=>{ updateBarcodeOptionsFromInput(); renderBarcodePreview(); },120)); });
    // expose selector helper to global so onclick in generated HTML can call
    window.selectBarcodeFormat = function(fmt){
      barcodeState.selectedFormat = fmt;
      const textarea = document.getElementById('barcode-values-input');
      const textareaValue = textarea ? textarea.value.trim() : '';
      const currentEntries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
      if (!currentEntries.length && textareaValue) {
        parseBarcodeTextarea();
      } else if (currentEntries.length) {
        barcodeState.entries = currentEntries.map(en=> ({ ...en, error: validateValue(en.value, fmt) }));
      }
      serializeEntriesToTextarea(); renderBarcodeFormatSelector(); renderBarcodePreview();
    };

    // Auto-scroll play/pause logic
    const playBtn = document.getElementById('barcode-play-toggle');
    const speedInput = document.getElementById('barcode-play-speed');
    const PLAY_SVG = '<svg id="barcode-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3v18l15-9L5 3z" fill="currentColor"/></svg>';
    const PAUSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>';
    function stopAutoPlay(){ isAutoPlaying = false; if(rafRef.id) cancelAnimationFrame(rafRef.id); rafRef.id = null; if(playBtn) playBtn.innerHTML = PLAY_SVG; }
    function startAutoPlay(){ if(isAutoPlaying) return; isAutoPlaying = true; if(playBtn) playBtn.innerHTML = PAUSE_SVG; let last = performance.now(); const step = (now)=>{ const previewEl = document.getElementById('barcode-preview'); if(!previewEl) return stopAutoPlay(); const delta = (now - last)/1000; last = now; const speed = Number(speedInput && speedInput.value ? Number(speedInput.value) : autoScrollSpeed); previewEl.scrollTop = Math.min(previewEl.scrollHeight - previewEl.clientHeight, previewEl.scrollTop + speed * delta); if(previewEl.scrollTop + previewEl.clientHeight >= previewEl.scrollHeight - 1){ stopAutoPlay(); return; } rafRef.id = requestAnimationFrame(step); }; rafRef.id = requestAnimationFrame(step); }
    if(playBtn) playBtn.addEventListener('click', ()=>{
      if(isAutoPlaying) stopAutoPlay(); else startAutoPlay();
    });
    if(speedInput) speedInput.addEventListener('input', ()=>{ /* value read in startAutoPlay loop */ });
    // left panel hide/collapse wiring (new left-hide button)
    const leftHide = document.getElementById('barcode-left-hide');
    const layout = document.querySelector('.barcode-layout');
    if (leftHide && layout) {
      if (leftHide.dataset.bound !== 'true') {
        leftHide.addEventListener('click', () => {
          layout.classList.toggle('left-collapsed');
          // update icon rotation to indicate collapsed state
          if (layout.classList.contains('left-collapsed')) {
            leftHide.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          } else {
            leftHide.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          }
        });
        leftHide.dataset.bound = 'true';
      }
    }
    // right panel hide wiring
    const rightHide = document.getElementById('barcode-right-hide');
    if (rightHide && layout) {
      if (rightHide.dataset.bound !== 'true') {
        rightHide.addEventListener('click', () => {
          layout.classList.toggle('right-collapsed');
          const hidden = layout.classList.contains('right-collapsed');
          rightHide.title = hidden ? 'Show options' : 'Hide options';
          // swap icon (eye vs eye-off) using inline SVG
          rightHide.innerHTML = hidden ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.94 17.94A10.97 10.97 0 0 0 21 12c-2.9-4.5-7.6-7-9-7-1.4 0-6.1 2.5-9 7a10.97 10.97 0 0 0 3.06 5.94" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 1l22 22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
        });
        rightHide.dataset.bound = 'true';
      }
    }
    // hide/show preview wiring
    const hideToggle = document.getElementById('barcode-hide-toggle');
    const previewEl = document.getElementById('barcode-preview');
    if (hideToggle && previewEl) {
      hideToggle.addEventListener('click', () => {
        const hidden = previewEl.classList.toggle('hidden-preview');
        hideToggle.title = hidden ? 'Show preview' : 'Hide preview';
        hideToggle.innerHTML = hidden ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 2l20 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      });
    }
  }

  function assignBarcodeOptionsToInputs(){ const el=id=>document.getElementById(id); if(!el('barcode-show-text')) return; el('barcode-show-text').checked = barcodeState.options.showText; el('barcode-max-width').value = barcodeState.options.maxWidth; el('barcode-height').value = barcodeState.options.height; el('barcode-margin').value = barcodeState.options.margin; el('barcode-color').value = barcodeState.options.color; el('barcode-bg-color').value = barcodeState.options.background; el('barcode-font-size').value = barcodeState.options.fontSize; el('barcode-text-align').value = barcodeState.options.textAlign; el('barcode-rotation').value = barcodeState.options.rotation; }

  // register to window for renderer to call
  window.initBarcodeGenerator = window.initBarcodeGenerator || initBarcodeGenerator;
  // also expose performBarcodeDownload for testing
  window.performBarcodeDownload = performBarcodeDownload;

})();
