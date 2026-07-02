/* ============================================================
 * 대령약국 커피주문 탭 (v3 - 갤럭시 IME 완전 최적화)
 *
 * 핵심 최적화:
 * - 그라디언트/box-shadow/애니메이션 완전 제거 (GPU 부하 0)
 * - 지난 기록은 클릭해야 로드 (지연 로딩)
 * - contain: layout 으로 리렌더 격리
 * - 입력창 리렌더 100% 방지 (한글 IME 절대 안 끊김)
 *
 * 작성: 2026-05-22 v3 극단 경량화
 * ============================================================ */
(function () {
  'use strict';

  /* ──────── 전역 접근 헬퍼 ──────── */
  function getFbDb() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) {}
    return window.fbDb || null;
  }
  function getCurrentUser() {
    try { if (typeof currentUser !== 'undefined') return currentUser; } catch (e) {}
    return window.currentUser || '';
  }
  function getCurrentAuthUid() {
    try { if (typeof currentAuthUid !== 'undefined') return currentAuthUid; } catch (e) {}
    return window.currentAuthUid || '';
  }
  function getTodayStr() {
    try { if (typeof todayStr === 'function') return todayStr(); } catch (e) {}
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isOwner() {
    return getCurrentAuthUid() === 'bhgORSzZ23dlNUfZmDPBe3IsnPN2';
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ──────── 데이터 ──────── */
  var ordersToday = [];
  var ordersByDate = {};
  var fbRefToday = null;
  var panelBuilt = false;
  var historyLoaded = false;

  /* ──────── 스타일 (극단 경량, GPU 부하 0) ──────── */
  function injectStyle() {
    if (document.getElementById('coffee-tab-style')) return;
    var s = document.createElement('style');
    s.id = 'coffee-tab-style';
    s.textContent = [
      // 패널 자체에 layout 격리 - 다른 탭 렌더에 안 방해받음
      '#panel-coffee { padding: 12px; padding-bottom: 80px; overflow-y: auto; height: 100%;',
      '  contain: layout style; -webkit-overflow-scrolling: touch; }',
      // 헤딩 - 단순 text
      '#panel-coffee .cf-h { font-size: 14px; font-weight: 700; color: #78350f; padding: 4px 0 10px; }',
      // 섹션 - 단순 border (그림자 없음)
      '#panel-coffee .cf-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;',
      '  padding: 12px; margin-bottom: 10px; }',
      '#panel-coffee .cf-title { font-size: 12.5px; font-weight: 700; color: #374151; margin-bottom: 8px; }',
      // 입력 - transition/box-shadow 제거
      '#panel-coffee .cf-input { width: 100%; padding: 11px 12px; border: 1px solid #d1d5db;',
      '  border-radius: 6px; font-size: 16px; box-sizing: border-box; background: #fff;',
      '  margin-bottom: 8px; font-family: inherit; color: #111827; }',
      '#panel-coffee .cf-input:focus { outline: 2px solid #c9763d; outline-offset: -1px; border-color: #c9763d; }',
      // 버튼 - gradient/shadow 제거
      '#panel-coffee .cf-save { width: 100%; padding: 12px; background: #c9763d; color: #fff;',
      '  border: none; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }',
      '#panel-coffee .cf-save:disabled { opacity: 0.5; }',
      // 상태
      '#panel-coffee .cf-status { font-size: 12px; color: #166534; padding: 6px 10px; background: #dcfce7;',
      '  border-radius: 6px; margin-top: 8px; display: none; }',
      '#panel-coffee .cf-status.show { display: block; }',
      // 주문 행 - 심플
      '#panel-coffee .cf-row { display: flex; align-items: center; gap: 8px; padding: 8px 2px;',
      '  border-top: 1px solid #f3f4f6; font-size: 13px; }',
      '#panel-coffee .cf-row:first-child { border-top: none; }',
      '#panel-coffee .cf-u { min-width: 52px; font-weight: 700; color: #4b5563; font-size: 12px; }',
      '#panel-coffee .cf-m { flex: 1; color: #111827; word-break: break-all; }',
      '#panel-coffee .cf-n { color: #6b7280; font-size: 11.5px; }',
      '#panel-coffee .cf-del { width: 26px; height: 26px; border: 1px solid #fca5a5;',
      '  background: #fff; color: #dc2626; border-radius: 4px; font-size: 12px; padding: 0; }',
      '#panel-coffee .cf-empty { text-align: center; color: #9ca3af; padding: 18px; font-size: 12.5px; }',
      // 정산 버튼
      '#panel-coffee .cf-settle { width: 100%; padding: 10px; margin-top: 10px; background: #fef3c7;',
      '  color: #78350f; border: 1px solid #fbbf24; border-radius: 6px; font-size: 13px; font-weight: 700; }',
      // 지난 기록 - 지연 로딩용 버튼
      '#panel-coffee .cf-load-hist { width: 100%; padding: 10px; background: #f3f4f6; color: #4b5563;',
      '  border: 1px solid #d1d5db; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; }',
      // 기록 리스트
      '#panel-coffee .cf-hd { padding: 8px 4px; border-top: 1px solid #f3f4f6; font-size: 12.5px;',
      '  display: flex; justify-content: space-between; cursor: pointer; }',
      '#panel-coffee .cf-hd:first-of-type { border-top: none; }',
      '#panel-coffee .cf-hdd { padding: 8px 12px; font-size: 12px; color: #4b5563; line-height: 1.6;',
      '  background: #f9fafb; border-radius: 6px; margin: 4px 0; display: none; }',
      '#panel-coffee .cf-hdd.open { display: block; }',
      // 배지
      '#panel-coffee .cf-badge { background: #fef3c7; color: #92400e; padding: 2px 8px;',
      '  border-radius: 999px; font-size: 11px; font-weight: 700; margin-left: 6px; }',
      // 카운트 우측
      '#panel-coffee .cf-cnt { color: #9ca3af; font-size: 11px; font-weight: 700; }',
      '@media (max-width: 600px) {',
      '  #panel-coffee { padding: 10px; }',
      '  #panel-coffee .cf-u { min-width: 46px; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ──────── 패널 생성 (1회만) ──────── */
  function ensurePanel() {
    var panel = document.getElementById('panel-coffee');
    if (!panel) {
      var main = document.querySelector('.main') || document.querySelector('.app');
      if (!main) return null;
      panel = document.createElement('div');
      panel.id = 'panel-coffee';
      panel.className = 'tab-panel';
      main.appendChild(panel);
    }
    if (panelBuilt) return panel;

    panel.innerHTML = [
      '<div class="cf-h">☕ 오늘의 커피</div>',
      // 입력 (한 번만 만들고 절대 리렌더 안 함)
      '<div class="cf-box">',
      '  <div class="cf-title">📝 내 주문</div>',
      '  <input type="text" class="cf-input" id="cfMenuInput" placeholder="메뉴 (예: 아이스아메리카노)" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">',
      '  <input type="text" class="cf-input" id="cfNoteInput" placeholder="옵션/메모 (예: 얼음적게) - 선택" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">',
      '  <button class="cf-save" id="cfSaveBtn" type="button">주문 등록</button>',
      '  <div class="cf-status" id="cfMyStatus"></div>',
      '</div>',
      // 오늘 주문
      '<div class="cf-box">',
      '  <div class="cf-title">🛒 오늘 주문<span class="cf-badge" id="cfCount">0잔</span></div>',
      '  <div id="cfList"></div>',
      '  <div id="cfActions"></div>',
      '</div>',
      // 지난 기록 (지연 로딩)
      '<div class="cf-box">',
      '  <div class="cf-title">📅 지난 기록 <span class="cf-cnt" id="cfHistCnt"></span></div>',
      '  <div id="cfHistArea"><button class="cf-load-hist" type="button" id="cfLoadHist">지난 14일 기록 보기</button></div>',
      '</div>'
    ].join('\n');

    // 이벤트 (1회만)
    var saveBtn = panel.querySelector('#cfSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveMyOrder);

    var menuInput = panel.querySelector('#cfMenuInput');
    var noteInput = panel.querySelector('#cfNoteInput');
    var isComposing = false;
    [menuInput, noteInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener('compositionstart', function () { isComposing = true; });
      el.addEventListener('compositionend', function () { isComposing = false; });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !isComposing && !e.shiftKey) {
          e.preventDefault();
          saveMyOrder();
        }
      });
    });

    // 지난 기록 지연 로딩 버튼
    var loadHistBtn = panel.querySelector('#cfLoadHist');
    if (loadHistBtn) loadHistBtn.addEventListener('click', loadAndRenderHistory);

    panelBuilt = true;
    return panel;
  }

  /* ──────── 저장 ──────── */
  function saveMyOrder() {
    var menuEl = document.getElementById('cfMenuInput');
    var noteEl = document.getElementById('cfNoteInput');
    if (!menuEl) return;
    var menu = (menuEl.value || '').trim();
    var note = (noteEl ? noteEl.value : '').trim();
    if (!menu) { alert('메뉴를 입력해주세요'); menuEl.focus(); return; }

    var fbDbRef = getFbDb();
    var uid = getCurrentAuthUid();
    var userName = getCurrentUser();
    if (!fbDbRef) { alert('Firebase 연결 안 됨'); return; }
    if (!uid || !userName) { alert('로그인 정보 없음'); return; }

    var payload = { userUid: uid, userName: userName, menu: menu, note: note, timestamp: Date.now() };
    var date = getTodayStr();
    var existing = ordersToday.find(function (o) { return o.userUid === uid && !o.settled; });

    var saveBtn = document.getElementById('cfSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    var promise;
    if (existing) {
      promise = fbDbRef.ref('coffeeOrders/' + date + '/' + existing.id).update(payload);
    } else {
      var ref = fbDbRef.ref('coffeeOrders/' + date).push();
      promise = ref.set(payload);
    }

    promise.then(function () {
      if (!existing) {
        menuEl.value = '';
        if (noteEl) noteEl.value = '';
      }
      if (saveBtn) saveBtn.disabled = false;
    }).catch(function (err) {
      if (saveBtn) saveBtn.disabled = false;
      alert('저장 실패: ' + (err.message || err));
    });
  }

  function deleteOrder(orderId) {
    var target = ordersToday.find(function (o) { return o.id === orderId; });
    if (!target) return;
    if (target.userUid !== getCurrentAuthUid() && !isOwner()) { alert('본인 주문만 삭제'); return; }
    if (!confirm(target.userName + '님 주문 삭제?\n\n' + target.menu)) return;
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    fbDbRef.ref('coffeeOrders/' + getTodayStr() + '/' + orderId).remove();
  }

  function settleToday() {
    if (!isOwner()) return;
    var active = ordersToday.filter(function (o) { return !o.settled; });
    if (!active.length) { alert('정산할 주문 없음'); return; }
    if (!confirm(active.length + '잔 정산 완료 처리?')) return;
    var date = getTodayStr();
    var updates = {};
    active.forEach(function (o) {
      updates['coffeeOrders/' + date + '/' + o.id + '/settled'] = true;
      updates['coffeeOrders/' + date + '/' + o.id + '/settledAt'] = Date.now();
    });
    getFbDb().ref().update(updates);
  }

  /* ──────── 렌더 (오늘 주문만 - 입력창은 절대 안 건드림) ──────── */
  function renderTodayList() {
    var listEl = document.getElementById('cfList');
    var cntEl = document.getElementById('cfCount');
    var actEl = document.getElementById('cfActions');
    var statusEl = document.getElementById('cfMyStatus');
    if (!listEl) return;

    var active = ordersToday.filter(function (o) { return !o.settled; });
    active.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

    if (cntEl) cntEl.textContent = active.length + '잔';

    var uid = getCurrentAuthUid();
    var mine = active.find(function (o) { return o.userUid === uid; });
    if (statusEl) {
      if (mine) {
        statusEl.textContent = '✓ 등록완료: ' + mine.menu + (mine.note ? ' (' + mine.note + ')' : '');
        statusEl.classList.add('show');
      } else {
        statusEl.classList.remove('show');
      }
    }

    if (!active.length) {
      listEl.innerHTML = '<div class="cf-empty">아직 주문 없음 ☕</div>';
    } else {
      var html = '';
      for (var i = 0; i < active.length; i++) {
        var o = active[i];
        var canDel = o.userUid === uid || isOwner();
        html += '<div class="cf-row"><span class="cf-u">' + escHtml(o.userName) +
          '</span><span class="cf-m">' + escHtml(o.menu) +
          (o.note ? ' <span class="cf-n">· ' + escHtml(o.note) + '</span>' : '') + '</span>' +
          (canDel ? '<button class="cf-del" type="button" data-del="' + escHtml(o.id) + '">🗑</button>' : '') +
          '</div>';
      }
      listEl.innerHTML = html;
      var dels = listEl.querySelectorAll('[data-del]');
      for (var j = 0; j < dels.length; j++) {
        (function (btn) {
          btn.addEventListener('click', function () { deleteOrder(btn.getAttribute('data-del')); });
        })(dels[j]);
      }
    }

    if (actEl) {
      if (isOwner() && active.length) {
        actEl.innerHTML = '<button class="cf-settle" type="button" id="cfSettleBtn">💳 결제완료 → 정산 (' + active.length + '잔)</button>';
        var sb = document.getElementById('cfSettleBtn');
        if (sb) sb.addEventListener('click', settleToday);
      } else {
        actEl.innerHTML = '';
      }
    }
  }

  /* ──────── 지난 기록 (지연 로딩 - 클릭해야만 실행) ──────── */
  function loadAndRenderHistory() {
    var area = document.getElementById('cfHistArea');
    if (!area) return;
    area.innerHTML = '<div class="cf-empty">불러오는 중...</div>';

    var fbDbRef = getFbDb();
    if (!fbDbRef) { area.innerHTML = '<div class="cf-empty">Firebase 연결 안 됨</div>'; return; }

    fbDbRef.ref('coffeeOrders').once('value').then(function (snap) {
      var val = snap.val() || {};
      Object.keys(val).forEach(function (d) {
        var dayVal = val[d] || {};
        ordersByDate[d] = Object.entries(dayVal).map(function (kv) {
          return Object.assign({ id: kv[0] }, kv[1] || {});
        });
      });
      historyLoaded = true;
      renderHistoryHtml();
    }).catch(function (err) {
      area.innerHTML = '<div class="cf-empty">로딩 실패</div>';
      console.warn('[커피] 기록 로딩 실패:', err && err.message);
    });
  }

  function renderHistoryHtml() {
    var area = document.getElementById('cfHistArea');
    var cntEl = document.getElementById('cfHistCnt');
    if (!area) return;
    var today = getTodayStr();
    var dates = Object.keys(ordersByDate).filter(function (d) { return d !== today; }).sort().reverse().slice(0, 14);
    if (cntEl) cntEl.textContent = '(최근 ' + dates.length + '일)';
    if (!dates.length) {
      area.innerHTML = '<div class="cf-empty">기록 없음</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      var orders = ordersByDate[d] || [];
      var detail = '';
      for (var j = 0; j < orders.length; j++) {
        var o = orders[j];
        detail += '• ' + escHtml(o.userName) + ': ' + escHtml(o.menu) +
          (o.note ? ' <span style="color:#9ca3af;">(' + escHtml(o.note) + ')</span>' : '') + '<br>';
      }
      html += '<div class="cf-hd" data-date="' + d + '"><span>📅 ' + d + '</span>' +
        '<span class="cf-badge">' + orders.length + '잔 ▼</span></div>' +
        '<div class="cf-hdd">' + detail + '</div>';
    }
    area.innerHTML = html;
    var heads = area.querySelectorAll('.cf-hd');
    for (var k = 0; k < heads.length; k++) {
      (function (h) {
        h.addEventListener('click', function () {
          var body = h.nextElementSibling;
          if (body) body.classList.toggle('open');
        });
      })(heads[k]);
    }
  }

  /* ──────── 메인 렌더 (오늘만) ──────── */
  function renderAll() {
    ensurePanel();
    renderTodayList();
  }

  /* ──────── Firebase 리스너 (오늘 것만) ──────── */
  function setupListener() {
    var fbDbRef = getFbDb();
    if (!fbDbRef) return false;
    var today = getTodayStr();
    if (fbRefToday) { try { fbRefToday.off(); } catch (e) {} }
    fbRefToday = fbDbRef.ref('coffeeOrders/' + today);
    fbRefToday.on('value', function (snap) {
      var val = snap.val() || {};
      ordersToday = Object.entries(val).map(function (kv) {
        return Object.assign({ id: kv[0] }, kv[1] || {});
      });
      ordersByDate[today] = ordersToday;
      renderTodayList();  // ★ 입력창 안 건드림
    }, function (err) {
      console.warn('[커피] 오늘 주문 읽기 실패:', err && err.message);
    });
    return true;
  }

  /* ──────── 글로벌 노출 ──────── */
  window.CoffeeOrders = {
    init: function () { injectStyle(); ensurePanel(); renderAll(); setupListener(); },
    render: renderAll,
    reattach: function () { setupListener(); }
  };

  /* ──────── 자동 초기화 ──────── */
  function autoInit() {
    injectStyle();
    ensurePanel();
    var tries = 0;
    var attach = function () {
      if (setupListener()) return;
      tries++;
      if (tries < 30) setTimeout(attach, 500);
    };
    attach();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  console.log('✓ 커피주문 모듈 로드됨 (coffee.js v3 극단경량)');
})();
