/* ============================================================
 * 대령약국 조제누락체크 탭 (외부 모듈)
 *
 * 워크플로우:
 *  1) 팜3000 조제내역 xlsx 업로드 (의약품명 + 사용량)
 *  2) 오늘 주문리스트와 자동 대조 → 누락 후보 추출
 *  3) 2층재고 자동 제외 / 무시목록 자동 제외 / 소량 필터
 *  4) [+ 주문추가] 버튼 → 오늘 주문리스트에 즉시 등록
 *  5) 수기 메모 사진 미리보기 (보면서 수동 대조)
 *
 * 의존: XLSX(SheetJS), fbDb, allData, currentDate, currentUser,
 *       currentAuthUid, floor2MedList, PriceMatcher, calcOrderAmount
 * 작성: 2026-05-22
 * ============================================================ */
(function () {
  'use strict';

  /* ──────── 전역 접근 헬퍼 (let 변수 대응) ──────── */
  function G(name) {
    try { if (typeof window[name] !== 'undefined' && window[name]) return window[name]; } catch (e) {}
    return null;
  }
  function getFbDb() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) {}
    return window.fbDb || null;
  }
  function getAllData() {
    try { if (typeof allData !== 'undefined' && allData) return allData; } catch (e) {}
    return window.allData || {};
  }
  function getCurrentDate() {
    try { if (typeof currentDate !== 'undefined' && currentDate) return currentDate; } catch (e) {}
    return window.currentDate || getTodayStr();
  }
  function getCurrentUser() {
    try { if (typeof currentUser !== 'undefined') return currentUser; } catch (e) {}
    return window.currentUser || '';
  }
  function getCurrentAuthUid() {
    try { if (typeof currentAuthUid !== 'undefined') return currentAuthUid; } catch (e) {}
    return window.currentAuthUid || '';
  }
  function getFloor2List() {
    try { if (typeof floor2MedList !== 'undefined' && Array.isArray(floor2MedList)) return floor2MedList; } catch (e) {}
    return window.floor2MedList || [];
  }
  function getTodayStr() {
    try { if (typeof todayStr === 'function') return todayStr(); } catch (e) {}
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normName(s) {
    try { if (typeof normalizeMedName === 'function') return normalizeMedName(s); } catch (e) {}
    return String(s || '').toLowerCase().replace(/[\s\(\)\*×x·\-_\/\.%,]/g, '');
  }
  function stripName(s) {
    try { if (typeof normalizeForPriceMatch === 'function') return normalizeForPriceMatch(s); } catch (e) {}
    return normName(s);
  }
  function fmtWonSafe(n) {
    try { if (typeof fmtWon === 'function') return fmtWon(n); } catch (e) {}
    return '₩' + Math.round(n || 0).toLocaleString();
  }

  /* ──────── 상태 ──────── */
  var dispenseItems = [];      // [{name, qty}]  업로드한 조제내역
  var ignoreMap = {};          // 무시목록 (Firebase)
  var photoUrls = [];          // 사진 objectURL 배열
  var panelBuilt = false;
  var minQtyFilter = 0;        // 소진량 필터
  var uploadMeta = null;       // {filename, count, uploadedAt}
  var addedNames = {};         // 이번 세션에서 추가한 약 (중복 방지 표시)

  /* ──────── 스타일 ──────── */
  function injectStyle() {
    if (document.getElementById('dispense-tab-style')) return;
    var s = document.createElement('style');
    s.id = 'dispense-tab-style';
    s.textContent = [
      '#panel-dispense { padding: 14px; padding-bottom: 80px; overflow-y: auto; height: 100%; contain: layout style; }',
      '#panel-dispense .dp-box { background:#fff; border:1px solid var(--border,#dfe8d1); border-radius:10px; padding:14px; margin-bottom:12px; }',
      '#panel-dispense .dp-title { font-size:13px; font-weight:800; color:var(--text,#1f2d1a); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; }',
      '#panel-dispense .dp-desc { font-size:11.5px; color:var(--text-muted,#8a9484); margin-bottom:10px; line-height:1.5; }',
      '#panel-dispense .dp-btn { padding:10px 16px; border:1px solid var(--border-strong,#c8d5b3); background:#fff; color:var(--text-soft,#4b5a44); border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; }',
      '#panel-dispense .dp-btn:hover { background:var(--accent-soft,#e4f0d4); border-color:var(--accent,#5a8a3a); }',
      '#panel-dispense .dp-btn.primary { background:var(--accent,#5a8a3a); color:#fff; border-color:var(--accent,#5a8a3a); }',
      '#panel-dispense .dp-btn.primary:hover { background:#4a7530; }',
      '#panel-dispense .dp-btn.danger { color:#dc2626; border-color:#fca5a5; }',
      '#panel-dispense .dp-btn:disabled { opacity:0.5; cursor:not-allowed; }',
      '#panel-dispense .dp-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }',
      '#panel-dispense .dp-meta { font-size:11.5px; color:var(--text-muted,#8a9484); background:#f8faf5; padding:8px 10px; border-radius:6px; margin-top:8px; }',
      // 통계 배지
      '#panel-dispense .dp-stats { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }',
      '#panel-dispense .dp-pill { padding:5px 11px; border-radius:999px; font-size:11.5px; font-weight:700; }',
      '#panel-dispense .dp-pill.total { background:#e0f2fe; color:#075985; }',
      '#panel-dispense .dp-pill.missing { background:#fee2e2; color:#991b1b; }',
      '#panel-dispense .dp-pill.ordered { background:#dcfce7; color:#166534; }',
      '#panel-dispense .dp-pill.floor2 { background:#fef3c7; color:#92400e; }',
      '#panel-dispense .dp-pill.ignored { background:#f3f4f6; color:#6b7280; }',
      // 필터
      '#panel-dispense .dp-filter { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; font-size:12px; color:var(--text-soft,#4b5a44); }',
      '#panel-dispense .dp-filter input[type=range] { flex:1; min-width:120px; max-width:200px; accent-color:var(--accent,#5a8a3a); }',
      '#panel-dispense .dp-filter input[type=search] { flex:1; min-width:140px; padding:7px 10px; border:1px solid var(--border-strong,#c8d5b3); border-radius:6px; font-size:12.5px; }',
      // 누락 리스트
      '#panel-dispense .dp-item { display:grid; grid-template-columns:26px 1fr 62px auto; gap:8px; align-items:center; padding:9px 8px; border-top:1px solid #f1f5f9; font-size:13px; }',
      '#panel-dispense .dp-item:first-child { border-top:none; }',
      '#panel-dispense .dp-item.added { background:#f0fdf4; opacity:0.65; }',
      '#panel-dispense .dp-item input[type=checkbox] { width:17px; height:17px; accent-color:var(--accent,#5a8a3a); cursor:pointer; }',
      '#panel-dispense .dp-name { font-weight:700; color:var(--text,#1f2d1a); word-break:break-all; line-height:1.35; }',
      '#panel-dispense .dp-price { font-size:10.5px; color:#065f46; font-weight:600; }',
      '#panel-dispense .dp-price.none { color:#9ca3af; font-weight:500; }',
      '#panel-dispense .dp-qty { text-align:right; font-weight:800; color:#78350f; background:#fef3c7; border-radius:5px; padding:3px 7px; font-size:12px; }',
      '#panel-dispense .dp-acts { display:flex; gap:4px; }',
      '#panel-dispense .dp-mini { padding:5px 9px; border:1px solid var(--border-strong,#c8d5b3); background:#fff; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap; }',
      '#panel-dispense .dp-mini.add { background:var(--accent,#5a8a3a); color:#fff; border-color:var(--accent,#5a8a3a); }',
      '#panel-dispense .dp-mini.ign { color:#6b7280; }',
      '#panel-dispense .dp-mini:disabled { opacity:0.45; cursor:default; }',
      '#panel-dispense .dp-empty { text-align:center; color:var(--text-muted,#8a9484); padding:26px 12px; font-size:13px; line-height:1.6; }',
      // 사진
      '#panel-dispense .dp-photos { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }',
      '#panel-dispense .dp-photo { position:relative; width:96px; height:96px; border-radius:8px; overflow:hidden; border:1px solid var(--border,#dfe8d1); cursor:pointer; background:#f8faf5; }',
      '#panel-dispense .dp-photo img { width:100%; height:100%; object-fit:cover; display:block; }',
      '#panel-dispense .dp-photo-del { position:absolute; top:3px; right:3px; width:20px; height:20px; border:none; background:rgba(0,0,0,0.6); color:#fff; border-radius:4px; font-size:11px; cursor:pointer; padding:0; line-height:1; }',
      // 라이트박스
      '#dpLightbox { display:none; position:fixed; inset:0; z-index:9700; background:rgba(0,0,0,0.88); align-items:center; justify-content:center; padding:16px; }',
      '#dpLightbox.show { display:flex; }',
      '#dpLightbox img { max-width:100%; max-height:92vh; object-fit:contain; border-radius:6px; }',
      '#dpLightbox .dp-lb-close { position:absolute; top:14px; right:14px; width:42px; height:42px; border:none; background:rgba(255,255,255,0.9); border-radius:8px; font-size:18px; cursor:pointer; }',
      // 무시목록
      '#panel-dispense .dp-ign-chip { display:inline-flex; align-items:center; gap:5px; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:999px; padding:4px 6px 4px 11px; font-size:11.5px; color:#4b5563; margin:3px 3px 0 0; }',
      '#panel-dispense .dp-ign-x { border:none; background:none; color:#dc2626; cursor:pointer; font-size:12px; padding:0 3px; }',
      '@media (max-width:600px){',
      '  #panel-dispense { padding:10px; }',
      '  #panel-dispense .dp-item { grid-template-columns:24px 1fr 54px; gap:6px; padding:10px 6px; }',
      '  #panel-dispense .dp-acts { grid-column:1 / -1; justify-content:flex-end; margin-top:2px; }',
      '  #panel-dispense .dp-photo { width:80px; height:80px; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ──────── 패널 생성 (1회) ──────── */
  function ensurePanel() {
    var panel = document.getElementById('panel-dispense');
    if (!panel) {
      var main = document.querySelector('.main') || document.querySelector('.app');
      if (!main) return null;
      panel = document.createElement('div');
      panel.id = 'panel-dispense';
      panel.className = 'tab-panel';
      main.appendChild(panel);
    }
    if (panelBuilt) return panel;

    panel.innerHTML = [
      // 1. 업로드
      '<div class="dp-box">',
      '  <div class="dp-title">📊 조제내역 업로드 <span id="dpUploadBadge"></span></div>',
      '  <div class="dp-desc">팜3000에서 추출한 <b>오늘 조제 의약품 사용량</b> 엑셀 파일을 올려주세요.<br>의약품명 · 사용량 컬럼을 자동으로 찾습니다.</div>',
      '  <div class="dp-row">',
      '    <input type="file" id="dpXlsxInput" accept=".xlsx,.xls,.csv" style="display:none;">',
      '    <button class="dp-btn primary" type="button" id="dpUploadBtn">📁 엑셀 파일 선택</button>',
      '    <button class="dp-btn danger" type="button" id="dpClearBtn" style="display:none;">🗑 초기화</button>',
      '  </div>',
      '  <div id="dpUploadMeta"></div>',
      '</div>',
      // 2. 사진
      '<div class="dp-box">',
      '  <div class="dp-title">📷 수기 메모 사진 <span style="font-size:11px;font-weight:400;color:var(--text-muted,#8a9484);">(참고용 · 저장 안 됨)</span></div>',
      '  <div class="dp-desc">직원들이 손으로 적은 주문 메모를 찍어서 올리면, 아래 누락 리스트와 나란히 보면서 대조할 수 있습니다.</div>',
      '  <div class="dp-row">',
      '    <input type="file" id="dpPhotoInput" accept="image/*" multiple capture="environment" style="display:none;">',
      '    <button class="dp-btn" type="button" id="dpPhotoBtn">📷 사진 추가</button>',
      '    <button class="dp-btn danger" type="button" id="dpPhotoClearBtn" style="display:none;">전체 삭제</button>',
      '  </div>',
      '  <div class="dp-photos" id="dpPhotos"></div>',
      '</div>',
      // 3. 결과
      '<div class="dp-box">',
      '  <div class="dp-title">⚠️ 주문 누락 의심 목록',
      '    <button class="dp-btn" type="button" id="dpExportBtn" style="padding:6px 11px;font-size:11.5px;display:none;">📥 Excel</button>',
      '  </div>',
      '  <div class="dp-stats" id="dpStats"></div>',
      '  <div class="dp-filter" id="dpFilterRow" style="display:none;">',
      '    <label style="white-space:nowrap;">최소 사용량 <b id="dpMinQtyLabel">0</b></label>',
      '    <input type="range" id="dpMinQty" min="0" max="50" step="1" value="0">',
      '    <input type="search" id="dpSearch" placeholder="🔍 약품명 검색">',
      '  </div>',
      '  <div class="dp-row" id="dpBulkRow" style="display:none;margin-bottom:8px;">',
      '    <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;"><input type="checkbox" id="dpCheckAll" style="width:16px;height:16px;accent-color:var(--accent,#5a8a3a);"> 전체선택</label>',
      '    <button class="dp-btn primary" type="button" id="dpBulkAddBtn" style="padding:7px 13px;font-size:12px;">✅ 선택 항목 주문 추가</button>',
      '  </div>',
      '  <div id="dpResult"><div class="dp-empty">먼저 조제내역 엑셀을 업로드해주세요 📊</div></div>',
      '</div>',
      // 4. 무시목록
      '<div class="dp-box">',
      '  <div class="dp-title">🚫 무시 목록 <span style="font-size:11px;font-weight:400;color:var(--text-muted,#8a9484);">(항상 제외되는 약)</span></div>',
      '  <div class="dp-desc">주문할 필요 없는 약(원내조제 전용, 대량 보유 등)을 등록하면 다음부터 목록에 안 뜹니다.</div>',
      '  <div id="dpIgnoreList"></div>',
      '</div>'
    ].join('\n');

    // 라이트박스 (body에 1회)
    if (!document.getElementById('dpLightbox')) {
      var lb = document.createElement('div');
      lb.id = 'dpLightbox';
      lb.innerHTML = '<button class="dp-lb-close" type="button">✕</button><img alt="메모 사진">';
      lb.addEventListener('click', function (e) {
        if (e.target === lb || e.target.classList.contains('dp-lb-close')) lb.classList.remove('show');
      });
      document.body.appendChild(lb);
    }

    bindEvents(panel);
    panelBuilt = true;
    return panel;
  }

  /* ──────── 이벤트 바인딩 (1회) ──────── */
  function bindEvents(panel) {
    var xlsxInput = panel.querySelector('#dpXlsxInput');
    panel.querySelector('#dpUploadBtn').addEventListener('click', function () { xlsxInput.click(); });
    xlsxInput.addEventListener('change', handleXlsxUpload);

    panel.querySelector('#dpClearBtn').addEventListener('click', function () {
      if (!confirm('업로드한 조제내역을 초기화할까요?')) return;
      dispenseItems = []; uploadMeta = null; addedNames = {};
      renderResult(); renderUploadMeta();
    });

    var photoInput = panel.querySelector('#dpPhotoInput');
    panel.querySelector('#dpPhotoBtn').addEventListener('click', function () { photoInput.click(); });
    photoInput.addEventListener('change', handlePhotoUpload);
    panel.querySelector('#dpPhotoClearBtn').addEventListener('click', clearPhotos);

    var minQty = panel.querySelector('#dpMinQty');
    minQty.addEventListener('input', function () {
      minQtyFilter = parseInt(minQty.value, 10) || 0;
      panel.querySelector('#dpMinQtyLabel').textContent = minQtyFilter;
      renderResult();
    });

    var search = panel.querySelector('#dpSearch');
    var st = null;
    search.addEventListener('input', function () {
      clearTimeout(st);
      st = setTimeout(renderResult, 200);
    });

    panel.querySelector('#dpCheckAll').addEventListener('change', function (e) {
      var boxes = panel.querySelectorAll('#dpResult input[type=checkbox]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = e.target.checked;
    });
    panel.querySelector('#dpBulkAddBtn').addEventListener('click', bulkAdd);
    panel.querySelector('#dpExportBtn').addEventListener('click', exportExcel);
  }

  /* ──────── 엑셀 업로드 & 파싱 ──────── */
  function handleXlsxUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리(XLSX) 로드 실패. 새로고침 후 다시 시도해주세요.'); return; }

    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        var parsed = parseRows(rows);
        if (!parsed.length) {
          alert('의약품명·사용량 데이터를 찾지 못했습니다.\n\n엑셀 첫 시트에 [의약품명] [사용량] 형태 컬럼이 있는지 확인해주세요.');
          return;
        }
        dispenseItems = parsed;
        uploadMeta = { filename: file.name, count: parsed.length, uploadedAt: Date.now(), uploader: getCurrentUser() };
        addedNames = {};
        renderUploadMeta();
        renderResult();
        alert('✅ ' + parsed.length + '개 품목 인식 완료');
      } catch (err) {
        console.error('[조제누락] 파싱 실패:', err);
        alert('엑셀 읽기 실패: ' + (err.message || err));
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  // 컬럼명 자동 감지 파서
  function parseRows(rows) {
    if (!rows || !rows.length) return [];
    var NAME_KEYS = ['의약품명', '약품명', '품목명', '제품명', '약품', '의약품', '품명', '명칭', 'name'];
    var QTY_KEYS = ['사용량', '수량', '조제량', '총량', '사용수량', '조제수량', '합계', '계', 'qty', 'count'];

    var headerRow = -1, nameCol = -1, qtyCol = -1;
    var scanLimit = Math.min(rows.length, 12);
    for (var r = 0; r < scanLimit; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || '').trim().toLowerCase().replace(/\s/g, '');
        if (!cell) continue;
        if (nameCol < 0 && NAME_KEYS.some(function (k) { return cell.indexOf(k) !== -1; })) { nameCol = c; headerRow = r; }
        if (qtyCol < 0 && QTY_KEYS.some(function (k) { return cell.indexOf(k) !== -1; })) { qtyCol = c; if (headerRow < 0) headerRow = r; }
      }
      if (nameCol >= 0 && qtyCol >= 0) break;
    }

    // 헤더 못 찾으면 추론: 텍스트 많은 컬럼 = 이름, 숫자 많은 컬럼 = 수량
    if (nameCol < 0 || qtyCol < 0) {
      var textScore = {}, numScore = {};
      var sampleEnd = Math.min(rows.length, 60);
      for (var rr = 0; rr < sampleEnd; rr++) {
        var rw = rows[rr] || [];
        for (var cc = 0; cc < rw.length; cc++) {
          var v = rw[cc];
          if (v === '' || v == null) continue;
          if (typeof v === 'number' || /^[\d.,]+$/.test(String(v).trim())) numScore[cc] = (numScore[cc] || 0) + 1;
          else if (/[가-힣a-zA-Z]/.test(String(v))) textScore[cc] = (textScore[cc] || 0) + 1;
        }
      }
      if (nameCol < 0) {
        var bestT = -1, bestTc = -1;
        Object.keys(textScore).forEach(function (k) { if (textScore[k] > bestT) { bestT = textScore[k]; bestTc = +k; } });
        nameCol = bestTc;
      }
      if (qtyCol < 0) {
        var bestN = -1, bestNc = -1;
        Object.keys(numScore).forEach(function (k) { if (+k !== nameCol && numScore[k] > bestN) { bestN = numScore[k]; bestNc = +k; } });
        qtyCol = bestNc;
      }
      if (headerRow < 0) headerRow = 0;
    }
    if (nameCol < 0) return [];

    var out = [], seen = {};
    for (var i = headerRow + 1; i < rows.length; i++) {
      var row2 = rows[i] || [];
      var nm = String(row2[nameCol] == null ? '' : row2[nameCol]).trim();
      if (!nm || nm.length < 2) continue;
      if (/^(합계|총계|소계|계|total|sum)$/i.test(nm)) continue;
      var qRaw = qtyCol >= 0 ? row2[qtyCol] : '';
      var qty = parseFloat(String(qRaw).replace(/[^\d.\-]/g, ''));
      if (!isFinite(qty)) qty = 0;
      var key = normName(nm);
      if (seen[key] != null) { out[seen[key]].qty += qty; continue; }  // 중복 합산
      seen[key] = out.length;
      out.push({ name: nm, qty: qty });
    }
    return out;
  }

  function renderUploadMeta() {
    var host = document.getElementById('dpUploadMeta');
    var badge = document.getElementById('dpUploadBadge');
    var clearBtn = document.getElementById('dpClearBtn');
    if (!host) return;
    if (!uploadMeta) {
      host.innerHTML = '';
      if (badge) badge.innerHTML = '';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    var t = new Date(uploadMeta.uploadedAt);
    var tm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    host.innerHTML = '<div class="dp-meta">📄 <b>' + escHtml(uploadMeta.filename) + '</b> · ' +
      uploadMeta.count + '개 품목 · ' + tm + ' 업로드' + (uploadMeta.uploader ? ' (' + escHtml(uploadMeta.uploader) + ')' : '') + '</div>';
    if (badge) badge.innerHTML = '<span class="dp-pill total">' + uploadMeta.count + '품목</span>';
    if (clearBtn) clearBtn.style.display = 'inline-block';
  }

  /* ──────── 사진 (메모리에만) ──────── */
  function handlePhotoUpload(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    for (var i = 0; i < files.length; i++) {
      if (photoUrls.length >= 8) { alert('사진은 최대 8장까지 가능합니다'); break; }
      photoUrls.push(URL.createObjectURL(files[i]));
    }
    renderPhotos();
    e.target.value = '';
  }
  function clearPhotos() {
    photoUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    photoUrls = [];
    renderPhotos();
  }
  function renderPhotos() {
    var host = document.getElementById('dpPhotos');
    var clearBtn = document.getElementById('dpPhotoClearBtn');
    if (!host) return;
    if (clearBtn) clearBtn.style.display = photoUrls.length ? 'inline-block' : 'none';
    if (!photoUrls.length) { host.innerHTML = ''; return; }
    host.innerHTML = photoUrls.map(function (u, i) {
      return '<div class="dp-photo" data-idx="' + i + '"><img src="' + u + '" alt="메모"><button class="dp-photo-del" type="button" data-del="' + i + '">✕</button></div>';
    }).join('');
    host.querySelectorAll('.dp-photo').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('dp-photo-del')) {
          var idx = parseInt(e.target.getAttribute('data-del'), 10);
          try { URL.revokeObjectURL(photoUrls[idx]); } catch (er) {}
          photoUrls.splice(idx, 1);
          renderPhotos();
          return;
        }
        var lb = document.getElementById('dpLightbox');
        var img = lb && lb.querySelector('img');
        if (img) { img.src = photoUrls[parseInt(el.getAttribute('data-idx'), 10)]; lb.classList.add('show'); }
      });
    });
  }

  /* ──────── 대조 로직 ──────── */
  function getTodayOrderedKeys() {
    var d = getCurrentDate();
    var day = getAllData()[d];
    var keys = { norm: {}, strip: {} };
    if (!day || !Array.isArray(day.items)) return keys;
    day.items.forEach(function (it) {
      if (!it || !it.name) return;
      keys.norm[normName(it.name)] = true;
      var sk = stripName(it.name);
      if (sk) keys.strip[sk] = true;
    });
    return keys;
  }

  function isOrdered(name, orderedKeys) {
    var n = normName(name), s = stripName(name);
    if (orderedKeys.norm[n]) return true;
    if (s && orderedKeys.strip[s]) return true;
    // 부분 포함 (짧은 이름이 긴 이름에 포함)
    if (s && s.length >= 3) {
      var sk = Object.keys(orderedKeys.strip);
      for (var i = 0; i < sk.length; i++) {
        var k = sk[i];
        if (k.length >= 3 && (k.indexOf(s) !== -1 || s.indexOf(k) !== -1)) return true;
      }
    }
    return false;
  }

  function isFloor2(name) {
    var list = getFloor2List();
    if (!list.length) return false;
    var s = stripName(name), n = normName(name);
    for (var i = 0; i < list.length; i++) {
      var fn = list[i] && list[i].name;
      if (!fn) continue;
      var fs = stripName(fn), fnorm = normName(fn);
      if (fnorm === n) return true;
      if (fs && s && (fs === s || (fs.length >= 3 && s.length >= 3 && (fs.indexOf(s) !== -1 || s.indexOf(fs) !== -1)))) return true;
    }
    return false;
  }

  function ignoreKey(name) { return normName(name).replace(/[.#$\[\]\/]/g, '_'); }
  function isIgnored(name) { return !!ignoreMap[ignoreKey(name)]; }

  /* ──────── 결과 렌더 ──────── */
  function renderResult() {
    var host = document.getElementById('dpResult');
    var statsEl = document.getElementById('dpStats');
    var filterRow = document.getElementById('dpFilterRow');
    var bulkRow = document.getElementById('dpBulkRow');
    var exportBtn = document.getElementById('dpExportBtn');
    if (!host) return;

    if (!dispenseItems.length) {
      host.innerHTML = '<div class="dp-empty">먼저 조제내역 엑셀을 업로드해주세요 📊</div>';
      if (statsEl) statsEl.innerHTML = '';
      if (filterRow) filterRow.style.display = 'none';
      if (bulkRow) bulkRow.style.display = 'none';
      if (exportBtn) exportBtn.style.display = 'none';
      return;
    }

    var orderedKeys = getTodayOrderedKeys();
    var cntOrdered = 0, cntFloor2 = 0, cntIgnored = 0;
    var missing = [];

    dispenseItems.forEach(function (it) {
      if (isOrdered(it.name, orderedKeys)) { cntOrdered++; return; }
      if (isFloor2(it.name)) { cntFloor2++; return; }
      if (isIgnored(it.name)) { cntIgnored++; return; }
      missing.push(it);
    });

    // 통계
    if (statsEl) {
      statsEl.innerHTML =
        '<span class="dp-pill total">조제 ' + dispenseItems.length + '</span>' +
        '<span class="dp-pill missing">⚠ 누락의심 ' + missing.length + '</span>' +
        '<span class="dp-pill ordered">✓ 주문됨 ' + cntOrdered + '</span>' +
        (cntFloor2 ? '<span class="dp-pill floor2">2층재고 ' + cntFloor2 + '</span>' : '') +
        (cntIgnored ? '<span class="dp-pill ignored">무시 ' + cntIgnored + '</span>' : '');
    }
    if (filterRow) filterRow.style.display = 'flex';
    if (exportBtn) exportBtn.style.display = missing.length ? 'inline-block' : 'none';

    // 필터 적용
    var q = ((document.getElementById('dpSearch') || {}).value || '').trim().toLowerCase();
    var filtered = missing.filter(function (it) {
      if (minQtyFilter > 0 && (it.qty || 0) < minQtyFilter) return false;
      if (q && it.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    // 사용량 많은 순
    filtered.sort(function (a, b) { return (b.qty || 0) - (a.qty || 0); });

    if (bulkRow) bulkRow.style.display = filtered.length ? 'flex' : 'none';

    if (!filtered.length) {
      host.innerHTML = '<div class="dp-empty">' +
        (missing.length ? '필터 조건에 맞는 항목이 없습니다.<br>최소 사용량을 낮추거나 검색어를 지워보세요.'
                        : '🎉 누락된 의약품이 없습니다!<br>조제한 약 모두 주문리스트에 있거나 2층재고입니다.') +
        '</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (it) {
      var added = !!addedNames[normName(it.name)];
      // 단가 매칭 (가벼운 캐시 기반)
      var priceHtml = '';
      try {
        if (window.PriceMatcher && typeof window.PriceMatcher.findBest === 'function') {
          var m = window.PriceMatcher.findBest(it.name);
          if (m && m.item && m.item.price) {
            priceHtml = '<div class="dp-price">단가 ' + fmtWonSafe(m.item.price) + '</div>';
          } else {
            priceHtml = '<div class="dp-price none">단가 미등록</div>';
          }
        }
      } catch (e) {}
      html += '<div class="dp-item' + (added ? ' added' : '') + '" data-name="' + escHtml(it.name) + '">' +
        '<input type="checkbox"' + (added ? ' disabled' : '') + '>' +
        '<div><div class="dp-name">' + escHtml(it.name) + '</div>' + priceHtml + '</div>' +
        '<div class="dp-qty">' + (it.qty || 0) + '</div>' +
        '<div class="dp-acts">' +
          '<button class="dp-mini add" type="button" data-add="' + escHtml(it.name) + '" data-qty="' + (it.qty || 0) + '"' + (added ? ' disabled' : '') + '>' + (added ? '✓ 추가됨' : '+ 주문') + '</button>' +
          '<button class="dp-mini ign" type="button" data-ign="' + escHtml(it.name) + '" title="다음부터 안 뜨게">🚫</button>' +
        '</div>' +
      '</div>';
    });
    host.innerHTML = html;

    host.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { addToOrder(b.getAttribute('data-add'), b.getAttribute('data-qty')); });
    });
    host.querySelectorAll('[data-ign]').forEach(function (b) {
      b.addEventListener('click', function () { addIgnore(b.getAttribute('data-ign')); });
    });
  }

  /* ──────── 주문리스트에 추가 ──────── */
  function addToOrder(name, qty) {
    var fbDbRef = getFbDb();
    var uid = getCurrentAuthUid();
    var user = getCurrentUser();
    if (!fbDbRef) { alert('Firebase 연결 안 됨'); return; }
    if (!uid || !user) { alert('로그인 정보 없음'); return; }
    var date = getCurrentDate();
    var now = Date.now();
    var payload = {
      name: String(name || ''),
      spec: '',
      qty: '',
      note: '조제누락',
      author: user,
      authorUid: uid,
      timestamp: now
    };
    fbDbRef.ref('days/' + date + '/items').push().set(payload).then(function () {
      addedNames[normName(name)] = true;
      renderResult();
    }).catch(function (err) {
      alert('주문 추가 실패: ' + (err.message || err));
    });
  }

  function bulkAdd() {
    var host = document.getElementById('dpResult');
    if (!host) return;
    var checked = [];
    host.querySelectorAll('.dp-item').forEach(function (row) {
      var cb = row.querySelector('input[type=checkbox]');
      if (cb && cb.checked && !cb.disabled) {
        var btn = row.querySelector('[data-add]');
        if (btn) checked.push({ name: btn.getAttribute('data-add'), qty: btn.getAttribute('data-qty') });
      }
    });
    if (!checked.length) { alert('선택된 항목이 없습니다'); return; }
    if (!confirm(checked.length + '개 품목을 오늘 주문리스트에 추가할까요?')) return;

    var fbDbRef = getFbDb();
    var uid = getCurrentAuthUid(), user = getCurrentUser();
    if (!fbDbRef || !uid) { alert('로그인 정보 없음'); return; }
    var date = getCurrentDate();
    var updates = {};
    var base = Date.now();
    checked.forEach(function (c, i) {
      var key = fbDbRef.ref('days/' + date + '/items').push().key;
      updates['days/' + date + '/items/' + key] = {
        name: c.name, spec: '', qty: '', note: '조제누락',
        author: user, authorUid: uid, timestamp: base + i
      };
    });
    fbDbRef.ref().update(updates).then(function () {
      checked.forEach(function (c) { addedNames[normName(c.name)] = true; });
      var ca = document.getElementById('dpCheckAll');
      if (ca) ca.checked = false;
      renderResult();
      alert('✅ ' + checked.length + '개 품목 추가 완료');
    }).catch(function (err) {
      alert('일괄 추가 실패: ' + (err.message || err));
    });
  }

  /* ──────── 무시목록 ──────── */
  function addIgnore(name) {
    if (!confirm('【' + name + '】을(를) 무시 목록에 추가할까요?\n\n다음부터 누락 목록에 표시되지 않습니다.')) return;
    var fbDbRef = getFbDb();
    var k = ignoreKey(name);
    var payload = { name: String(name), addedBy: getCurrentUser(), addedAt: Date.now() };
    if (fbDbRef) {
      fbDbRef.ref('dispenseIgnore/' + k).set(payload).catch(function (err) {
        alert('무시 등록 실패: ' + (err.message || err));
      });
    } else {
      ignoreMap[k] = payload;
      renderResult(); renderIgnoreList();
    }
  }
  function removeIgnore(key) {
    var fbDbRef = getFbDb();
    if (fbDbRef) {
      fbDbRef.ref('dispenseIgnore/' + key).remove();
    } else {
      delete ignoreMap[key];
      renderResult(); renderIgnoreList();
    }
  }
  function renderIgnoreList() {
    var host = document.getElementById('dpIgnoreList');
    if (!host) return;
    var keys = Object.keys(ignoreMap);
    if (!keys.length) {
      host.innerHTML = '<div style="font-size:12px;color:var(--text-muted,#8a9484);padding:4px 0;">등록된 무시 항목이 없습니다.</div>';
      return;
    }
    host.innerHTML = keys.map(function (k) {
      var v = ignoreMap[k] || {};
      return '<span class="dp-ign-chip">' + escHtml(v.name || k) + '<button class="dp-ign-x" type="button" data-rm="' + escHtml(k) + '">✕</button></span>';
    }).join('');
    host.querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () { removeIgnore(b.getAttribute('data-rm')); });
    });
  }

  /* ──────── Excel 내보내기 ──────── */
  function exportExcel() {
    if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 없음'); return; }
    var orderedKeys = getTodayOrderedKeys();
    var missing = dispenseItems.filter(function (it) {
      return !isOrdered(it.name, orderedKeys) && !isFloor2(it.name) && !isIgnored(it.name);
    });
    if (!missing.length) { alert('내보낼 항목이 없습니다'); return; }
    missing.sort(function (a, b) { return (b.qty || 0) - (a.qty || 0); });
    var aoa = [['의약품명', '사용량', '단가', '비고']];
    missing.forEach(function (it) {
      var price = '';
      try {
        if (window.PriceMatcher) {
          var m = window.PriceMatcher.findBest(it.name);
          if (m && m.item && m.item.price) price = m.item.price;
        }
      } catch (e) {}
      aoa.push([it.name, it.qty || 0, price, addedNames[normName(it.name)] ? '추가됨' : '']);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 42 }, { wch: 9 }, { wch: 10 }, { wch: 10 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '조제누락');
    XLSX.writeFile(wb, '조제누락_' + getCurrentDate() + '.xlsx');
  }

  /* ──────── Firebase 무시목록 리스너 ──────── */
  var ignoreAttached = false;
  function setupIgnoreListener() {
    var fbDbRef = getFbDb();
    if (!fbDbRef || ignoreAttached) return !!fbDbRef;
    try {
      fbDbRef.ref('dispenseIgnore').on('value', function (snap) {
        ignoreMap = snap.val() || {};
        ignoreAttached = true;
        renderIgnoreList();
        if (dispenseItems.length) renderResult();
      }, function (err) {
        console.warn('[조제누락] 무시목록 읽기 실패:', err && err.message);
      });
      ignoreAttached = true;
      return true;
    } catch (e) { return false; }
  }

  /* ──────── 메인 렌더 ──────── */
  function renderAll() {
    ensurePanel();
    renderUploadMeta();
    renderPhotos();
    renderResult();
    renderIgnoreList();
    setupIgnoreListener();
  }

  /* ──────── 글로벌 노출 ──────── */
  window.DispenseCheck = {
    render: renderAll,
    init: function () { injectStyle(); ensurePanel(); renderAll(); }
  };

  /* ──────── 자동 초기화 (패널만, 데이터는 탭 진입 시) ──────── */
  function autoInit() {
    injectStyle();
    ensurePanel();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  console.log('✓ 조제누락체크 모듈 로드됨 (dispense.js)');
})();
