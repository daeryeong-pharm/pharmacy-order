/* ============================================================
 * 대령약국 커피주문 탭 (외부 모듈)
 * - 빽다방 / 컴포트커피 / 메가커피
 * - 직원 각자 본인 주문 등록/수정/삭제
 * - 약국장(백승준)은 모든 주문 관리 + 정산
 * - 날짜별 자동 기록 (재미용 통계 포함)
 *
 * 의존: window.fbDb, currentUser, currentAuthUid, todayStr
 * 작성: 2026-05-22
 * ============================================================ */
(function () {
  'use strict';

  const SHOPS = [
    { id: 'paik', name: '빽다방', color: '#fbbf24', bg: '#fef3c7', emoji: '☕' },
    { id: 'comfort', name: '컴포트커피', color: '#8b5cf6', bg: '#ede9fe', emoji: '🫖' },
    { id: 'mega', name: '메가커피', color: '#facc15', bg: '#fef9c3', emoji: '🥤' },
  ];

  // 인기 메뉴 시드 (자동완성용 - 자유 입력 가능)
  const POPULAR_MENUS = {
    paik: [
      '아이스아메리카노', '빽사이즈 아메리카노', '카페라떼', '빽사이즈 카페라떼',
      '바닐라라떼', '카라멜마키아토', '딸기스무디', '망고스무디',
      '초코프라페', '쿠앤크프라페', '빽사이즈 카페모카',
    ],
    comfort: [
      '아메리카노', '카페라떼', '카푸치노', '바닐라라떼',
      '카라멜마키아토', '콜드브루', '말차라떼', '복숭아아이스티',
      '딸기라떼', '초코라떼',
    ],
    mega: [
      '아이스아메리카노', '카페라떼', '바닐라라떼', '카라멜마키아토',
      '딸기라떼', '초코라떼', '복숭아아이스티', '레몬에이드',
      '자몽에이드', '쿠키앤크림', '메가샷 아메리카노',
    ],
  };

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
    var uid = getCurrentAuthUid();
    return uid === 'bhgORSzZ23dlNUfZmDPBe3IsnPN2'; // 백승준
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ──────── 데이터 상태 ──────── */
  var coffeeOrdersToday = []; // 오늘의 주문 목록
  var coffeeOrdersAllDates = {}; // {date: [orders...]} 캐시
  var fbCoffeeRefToday = null;

  /* ──────── 스타일 주입 ──────── */
  function injectStyle() {
    if (document.getElementById('coffee-tab-style')) return;
    var s = document.createElement('style');
    s.id = 'coffee-tab-style';
    s.textContent = [
      '#panel-coffee { padding: 16px; padding-bottom: 80px; overflow-y: auto; height: 100%; }',
      '#panel-coffee .coffee-hero { background: linear-gradient(135deg, #fff5e6 0%, #fed7aa 100%);',
      '  border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; position: relative; overflow: hidden; }',
      '#panel-coffee .coffee-hero h2 { font-size: 18px; font-weight: 800; color: #7c2d12; margin: 0 0 4px 0; }',
      '#panel-coffee .coffee-hero p { font-size: 12.5px; color: #92400e; margin: 0; }',
      '#panel-coffee .coffee-hero .emoji { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); font-size: 44px; opacity: 0.5; }',
      '#panel-coffee .coffee-section { background: #fff; border: 1px solid #e7e3da; border-radius: 14px; padding: 16px; margin-bottom: 14px; }',
      '#panel-coffee .coffee-section-title { font-size: 13px; font-weight: 800; color: #1f2937; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }',
      '#panel-coffee .coffee-section-title .badge { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }',
      '#panel-coffee .shop-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }',
      '#panel-coffee .shop-tab { flex: 1; min-width: 90px; padding: 10px 8px; border: 2px solid #e2e8f0; background: #fff;',
      '  border-radius: 10px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: #475569; text-align: center;',
      '  transition: all 0.15s; }',
      '#panel-coffee .shop-tab .shop-emoji { font-size: 18px; display: block; margin-bottom: 2px; }',
      '#panel-coffee .shop-tab.active { color: #fff; transform: translateY(-1px); box-shadow: 0 4px 12px -2px rgba(0,0,0,0.15); }',
      '#panel-coffee .shop-tab[data-shop="paik"].active { background: #fbbf24; border-color: #fbbf24; }',
      '#panel-coffee .shop-tab[data-shop="comfort"].active { background: #8b5cf6; border-color: #8b5cf6; }',
      '#panel-coffee .shop-tab[data-shop="mega"].active { background: #facc15; border-color: #facc15; color: #78350f; }',
      '#panel-coffee .menu-input-wrap { position: relative; margin-bottom: 10px; }',
      '#panel-coffee .menu-input { width: 100%; padding: 12px 14px; border: 1.5px solid #d4cab8; border-radius: 10px;',
      '  font-size: 14.5px; box-sizing: border-box; background: #fefaf3; }',
      '#panel-coffee .menu-input:focus { outline: none; border-color: #c9763d; background: #fff; box-shadow: 0 0 0 3px rgba(201,118,61,0.12); }',
      '#panel-coffee .menu-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }',
      '#panel-coffee .menu-chip { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 5px 10px; border-radius: 999px;',
      '  font-size: 11.5px; color: #475569; cursor: pointer; font-weight: 600; transition: all 0.15s; }',
      '#panel-coffee .menu-chip:hover { background: #c9763d; border-color: #c9763d; color: #fff; }',
      '#panel-coffee .note-input { width: 100%; padding: 10px 14px; border: 1.5px solid #d4cab8; border-radius: 10px;',
      '  font-size: 13px; margin-bottom: 10px; box-sizing: border-box; background: #fefaf3; }',
      '#panel-coffee .note-input:focus { outline: none; border-color: #c9763d; background: #fff; }',
      '#panel-coffee .save-btn { width: 100%; padding: 13px; background: linear-gradient(135deg, #d18556 0%, #c9763d 100%);',
      '  color: #fff; border: none; border-radius: 11px; font-size: 14.5px; font-weight: 700; cursor: pointer;',
      '  display: inline-flex; align-items: center; justify-content: center; gap: 8px;',
      '  box-shadow: 0 6px 14px -4px rgba(201,118,61,0.45); transition: all 0.15s; }',
      '#panel-coffee .save-btn:hover { transform: translateY(-1px); }',
      '#panel-coffee .save-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }',
      '#panel-coffee .my-order { background: #f0f9ff; border: 1.5px dashed #3b82f6; border-radius: 12px;',
      '  padding: 12px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }',
      '#panel-coffee .my-order-text { flex: 1; font-size: 13px; color: #1e40af; }',
      '#panel-coffee .my-order-text b { font-weight: 800; }',
      '#panel-coffee .my-order-btn { padding: 6px 12px; border: 1px solid #3b82f6; background: #fff; color: #3b82f6;',
      '  border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; }',
      '#panel-coffee .my-order-btn.danger { color: #dc2626; border-color: #fca5a5; }',
      '#panel-coffee .shop-group { margin-bottom: 14px; }',
      '#panel-coffee .shop-header { display: flex; align-items: center; justify-content: space-between;',
      '  padding: 10px 12px; border-radius: 10px 10px 0 0; font-weight: 800; font-size: 13.5px; }',
      '#panel-coffee .shop-header .count { background: rgba(255,255,255,0.4); padding: 2px 8px; border-radius: 999px;',
      '  font-size: 11.5px; font-weight: 700; }',
      '#panel-coffee .shop-body { background: #fff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; }',
      '#panel-coffee .order-row { display: grid; grid-template-columns: 70px 1fr auto; gap: 10px;',
      '  padding: 10px 12px; border-top: 1px solid #f1f5f9; font-size: 13px; align-items: center; }',
      '#panel-coffee .order-row:first-child { border-top: none; }',
      '#panel-coffee .order-user { font-weight: 700; color: #475569; font-size: 12px; }',
      '#panel-coffee .order-menu { color: #0f172a; word-break: break-all; }',
      '#panel-coffee .order-menu .note { color: #64748b; font-size: 11.5px; }',
      '#panel-coffee .order-actions { display: flex; gap: 4px; }',
      '#panel-coffee .order-icon-btn { width: 28px; height: 28px; border: 1px solid #e2e8f0; background: #f8fafc;',
      '  border-radius: 6px; cursor: pointer; font-size: 12px; padding: 0; display: flex; align-items: center; justify-content: center; }',
      '#panel-coffee .order-icon-btn:hover { background: #e2e8f0; }',
      '#panel-coffee .order-icon-btn.danger { color: #dc2626; }',
      '#panel-coffee .empty { text-align: center; color: #94a3b8; padding: 30px 12px; font-size: 13px; }',
      '#panel-coffee .summary-bar { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);',
      '  border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center;',
      '  justify-content: space-between; font-size: 13px; color: #78350f; font-weight: 700; }',
      '#panel-coffee .summary-bar .total { font-size: 16px; font-weight: 800; }',
      '#panel-coffee .owner-actions { display: flex; gap: 6px; margin-top: 10px; }',
      '#panel-coffee .owner-btn { flex: 1; padding: 9px 12px; border: 1px solid #e2e8f0; background: #fff;',
      '  color: #475569; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }',
      '#panel-coffee .owner-btn.primary { background: #c9763d; color: #fff; border-color: #c9763d; }',
      '#panel-coffee .owner-btn.danger { color: #dc2626; border-color: #fca5a5; }',
      '#panel-coffee .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }',
      '#panel-coffee .stat-card { background: #fafafa; border: 1px solid #e7e3da; border-radius: 10px; padding: 10px 12px; }',
      '#panel-coffee .stat-label { font-size: 10.5px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }',
      '#panel-coffee .stat-value { font-size: 18px; font-weight: 800; color: #1f2937; margin-top: 2px; }',
      '#panel-coffee .stat-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }',
      '#panel-coffee .history-day { background: #fff; border: 1px solid #e7e3da; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }',
      '#panel-coffee .history-day-head { background: #faf6ee; padding: 8px 12px; display: flex; justify-content: space-between;',
      '  font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; }',
      '#panel-coffee .history-day-body { padding: 8px 12px; font-size: 12px; color: #6b7280; line-height: 1.6; display: none; }',
      '#panel-coffee .history-day-body.open { display: block; }',
      '@media (max-width: 600px) {',
      '  #panel-coffee { padding: 12px; }',
      '  #panel-coffee .coffee-hero { padding: 14px 16px; }',
      '  #panel-coffee .coffee-hero .emoji { font-size: 36px; }',
      '  #panel-coffee .shop-tab { font-size: 11.5px; min-width: 0; padding: 8px 4px; }',
      '  #panel-coffee .menu-input { font-size: 16px; }',
      '  #panel-coffee .order-row { grid-template-columns: 60px 1fr auto; gap: 6px; padding: 10px; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ──────── 패널 DOM 생성 ──────── */
  function ensurePanel() {
    var panel = document.getElementById('panel-coffee');
    if (!panel) {
      // 패널이 없으면 main 영역에 추가
      var main = document.querySelector('.main') || document.querySelector('.app');
      if (!main) return null;
      panel = document.createElement('div');
      panel.id = 'panel-coffee';
      panel.className = 'tab-panel';
      main.appendChild(panel);
    }
    if (!panel.dataset.built) {
      panel.innerHTML = [
        '<div class="coffee-hero">',
        '  <h2>오늘의 커피 타임 ☕</h2>',
        '  <p>각자 메뉴 선택하면 약국장님이 한 번에 결제합니다</p>',
        '  <span class="emoji">☕</span>',
        '</div>',
        // 내 주문 영역
        '<div class="coffee-section" id="coffeeMyOrderSection">',
        '  <div class="coffee-section-title">📝 내 주문하기 <span id="coffeeMyOrderStatus"></span></div>',
        '  <div class="shop-tabs" id="coffeeShopTabs"></div>',
        '  <div class="menu-input-wrap">',
        '    <input type="text" class="menu-input" id="coffeeMenuInput" placeholder="메뉴 입력 (예: 아이스아메리카노)" maxlength="50">',
        '  </div>',
        '  <div class="menu-suggestions" id="coffeeMenuSuggestions"></div>',
        '  <input type="text" class="note-input" id="coffeeNoteInput" placeholder="옵션·메모 (예: 얼음적게, 샷추가)" maxlength="60">',
        '  <button class="save-btn" id="coffeeSaveBtn"><span>☕</span> <span>주문 등록</span></button>',
        '</div>',
        // 오늘 주문 목록
        '<div class="coffee-section">',
        '  <div class="coffee-section-title">🛒 오늘의 주문 (<span id="coffeeOrderDate"></span>) <span class="badge" id="coffeeTotalCount">0건</span></div>',
        '  <div id="coffeeOwnerSummary"></div>',
        '  <div id="coffeeOrderList"></div>',
        '  <div id="coffeeOwnerActions"></div>',
        '</div>',
        // 통계
        '<div class="coffee-section">',
        '  <div class="coffee-section-title">📊 통계 (재미용)</div>',
        '  <div class="stats-grid" id="coffeeStats"></div>',
        '</div>',
        // 지난 기록
        '<div class="coffee-section">',
        '  <div class="coffee-section-title">📅 지난 기록</div>',
        '  <div id="coffeeHistory"></div>',
        '</div>'
      ].join('\n');
      panel.dataset.built = '1';
    }
    return panel;
  }

  /* ──────── 상태 ──────── */
  var selectedShop = 'paik';
  var myExistingOrderId = null;

  /* ──────── 카페 선택 탭 렌더 ──────── */
  function renderShopTabs() {
    var host = document.getElementById('coffeeShopTabs');
    if (!host) return;
    host.innerHTML = SHOPS.map(function (sh) {
      return '<button class="shop-tab' + (sh.id === selectedShop ? ' active' : '') + '" data-shop="' + sh.id + '" type="button">' +
        '<span class="shop-emoji">' + sh.emoji + '</span>' + escHtml(sh.name) +
        '</button>';
    }).join('');
    host.querySelectorAll('.shop-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        selectedShop = b.dataset.shop;
        renderShopTabs();
        renderSuggestions();
      });
    });
  }

  function renderSuggestions() {
    var host = document.getElementById('coffeeMenuSuggestions');
    if (!host) return;
    var menus = POPULAR_MENUS[selectedShop] || [];
    host.innerHTML = menus.map(function (m) {
      return '<span class="menu-chip" data-menu="' + escHtml(m) + '">' + escHtml(m) + '</span>';
    }).join('');
    host.querySelectorAll('.menu-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        var input = document.getElementById('coffeeMenuInput');
        if (input) { input.value = c.dataset.menu; input.focus(); }
      });
    });
  }

  /* ──────── 내 주문 상태 표시 ──────── */
  function renderMyOrderStatus() {
    var uid = getCurrentAuthUid();
    var mine = coffeeOrdersToday.find(function (o) { return o.userUid === uid; });
    var statusEl = document.getElementById('coffeeMyOrderStatus');
    var saveBtn = document.getElementById('coffeeSaveBtn');
    if (mine) {
      myExistingOrderId = mine.id;
      var shop = SHOPS.find(function (s) { return s.id === mine.shopId; });
      if (statusEl) {
        statusEl.innerHTML = ' <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">' +
          '✓ 등록완료: ' + (shop ? shop.emoji : '') + ' ' + escHtml(mine.menu) + '</span>';
      }
      if (saveBtn) saveBtn.querySelector('span:last-child').textContent = '주문 수정';
    } else {
      myExistingOrderId = null;
      if (statusEl) statusEl.innerHTML = '';
      if (saveBtn) saveBtn.querySelector('span:last-child').textContent = '주문 등록';
    }
  }

  /* ──────── 주문 저장 ──────── */
  function saveMyOrder() {
    var menu = (document.getElementById('coffeeMenuInput').value || '').trim();
    var note = (document.getElementById('coffeeNoteInput').value || '').trim();
    if (!menu) { alert('메뉴를 입력해주세요'); return; }
    var fbDbRef = getFbDb();
    var uid = getCurrentAuthUid();
    var userName = getCurrentUser();
    if (!fbDbRef) { alert('Firebase 연결 안 됨'); return; }
    if (!uid || !userName) { alert('로그인 정보 없음'); return; }

    var shop = SHOPS.find(function (s) { return s.id === selectedShop; });
    var payload = {
      userUid: uid,
      userName: userName,
      shopId: selectedShop,
      shopName: shop ? shop.name : '',
      menu: menu,
      note: note,
      timestamp: Date.now()
    };

    var date = getTodayStr();
    var ref;
    if (myExistingOrderId) {
      ref = fbDbRef.ref('coffeeOrders/' + date + '/' + myExistingOrderId);
      ref.update(payload).then(function () {
        // 입력 필드 유지 (UI 깜박임 방지)
      }).catch(function (err) {
        alert('수정 실패: ' + (err.message || err));
      });
    } else {
      ref = fbDbRef.ref('coffeeOrders/' + date).push();
      ref.set(payload).then(function () {
        // 저장 후 입력 필드 초기화
        document.getElementById('coffeeMenuInput').value = '';
        document.getElementById('coffeeNoteInput').value = '';
      }).catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/PERMISSION_DENIED/i.test(msg)) {
          alert('⛔ Firebase 규칙에서 /coffeeOrders 쓰기 차단.\n\n규칙 추가 필요:\n\n"coffeeOrders": {\n  "$date": {\n    "$id": {\n      ".write": "auth != null && (!data.exists() || data.child(\'userUid\').val() == auth.uid || auth.uid === \'bhgORSzZ23dlNUfZmDPBe3IsnPN2\')"\n    }\n  }\n}');
        } else {
          alert('저장 실패: ' + msg);
        }
      });
    }
  }

  /* ──────── 내 주문 삭제 ──────── */
  function deleteMyOrder() {
    if (!myExistingOrderId) return;
    if (!confirm('내 주문을 삭제할까요?')) return;
    var date = getTodayStr();
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    fbDbRef.ref('coffeeOrders/' + date + '/' + myExistingOrderId).remove().catch(function (err) {
      alert('삭제 실패: ' + (err.message || err));
    });
  }
  function deleteOtherOrder(orderId) {
    if (!isOwner()) { alert('약국장만 다른 사람 주문 삭제 가능'); return; }
    if (!confirm('이 주문을 삭제할까요?')) return;
    var date = getTodayStr();
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    fbDbRef.ref('coffeeOrders/' + date + '/' + orderId).remove().catch(function (err) {
      alert('삭제 실패: ' + (err.message || err));
    });
  }

  /* ──────── 정산 (전체 클리어) ──────── */
  function settleToday() {
    if (!isOwner()) return;
    if (!coffeeOrdersToday.length) { alert('정산할 주문이 없습니다'); return; }
    if (!confirm('오늘 주문 ' + coffeeOrdersToday.length + '건을 정산 완료 처리합니다.\n\n주문 목록은 \'지난 기록\'에 보관되고 화면에서 비웁니다.\n\n계속할까요?')) return;
    var date = getTodayStr();
    var fbDbRef = getFbDb();
    if (!fbDbRef) return;
    // settled flag만 추가 (삭제 안함 - 기록 보존)
    var updates = {};
    coffeeOrdersToday.forEach(function (o) {
      updates['coffeeOrders/' + date + '/' + o.id + '/settled'] = true;
      updates['coffeeOrders/' + date + '/' + o.id + '/settledAt'] = Date.now();
      updates['coffeeOrders/' + date + '/' + o.id + '/settledBy'] = getCurrentUser();
    });
    fbDbRef.ref().update(updates).then(function () {
      alert('✅ 정산 완료! 지난 기록에서 확인 가능합니다.');
    }).catch(function (err) {
      alert('정산 실패: ' + (err.message || err));
    });
  }

  /* ──────── 주문 목록 렌더 ──────── */
  function renderOrderList() {
    var listEl = document.getElementById('coffeeOrderList');
    var dateEl = document.getElementById('coffeeOrderDate');
    var cntEl = document.getElementById('coffeeTotalCount');
    var summaryEl = document.getElementById('coffeeOwnerSummary');
    var actionsEl = document.getElementById('coffeeOwnerActions');
    if (!listEl) return;
    if (dateEl) dateEl.textContent = getTodayStr();

    // 정산되지 않은 주문만 표시
    var active = coffeeOrdersToday.filter(function (o) { return !o.settled; });
    if (cntEl) cntEl.textContent = active.length + '건';

    if (!active.length) {
      listEl.innerHTML = '<div class="empty">아직 주문이 없습니다. 첫 주문을 등록해주세요 ☕</div>';
      if (summaryEl) summaryEl.innerHTML = '';
      if (actionsEl) actionsEl.innerHTML = '';
      return;
    }

    // 카페별 그룹핑
    var grouped = {};
    SHOPS.forEach(function (s) { grouped[s.id] = []; });
    active.forEach(function (o) {
      if (grouped[o.shopId]) grouped[o.shopId].push(o);
    });

    var html = '';
    SHOPS.forEach(function (shop) {
      var orders = grouped[shop.id] || [];
      if (!orders.length) return;
      orders.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
      html += '<div class="shop-group">';
      html += '<div class="shop-header" style="background:' + shop.bg + ';color:' + shop.color + ';">' +
        '<span>' + shop.emoji + ' ' + escHtml(shop.name) + '</span>' +
        '<span class="count">' + orders.length + '잔</span></div>';
      html += '<div class="shop-body">';
      orders.forEach(function (o) {
        var canEdit = (o.userUid === getCurrentAuthUid()) || isOwner();
        var btn = canEdit ?
          '<button class="order-icon-btn danger" type="button" data-del="' + escHtml(o.id) + '" title="삭제">🗑</button>' : '';
        html += '<div class="order-row">' +
          '<span class="order-user">' + escHtml(o.userName) + '</span>' +
          '<span class="order-menu">' + escHtml(o.menu) +
            (o.note ? ' <span class="note">· ' + escHtml(o.note) + '</span>' : '') + '</span>' +
          '<span class="order-actions">' + btn + '</span></div>';
      });
      html += '</div></div>';
    });
    listEl.innerHTML = html;

    // 삭제 버튼 이벤트
    listEl.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var o = active.find(function (x) { return x.id === id; });
        if (!o) return;
        if (o.userUid === getCurrentAuthUid()) {
          deleteMyOrder();
        } else {
          deleteOtherOrder(id);
        }
      });
    });

    // 약국장 요약 + 정산 버튼
    if (isOwner()) {
      var byShop = {};
      SHOPS.forEach(function (s) { byShop[s.id] = grouped[s.id].length; });
      var shopSummary = SHOPS.filter(function (s) { return byShop[s.id] > 0; })
        .map(function (s) { return s.emoji + ' ' + s.name + ' <b>' + byShop[s.id] + '잔</b>'; })
        .join(' · ');
      if (summaryEl) {
        summaryEl.innerHTML = '<div class="summary-bar">' +
          '<span>' + shopSummary + '</span>' +
          '<span class="total">총 ' + active.length + '잔</span>' +
          '</div>';
      }
      if (actionsEl) {
        actionsEl.innerHTML = '<div class="owner-actions">' +
          '<button class="owner-btn primary" type="button" id="coffeeSettleBtn">💳 결제완료 → 정산</button>' +
          '</div>';
        document.getElementById('coffeeSettleBtn').addEventListener('click', settleToday);
      }
    } else {
      if (summaryEl) summaryEl.innerHTML = '';
      if (actionsEl) actionsEl.innerHTML = '';
    }
  }

  /* ──────── 통계 렌더 ──────── */
  function renderStats() {
    var host = document.getElementById('coffeeStats');
    if (!host) return;
    // 모든 날짜 합산
    var totalCount = 0;
    var byShop = { paik: 0, comfort: 0, mega: 0 };
    var byMenu = {};
    var byUser = {};
    var byDate = new Set();
    Object.entries(coffeeOrdersAllDates).forEach(function (kv) {
      var orders = kv[1];
      orders.forEach(function (o) {
        totalCount++;
        byDate.add(kv[0]);
        if (byShop[o.shopId] !== undefined) byShop[o.shopId]++;
        var m = o.menu || '';
        byMenu[m] = (byMenu[m] || 0) + 1;
        var u = o.userName || '';
        byUser[u] = (byUser[u] || 0) + 1;
      });
    });
    var topShop = Object.entries(byShop).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topMenu = Object.entries(byMenu).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topUser = Object.entries(byUser).sort(function (a, b) { return b[1] - a[1]; })[0];
    var topShopMeta = topShop && SHOPS.find(function (s) { return s.id === topShop[0]; });

    host.innerHTML = [
      '<div class="stat-card"><div class="stat-label">누적 주문</div><div class="stat-value">' + totalCount + '잔</div><div class="stat-sub">' + byDate.size + '일 기록</div></div>',
      '<div class="stat-card"><div class="stat-label">최애 카페</div><div class="stat-value">' + (topShopMeta ? topShopMeta.emoji + ' ' + topShopMeta.name : '-') + '</div><div class="stat-sub">' + (topShop ? topShop[1] + '잔' : '-') + '</div></div>',
      '<div class="stat-card"><div class="stat-label">베스트 메뉴</div><div class="stat-value" style="font-size:14px;">' + (topMenu ? escHtml(topMenu[0]) : '-') + '</div><div class="stat-sub">' + (topMenu ? topMenu[1] + '회' : '-') + '</div></div>',
      '<div class="stat-card"><div class="stat-label">최다 주문자</div><div class="stat-value" style="font-size:15px;">' + (topUser ? escHtml(topUser[0]) : '-') + '</div><div class="stat-sub">' + (topUser ? topUser[1] + '잔' : '-') + '</div></div>'
    ].join('');
  }

  /* ──────── 지난 기록 렌더 ──────── */
  function renderHistory() {
    var host = document.getElementById('coffeeHistory');
    if (!host) return;
    var today = getTodayStr();
    var dates = Object.keys(coffeeOrdersAllDates).filter(function (d) { return d !== today; }).sort().reverse();
    if (!dates.length) {
      host.innerHTML = '<div class="empty">아직 기록이 없습니다.</div>';
      return;
    }
    host.innerHTML = dates.slice(0, 30).map(function (d) {
      var orders = coffeeOrdersAllDates[d] || [];
      var bs = { paik: 0, comfort: 0, mega: 0 };
      orders.forEach(function (o) { if (bs[o.shopId] !== undefined) bs[o.shopId]++; });
      var dayParts = SHOPS.filter(function (s) { return bs[s.id] > 0; })
        .map(function (s) { return s.emoji + s.name + ' ' + bs[s.id]; }).join(' · ');
      var users = Array.from(new Set(orders.map(function (o) { return o.userName; }))).join(', ');
      var detail = orders.map(function (o) {
        var sh = SHOPS.find(function (s) { return s.id === o.shopId; });
        return '• ' + escHtml(o.userName) + ': ' + (sh ? sh.emoji : '') + ' ' + escHtml(o.menu) + (o.note ? ' (' + escHtml(o.note) + ')' : '');
      }).join('<br>');
      return '<div class="history-day">' +
        '<div class="history-day-head" data-date="' + d + '">' +
          '<span>📅 ' + d + ' · ' + orders.length + '잔</span>' +
          '<span style="color:#94a3b8;font-weight:500;font-size:11px;">' + escHtml(dayParts) + ' ▼</span>' +
        '</div>' +
        '<div class="history-day-body">' + detail + '</div>' +
        '</div>';
    }).join('');
    host.querySelectorAll('.history-day-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var body = h.nextElementSibling;
        if (body) body.classList.toggle('open');
      });
    });
  }

  /* ──────── 메인 렌더 ──────── */
  function renderAll() {
    ensurePanel();
    renderShopTabs();
    renderSuggestions();
    renderMyOrderStatus();
    renderOrderList();
    renderStats();
    renderHistory();
  }

  /* ──────── Firebase 리스너 ──────── */
  function setupListener() {
    var fbDbRef = getFbDb();
    if (!fbDbRef) return false;
    // 오늘 날짜 실시간
    var today = getTodayStr();
    if (fbCoffeeRefToday) { try { fbCoffeeRefToday.off(); } catch (e) {} }
    fbCoffeeRefToday = fbDbRef.ref('coffeeOrders/' + today);
    fbCoffeeRefToday.on('value', function (snap) {
      var val = snap.val() || {};
      coffeeOrdersToday = Object.entries(val).map(function (kv) {
        return Object.assign({ id: kv[0] }, kv[1] || {});
      });
      coffeeOrdersAllDates[today] = coffeeOrdersToday;
      renderAll();
    }, function (err) {
      console.warn('[커피] 오늘 주문 읽기 실패:', err && err.message);
    });
    // 전체 날짜 (통계 + 기록용)
    fbDbRef.ref('coffeeOrders').once('value').then(function (snap) {
      var val = snap.val() || {};
      Object.entries(val).forEach(function (kv) {
        var d = kv[0];
        var dayVal = kv[1] || {};
        coffeeOrdersAllDates[d] = Object.entries(dayVal).map(function (oKv) {
          return Object.assign({ id: oKv[0] }, oKv[1] || {});
        });
      });
      renderAll();
    }).catch(function (err) {
      console.warn('[커피] 전체 기록 읽기 실패:', err && err.message);
    });
    return true;
  }

  /* ──────── 입력 이벤트 ──────── */
  function bindEvents() {
    var saveBtn = document.getElementById('coffeeSaveBtn');
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.addEventListener('click', saveMyOrder);
      saveBtn.dataset.bound = '1';
    }
    var input = document.getElementById('coffeeMenuInput');
    if (input && !input.dataset.bound) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveMyOrder(); }
      });
      input.dataset.bound = '1';
    }
  }

  /* ──────── 글로벌 노출 ──────── */
  window.CoffeeOrders = {
    init: function () {
      injectStyle();
      ensurePanel();
      renderAll();
      bindEvents();
      setupListener();
    },
    render: renderAll,
    reattach: function () {
      setupListener();
    }
  };

  /* ──────── 자동 초기화 ──────── */
  function autoInit() {
    injectStyle();
    ensurePanel();
    bindEvents();
    // 로그인되면 Firebase 리스너 연결, 안되면 재시도
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

  console.log('✓ 커피주문 모듈 로드됨 (coffee.js)');
})();
