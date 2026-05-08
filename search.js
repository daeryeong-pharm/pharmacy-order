/* ========================================================
 * 대령약국 주문리스트 - 과거 주문 검색 기능 (외부 모듈)
 * 의존: window.allData, window.currentDate, window.loadDate,
 *       window.normalizeMedName, window.normalizeForPriceMatch (옵션)
 * 로딩 시점: index.html </body> 직전
 * 작성일: 2026-05-08
 * ======================================================== */
(function () {
  'use strict';

  /* ---------- 1. 스타일 주입 ---------- */
  var STYLE_ID = 'order-search-style';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#orderSearchModal { display:none; position:fixed; inset:0; z-index:9500;',
      '  background: rgba(15,23,42,0.55); backdrop-filter: blur(2px);',
      '  align-items:flex-start; justify-content:center; padding:40px 12px; overflow-y:auto; }',
      '#orderSearchModal.show { display:flex; }',
      '#orderSearchModal .os-box { background:#fff; border-radius:14px; width:100%; max-width:780px;',
      '  box-shadow: 0 20px 50px rgba(0,0,0,0.25); padding:18px 18px 22px; position:relative; }',
      '#orderSearchModal .os-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }',
      '#orderSearchModal .os-title { font-size:16px; font-weight:800; color:#0f172a; }',
      '#orderSearchModal .os-close { background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px;',
      '  width:32px; height:32px; cursor:pointer; font-size:16px; }',
      '#orderSearchModal .os-form { display:grid; grid-template-columns: 1fr 1fr; gap:8px 10px; margin-bottom:12px; }',
      '#orderSearchModal .os-form .full { grid-column: 1 / -1; }',
      '#orderSearchModal .os-form label { font-size:11.5px; font-weight:700; color:#475569; display:block; margin-bottom:3px; }',
      '#orderSearchModal .os-form input, #orderSearchModal .os-form select {',
      '  width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px;',
      '  font-size:13px; background:#fff; color:#0f172a; box-sizing:border-box; }',
      '#orderSearchModal .os-form input:focus, #orderSearchModal .os-form select:focus {',
      '  outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.15); }',
      '#orderSearchModal .os-actions { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }',
      '#orderSearchModal .os-btn { padding:8px 14px; border-radius:8px; border:1px solid #e2e8f0;',
      '  background:#fff; color:#334155; font-weight:700; font-size:12.5px; cursor:pointer; }',
      '#orderSearchModal .os-btn.primary { background:#3b82f6; border-color:#3b82f6; color:#fff; }',
      '#orderSearchModal .os-btn.primary:hover { background:#2563eb; }',
      '#orderSearchModal .os-btn:hover { background:#f8fafc; }',
      '#orderSearchModal .os-summary { font-size:12px; color:#64748b; margin-bottom:8px; }',
      '#orderSearchModal .os-results { max-height:55vh; overflow-y:auto; border-top:1px solid #e2e8f0; padding-top:10px; }',
      '#orderSearchModal .os-empty { text-align:center; color:#94a3b8; padding:30px 10px; font-size:13px; }',
      '#orderSearchModal .os-date-card { border:1px solid #e2e8f0; border-radius:10px; margin-bottom:10px; overflow:hidden; }',
      '#orderSearchModal .os-date-head { background:#f8fafc; padding:8px 12px; display:flex; justify-content:space-between;',
      '  align-items:center; font-weight:800; color:#0f172a; font-size:13px; border-bottom:1px solid #e2e8f0; }',
      '#orderSearchModal .os-date-head .os-jump { background:#3b82f6; color:#fff; border:none; padding:5px 11px;',
      '  border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; }',
      '#orderSearchModal .os-date-head .os-jump:hover { background:#2563eb; }',
      '#orderSearchModal .os-item-row { display:grid;',
      '  grid-template-columns: minmax(0,2.4fr) 60px 40px minmax(0,1.1fr) 60px;',
      '  gap:6px; padding:6px 12px; font-size:12px; border-top:1px solid #f1f5f9; align-items:center; }',
      '#orderSearchModal .os-item-row:first-child { border-top:none; }',
      '#orderSearchModal .os-item-row .col-name { font-weight:700; color:#0f172a; word-break:break-all; }',
      '#orderSearchModal .os-item-row .col-spec { color:#78350f; background:#fef9c3; border-radius:4px;',
      '  padding:1px 4px; text-align:center; font-size:11px; }',
      '#orderSearchModal .os-item-row .col-qty { color:#78350f; background:#fef3c7; border-radius:4px;',
      '  padding:1px 4px; text-align:center; font-weight:800; font-size:11px; }',
      '#orderSearchModal .os-item-row .col-note { color:#475569; font-size:11.5px; word-break:break-all; }',
      '#orderSearchModal .os-item-row .col-author { color:#64748b; font-size:11px; text-align:right; }',
      '#orderSearchModal mark { background:#fde68a; color:#78350f; padding:0 2px; border-radius:2px; }',
      '@media (max-width: 600px) {',
      '  #orderSearchModal { padding:10px; }',
      '  #orderSearchModal .os-box { padding:14px; }',
      '  #orderSearchModal .os-form { grid-template-columns: 1fr; }',
      '  #orderSearchModal .os-item-row { grid-template-columns: 1fr; gap:2px; padding:8px 10px; }',
      '  #orderSearchModal .os-item-row > div { padding:1px 0; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ---------- 2. 모달 DOM 주입 ---------- */
  if (!document.getElementById('orderSearchModal')) {
    var modal = document.createElement('div');
    modal.id = 'orderSearchModal';
    modal.innerHTML = [
      '<div class="os-box" onclick="event.stopPropagation()">',
      '  <div class="os-head">',
      '    <div class="os-title">🔍 과거 주문 검색</div>',
      '    <button class="os-close" type="button" data-os-close>✕</button>',
      '  </div>',
      '  <div class="os-form">',
      '    <div class="full">',
      '      <label>의약품명 (필수, 일부만 입력 가능)</label>',
      '      <input type="text" id="osQuery" placeholder="예: 라믹탈, 크레스토 등" autocomplete="off">',
      '    </div>',
      '    <div>',
      '      <label>시작 날짜</label>',
      '      <input type="date" id="osDateFrom">',
      '    </div>',
      '    <div>',
      '      <label>종료 날짜</label>',
      '      <input type="date" id="osDateTo">',
      '    </div>',
      '    <div>',
      '      <label>비고 포함 (옵션)</label>',
      '      <input type="text" id="osNote" placeholder="예: 정자약국">',
      '    </div>',
      '    <div>',
      '      <label>작성자 (옵션)</label>',
      '      <input type="text" id="osAuthor" placeholder="예: 백승준">',
      '    </div>',
      '  </div>',
      '  <div class="os-actions">',
      '    <button type="button" class="os-btn primary" data-os-search>🔎 검색</button>',
      '    <button type="button" class="os-btn" data-os-reset>↻ 초기화</button>',
      '    <button type="button" class="os-btn" data-os-range="3">최근 3개월</button>',
      '    <button type="button" class="os-btn" data-os-range="6">최근 6개월</button>',
      '    <button type="button" class="os-btn" data-os-range="12">최근 12개월</button>',
      '    <button type="button" class="os-btn" data-os-range="0">전체</button>',
      '  </div>',
      '  <div class="os-summary" id="osSummary"></div>',
      '  <div class="os-results" id="osResults">',
      '    <div class="os-empty">의약품명을 입력 후 🔎 검색을 눌러주세요.</div>',
      '  </div>',
      '</div>'
    ].join('\n');
    // 배경 클릭 시 닫기
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    document.body.appendChild(modal);

    // 버튼 이벤트 위임
    modal.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.matches('[data-os-close]')) { closeModal(); return; }
      if (t.matches('[data-os-search]')) { performSearch(); return; }
      if (t.matches('[data-os-reset]')) { resetForm(); return; }
      if (t.matches('[data-os-range]')) {
        var months = parseInt(t.getAttribute('data-os-range'), 10) || 0;
        applyRange(months);
        return;
      }
      if (t.matches('[data-os-jump]')) {
        var d = t.getAttribute('data-os-jump');
        if (d) jumpToDate(d);
        return;
      }
    });

    // Enter 키로 검색
    var qInput = modal.querySelector('#osQuery');
    if (qInput) {
      qInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); performSearch(); }
      });
    }
  }

  /* ---------- 3. 헬퍼 함수 ---------- */
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  }
  function shiftMonths(months) {
    var d = new Date();
    d.setMonth(d.getMonth() - months);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function highlight(text, queries) {
    var safe = escHtml(text);
    if (!queries || !queries.length) return safe;
    var qs = queries.filter(function (q) { return q && q.length > 0; });
    if (!qs.length) return safe;
    qs.sort(function (a, b) { return b.length - a.length; });
    var pattern = qs.map(escRegex).join('|');
    try {
      var re = new RegExp(pattern, 'gi');
      return safe.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    } catch (err) { return safe; }
  }
  function normalize(s) {
    if (typeof window.normalizeMedName === 'function') {
      return window.normalizeMedName(s);
    }
    return String(s || '').toLowerCase().replace(/[\s\(\)\*×x·\-_/\.%,]/g, '');
  }
  function normalizeStrip(s) {
    if (typeof window.normalizeForPriceMatch === 'function') {
      return window.normalizeForPriceMatch(s);
    }
    return normalize(s);
  }

  /* ---------- 4. 검색 핵심 ---------- */
  // let 으로 선언된 변수는 window.X 로 접근 안됨. 직접 참조 시도 후 fallback.
  function getAllDataRef() {
    // 1) 스크립트 전역 (let allData) 직접 접근
    try { if (typeof allData !== 'undefined' && allData) return allData; } catch (e) {}
    // 2) window 폴백
    if (window.allData) return window.allData;
    return {};
  }
  function getCurrentDateRef() {
    try { if (typeof currentDate !== 'undefined' && currentDate) return currentDate; } catch (e) {}
    if (window.currentDate) return window.currentDate;
    return '';
  }
  function getFbDbRef() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) {}
    if (window.fbDb) return window.fbDb;
    return null;
  }

  function buildSearchPool() {
    // allData[date] = { messages, items: [{name, spec, qty, note, timestamp, author, authorName}] }
    var pool = [];
    var data = getAllDataRef();
    var keys = Object.keys(data);
    console.log('[검색] allData 날짜 수:', keys.length, '키 샘플:', keys.slice(0, 5));
    keys.forEach(function (dStr) {
      var v = data[dStr];
      if (!v) return;
      // items 가 객체(Firebase 원본)일 수도, 배열(로컬 변환 후)일 수도 있음
      var items = [];
      if (Array.isArray(v.items)) items = v.items;
      else if (v.items && typeof v.items === 'object') {
        items = Object.entries(v.items).map(function (kv) {
          return Object.assign({ id: kv[0] }, kv[1] || {});
        });
      }
      items.forEach(function (it) {
        if (!it || !it.name) return;
        pool.push({
          date: dStr,
          name: it.name || '',
          spec: it.spec || '',
          qty: it.qty || '',
          note: it.note || '',
          author: it.authorName || it.author || '',
          ts: it.timestamp || 0
        });
      });
    });
    console.log('[검색] 풀 크기:', pool.length);
    return pool;
  }

  // Firebase 에서 모든 날짜 강제 재로딩 (allData 비어있을 때 fallback)
  function fetchAllDaysFromFirebase() {
    return new Promise(function (resolve) {
      var fbDb = getFbDbRef();
      if (!fbDb) { resolve({}); return; }
      try {
        fbDb.ref('days').once('value').then(function (snap) {
          var fresh = {};
          snap.forEach(function (dayChild) {
            var dStr = dayChild.key;
            var v = dayChild.val() || {};
            var items = v.items ? Object.entries(v.items).map(function (kv) {
              return Object.assign({ id: kv[0] }, kv[1] || {});
            }) : [];
            items.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
            fresh[dStr] = { items: items, messages: [] };
          });
          console.log('[검색] Firebase 직접 로드 - 날짜 수:', Object.keys(fresh).length);
          resolve(fresh);
        }).catch(function (err) {
          console.error('[검색] Firebase 로드 실패:', err);
          resolve({});
        });
      } catch (e) {
        console.error('[검색] Firebase 호출 예외:', e);
        resolve({});
      }
    });
  }

  function matchName(itemName, queryRaw) {
    if (!itemName || !queryRaw) return false;
    var nameLow = String(itemName).toLowerCase();
    var qLow = String(queryRaw).toLowerCase().trim();
    if (!qLow) return false;
    // 1) 단순 부분 일치 (가장 흔한 케이스)
    if (nameLow.indexOf(qLow) !== -1) return true;
    // 2) 정규화 후 부분 일치
    var nN = normalize(itemName);
    var qN = normalize(queryRaw);
    if (qN && nN.indexOf(qN) !== -1) return true;
    // 3) Strip(제형/용량 제거) 후 부분 일치
    var nS = normalizeStrip(itemName);
    var qS = normalizeStrip(queryRaw);
    if (qS && nS.indexOf(qS) !== -1) return true;
    return false;
  }

  function performSearch() {
    var $ = function (id) { return document.getElementById(id); };
    var query = ($('osQuery').value || '').trim();
    var dateFrom = ($('osDateFrom').value || '').trim();
    var dateTo = ($('osDateTo').value || '').trim();
    var noteQ = ($('osNote').value || '').trim().toLowerCase();
    var authorQ = ($('osAuthor').value || '').trim().toLowerCase();
    var resultsEl = $('osResults');
    var summaryEl = $('osSummary');

    if (!query) {
      resultsEl.innerHTML = '<div class="os-empty">⚠️ 의약품명을 입력해주세요.</div>';
      summaryEl.textContent = '';
      $('osQuery').focus();
      return;
    }

    // 1차 시도: 메모리 캐시 (allData)
    var pool = buildSearchPool();

    // 2차 fallback: 메모리 캐시가 비어있거나 날짜가 1개 이하이면 Firebase 직접 조회
    var memDates = new Set(pool.map(function (p) { return p.date; }));
    if (memDates.size <= 1) {
      console.log('[검색] 메모리 캐시 부족 - Firebase 직접 조회 시작');
      summaryEl.textContent = '⏳ 모든 날짜 데이터 불러오는 중...';
      resultsEl.innerHTML = '<div class="os-empty">⏳ 잠시만 기다려주세요...</div>';
      fetchAllDaysFromFirebase().then(function (fresh) {
        // 가져온 데이터를 메모리 allData 에도 캐시 (가능한 경우)
        try {
          var existing = getAllDataRef();
          Object.keys(fresh).forEach(function (k) {
            if (!existing[k] || !existing[k].items || !existing[k].items.length) {
              existing[k] = fresh[k];
            }
          });
        } catch (e) {}
        // 검색 풀 재구성 후 검색 진행
        var freshPool = [];
        Object.keys(fresh).forEach(function (dStr) {
          var items = fresh[dStr].items || [];
          items.forEach(function (it) {
            if (!it || !it.name) return;
            freshPool.push({
              date: dStr, name: it.name || '', spec: it.spec || '', qty: it.qty || '',
              note: it.note || '', author: it.authorName || it.author || '', ts: it.timestamp || 0
            });
          });
        });
        runSearchOnPool(freshPool, query, dateFrom, dateTo, noteQ, authorQ, resultsEl, summaryEl);
      });
      return;
    }

    runSearchOnPool(pool, query, dateFrom, dateTo, noteQ, authorQ, resultsEl, summaryEl);
  }

  function runSearchOnPool(pool, query, dateFrom, dateTo, noteQ, authorQ, resultsEl, summaryEl) {
    var matched = pool.filter(function (it) {
      if (dateFrom && it.date < dateFrom) return false;
      if (dateTo && it.date > dateTo) return false;
      if (!matchName(it.name, query)) return false;
      if (noteQ && (it.note || '').toLowerCase().indexOf(noteQ) === -1) return false;
      if (authorQ && (it.author || '').toLowerCase().indexOf(authorQ) === -1) return false;
      return true;
    });

    // 날짜별 그룹핑
    var groups = {};
    matched.forEach(function (it) {
      if (!groups[it.date]) groups[it.date] = [];
      groups[it.date].push(it);
    });

    var dates = Object.keys(groups).sort(function (a, b) { return a < b ? 1 : -1; });

    summaryEl.textContent = '"' + query + '" 검색 결과: ' + matched.length + '건 (' + dates.length + '일)' +
      (dateFrom || dateTo ? ' · 기간: ' + (dateFrom || '처음') + ' ~ ' + (dateTo || '오늘') : '');

    if (!matched.length) {
      resultsEl.innerHTML = '<div class="os-empty">검색 결과가 없습니다.<br><br>' +
        '입력 키워드: <b>' + escHtml(query) + '</b><br>' +
        '· 약품명을 더 짧게 입력해보세요 (예: "라믹탈100" → "라믹탈")<br>' +
        '· 날짜 범위를 넓혀보세요</div>';
      return;
    }

    var hlQueries = [query];
    var html = dates.map(function (d) {
      var rows = groups[d].map(function (it) {
        return '<div class="os-item-row">' +
          '<div class="col-name">' + highlight(it.name, hlQueries) + '</div>' +
          '<div class="col-spec">' + escHtml(it.spec || '-') + '</div>' +
          '<div class="col-qty">' + escHtml(it.qty || '-') + '</div>' +
          '<div class="col-note">' + escHtml(it.note || '') + '</div>' +
          '<div class="col-author">' + escHtml(it.author || '') + '</div>' +
        '</div>';
      }).join('');
      return '<div class="os-date-card">' +
        '<div class="os-date-head">' +
          '<span>📅 ' + d + ' · ' + groups[d].length + '건</span>' +
          '<button class="os-jump" type="button" data-os-jump="' + d + '">→ 이 날짜로 이동</button>' +
        '</div>' + rows +
      '</div>';
    }).join('');

    resultsEl.innerHTML = html;
  }

  /* ---------- 5. 액션 ---------- */
  function openModal() {
    var modal = document.getElementById('orderSearchModal');
    if (!modal) return;
    // 기본 3개월 범위 (단, 사용자가 이미 설정했으면 유지)
    var $ = function (id) { return document.getElementById(id); };
    if (!$('osDateFrom').value && !$('osDateTo').value) {
      $('osDateFrom').value = shiftMonths(3);
      $('osDateTo').value = todayStr();
    }
    modal.classList.add('show');
    setTimeout(function () { var q = $('osQuery'); if (q) q.focus(); }, 80);
  }
  function closeModal() {
    var modal = document.getElementById('orderSearchModal');
    if (modal) modal.classList.remove('show');
  }
  function resetForm() {
    var $ = function (id) { return document.getElementById(id); };
    $('osQuery').value = '';
    $('osNote').value = '';
    $('osAuthor').value = '';
    $('osDateFrom').value = shiftMonths(3);
    $('osDateTo').value = todayStr();
    $('osResults').innerHTML = '<div class="os-empty">의약품명을 입력 후 🔎 검색을 눌러주세요.</div>';
    $('osSummary').textContent = '';
    $('osQuery').focus();
  }
  function applyRange(months) {
    var $ = function (id) { return document.getElementById(id); };
    if (months > 0) {
      $('osDateFrom').value = shiftMonths(months);
      $('osDateTo').value = todayStr();
    } else {
      $('osDateFrom').value = '';
      $('osDateTo').value = '';
    }
  }
  function jumpToDate(d) {
    closeModal();
    if (typeof window.loadDate === 'function') {
      window.loadDate(d);
    } else {
      alert('날짜 이동 함수를 찾을 수 없습니다 (loadDate)');
    }
  }

  /* ---------- 6. 툴바 버튼 자동 추가 (안전 fallback) ---------- */
  function ensureToolbarButton() {
    if (document.getElementById('orderSearchBtn')) return true;
    var actions = document.querySelector('.toolbar-actions');
    if (!actions) return false;
    var btn = document.createElement('button');
    btn.id = 'orderSearchBtn';
    btn.type = 'button';
    btn.className = 'tool-btn';
    btn.title = '과거 주문 검색';
    btn.innerHTML = '🔍 검색';
    btn.addEventListener('click', openModal);
    // 첫 번째 자리에 삽입 (◀ 앞)
    actions.insertBefore(btn, actions.firstChild);
    return true;
  }
  if (!ensureToolbarButton()) {
    // DOM이 아직 준비 안 됐을 수 있어 재시도
    var tries = 0;
    var retry = setInterval(function () {
      tries++;
      if (ensureToolbarButton() || tries > 20) clearInterval(retry);
    }, 250);
  }

  /* ---------- 7. ESC로 닫기 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('orderSearchModal');
      if (modal && modal.classList.contains('show')) closeModal();
    }
  });

  /* ---------- 8. 전역 노출 ---------- */
  window.openOrderSearchModal = openModal;
  window.closeOrderSearchModal = closeModal;
  window.performOrderSearch = performSearch;

  console.log('✓ 검색 모듈 로드됨 (search.js)');
})();
