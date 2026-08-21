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
  var photoUrls = [];          // [{url, name, dateStr, lastModified}]
  var panelBuilt = false;
  var minQtyFilter = 0;        // 소진량 필터
  var uploadMeta = null;       // {filename, count, uploadedAt, fileDate, detectedDate}
  var addedNames = {};         // 이번 세션에서 추가한 약 (중복 방지 표시)
  var targetDate = null;       // ★ 대조 기준 날짜 (사용자가 선택/확정)
  var manualList = [];         // ★ b: 수기 주문 목록 (OCR 인식 or 직접 입력)
  var ocrRunning = false;

  /* ──────── 날짜 유틸 ──────── */
  function toDateStr(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 파일명에서 날짜 추출: 20260819, 2026-08-19, 260819, 08-19 등
  function extractDateFromFilename(fn) {
    if (!fn) return '';
    var s = String(fn);
    var m;
    // YYYY-MM-DD or YYYY.MM.DD or YYYY_MM_DD or YYYYMMDD
    m = s.match(/(20\d{2})[-._]?(\d{2})[-._]?(\d{2})/);
    if (m) {
      var y = +m[1], mo = +m[2], da = +m[3];
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        return y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
      }
    }
    // YYMMDD (6자리, 앞에 20 붙임)
    m = s.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
    if (m) {
      var y2 = 2000 + (+m[1]), mo2 = +m[2], da2 = +m[3];
      if (mo2 >= 1 && mo2 <= 12 && da2 >= 1 && da2 <= 31 && y2 >= 2020 && y2 <= 2099) {
        return y2 + '-' + String(mo2).padStart(2, '0') + '-' + String(da2).padStart(2, '0');
      }
    }
    return '';
  }
  function dateLabel(dStr) {
    if (!dStr) return '-';
    var dow = ['일', '월', '화', '수', '목', '금', '토'];
    var d = new Date(dStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dStr;
    return dStr + ' (' + dow[d.getDay()] + ')';
  }
  function getTargetDate() {
    return targetDate || getCurrentDate() || getTodayStr();
  }

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
      // ★ 날짜 박스
      '#panel-dispense .dp-datebox { border:2px solid var(--accent,#5a8a3a); background:#f8fcf4; }',
      '#panel-dispense .dp-date-input { padding:9px 12px; border:1.5px solid var(--border-strong,#c8d5b3); border-radius:7px; font-size:15px; font-family:inherit; color:var(--text,#1f2d1a); background:#fff; }',
      '#panel-dispense .dp-date-input:focus { outline:none; border-color:var(--accent,#5a8a3a); box-shadow:0 0 0 3px rgba(90,138,58,0.12); }',
      '#panel-dispense .dp-check-row { display:flex; align-items:center; gap:8px; padding:8px 11px; border-radius:7px; font-size:12.5px; margin-top:6px; }',
      '#panel-dispense .dp-check-row.ok { background:#dcfce7; color:#166534; }',
      '#panel-dispense .dp-check-row.warn { background:#fef3c7; color:#92400e; }',
      '#panel-dispense .dp-check-row.err { background:#fee2e2; color:#991b1b; font-weight:700; }',
      '#panel-dispense .dp-check-row.idle { background:#f3f4f6; color:#6b7280; }',
      '#panel-dispense .dp-check-icon { font-size:14px; flex-shrink:0; }',
      '#panel-dispense .dp-check-label { flex:1; }',
      '#panel-dispense .dp-check-val { font-weight:700; }',
      '#panel-dispense .dp-date-fix { border:none; background:rgba(255,255,255,0.7); border-radius:5px; padding:3px 9px; font-size:11px; font-weight:700; cursor:pointer; color:inherit; }',
      '#panel-dispense .dp-blocked { background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; padding:12px; border-radius:8px; font-size:12.5px; text-align:center; line-height:1.6; }',
      // ★ 수기 목록 (b)
      '#panel-dispense .dp-textarea { width:100%; padding:10px 12px; border:1.5px solid var(--border-strong,#c8d5b3); border-radius:7px; font-size:14px; font-family:inherit; resize:vertical; box-sizing:border-box; line-height:1.6; }',
      '#panel-dispense .dp-textarea:focus { outline:none; border-color:var(--accent,#5a8a3a); box-shadow:0 0 0 3px rgba(90,138,58,0.1); }',
      '#panel-dispense .dp-mchip { display:inline-flex; align-items:center; gap:5px; background:#ede9fe; border:1px solid #ddd6fe; border-radius:999px; padding:4px 6px 4px 11px; font-size:11.5px; color:#5b21b6; margin:3px 3px 0 0; font-weight:600; }',
      '#panel-dispense .dp-mchip-x { border:none; background:none; color:#dc2626; cursor:pointer; font-size:12px; padding:0 3px; }',
      // ★ OCR 결과
      '#panel-dispense .dp-ocr-box { margin-top:10px; padding:10px; background:#f8faf5; border:1px solid var(--border,#dfe8d1); border-radius:8px; }',
      '#panel-dispense .dp-ocr-head { font-size:12px; font-weight:700; color:var(--text-soft,#4b5a44); margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; }',
      '#panel-dispense .dp-ocr-line { display:grid; grid-template-columns:22px 1fr auto; gap:8px; align-items:center; padding:7px 4px; border-top:1px solid #eef2e8; font-size:12.5px; }',
      '#panel-dispense .dp-ocr-line:first-of-type { border-top:none; }',
      '#panel-dispense .dp-ocr-line input[type=checkbox] { width:16px; height:16px; accent-color:var(--accent,#5a8a3a); }',
      '#panel-dispense .dp-ocr-matched { font-weight:700; color:var(--text,#1f2d1a); }',
      '#panel-dispense .dp-ocr-raw { font-size:10.5px; color:#9ca3af; }',
      '#panel-dispense .dp-ocr-conf { font-size:10px; font-weight:800; padding:2px 7px; border-radius:999px; white-space:nowrap; }',
      '#panel-dispense .dp-ocr-conf.high { background:#dcfce7; color:#166534; }',
      '#panel-dispense .dp-ocr-conf.mid { background:#dbeafe; color:#1e40af; }',
      '#panel-dispense .dp-ocr-conf.low { background:#fef3c7; color:#92400e; }',
      '#panel-dispense .dp-ocr-conf.none { background:#f3f4f6; color:#9ca3af; }',
      '#panel-dispense .dp-spinner { display:inline-block; width:13px; height:13px; border:2px solid #d1d5db; border-top-color:var(--accent,#5a8a3a); border-radius:50%; animation:dpspin 0.7s linear infinite; vertical-align:-2px; margin-right:5px; }',
      '@keyframes dpspin { to { transform:rotate(360deg); } }',
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
      '#panel-dispense .dp-photo.bad { border:2px solid #dc2626; }',
      '#panel-dispense .dp-photo-date { position:absolute; bottom:0; left:0; right:0; background:rgba(22,101,52,0.85); color:#fff; font-size:9.5px; font-weight:700; text-align:center; padding:2px 0; }',
      '#panel-dispense .dp-photo-date.bad { background:rgba(153,27,27,0.9); }',
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
      // 0. ★ 날짜 기준 (최상단)
      '<div class="dp-box dp-datebox" id="dpDateBox">',
      '  <div class="dp-title">📅 대조 기준 날짜</div>',
      '  <div class="dp-desc">엑셀 조제내역 · 주문리스트 · 메모사진 <b>모두 같은 날짜</b>여야 정확한 대조가 됩니다.</div>',
      '  <div class="dp-row" style="align-items:center;">',
      '    <input type="date" id="dpTargetDate" class="dp-date-input">',
      '    <button class="dp-btn" type="button" id="dpTodayBtn" style="padding:8px 12px;font-size:12px;">오늘</button>',
      '    <button class="dp-btn" type="button" id="dpYesterdayBtn" style="padding:8px 12px;font-size:12px;">어제</button>',
      '  </div>',
      '  <div id="dpDateCheck"></div>',
      '</div>',
      // 1. 업로드
      '<div class="dp-box">',
      '  <div class="dp-title">📊 조제내역 업로드 <span id="dpUploadBadge"></span></div>',
      '  <div class="dp-desc">팜3000에서 추출한 <b>조제 의약품 사용량</b> 엑셀 파일을 올려주세요.<br>의약품명 · 사용량 컬럼을 자동으로 찾습니다.</div>',
      '  <div class="dp-row">',
      '    <input type="file" id="dpXlsxInput" accept=".xlsx,.xls,.csv" style="display:none;">',
      '    <button class="dp-btn primary" type="button" id="dpUploadBtn">📁 엑셀 파일 선택</button>',
      '    <button class="dp-btn danger" type="button" id="dpClearBtn" style="display:none;">🗑 초기화</button>',
      '  </div>',
      '  <div id="dpUploadMeta"></div>',
      '</div>',
      // 2. 사진 + OCR
      '<div class="dp-box">',
      '  <div class="dp-title">📷 수기 메모 사진 <span id="dpOcrBadge" style="font-size:11px;font-weight:400;color:var(--text-muted,#8a9484);">(참고용 · 저장 안 됨)</span></div>',
      '  <div class="dp-desc">직원들이 손으로 적은 주문 메모를 찍어서 올리면 <b>자동으로 글씨를 읽어</b> 누락 목록에서 제외합니다.</div>',
      '  <div class="dp-row">',
      '    <input type="file" id="dpPhotoInput" accept="image/*" multiple capture="environment" style="display:none;">',
      '    <button class="dp-btn" type="button" id="dpPhotoBtn">📷 사진 추가</button>',
      '    <button class="dp-btn primary" type="button" id="dpOcrBtn" style="display:none;">🖋 손글씨 자동 인식</button>',
      '    <button class="dp-btn danger" type="button" id="dpPhotoClearBtn" style="display:none;">전체 삭제</button>',
      '  </div>',
      '  <div class="dp-photos" id="dpPhotos"></div>',
      '  <div id="dpOcrResult"></div>',
      '</div>',
      // 2-b. 수기 목록 (b) - OCR 결과 또는 직접 입력
      '<div class="dp-box" id="dpManualBox">',
      '  <div class="dp-title">✍️ 수기 주문 목록 (b) <span class="dp-pill" id="dpManualCount" style="background:#ede9fe;color:#5b21b6;">0개</span></div>',
      '  <div class="dp-desc">사진에서 인식했거나 직접 입력한 목록입니다. 이 약들은 누락 목록에서 자동 제외됩니다.<br>한 줄에 하나씩 입력하세요.</div>',
      '  <textarea id="dpManualText" class="dp-textarea" rows="4" placeholder="라믹탈100&#10;크레스토10&#10;노바스크5" spellcheck="false"></textarea>',
      '  <div class="dp-row" style="margin-top:6px;">',
      '    <button class="dp-btn primary" type="button" id="dpManualApply" style="padding:8px 14px;font-size:12px;">✓ 적용</button>',
      '    <button class="dp-btn" type="button" id="dpManualClear" style="padding:8px 12px;font-size:12px;">비우기</button>',
      '  </div>',
      '  <div id="dpManualChips" style="margin-top:8px;"></div>',
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
    // ★ 날짜 선택
    var dateInput = panel.querySelector('#dpTargetDate');
    if (dateInput) {
      dateInput.value = getCurrentDate() || getTodayStr();
      targetDate = dateInput.value;
      dateInput.addEventListener('change', function () {
        targetDate = dateInput.value || getTodayStr();
        renderDateCheck();
        renderResult();
      });
    }
    var todayBtn = panel.querySelector('#dpTodayBtn');
    if (todayBtn) todayBtn.addEventListener('click', function () {
      targetDate = getTodayStr();
      if (dateInput) dateInput.value = targetDate;
      renderDateCheck(); renderResult();
    });
    var yBtn = panel.querySelector('#dpYesterdayBtn');
    if (yBtn) yBtn.addEventListener('click', function () {
      var d = new Date(); d.setDate(d.getDate() - 1);
      targetDate = toDateStr(d.getTime());
      if (dateInput) dateInput.value = targetDate;
      renderDateCheck(); renderResult();
    });

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

    // ★ OCR 실행
    var ocrBtn = panel.querySelector('#dpOcrBtn');
    if (ocrBtn) ocrBtn.addEventListener('click', runOcr);

    // ★ 수기 목록 (b)
    var mApply = panel.querySelector('#dpManualApply');
    if (mApply) mApply.addEventListener('click', applyManualText);
    var mClear = panel.querySelector('#dpManualClear');
    if (mClear) mClear.addEventListener('click', function () {
      if (manualList.length && !confirm('수기 목록을 모두 비울까요?')) return;
      manualList = [];
      var ta = document.getElementById('dpManualText');
      if (ta) ta.value = '';
      renderManualList(); renderResult();
    });

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
        // ★ 파일명 + 수정일에서 날짜 추출
        var fnDate = extractDateFromFilename(file.name);
        var modDate = toDateStr(file.lastModified);
        uploadMeta = {
          filename: file.name,
          count: parsed.length,
          uploadedAt: Date.now(),
          uploader: getCurrentUser(),
          fileDate: fnDate,       // 파일명에서 추출
          modDate: modDate        // 파일 수정일
        };
        addedNames = {};
        renderUploadMeta();
        renderDateCheck();
        renderResult();

        // 날짜 불일치 경고
        var detected = fnDate || modDate;
        var tgt = getTargetDate();
        if (detected && detected !== tgt) {
          if (confirm('✅ ' + parsed.length + '개 품목 인식 완료\n\n' +
            '⚠️ 날짜 불일치 감지\n\n' +
            '파일 날짜: ' + detected + '\n' +
            '현재 기준: ' + tgt + '\n\n' +
            '대조 기준 날짜를 [' + detected + ']로 변경할까요?')) {
            targetDate = detected;
            var di = document.getElementById('dpTargetDate');
            if (di) di.value = detected;
            renderDateCheck();
            renderResult();
          }
        } else {
          alert('✅ ' + parsed.length + '개 품목 인식 완료' + (detected ? '\n📅 파일 날짜: ' + detected : ''));
        }
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

  /* ──────── 사진 (메모리에만 · 날짜 검증 포함) ──────── */
  function handlePhotoUpload(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    var mismatched = [];
    var tgt = getTargetDate();
    for (var i = 0; i < files.length; i++) {
      if (photoUrls.length >= 8) { alert('사진은 최대 8장까지 가능합니다'); break; }
      var f = files[i];
      // ★ 파일명 또는 촬영/수정일에서 날짜 추출
      var fnDate = extractDateFromFilename(f.name);
      var modDate = toDateStr(f.lastModified);
      var photoDate = fnDate || modDate;
      if (photoDate && photoDate !== tgt) mismatched.push(f.name + ' (' + photoDate + ')');
      photoUrls.push({
        url: URL.createObjectURL(f),
        name: f.name,
        dateStr: photoDate,
        match: !photoDate || photoDate === tgt
      });
    }
    renderPhotos();
    renderDateCheck();
    e.target.value = '';
    if (mismatched.length) {
      alert('⚠️ 날짜가 다른 사진이 있습니다\n\n기준: ' + tgt + '\n\n' + mismatched.join('\n') +
        '\n\n(사진은 참고용이므로 추가는 됩니다. 날짜 확인 후 사용하세요)');
    }
  }
  function clearPhotos() {
    photoUrls.forEach(function (p) { try { URL.revokeObjectURL(p.url || p); } catch (e) {} });
    photoUrls = [];
    renderPhotos();
    renderDateCheck();
  }
  function renderPhotos() {
    var host = document.getElementById('dpPhotos');
    var clearBtn = document.getElementById('dpPhotoClearBtn');
    if (!host) return;
    if (clearBtn) clearBtn.style.display = photoUrls.length ? 'inline-block' : 'none';
    if (typeof updateOcrButton === 'function') updateOcrButton();
    if (!photoUrls.length) { host.innerHTML = ''; return; }
    var tgt = getTargetDate();
    host.innerHTML = photoUrls.map(function (p, i) {
      var isMatch = !p.dateStr || p.dateStr === tgt;
      var badge = p.dateStr
        ? '<div class="dp-photo-date' + (isMatch ? '' : ' bad') + '">' + (isMatch ? '✓ ' : '⚠ ') + p.dateStr.slice(5) + '</div>'
        : '';
      return '<div class="dp-photo' + (isMatch ? '' : ' bad') + '" data-idx="' + i + '">' +
        '<img src="' + p.url + '" alt="메모">' + badge +
        '<button class="dp-photo-del" type="button" data-del="' + i + '">✕</button></div>';
    }).join('');
    host.querySelectorAll('.dp-photo').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('dp-photo-del')) {
          var idx = parseInt(e.target.getAttribute('data-del'), 10);
          try { URL.revokeObjectURL(photoUrls[idx].url); } catch (er) {}
          photoUrls.splice(idx, 1);
          renderPhotos(); renderDateCheck();
          return;
        }
        var lb = document.getElementById('dpLightbox');
        var img = lb && lb.querySelector('img');
        if (img) { img.src = photoUrls[parseInt(el.getAttribute('data-idx'), 10)].url; lb.classList.add('show'); }
      });
    });
  }

  /* ──────── ★ OCR 실행 ──────── */
  function runOcr() {
    if (ocrRunning) return;
    if (!window.HandwritingOCR) { alert('OCR 모듈 미로드'); return; }
    if (!window.HandwritingOCR.isReady()) {
      alert('⚠️ OCR이 설정되지 않았습니다.\n\n설정 탭 → 손글씨 OCR 설정에서\n약국장이 CLOVA OCR 키를 등록해야 합니다.');
      return;
    }
    if (!photoUrls.length) { alert('먼저 사진을 추가해주세요'); return; }
    if (!dispenseItems.length) {
      if (!confirm('조제내역 엑셀이 없으면 인식 정확도가 낮습니다.\n\n엑셀을 먼저 업로드하는 것을 권장합니다.\n\n그래도 진행할까요?')) return;
    }

    ocrRunning = true;
    var host = document.getElementById('dpOcrResult');
    var btn = document.getElementById('dpOcrBtn');
    if (btn) btn.disabled = true;
    if (host) host.innerHTML = '<div class="dp-ocr-box"><span class="dp-spinner"></span>손글씨 인식 중... (' + photoUrls.length + '장)</div>';

    var allLines = [];
    var errors = [];
    var idx = 0;

    var next = function () {
      if (idx >= photoUrls.length) { finish(); return; }
      var p = photoUrls[idx];
      if (host) host.innerHTML = '<div class="dp-ocr-box"><span class="dp-spinner"></span>인식 중... (' + (idx + 1) + '/' + photoUrls.length + ')</div>';
      // objectURL → File 복원
      fetch(p.url).then(function (r) { return r.blob(); }).then(function (blob) {
        var file = new File([blob], p.name || ('photo' + idx + '.jpg'), { type: blob.type || 'image/jpeg' });
        return window.HandwritingOCR.recognize(file);
      }).then(function (lines) {
        allLines = allLines.concat(lines || []);
      }).catch(function (err) {
        errors.push((p.name || ('사진' + (idx + 1))) + ': ' + (err.message || err));
      }).then(function () {
        idx++;
        next();
      });
    };

    var finish = function () {
      ocrRunning = false;
      if (btn) btn.disabled = false;
      if (!allLines.length) {
        if (host) host.innerHTML = '<div class="dp-ocr-box" style="color:#991b1b;">❌ 인식된 글씨가 없습니다.' +
          (errors.length ? '<br><small>' + escHtml(errors.join(' / ').slice(0, 200)) + '</small>' : '') + '</div>';
        return;
      }
      // 조제내역과 fuzzy 매칭
      var matched = window.HandwritingOCR.matchLines(allLines, dispenseItems);
      renderOcrResult(matched, errors);
    };

    next();
  }

  function renderOcrResult(matched, errors) {
    var host = document.getElementById('dpOcrResult');
    if (!host) return;
    var okCount = matched.filter(function (m) { return m.matched; }).length;
    var html = '<div class="dp-ocr-box">' +
      '<div class="dp-ocr-head"><span>🖋 인식 결과 ' + matched.length + '줄 · 매칭 ' + okCount + '개</span>' +
      '<button class="dp-btn primary" type="button" id="dpOcrApply" style="padding:6px 12px;font-size:11.5px;">✓ 선택 항목 수기목록에 추가</button></div>';
    matched.forEach(function (m, i) {
      var conf = m.confidence;
      var confLabel = conf === 'high' ? Math.round(m.score * 100) + '%' :
                      conf === 'mid' ? Math.round(m.score * 100) + '%' :
                      conf === 'low' ? Math.round(m.score * 100) + '%' : '실패';
      var autoCheck = (conf === 'high' || conf === 'mid') ? ' checked' : '';
      var display = m.matched
        ? '<span class="dp-ocr-matched">' + escHtml(m.matched) + '</span>' +
          (normName(m.raw) !== normName(m.matched) ? '<div class="dp-ocr-raw">원문: ' + escHtml(m.raw) + '</div>' : '')
        : '<span style="color:#9ca3af;">' + escHtml(m.raw) + '</span><div class="dp-ocr-raw">조제내역에서 못 찾음</div>';
      html += '<div class="dp-ocr-line">' +
        '<input type="checkbox" data-ocr-idx="' + i + '"' + autoCheck + (m.matched ? '' : ' disabled') + '>' +
        '<div>' + display + '</div>' +
        '<span class="dp-ocr-conf ' + conf + '">' + confLabel + '</span>' +
        '</div>';
    });
    if (errors && errors.length) {
      html += '<div style="margin-top:8px;font-size:11px;color:#991b1b;">⚠ ' + escHtml(errors.join(' / ').slice(0, 200)) + '</div>';
    }
    html += '</div>';
    host.innerHTML = html;

    var applyBtn = document.getElementById('dpOcrApply');
    if (applyBtn) applyBtn.addEventListener('click', function () {
      var boxes = host.querySelectorAll('[data-ocr-idx]');
      var added = 0;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked && !boxes[i].disabled) {
          var m = matched[parseInt(boxes[i].getAttribute('data-ocr-idx'), 10)];
          if (m && m.matched && manualList.indexOf(m.matched) === -1) {
            manualList.push(m.matched);
            added++;
          }
        }
      }
      syncManualTextarea();
      renderManualList();
      renderResult();
      alert(added ? ('✅ ' + added + '개를 수기 목록에 추가했습니다') : '추가된 항목이 없습니다');
    });
  }

  /* ──────── ★ 수기 목록 (b) 관리 ──────── */
  function applyManualText() {
    var ta = document.getElementById('dpManualText');
    if (!ta) return;
    var lines = (ta.value || '').split(/[\n,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
    // 중복 제거
    var seen = {};
    manualList = lines.filter(function (l) {
      var k = normName(l);
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
    renderManualList();
    renderResult();
  }
  function syncManualTextarea() {
    var ta = document.getElementById('dpManualText');
    if (ta) ta.value = manualList.join('\n');
  }
  function renderManualList() {
    var host = document.getElementById('dpManualChips');
    var cnt = document.getElementById('dpManualCount');
    if (cnt) cnt.textContent = manualList.length + '개';
    if (!host) return;
    if (!manualList.length) { host.innerHTML = ''; return; }
    host.innerHTML = manualList.map(function (n, i) {
      return '<span class="dp-mchip">' + escHtml(n) + '<button class="dp-mchip-x" type="button" data-mrm="' + i + '">✕</button></span>';
    }).join('');
    host.querySelectorAll('[data-mrm]').forEach(function (b) {
      b.addEventListener('click', function () {
        manualList.splice(parseInt(b.getAttribute('data-mrm'), 10), 1);
        syncManualTextarea(); renderManualList(); renderResult();
      });
    });
  }
  // b 목록에 있는지 판정 (fuzzy)
  function isInManual(name) {
    if (!manualList.length) return false;
    var n = normName(name), s = stripName(name);
    for (var i = 0; i < manualList.length; i++) {
      var mn = normName(manualList[i]), ms = stripName(manualList[i]);
      if (mn === n) return true;
      if (ms && s && ms === s) return true;
      if (ms && s && Math.min(ms.length, s.length) >= 3 && (ms.indexOf(s) !== -1 || s.indexOf(ms) !== -1)) return true;
    }
    return false;
  }

  /* ──────── ★ 날짜 일치 검증 UI ──────── */
  function renderDateCheck() {
    var host = document.getElementById('dpDateCheck');
    if (!host) return;
    var tgt = getTargetDate();
    var rows = '';

    // ① 엑셀 조제내역
    if (!dispenseItems.length) {
      rows += checkRow('idle', '📊', '조제내역 엑셀', '미업로드', '');
    } else {
      var xDate = uploadMeta && (uploadMeta.fileDate || uploadMeta.modDate);
      if (!xDate) {
        rows += checkRow('warn', '📊', '조제내역 엑셀', '날짜 미확인 (' + uploadMeta.count + '품목)', '');
      } else if (xDate === tgt) {
        rows += checkRow('ok', '📊', '조제내역 엑셀', xDate + ' · ' + uploadMeta.count + '품목', '');
      } else {
        rows += checkRow('err', '📊', '조제내역 엑셀', xDate + ' ✕ 불일치',
          '<button class="dp-date-fix" type="button" data-fix="' + xDate + '">이 날짜로 맞추기</button>');
      }
    }

    // ② 주문리스트
    var day = getAllData()[tgt];
    var orderCnt = (day && Array.isArray(day.items)) ? day.items.length : 0;
    if (orderCnt === 0) {
      rows += checkRow('warn', '📋', '주문리스트', tgt + ' · 0건 (비어있음)', '');
    } else {
      rows += checkRow('ok', '📋', '주문리스트', tgt + ' · ' + orderCnt + '건', '');
    }

    // ③ 메모 사진
    if (!photoUrls.length) {
      rows += checkRow('idle', '📷', '메모 사진', '없음 (선택사항)', '');
    } else {
      var bad = photoUrls.filter(function (p) { return p.dateStr && p.dateStr !== tgt; });
      if (bad.length) {
        rows += checkRow('err', '📷', '메모 사진', photoUrls.length + '장 중 ' + bad.length + '장 날짜 불일치', '');
      } else {
        rows += checkRow('ok', '📷', '메모 사진', photoUrls.length + '장 · 날짜 일치', '');
      }
    }

    host.innerHTML = rows;
    host.querySelectorAll('[data-fix]').forEach(function (b) {
      b.addEventListener('click', function () {
        targetDate = b.getAttribute('data-fix');
        var di = document.getElementById('dpTargetDate');
        if (di) di.value = targetDate;
        renderDateCheck();
        renderResult();
      });
    });
  }
  function checkRow(status, icon, label, value, action) {
    var mark = status === 'ok' ? '✓' : (status === 'err' ? '✕' : (status === 'warn' ? '⚠' : '·'));
    return '<div class="dp-check-row ' + status + '">' +
      '<span class="dp-check-icon">' + icon + '</span>' +
      '<span class="dp-check-label">' + label + '</span>' +
      '<span class="dp-check-val">' + mark + ' ' + escHtml(value) + '</span>' +
      (action || '') + '</div>';
  }
  // 날짜 불일치가 있으면 true
  function hasDateMismatch() {
    var tgt = getTargetDate();
    if (dispenseItems.length && uploadMeta) {
      var xDate = uploadMeta.fileDate || uploadMeta.modDate;
      if (xDate && xDate !== tgt) return true;
    }
    return false;
  }

  /* ──────── 대조 로직 (targetDate 기준) ──────── */
  function getTodayOrderedKeys() {
    var d = getTargetDate();
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

    // ★ 날짜 불일치면 결과 차단
    if (hasDateMismatch()) {
      var xd = uploadMeta && (uploadMeta.fileDate || uploadMeta.modDate);
      host.innerHTML = '<div class="dp-blocked">🚫 <b>날짜 불일치로 대조를 중단했습니다</b><br><br>' +
        '엑셀 조제내역: <b>' + escHtml(xd || '?') + '</b><br>' +
        '대조 기준 날짜: <b>' + escHtml(getTargetDate()) + '</b><br><br>' +
        '위 📅 날짜 박스에서 날짜를 맞춰주세요.</div>';
      if (statsEl) statsEl.innerHTML = '';
      if (filterRow) filterRow.style.display = 'none';
      if (bulkRow) bulkRow.style.display = 'none';
      if (exportBtn) exportBtn.style.display = 'none';
      return;
    }

    var orderedKeys = getTodayOrderedKeys();
    var cntOrdered = 0, cntFloor2 = 0, cntIgnored = 0, cntManual = 0;
    var missing = [];

    // ★ a − b − c − (2층재고) − (무시목록)
    dispenseItems.forEach(function (it) {
      if (isOrdered(it.name, orderedKeys)) { cntOrdered++; return; }   // c: 앱 주문리스트
      if (isInManual(it.name)) { cntManual++; return; }                 // b: 수기 목록
      if (isFloor2(it.name)) { cntFloor2++; return; }
      if (isIgnored(it.name)) { cntIgnored++; return; }
      missing.push(it);
    });

    // 통계
    if (statsEl) {
      statsEl.innerHTML =
        '<span class="dp-pill" style="background:var(--accent-soft,#e4f0d4);color:var(--accent,#5a8a3a);">📅 ' + dateLabel(getTargetDate()) + '</span>' +
        '<span class="dp-pill total">조제 ' + dispenseItems.length + '</span>' +
        '<span class="dp-pill missing">⚠ 누락의심 ' + missing.length + '</span>' +
        '<span class="dp-pill ordered">✓ 앱주문 ' + cntOrdered + '</span>' +
        (cntManual ? '<span class="dp-pill" style="background:#ede9fe;color:#5b21b6;">✍️ 수기 ' + cntManual + '</span>' : '') +
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
    var date = getTargetDate();
    // ★ 오늘이 아닌 날짜에 추가할 때 확인
    if (date !== getTodayStr()) {
      if (!confirm('⚠️ 오늘이 아닌 날짜에 주문을 추가합니다\n\n대상 날짜: ' + date + '\n오늘: ' + getTodayStr() + '\n\n계속할까요?')) return;
    }
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
    var date = getTargetDate();
    var dateWarn = (date !== getTodayStr()) ? '\n\n⚠️ 오늘(' + getTodayStr() + ')이 아닌 날짜입니다!' : '';
    if (!confirm(checked.length + '개 품목을 [' + date + '] 주문리스트에 추가할까요?' + dateWarn)) return;

    var fbDbRef = getFbDb();
    var uid = getCurrentAuthUid(), user = getCurrentUser();
    if (!fbDbRef || !uid) { alert('로그인 정보 없음'); return; }
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
      return !isOrdered(it.name, orderedKeys) && !isInManual(it.name) && !isFloor2(it.name) && !isIgnored(it.name);
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
    XLSX.writeFile(wb, '조제누락_' + getTargetDate() + '.xlsx');
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
    // 탭 진입 시 앱의 현재 날짜와 동기화 (사용자가 직접 바꾼 적 없으면)
    var di = document.getElementById('dpTargetDate');
    if (di && !targetDate) {
      targetDate = getCurrentDate() || getTodayStr();
      di.value = targetDate;
    }
    renderDateCheck();
    renderUploadMeta();
    renderPhotos();
    renderManualList();
    renderResult();
    renderIgnoreList();
    setupIgnoreListener();
    updateOcrButton();
  }

  // OCR 버튼 표시 여부 갱신
  function updateOcrButton() {
    var btn = document.getElementById('dpOcrBtn');
    var badge = document.getElementById('dpOcrBadge');
    if (!btn) return;
    var ready = !!(window.HandwritingOCR && window.HandwritingOCR.isReady());
    btn.style.display = (ready && photoUrls.length) ? 'inline-block' : 'none';
    if (badge) {
      badge.innerHTML = ready
        ? '<span style="color:#166534;font-weight:700;">🖋 OCR 활성</span>'
        : '<span style="color:#92400e;">OCR 미설정 (설정 탭에서 등록)</span>';
    }
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
