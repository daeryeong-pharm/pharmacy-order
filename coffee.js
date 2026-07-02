/* ============================================================
 * 대령약국 커피주문 탭 (경량 버전)
 * - 메뉴 + 옵션메모만
 * - 카페 구분 없음, 통계 없음
 * - 입력창은 한 번만 만들고 절대 리렌더 안 함 (한글 IME 안 끊김)
 * - 오늘 주문 목록 + 지난 기록 간략
 *
 * 작성: 2026-05-22 (v2 경량 개편)
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

  /* ──────── 데이터 상태 ──────── */
  var ordersToday = [];
  var ordersByDate = {};
  var fbRefToday = null;
  var panelBuilt = false;

  /* ──────── 스타일 (초경량) ──────── */
  function injectStyle() {
    if (document.getElementById('coffee-tab-style')) return;
    var s = document.createElement('style');
    s.id = 'coffee-tab-style';
    s.textContent = [
      '#panel-coffee { padding: 16px; padding-bottom: 80px; overflow-y: auto; height: 100%; }',
      '#panel-coffee .cf-hero { background: linear-gradient(135deg, #fff5e6 0%, #fed7aa 100%);',
      '  border-radius: 14px; padding: 14px 18px; margin-bottom: 14px; }',
      '#panel-coffee .cf-hero h2 { font-size: 17px; font-weight: 800; color: #7c2d12; margin: 0 0 3px 0; }',
      '#panel-coffee .cf-hero p { font-size: 12px; color: #92400e; margin: 0; }',
      '#panel-coffee .cf-section { background: #fff; border: 1px solid #e7e3da; border-radius: 12px; padding: 14px; margin-bottom: 12px; }',
      '#panel-coffee .cf-title { font-size: 13px; font-weight: 800; color: #1f2937; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }',
      '#panel-coffee .cf-badge { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }',
      '#panel-coffee .cf-input { width: 100%; padding: 12px 14px; border: 1.5px solid #d4cab8; border-radius: 10px;',
      '  font-size: 16px; box-sizing: border-box; background: #fefaf3; margin-bottom: 8px; font-family: inherit; }',
      '#panel-coffee .cf-input:focus { outline: none; border-color: #c9763d; background: #fff; box-shadow: 0 0 0 3px rgba(201,118,61,0.12); }',
      '#panel-coffee .cf-save { width: 100%; padding: 12px; background: linear-gradient(135deg, #d18556 0%, #c9763d 100%);',
      '  color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 4px; }',
      '#panel-coffee .cf-save:active { opacity: 0.85; }',
      '#panel-coffee .cf-save:disabled { opacity: 0.6; cursor: not-allowed; }',
      '#panel-coffee .cf-my-status { font-size: 12px; color: #166534; background: #dcfce7; padding: 8px 12px;',
      '  border-radius: 8px; margin-top: 8px; display: none; }',
      '#panel-coffee .cf-my-status.show { display: block; }',
      '#panel-coffee .cf-order-item { display: flex; align-items: center; gap: 10px; padding: 9px 4px;',
      '  border-top: 1px solid #f1f5f9; font-size: 13.5px; }',
      '#panel-coffee .cf-order-item:first-child { border-top: none; }',
      '#panel-coffee .cf-order-user { min-width: 60px; font-weight: 700; color: #475569; font-size: 12.5px; }',
      '#panel-coffee .cf-order-menu { flex: 1; color: #0f172a; word-break: break-all; }',
      '#panel-coffee .cf-order-note { color: #64748b; font-size: 11.5px; }',
      '#panel-coffee .cf-del-btn { width: 28px; height: 28px; border: 1px solid #fca5a5; background: #fff;',
      '  color: #dc2626; border-radius: 6px; font-size: 12px; cursor: pointer; padding: 0; }',
      '#panel-coffee .cf-empty { text-align: center; color: #94a3b8; padding: 22px 12px; font-size: 13px; }',
      '#panel-coffee .cf-settle-btn { width: 100%; padding: 11px; margin-top: 10px;',
      '  background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 8px;',
      '  font-size: 13px; font-weight: 700; cursor: pointer; }',
      '#panel-coffee .cf-settle-btn:active { background: #fde68a; }',
      '#panel-coffee .cf-hist-row { display: flex; justify-content: space-between; align-items: center;',
      '  padding: 8px 4px; border-top: 1px solid #f1f5f9; font-size: 12.5px; cursor: pointer; }',
      '#panel-coffee .cf-hist-row:first-of-type { border-top: none; }',
      '#panel-coffee .cf-hist-date { font-weight: 700; color: #475569; }',
      '#panel-coffee .cf-hist-count { color: #92400e; background: #fef3c7; padding: 2px 8px;',
      '  border-radius: 999px; font-size: 11px; font-weight: 700; }',
      '#panel-coffee .cf-hist-detail { padding: 6px 6px 10px; font-size: 12px; color: #6b7280;',
      '  line-height: 1.6; display: none; background: #faf6ee; border-radius: 6px; margin-top: 4px; }',
      '#panel-coffee .cf-hist-detail.open { display: block; padding: 10px 12px; }',
      '@media (max-width: 600px) {',
      '  #panel-coffee { padding: 12px; }',
      '  #panel-coffee .cf-hero { padding: 12px 14px; }',
      '  #panel-coffee .cf-order-item { font-size: 13px; }',
      '  #panel-coffee .cf-order-user { min-width: 50px; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ──────── 패널 (단 한 번만 생성) ──────── */
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
      '<div class="cf-hero">',
      '  <h2>오늘의 커피 ☕</h2>',
      '  <p>메뉴를 입력하면 약국장님이 한 번에 결제합니다</p>',
      '</div>',
      // ★ 입력 섹션 (한 번만 만들고 절대 손대지 않음)
      '<div class="cf-section">',
      '  <div class="cf-title">📝 내 주문</div>',
      '  <input type="text" class="cf-input" id="cfMenuInput" placeholder="메뉴 (예: 아이스아메리카노, 메가커피)" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off">',
      '  <input type="text" class="cf-input" id="cfNoteInput" placeholder="옵션/메모 (예: 얼음적게, 샷추가) - 선택" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off">',
      '  <button class="cf-save" id="cfSaveBtn" type="button">☕ 주문 등록</button>',
      '  <div class="cf-my-status" id="cfMyStatus"></div>',
      '</div>',
      // 오늘 주문 목록 (여기만 리렌더됨)
      '<div class="cf-section">',
      '  <div class="cf-title">🛒 오늘 주문 <span class="cf-badge" id="cfTodayCount">0잔</span></div>',
      '  <div id="cfOrderList"></div>',
      '  <div id="cfOwnerActions"></div>',
      '</div>',
      // 지난 기록 (여기만 리렌더됨)
      '<div class="cf-section">',
      '  <div class="cf-title">📅 지난 기록</div>',
      '  <div id="cfHistory"></div>',
      '</div>'
    ].join('\n');

    // 이벤트 (한 번만 바인딩)
    var saveBtn = panel.querySelector('#cfSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveMyOrder);

    // Enter 키로 저장 - 한글 조합 중일 땐 무시 (IME 안 끊김)
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

    var payload = {
      userUid: uid,
      userName: userName,
      menu: menu,
      note: note,
      timestamp: Date.now()
    };

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
      // 새 주문이면 입력창 비움 (수정이면 유지)
      if (!existing) {
        menuEl.value = '';
        if (noteEl) noteEl.value = '';
      }
      if (saveBtn) saveBtn.disabled = false;
    }).catch(function (err) {
      if (saveBtn) saveBtn.disabled = false;
      var msg = err && err.message ? err.message : String(err);
      if (/PERMISSION_DENIED/i.test(msg)) {
        alert('⛔ Firebase 규칙에 /coffeeOrders 쓰기 권한 없음. 규칙 확인 필요.');
      } else {
        alert('저장 실패: ' + msg);
      }
    });
  }

  /* ──────── 삭제 ──────── */
  function deleteOrder(orderId) {
    var target = ordersToday.find(function (o) { return o.id === orderId; });
    if (!target) return;
    var canDelete = target.userUid === getCurrentAuthUid() || isOwner();
    if (!canDelete) { alert('본인 주문만 삭제 가능합니다'); return; }
    if (!confirm(target.userName + '님의 주문을 삭제할까요?\n\n' + target.menu)) return;
    var date = getTodayStr();
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    fbDbRef.ref('coffeeOrders/' + date + '/' + orderId).remove().catch(function (err) {
      alert('삭제 실패: ' + (err.message || err));
    });
  }

  /* ──────── 정산 ──────── */
  function settleToday() {
    if (!isOwner()) return;
    var active = ordersToday.filter(function (o) { return !o.settled; });
    if (!active.length) { alert('정산할 주문이 없습니다'); return; }
    if (!confirm('오늘 주문 ' + active.length + '잔을 정산 완료로 처리합니다.\n\n지난 기록에 보관되고 화면에서 비웁니다.')) return;
    var date = getTodayStr();
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    var updates = {};
    active.forEach(function (o) {
      updates['coffeeOrders/' + date + '/' + o.id + '/settled'] = true;
      updates['coffeeOrders/' + date + '/' + o.id + '/settledAt'] = Date.now();
    });
    fbDbRef.ref().update(updates).catch(function (err) {
      alert('정산 실패: ' + (err.message || err));
    });
  }

  /* ──────── 렌더 (오늘 주문 목록만 - 입력창은 절대 안 건드림) ──────── */
  function renderOrderList() {
    var listEl = document.getElementById('cfOrderList');
    var cntEl = document.getElementById('cfTodayCount');
    var actionsEl = document.getElementById('cfOwnerActions');
    var statusEl = document.getElementById('cfMyStatus');
    if (!listEl) return;

    var active = ordersToday.filter(function (o) { return !o.settled; });
    active.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

    if (cntEl) cntEl.textContent = active.length + '잔';

    // 내 등록 상태
    var uid = getCurrentAuthUid();
    var mine = active.find(function (o) { return o.userUid === uid; });
    if (statusEl) {
      if (mine) {
        statusEl.textContent = '✓ 등록완료: ' + mine.menu + (mine.note ? ' (' + mine.note + ')' : '') + ' — 다시 저장하면 수정됩니다';
        statusEl.classList.add('show');
      } else {
        statusEl.classList.remove('show');
        statusEl.textContent = '';
      }
    }

    // 목록 렌더
    if (!active.length) {
      listEl.innerHTML = '<div class="cf-empty">아직 주문이 없습니다 ☕</div>';
    } else {
      listEl.innerHTML = active.map(function (o) {
        var canDelete = o.userUid === uid || isOwner();
        var delBtn = canDelete ? '<button class="cf-del-btn" type="button" data-del="' + escHtml(o.id) + '">🗑</button>' : '';
        return '<div class="cf-order-item">' +
          '<span class="cf-order-user">' + escHtml(o.userName) + '</span>' +
          '<span class="cf-order-menu">' + escHtml(o.menu) +
          (o.note ? ' <span class="cf-order-note">· ' + escHtml(o.note) + '</span>' : '') +
          '</span>' + delBtn + '</div>';
      }).join('');
      listEl.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () { deleteOrder(b.getAttribute('data-del')); });
      });
    }

    // 약국장 정산 버튼
    if (actionsEl) {
      if (isOwner() && active.length) {
        actionsEl.innerHTML = '<button class="cf-settle-btn" type="button" id="cfSettleBtn">💳 결제완료 → 정산 (' + active.length + '잔)</button>';
        var sb = document.getElementById('cfSettleBtn');
        if (sb) sb.addEventListener('click', settleToday);
      } else {
        actionsEl.innerHTML = '';
      }
    }
  }

  /* ──────── 렌더 (지난 기록 - 최소 정보) ──────── */
  function renderHistory() {
    var host = document.getElementById('cfHistory');
    if (!host) return;
    var today = getTodayStr();
    var dates = Object.keys(ordersByDate).filter(function (d) { return d !== today; }).sort().reverse();
    if (!dates.length) {
      host.innerHTML = '<div class="cf-empty">아직 지난 기록이 없습니다</div>';
      return;
    }
    host.innerHTML = dates.slice(0, 14).map(function (d) {
      var orders = ordersByDate[d] || [];
      var detail = orders.map(function (o) {
        return '• ' + escHtml(o.userName) + ': ' + escHtml(o.menu) + (o.note ? ' <span style="color:#94a3b8;">(' + escHtml(o.note) + ')</span>' : '');
      }).join('<br>');
      return '<div>' +
        '<div class="cf-hist-row" data-date="' + d + '">' +
          '<span class="cf-hist-date">📅 ' + d + '</span>' +
          '<span class="cf-hist-count">' + orders.length + '잔 ▼</span>' +
        '</div>' +
        '<div class="cf-hist-detail">' + detail + '</div>' +
        '</div>';
    }).join('');
    host.querySelectorAll('.cf-hist-row').forEach(function (h) {
      h.addEventListener('click', function () {
        var body = h.nextElementSibling;
        if (body) body.classList.toggle('open');
      });
    });
  }

  /* ──────── 메인 렌더 ──────── */
  function renderAll() {
    ensurePanel();
    renderOrderList();
    renderHistory();
  }

  /* ──────── Firebase 리스너 ──────── */
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
      renderOrderList();  // ★ 입력창 안 건드리고 목록만 갱신
    }, function (err) {
      console.warn('[커피] 오늘 주문 읽기 실패:', err && err.message);
    });
    // 전체 기록 (한 번만)
    fbDbRef.ref('coffeeOrders').once('value').then(function (snap) {
      var val = snap.val() || {};
      Object.entries(val).forEach(function (kv) {
        var d = kv[0];
        var dayVal = kv[1] || {};
        ordersByDate[d] = Object.entries(dayVal).map(function (oKv) {
          return Object.assign({ id: oKv[0] }, oKv[1] || {});
        });
      });
      renderHistory();  // ★ 입력창 안 건드리고 기록만 갱신
    }).catch(function (err) {
      console.warn('[커피] 전체 기록 읽기 실패:', err && err.message);
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

  console.log('✓ 커피주문 모듈 로드됨 (coffee.js v2 경량)');
})();
