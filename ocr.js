/* ============================================================
 * 대령약국 손글씨 OCR 모듈 (Naver CLOVA OCR)
 *
 * - 설정에서 약국장이 API 키 등록 (Firebase /ocrConfig)
 * - 사진 → CLOVA OCR → 텍스트 추출
 * - 추출된 텍스트를 조제내역(a) 리스트와 fuzzy 매칭 → 정확도 보정
 *
 * 의존: fbDb, currentUser, currentAuthUid, PriceMatcher(선택)
 * 작성: 2026-05-22
 * ============================================================ */
(function () {
  'use strict';

  var OWNER_UID = 'bhgORSzZ23dlNUfZmDPBe3IsnPN2';

  /* ──────── 전역 헬퍼 ──────── */
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
  function isOwner() { return getCurrentAuthUid() === OWNER_UID; }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normName(s) {
    try { if (typeof normalizeMedName === 'function') return normalizeMedName(s); } catch (e) {}
    return String(s || '').toLowerCase().replace(/[\s\(\)\*×x·\-_\/\.%,]/g, '');
  }

  /* ──────── 설정 (Firebase /ocrConfig) ──────── */
  var ocrConfig = { invokeUrl: '', secretKey: '', enabled: false };
  var configLoaded = false;
  var configListenerAttached = false;

  function loadConfigFromLS() {
    try {
      var raw = localStorage.getItem('dr_pharm_ocr_config');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') ocrConfig = Object.assign(ocrConfig, p);
      }
    } catch (e) {}
  }
  function saveConfigToLS() {
    try { localStorage.setItem('dr_pharm_ocr_config', JSON.stringify(ocrConfig)); } catch (e) {}
  }

  function attachConfigListener() {
    var db = getFbDb();
    if (!db || configListenerAttached) return !!db;
    try {
      db.ref('ocrConfig').on('value', function (snap) {
        var v = snap.val();
        if (v && typeof v === 'object') {
          ocrConfig = {
            invokeUrl: String(v.invokeUrl || ''),
            secretKey: String(v.secretKey || ''),
            enabled: !!v.enabled
          };
          saveConfigToLS();
        }
        configLoaded = true;
        configListenerAttached = true;
        renderSettingsCard();
      }, function (err) {
        console.warn('[OCR] 설정 읽기 실패:', err && err.message);
        configLoaded = true;
      });
      configListenerAttached = true;
      return true;
    } catch (e) { return false; }
  }

  function saveConfig(invokeUrl, secretKey, enabled) {
    if (!isOwner()) return Promise.reject(new Error('약국장만 설정 가능'));
    var db = getFbDb();
    var payload = {
      invokeUrl: String(invokeUrl || '').trim(),
      secretKey: String(secretKey || '').trim(),
      enabled: !!enabled,
      updatedAt: Date.now(),
      updatedBy: getCurrentUser()
    };
    if (!db) {
      ocrConfig = payload; saveConfigToLS();
      return Promise.resolve();
    }
    return db.ref('ocrConfig').set(payload).then(function () {
      ocrConfig = payload; saveConfigToLS();
    });
  }

  function isReady() {
    return !!(ocrConfig.enabled && ocrConfig.invokeUrl && ocrConfig.secretKey);
  }

  /* ──────── CLOVA OCR 호출 ──────── */
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        var idx = s.indexOf(',');
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // 이미지 리사이즈 (전송량 절감 + 인식률 향상)
  function resizeImage(file, maxSide) {
    maxSide = maxSide || 1600;
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (Math.max(w, h) <= maxSide) { URL.revokeObjectURL(url); resolve(file); return; }
          var scale = maxSide / Math.max(w, h);
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            resolve(blob || file);
          }, 'image/jpeg', 0.88);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function extFromName(name) {
    var m = String(name || '').match(/\.(jpg|jpeg|png|bmp|tiff|pdf)$/i);
    return m ? m[1].toLowerCase() : 'jpg';
  }

  function recognize(file) {
    if (!isReady()) {
      return Promise.reject(new Error('OCR 설정이 없습니다. 설정 탭에서 약국장이 CLOVA OCR 키를 등록해주세요.'));
    }
    return resizeImage(file, 1600).then(function (resized) {
      return fileToBase64(resized).then(function (b64) {
        var body = {
          version: 'V2',
          requestId: 'dr-' + Date.now(),
          timestamp: Date.now(),
          lang: 'ko',
          images: [{
            format: extFromName(file.name),
            name: 'memo',
            data: b64
          }]
        };
        return fetch(ocrConfig.invokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-OCR-SECRET': ocrConfig.secretKey
          },
          body: JSON.stringify(body)
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error('OCR 응답 오류 (' + res.status + '): ' + t.slice(0, 200));
            });
          }
          return res.json();
        }).then(function (json) {
          return extractLines(json);
        });
      });
    });
  }

  // CLOVA 응답에서 라인 단위 텍스트 추출
  function extractLines(json) {
    var out = [];
    try {
      var images = json.images || [];
      images.forEach(function (img) {
        var fields = img.fields || [];
        var currentLine = [];
        fields.forEach(function (f) {
          var txt = String(f.inferText || '').trim();
          if (txt) currentLine.push(txt);
          // lineBreak == true 이면 줄 끝
          if (f.lineBreak) {
            if (currentLine.length) out.push(currentLine.join(' '));
            currentLine = [];
          }
        });
        if (currentLine.length) out.push(currentLine.join(' '));
      });
    } catch (e) { console.warn('[OCR] 파싱 실패:', e); }
    return out;
  }

  /* ──────── 후처리: 조제내역과 fuzzy 매칭 ──────── */
  // OCR 라인들을 후보 리스트(dispenseItems)와 대조하여 정확한 약품명으로 보정
  function matchLines(lines, candidates) {
    // candidates: [{name, qty}]
    var results = [];
    var used = {};
    (lines || []).forEach(function (rawLine) {
      var line = cleanLine(rawLine);
      if (!line || line.length < 2) return;
      var best = findBestCandidate(line, candidates);
      if (best && best.score >= 0.45 && !used[normName(best.item.name)]) {
        used[normName(best.item.name)] = true;
        results.push({
          raw: rawLine,
          matched: best.item.name,
          qty: best.item.qty,
          score: best.score,
          confidence: best.score >= 0.85 ? 'high' : (best.score >= 0.65 ? 'mid' : 'low')
        });
      } else {
        results.push({ raw: rawLine, matched: null, qty: 0, score: best ? best.score : 0, confidence: 'none' });
      }
    });
    return results;
  }

  // 노이즈 제거: 숫자만 있는 줄, 특수문자만, 너무 짧은 것
  function cleanLine(s) {
    var x = String(s || '').trim();
    // 앞뒤 불릿/번호 제거
    x = x.replace(/^[\-•·*○●▶▷>\d]+[.)\s]*/, '').trim();
    // 뒤쪽 수량 표기 제거 후보 (예: "라믹탈100 3통" → "라믹탈100")
    // 단, 약품명에 숫자가 있으므로 조심스럽게: 공백 뒤 [숫자+단위]만 제거
    x = x.replace(/\s+\d+\s*(통|개|정|캡슐|박스|병|팩|매|장|ea|EA)\s*$/i, '').trim();
    // 순수 숫자/기호만이면 버림
    if (!/[가-힣a-zA-Z]/.test(x)) return '';
    return x;
  }

  function findBestCandidate(line, candidates) {
    if (!candidates || !candidates.length) return null;
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c || !c.name) continue;
      var sc = similarity(line, c.name);
      if (!best || sc > best.score) best = { item: c, score: sc };
      if (best.score >= 0.98) break;
    }
    return best;
  }

  // 유사도: 정규화 완전일치 > 포함 > 트라이그램 > 편집거리
  function similarity(a, b) {
    var na = normName(a), nb = normName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1.0;
    // 포함 관계 (짧은 쪽이 3글자 이상)
    var shortLen = Math.min(na.length, nb.length);
    if (shortLen >= 3) {
      if (nb.indexOf(na) !== -1) return 0.92;   // OCR 결과가 DB명에 포함 (라믹탈100 ⊂ 라믹탈정100밀리그램)
      if (na.indexOf(nb) !== -1) return 0.88;
    }
    // PriceMatcher 있으면 재사용
    try {
      if (window.PriceMatcher && typeof window.PriceMatcher.jaccardSim === 'function') {
        var j = window.PriceMatcher.jaccardSim(na, nb);
        if (j >= 0.4) return Math.min(0.85, 0.35 + j * 0.65);
      }
    } catch (e) {}
    // 자체 트라이그램
    var tri = trigramSim(na, nb);
    if (tri >= 0.35) return Math.min(0.82, 0.3 + tri * 0.7);
    // 편집거리 (짧은 단어)
    if (shortLen >= 3 && Math.max(na.length, nb.length) <= 16) {
      var d = levenshtein(na, nb);
      var maxL = Math.max(na.length, nb.length);
      if (d <= 3 && (d / maxL) < 0.4) return Math.max(0, 1 - (d / maxL) * 1.5);
    }
    return 0;
  }

  function trigramSet(s) {
    var out = new Set();
    if (s.length < 3) { if (s) out.add(s); return out; }
    for (var i = 0; i <= s.length - 3; i++) out.add(s.substring(i, i + 3));
    return out;
  }
  function trigramSim(a, b) {
    var A = trigramSet(a), B = trigramSet(b);
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (x) { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    if (Math.abs(m - n) > 4) return Math.abs(m - n) + 99;
    var prev = new Array(n + 1), curr = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      for (var k = 1; k <= n; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
      }
      var t = prev; prev = curr; curr = t;
    }
    return prev[n];
  }

  /* ──────── 설정 카드 (설정 탭에 주입) ──────── */
  function renderSettingsCard() {
    var host = document.getElementById('ocrSettingsCard');
    if (!host) return;
    if (!isOwner()) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    var statusHtml = isReady()
      ? '<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">✓ 활성화됨</span>'
      : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">⚠ 미설정</span>';
    host.innerHTML =
      '<h3>🖋 손글씨 OCR 설정 (CLOVA) ' + statusHtml + '</h3>' +
      '<p style="font-size:11px;color:var(--text-muted,#8a9484);margin-bottom:10px;line-height:1.6;">' +
      '네이버 클라우드 플랫폼 → CLOVA OCR → General 도메인 생성 후 발급받은 정보를 입력하세요.<br>' +
      '<b>월 300건 무료</b> · 조제누락체크 탭에서 손글씨 메모 자동 인식에 사용됩니다.</p>' +
      '<label style="display:block;font-size:11.5px;font-weight:700;color:var(--text-soft,#4b5a44);margin-bottom:4px;">APIGW Invoke URL</label>' +
      '<input type="text" id="ocrInvokeUrl" class="emp-input" style="width:100%;font-size:12px;padding:8px 10px;margin-bottom:8px;" placeholder="https://xxxxx.apigw.ntruss.com/custom/v1/.../general" value="' + escHtml(ocrConfig.invokeUrl) + '">' +
      '<label style="display:block;font-size:11.5px;font-weight:700;color:var(--text-soft,#4b5a44);margin-bottom:4px;">Secret Key</label>' +
      '<input type="password" id="ocrSecretKey" class="emp-input" style="width:100%;font-size:12px;padding:8px 10px;margin-bottom:8px;" placeholder="••••••••••••" value="' + escHtml(ocrConfig.secretKey) + '">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:10px;cursor:pointer;">' +
      '<input type="checkbox" id="ocrEnabled" style="width:16px;height:16px;accent-color:var(--accent,#5a8a3a);"' + (ocrConfig.enabled ? ' checked' : '') + '> OCR 기능 사용</label>' +
      '<div style="display:flex;gap:6px;">' +
      '<button class="hist-btn" id="ocrSaveBtn">💾 저장</button>' +
      '<button class="hist-btn" id="ocrTestBtn">🧪 연결 테스트</button>' +
      '</div>' +
      '<div id="ocrTestResult" style="margin-top:8px;font-size:11.5px;"></div>';

    var saveBtn = document.getElementById('ocrSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var u = document.getElementById('ocrInvokeUrl').value;
      var k = document.getElementById('ocrSecretKey').value;
      var e = document.getElementById('ocrEnabled').checked;
      saveConfig(u, k, e).then(function () {
        alert('✅ OCR 설정 저장 완료');
        renderSettingsCard();
      }).catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/PERMISSION_DENIED/i.test(msg)) {
          alert('⛔ Firebase 규칙에 /ocrConfig 쓰기 권한이 없습니다.\n\n규칙 추가 필요:\n"ocrConfig": {\n  ".write": "auth != null && auth.uid === \'' + OWNER_UID + '\'"\n}');
        } else alert('저장 실패: ' + msg);
      });
    });
    var testBtn = document.getElementById('ocrTestBtn');
    if (testBtn) testBtn.addEventListener('click', function () {
      var res = document.getElementById('ocrTestResult');
      var u = (document.getElementById('ocrInvokeUrl').value || '').trim();
      var k = (document.getElementById('ocrSecretKey').value || '').trim();
      if (!u || !k) { res.innerHTML = '<span style="color:#991b1b;">URL과 Secret Key를 모두 입력하세요</span>'; return; }
      res.innerHTML = '<span style="color:#6b7280;">테스트 중...</span>';
      // 1x1 흰색 픽셀로 최소 요청
      var tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': k },
        body: JSON.stringify({
          version: 'V2', requestId: 'test-' + Date.now(), timestamp: Date.now(), lang: 'ko',
          images: [{ format: 'png', name: 'test', data: tinyPng }]
        })
      }).then(function (r) {
        if (r.ok) {
          res.innerHTML = '<span style="color:#166534;font-weight:700;">✅ 연결 성공! 저장 후 사용하세요.</span>';
        } else {
          return r.text().then(function (t) {
            res.innerHTML = '<span style="color:#991b1b;">❌ 오류 ' + r.status + ': ' + escHtml(t.slice(0, 150)) + '</span>';
          });
        }
      }).catch(function (err) {
        res.innerHTML = '<span style="color:#991b1b;">❌ 연결 실패: ' + escHtml(String(err.message || err).slice(0, 150)) +
          '<br><small>CORS 오류일 수 있습니다. 네이버 클라우드 콘솔에서 도메인 허용 설정을 확인하세요.</small></span>';
      });
    });
  }

  /* ──────── 초기화 ──────── */
  function init() {
    loadConfigFromLS();
    var tries = 0;
    var attach = function () {
      if (attachConfigListener()) return;
      tries++;
      if (tries < 30) setTimeout(attach, 500);
    };
    attach();
  }

  /* ──────── 글로벌 노출 ──────── */
  window.HandwritingOCR = {
    recognize: recognize,
    matchLines: matchLines,
    similarity: similarity,
    isReady: isReady,
    getConfig: function () { return Object.assign({}, ocrConfig); },
    saveConfig: saveConfig,
    renderSettingsCard: renderSettingsCard,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✓ 손글씨 OCR 모듈 로드됨 (ocr.js)');
})();
