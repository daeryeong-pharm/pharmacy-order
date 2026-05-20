/* ============================================================
 * 대령약국 단가 매칭 추론 시스템 (외부 모듈)
 * Phase 2: 알고리즘 강화 (트라이그램·편집거리·토큰·베이스용량)
 * Phase 3: 신뢰도 점수 + 후보 랭킹
 * Phase 4: UI 색상 구분 (정확/유사/추론/미등록)
 * Phase 5: 학습 시스템 (Firebase /medAliases)
 * Phase 6: 영문↔한글 약품명 매핑
 *
 * 의존: window.medPrices, window.fbDb, window.currentUser, window.safeLS
 *       window.normalizeForPriceMatch (기존 함수 - 호환)
 *       window.renderAll (alias 변경시 화면 갱신)
 * 작성: 2026-05-08
 * ============================================================ */
(function () {
  'use strict';

  /* ──────── Phase 6: 영문↔한글 매핑 시드 (성분명·브랜드) ──────── */
  const EN_TO_KO = {
    // 진통/소염제
    'acetaminophen': '아세트아미노펜', 'paracetamol': '아세트아미노펜',
    'ibuprofen': '이부프로펜', 'naproxen': '나프록센',
    'celecoxib': '셀레콕시브', 'meloxicam': '멜록시캄',
    'aspirin': '아스피린', 'tramadol': '트라마돌',
    // 항생제
    'amoxicillin': '아목시실린', 'cephalexin': '세팔렉신',
    'cefuroxime': '세푸록심', 'cefdinir': '세프디니르',
    'azithromycin': '아지스로마이신', 'clarithromycin': '클래리스로마이신',
    'levofloxacin': '레보플록사신', 'ciprofloxacin': '시프로플록사신',
    'metronidazole': '메트로니다졸',
    // 위장약
    'omeprazole': '오메프라졸', 'esomeprazole': '에소메프라졸',
    'rabeprazole': '라베프라졸', 'lansoprazole': '란소프라졸',
    'pantoprazole': '판토프라졸', 'famotidine': '파모티딘',
    'ranitidine': '라니티딘', 'mosapride': '모사프리드',
    'itopride': '이토프리드', 'domperidone': '돔페리돈',
    // 고혈압
    'amlodipine': '암로디핀', 'nifedipine': '니페디핀',
    'losartan': '로사르탄', 'valsartan': '발사르탄',
    'telmisartan': '텔미사르탄', 'candesartan': '칸데사르탄',
    'olmesartan': '올메사르탄', 'irbesartan': '이르베사르탄',
    'enalapril': '에날라프릴', 'lisinopril': '리시노프릴',
    'ramipril': '라미프릴', 'perindopril': '페린도프릴',
    'bisoprolol': '비소프롤롤', 'atenolol': '아테놀롤',
    'carvedilol': '카르베디롤', 'propranolol': '프로프라놀롤',
    'hydrochlorothiazide': '히드로클로로티아지드', 'hctz': '히드로클로로티아지드',
    'furosemide': '푸로세미드', 'spironolactone': '스피로놀락톤',
    'doxazosin': '독사조신', 'terazosin': '테라조신',
    // 고지혈증
    'atorvastatin': '아토르바스타틴', 'rosuvastatin': '로수바스타틴',
    'simvastatin': '심바스타틴', 'pravastatin': '프라바스타틴',
    'pitavastatin': '피타바스타틴', 'fenofibrate': '페노피브레이트',
    'ezetimibe': '에제티미브',
    // 당뇨
    'metformin': '메트포민', 'glimepiride': '글리메피리드',
    'gliclazide': '글리클라지드', 'sitagliptin': '시타글립틴',
    'vildagliptin': '빌다글립틴', 'linagliptin': '리나글립틴',
    'empagliflozin': '엠파글리플로진', 'dapagliflozin': '다파글리플로진',
    'pioglitazone': '피오글리타존',
    // 신경/정신
    'lamotrigine': '라모트리진', 'levetiracetam': '레베티라세탐',
    'carbamazepine': '카르바마제핀', 'gabapentin': '가바펜틴',
    'pregabalin': '프레가발린', 'topiramate': '토피라메이트',
    'valproate': '발프로에이트', 'sertraline': '서트랄린',
    'escitalopram': '에스시탈로프람', 'paroxetine': '파록세틴',
    'fluoxetine': '플루옥세틴', 'venlafaxine': '벤라팍신',
    'duloxetine': '둘록세틴', 'mirtazapine': '미르타자핀',
    'alprazolam': '알프라졸람', 'lorazepam': '로라제팜',
    'diazepam': '디아제팜', 'zolpidem': '졸피뎀',
    // 항히스타민/감기
    'cetirizine': '세티리진', 'levocetirizine': '레보세티리진',
    'loratadine': '로라타딘', 'desloratadine': '데스로라타딘',
    'fexofenadine': '펙소페나딘', 'ebastine': '에바스틴',
    'bepotastine': '베포타스틴',
    // 항혈전
    'warfarin': '와파린', 'clopidogrel': '클로피도그렐',
    'rivaroxaban': '리바록사반', 'apixaban': '아픽사반',
    'dabigatran': '다비가트란', 'edoxaban': '에독사반',
    // 비뇨/전립선
    'tamsulosin': '탐수로신', 'silodosin': '실로도신',
    'finasteride': '피나스테리드', 'dutasteride': '두타스테리드',
    'tadalafil': '타다라필', 'sildenafil': '실데나필',
    // 기타
    'levothyroxine': '레보티록신', 'methimazole': '메티마졸',
    'allopurinol': '알로푸리놀', 'febuxostat': '페북소스타트',
    'colchicine': '콜키신',
    'donepezil': '도네페질', 'memantine': '메만틴',
    'digoxin': '디곡신',
    // 흡입제/천식
    'salbutamol': '살부타몰', 'albuterol': '살부타몰',
    'formoterol': '포르모테롤', 'budesonide': '부데소니드',
    'fluticasone': '플루티카손', 'montelukast': '몬테루카스트',
  };
  const KO_TO_EN = {};
  Object.entries(EN_TO_KO).forEach(function (kv) {
    if (!KO_TO_EN[kv[1]]) KO_TO_EN[kv[1]] = kv[0];
  });

  /* ──────── 단일 영문자 ↔ 한글 발음 (F↔에프, T↔티 등) ──────── */
  const EN_LETTER_KO = {
    'a':'에이','b':'비','c':'씨','d':'디','e':'이','f':'에프','g':'지',
    'h':'에이치','i':'아이','j':'제이','k':'케이','l':'엘','m':'엠','n':'엔',
    'o':'오','p':'피','q':'큐','r':'알','s':'에스','t':'티','u':'유',
    'v':'브이','w':'더블유','x':'엑스','y':'와이','z':'제트'
  };
  const KO_LETTER_EN = {};
  Object.keys(EN_LETTER_KO).forEach(function (k) {
    KO_LETTER_EN[EN_LETTER_KO[k]] = k;
  });

  // 한글 옆 영문 1글자를 한글 발음으로 (예: "유니버거F" → "유니버거에프")
  // 그 반대도 (예: "유니버거에프" → "유니버거F")
  function expandLetters(s) {
    var str = String(s || '');
    var variants = [];

    // 영문 → 한글 발음 (한글에 인접한 영문 1글자만 변환)
    var koSide = str.replace(/([가-힣])([a-zA-Z])(?![a-zA-Z])/g, function (m, kor, en) {
      var ko = EN_LETTER_KO[en.toLowerCase()];
      return ko ? kor + ko : m;
    });
    koSide = koSide.replace(/(?<![a-zA-Z])([a-zA-Z])([가-힣])/g, function (m, en, kor) {
      var ko = EN_LETTER_KO[en.toLowerCase()];
      return ko ? ko + kor : m;
    });
    if (koSide !== str) variants.push(koSide);

    // 한글 발음 → 영문 (긴 발음부터 매칭: '에이치' → 'h' 등)
    var enSide = str;
    var sortedKoLetters = Object.keys(KO_LETTER_EN).sort(function (a, b) { return b.length - a.length; });
    sortedKoLetters.forEach(function (ko) {
      // 한글 옆에 붙은 발음만 치환 (단어 중간의 정상 한글 보호 안 함 - 약품명에서는 안전)
      enSide = enSide.split(ko).join(KO_LETTER_EN[ko].toUpperCase());
    });
    if (enSide !== str && variants.indexOf(enSide) === -1) variants.push(enSide);

    return variants;
  }

  /* ──────── 정규화 함수 ──────── */
  function basicNorm(s) {
    return String(s || '').toLowerCase().replace(/[\s\(\)\[\]\{\}\*×x·\-_\/\.%,]/g, '');
  }
  function stripNorm(s) {
    if (typeof window.normalizeForPriceMatch === 'function') {
      return window.normalizeForPriceMatch(s);
    }
    if (typeof normalizeForPriceMatch === 'function') {
      try { return normalizeForPriceMatch(s); } catch (e) {}
    }
    return basicNorm(s);
  }

  /* ──────── 전역 변수 안전 접근 (let 변수는 window.X 로 못 가져옴) ──────── */
  function getMedPrices() {
    try { if (typeof medPrices !== 'undefined' && medPrices) return medPrices; } catch (e) {}
    if (window.medPrices) return window.medPrices;
    return { items: [] };
  }
  function getMedPriceItems() {
    var mp = getMedPrices();
    if (!mp || !Array.isArray(mp.items)) return [];
    return mp.items;
  }
  // 기존 index.html 의 빠른 인덱스 (O(1) 조회) 접근
  function getStripIndex() {
    try { if (typeof medPricesIndexStrip !== 'undefined' && medPricesIndexStrip) return medPricesIndexStrip; } catch (e) {}
    return null;
  }
  function getNormIndex() {
    try { if (typeof medPricesIndexNorm !== 'undefined' && medPricesIndexNorm) return medPricesIndexNorm; } catch (e) {}
    return null;
  }
  function getFbDb() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) {}
    if (window.fbDb) return window.fbDb;
    return null;
  }
  function getCurrentUser() {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (e) {}
    if (window.currentUser) return window.currentUser;
    return '';
  }
  function getSafeLS() {
    try { if (typeof safeLS !== 'undefined' && safeLS) return safeLS; } catch (e) {}
    if (window.safeLS) return window.safeLS;
    return localStorage;
  }
  function expandWithEnKo(s) {
    var variants = [s];
    var low = String(s || '').toLowerCase();
    // 풀네임 약품 매핑 (acetaminophen ↔ 아세트아미노펜)
    Object.entries(EN_TO_KO).forEach(function (kv) {
      if (low.indexOf(kv[0]) !== -1) {
        variants.push(low.replace(new RegExp(kv[0], 'gi'), kv[1]));
      }
    });
    Object.entries(KO_TO_EN).forEach(function (kv) {
      if (String(s).indexOf(kv[0]) !== -1) {
        variants.push(String(s).replace(kv[0], kv[1]));
      }
    });
    // 단일 영문자 매핑 (F ↔ 에프, T ↔ 티 등)
    var letterVariants = expandLetters(s);
    for (var i = 0; i < letterVariants.length; i++) {
      variants.push(letterVariants[i]);
    }
    return Array.from(new Set(variants));
  }

  /* ──────── 트라이그램 ──────── */
  function trigrams(s) {
    var t = basicNorm(s);
    var out = new Set();
    if (t.length < 3) { if (t) out.add(t); return out; }
    for (var i = 0; i <= t.length - 3; i++) out.add(t.substring(i, i + 3));
    return out;
  }
  function jaccardSim(a, b) {
    var A = trigrams(a), B = trigrams(b);
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (x) { if (B.has(x)) inter++; });
    var union = A.size + B.size - inter;
    return union > 0 ? inter / union : 0;
  }

  /* ──────── 편집 거리 (Levenshtein) ──────── */
  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    // 빠른 컷오프: 길이 차이가 크면 정확한 거리 계산 불필요
    if (Math.abs(m - n) > 3) return Math.abs(m - n) + 99;
    var prev = new Array(n + 1);
    var curr = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      for (var jj = 1; jj <= n; jj++) {
        var cost = a[i - 1] === b[jj - 1] ? 0 : 1;
        curr[jj] = Math.min(prev[jj] + 1, curr[jj - 1] + 1, prev[jj - 1] + cost);
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[n];
  }

  /* ──────── 토큰 ──────── */
  function tokenize(s) {
    return String(s || '').toLowerCase()
      .split(/[\s\-_\/\(\)\[\]\{\}\*×x·\.%,]+/)
      .filter(function (t) { return t.length >= 2; });
  }
  function tokenSim(a, b) {
    var A = new Set(tokenize(a)), B = new Set(tokenize(b));
    if (!A.size || !B.size) return 0;
    var inter = 0;
    A.forEach(function (x) { if (B.has(x)) inter++; });
    return inter / Math.max(A.size, B.size);
  }

  /* ──────── 베이스+용량 분리 ──────── */
  function splitBaseDose(s) {
    var n = stripNorm(s);
    var m = n.match(/^([가-힣a-zA-Z]+)([0-9].*)$/);
    if (m) return { base: m[1], dose: m[2], full: n };
    return null;
  }

  /* ──────── Phase 5: 별칭 시스템 ──────── */
  var aliasMap = {};       // encodedKey → { itemId, itemName, savedAt, savedBy }
  var aliasLoaded = false;
  var aliasInterval = null;

  function encodeFbKey(s) {
    return String(s).replace(/[.#$\[\]\/]/g, '_');
  }
  function aliasKey(s) { return encodeFbKey(basicNorm(s)); }

  function loadAliasesFromLS() {
    try {
      var ls = getSafeLS();
      var raw = ls.getItem('dr_pharm_med_aliases');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') aliasMap = parsed;
      }
    } catch (e) {}
  }
  function saveAliasesToLS() {
    try {
      var ls = getSafeLS();
      ls.setItem('dr_pharm_med_aliases', JSON.stringify(aliasMap));
    } catch (e) {}
  }

  // renderAll 디바운스 (별칭 여러 개 동시 변경시 한 번만 렌더)
  var renderAllTimer = null;
  function scheduleRenderAll() {
    if (typeof findBestCache !== 'undefined') findBestCache.clear();  // 캐시 무효화
    if (renderAllTimer) clearTimeout(renderAllTimer);
    renderAllTimer = setTimeout(function () {
      renderAllTimer = null;
      try {
        if (typeof window.renderAll === 'function') window.renderAll();
      } catch (e) { console.warn('[단가추론] renderAll 호출 실패:', e); }
    }, 200);
  }

  function attachFbAliasListener() {
    var fbDbRef = getFbDb();
    if (!fbDbRef) return false;
    try {
      fbDbRef.ref('medAliases').on('value', function (snap) {
        var val = snap.val();
        if (val && typeof val === 'object') {
          aliasMap = val;
          saveAliasesToLS();
        }
        aliasLoaded = true;
        // 별칭 변경시 캐시 무효화 + 디바운스된 화면 갱신
        scheduleRenderAll();
      }, function (err) {
        console.warn('[단가추론] /medAliases 읽기 실패:', err && err.message);
        aliasLoaded = true;
      });
      return true;
    } catch (e) {
      console.warn('[단가추론] FB 별칭 리스너 부착 실패:', e);
      return false;
    }
  }

  function loadAliases() {
    loadAliasesFromLS();
    if (attachFbAliasListener()) return;
    // fbDb 늦게 준비될 수 있어 재시도
    if (aliasInterval) return;
    var tries = 0;
    aliasInterval = setInterval(function () {
      tries++;
      if (attachFbAliasListener()) { clearInterval(aliasInterval); aliasInterval = null; }
      else if (tries > 30) { clearInterval(aliasInterval); aliasInterval = null; aliasLoaded = true; }
    }, 500);
  }

  // 단가표 항목은 id 필드가 없어서 name 을 식별자로 사용
  function priceItemKey(p) {
    if (!p) return '';
    return p.id || p.name || '';
  }

  function lookupAlias(orderName) {
    var k = aliasKey(orderName);
    var entry = aliasMap[k];
    if (!entry) return null;
    var items = getMedPriceItems();
    // itemId 우선, 없으면 itemName 으로 찾기
    if (entry.itemId) {
      var byId = items.find(function (p) { return p && p.id === entry.itemId; });
      if (byId) return byId;
    }
    if (entry.itemName) {
      var byName = items.find(function (p) { return p && p.name === entry.itemName; });
      if (byName) return byName;
    }
    return null;
  }

  function saveAlias(orderName, priceItem) {
    var k = aliasKey(orderName);
    if (!k || !priceItem || !priceItem.name) {
      return Promise.reject(new Error('invalid alias input'));
    }
    var payload = {
      itemId: priceItem.id || '',
      itemName: priceItem.name || '',
      origName: String(orderName || ''),
      savedAt: Date.now(),
      savedBy: getCurrentUser()
    };
    var fbDbRef = getFbDb();
    if (fbDbRef) {
      return fbDbRef.ref('medAliases/' + k).set(payload).then(function () {
        aliasMap[k] = payload;
        saveAliasesToLS();
      });
    } else {
      aliasMap[k] = payload;
      saveAliasesToLS();
      return Promise.resolve();
    }
  }

  function removeAlias(orderName) {
    var k = aliasKey(orderName);
    var fbDbRef = getFbDb();
    if (fbDbRef) {
      return fbDbRef.ref('medAliases/' + k).remove().then(function () {
        delete aliasMap[k]; saveAliasesToLS();
      });
    }
    delete aliasMap[k]; saveAliasesToLS();
    return Promise.resolve();
  }

  /* ──────── 점수화 매칭 (최적화: early-exit + 빠른 거부) ──────── */
  function scoreItem(orderName, item) {
    if (!orderName || !item || !item.name) return null;

    // 빠른 거부: 정규화 후 첫 2글자가 완전히 다르면 스킵
    var preDbKey = stripNorm(item.name);
    var preVKey = stripNorm(orderName);
    if (!preVKey || !preDbKey) return null;
    // 첫 글자도 안 겹치면 즉시 거부 (Korean 단어는 보통 시작이 같음)
    if (preVKey.length >= 2 && preDbKey.length >= 2) {
      var c1 = preVKey[0], c2 = preDbKey[0];
      // 둘 다 한글이고 다르면 거부 (다른 약품 가능성 매우 높음)
      var isHangul1 = c1 >= '가' && c1 <= '힣';
      var isHangul2 = c2 >= '가' && c2 <= '힣';
      if (isHangul1 && isHangul2 && c1 !== c2) {
        // 단, 영문 변형 가능성 있으면 통과
        var hasEnglish = /[a-zA-Z]/.test(orderName) || /[a-zA-Z]/.test(item.name);
        if (!hasEnglish) return null;
      }
    }

    var bestScore = 0;
    var bestSource = '';

    // variants: 영문이 포함될 때만 확장 (성능)
    var variants;
    if (/[a-zA-Z]/.test(orderName)) {
      variants = expandWithEnKo(orderName);
    } else {
      variants = [orderName];
    }

    for (var v = 0; v < variants.length; v++) {
      var variant = variants[v];
      var vKey = (v === 0) ? preVKey : stripNorm(variant);
      var dbKey = preDbKey;

      // 1) 정확 일치 - 즉시 종료
      if (vKey && vKey === dbKey) {
        return { item: item, confidence: 1.0, source: 'exact' };
      }
      // 2) Prefix 양방향
      if (vKey && dbKey && Math.min(vKey.length, dbKey.length) >= 3) {
        if (dbKey.startsWith(vKey) || vKey.startsWith(dbKey)) {
          if (0.93 > bestScore) { bestScore = 0.93; bestSource = 'prefix'; }
        }
      }
      // 3) 부분 포함
      if (vKey && dbKey && Math.min(vKey.length, dbKey.length) >= 4) {
        if (vKey.indexOf(dbKey) !== -1 || dbKey.indexOf(vKey) !== -1) {
          if (0.86 > bestScore) { bestScore = 0.86; bestSource = 'contains'; }
        }
      }
      // 4) 베이스+용량
      var vBD = splitBaseDose(variant);
      var dBD = splitBaseDose(item.name);
      if (vBD && dBD) {
        var baseOK = (vBD.base === dBD.base)
          || dBD.base.startsWith(vBD.base) || vBD.base.startsWith(dBD.base);
        var doseExact = (vBD.dose === dBD.dose)
          || dBD.dose.startsWith(vBD.dose) || vBD.dose.startsWith(dBD.dose);
        if (baseOK && doseExact) {
          if (0.9 > bestScore) { bestScore = 0.9; bestSource = 'baseDose'; }
        }
      }
      // 5~7) 비싼 알고리즘은 위 단계에서 충분한 점수 못 얻었을 때만
      if (bestScore < 0.85) {
        var vBasic = basicNorm(variant);
        var dbBasic = basicNorm(item.name);

        // 트라이그램
        var tri = jaccardSim(vBasic, dbBasic);
        if (tri >= 0.5) {
          var triScore = Math.min(0.82, 0.4 + tri * 0.6);
          if (triScore > bestScore) { bestScore = triScore; bestSource = 'trigram(' + tri.toFixed(2) + ')'; }
        }
        // 편집 거리
        if (vKey && dbKey) {
          var minLen = Math.min(vKey.length, dbKey.length);
          var maxLen = Math.max(vKey.length, dbKey.length);
          if (minLen >= 4 && maxLen <= 14 && Math.abs(maxLen - minLen) <= 2) {
            var dist = levenshtein(vKey, dbKey);
            if (dist <= 2 && (dist / maxLen) < 0.3) {
              var editScore = 1 - (dist / maxLen) * 1.6;
              if (editScore > bestScore && editScore > 0.5) {
                bestScore = Math.min(0.78, editScore);
                bestSource = 'edit(' + dist + ')';
              }
            }
          }
        }
        // 토큰
        var tok = tokenSim(variant, item.name);
        if (tok >= 0.5) {
          var tokScore = Math.min(0.75, tok * 0.95);
          if (tokScore > bestScore) { bestScore = tokScore; bestSource = 'token(' + tok.toFixed(2) + ')'; }
        }
      }
    }

    if (bestScore <= 0.3) return null;
    return { item: item, confidence: bestScore, source: bestSource };
  }

  function findCandidates(orderName, topN) {
    topN = topN || 5;
    var items = getMedPriceItems();
    if (!items.length || !orderName) return [];
    var scored = [];
    for (var i = 0; i < items.length; i++) {
      var s = scoreItem(orderName, items[i]);
      if (s) scored.push(s);
    }
    scored.sort(function (a, b) { return b.confidence - a.confidence; });
    return scored.slice(0, topN);
  }

  /* ──────── 캐시 (성능) ──────── */
  var findBestCache = new Map();
  var FIND_BEST_CACHE_MAX = 2000; // 메모리 제한
  var lastMedPriceItemsCount = -1; // 단가 DB 크기 변경 감지
  function invalidateMatchCache() {
    findBestCache.clear();
  }
  // 외부 노출 - alias/medPrices 갱신시 호출
  window.__invalidatePriceMatchCache = invalidateMatchCache;

  function findBest(orderName) {
    if (!orderName) return null;
    var nameStr = String(orderName);

    // 단가 DB 크기가 변했으면 캐시 무효화 (medPrices 늦게 로드되는 케이스 대응)
    var items = getMedPriceItems();
    if (items.length !== lastMedPriceItemsCount) {
      findBestCache.clear();
      lastMedPriceItemsCount = items.length;
      // 일별 합계 캐시도 함께 무효화 (모든 항목 재계산 필요)
      if (typeof window.__invalidateDailyTotalCache === 'function') {
        try { window.__invalidateDailyTotalCache(); } catch (e) {}
      }
    }
    // DB 비어있으면 캐시하지 말고 즉시 null (다음 호출에서 재시도)
    if (items.length === 0) return null;

    // 캐시 히트 (성공 결과만 캐시되므로 안전)
    if (findBestCache.has(nameStr)) return findBestCache.get(nameStr);

    var result = null;

    // 1) 별칭 우선 (해시맵 O(1))
    var aliasItem = lookupAlias(nameStr);
    if (aliasItem) {
      result = { item: aliasItem, confidence: 0.99, source: 'alias' };
    }

    // 변형 생성 (영문/한글 매핑 - 영문자 있을 때만)
    var hasEnglish = /[a-zA-Z]/.test(nameStr);
    // 한글 발음(에프/티/씨 등)이 포함됐을 가능성도 체크
    var hasKoLetterPhonetic = /(에프|에이치|에이|에스|제이|제트|케이|더블유|엑스|와이|티|비|씨|디|이|지|아이|엘|엠|엔|오|피|큐|알|유|브이)/.test(nameStr);
    var variants = (hasEnglish || hasKoLetterPhonetic) ? expandWithEnKo(nameStr) : [nameStr];

    // 2) 빠른 인덱스 조회 (모든 변형 시도)
    if (!result) {
      var stripIdx = getStripIndex();
      if (stripIdx) {
        for (var vi = 0; vi < variants.length; vi++) {
          var key = stripNorm(variants[vi]);
          if (key && stripIdx[key]) {
            result = { item: stripIdx[key], confidence: 1.0, source: 'exact-fast' };
            break;
          }
        }
      }
    }
    if (!result) {
      var normIdx = getNormIndex();
      if (normIdx) {
        for (var vi2 = 0; vi2 < variants.length; vi2++) {
          var nKey = basicNorm(variants[vi2]);
          if (nKey && normIdx[nKey]) {
            result = { item: normIdx[nKey], confidence: 0.98, source: 'norm-fast' };
            break;
          }
        }
      }
    }

    // 3) Prefix 빠른 조회 (인덱스 키들 중 시작 매칭, 모든 변형 시도)
    if (!result) {
      var stripIdx2 = getStripIndex();
      if (stripIdx2) {
        var stripKeys = Object.keys(stripIdx2);
        outer: for (var vi3 = 0; vi3 < variants.length; vi3++) {
          var userKey = stripNorm(variants[vi3]);
          if (!userKey || userKey.length < 3) continue;
          for (var i = 0; i < stripKeys.length; i++) {
            var k = stripKeys[i];
            if (k && (k.startsWith(userKey) || userKey.startsWith(k)) && Math.min(k.length, userKey.length) >= 3) {
              result = { item: stripIdx2[k], confidence: 0.92, source: 'prefix-fast' };
              break outer;
            }
          }
        }
      }
    }

    // 4) 마지막 수단: 점수화 매칭 (느림 - 위에서 안 잡힌 경우만)
    if (!result) {
      var candidates = findCandidatesFast(nameStr, 1);
      if (candidates.length && candidates[0].confidence >= 0.5) {
        result = candidates[0];
      }
    }

    // 성공 결과만 캐시 (null 은 캐시 안 함 - 다음 호출에서 재시도 가능)
    if (result) {
      if (findBestCache.size >= FIND_BEST_CACHE_MAX) findBestCache.clear();
      findBestCache.set(nameStr, result);
    }
    return result;
  }

  // 정확/Prefix 매칭이 실패한 케이스만 호출되는 느린 fuzzy 매칭
  // 1위 1건만 빠르게 찾기 위한 단순화 버전
  function findCandidatesFast(orderName, topN) {
    topN = topN || 1;
    var items = getMedPriceItems();
    if (!items.length || !orderName) return [];
    var bestList = [];
    var threshold = 0.5;
    for (var i = 0; i < items.length; i++) {
      var s = scoreItem(orderName, items[i]);
      if (s && s.confidence >= threshold) {
        bestList.push(s);
        // 1.0 정확매칭 만나면 즉시 종료
        if (s.confidence >= 0.99) break;
      }
    }
    bestList.sort(function (a, b) { return b.confidence - a.confidence; });
    return bestList.slice(0, topN);
  }

  /* ──────── 기존 findPriceForOrder 오버라이드 (호환) ──────── */
  var originalFindPriceForOrder = window.findPriceForOrder;
  window.findPriceForOrder = function (orderItem) {
    if (!orderItem || !orderItem.name) return null;
    var r = findBest(orderItem.name);
    if (r) return r.item;
    // 신뢰도 부족 → 기존 로직 폴백 (이중 안전망)
    if (typeof originalFindPriceForOrder === 'function') {
      return originalFindPriceForOrder(orderItem);
    }
    return null;
  };

  /* ──────── Phase 4: UI 색상용 매치 정보 조회 ──────── */
  // 렌더링 단계에서 호출되어 신뢰도 클래스/이모지 결정
  function getMatchBadge(orderName) {
    var r = findBest(orderName);
    if (!r) return null;
    var conf = r.confidence;
    if (conf >= 0.95) {
      return { cls: 'match-exact', emoji: '', label: '정확', conf: conf, source: r.source };
    } else if (conf >= 0.7) {
      return { cls: 'match-similar', emoji: '🔵 ', label: '유사', conf: conf, source: r.source };
    } else if (conf >= 0.5) {
      return { cls: 'match-inferred', emoji: '⚠️ ', label: '추론', conf: conf, source: r.source };
    }
    return null;
  }

  /* ──────── Phase 4 + 5: 별칭 등록 모달 ──────── */
  function ensureAliasModal() {
    if (document.getElementById('aliasPickModal')) return;
    // 스타일
    if (!document.getElementById('alias-pick-style')) {
      var st = document.createElement('style');
      st.id = 'alias-pick-style';
      st.textContent = [
        '#aliasPickModal { display:none; position:fixed; inset:0; z-index:9600;',
        '  background: rgba(15,23,42,0.55); align-items:flex-start; justify-content:center;',
        '  padding:40px 12px; overflow-y:auto; -webkit-overflow-scrolling: touch; }',
        '#aliasPickModal.show { display:flex; }',
        '#aliasPickModal .ap-box { background:#fff; border-radius:14px; width:100%; max-width:600px;',
        '  padding:18px 18px 22px; box-shadow:0 20px 50px rgba(0,0,0,0.25); position:relative; }',
        '#aliasPickModal .ap-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }',
        '#aliasPickModal .ap-title { font-size:15px; font-weight:800; color:#0f172a; }',
        '#aliasPickModal .ap-close { width:36px; height:36px; border:1px solid #e2e8f0;',
        '  background:#f1f5f9; border-radius:8px; font-size:16px; cursor:pointer; }',
        '#aliasPickModal .ap-target { background:#fef3c7; border:1px solid #f59e0b; border-radius:10px;',
        '  padding:10px 12px; font-size:13px; color:#78350f; margin-bottom:14px; font-weight:700; }',
        '#aliasPickModal .ap-sub { font-size:11.5px; color:#64748b; margin-bottom:6px; font-weight:700;',
        '  text-transform: uppercase; letter-spacing:0.05em; }',
        '#aliasPickModal .ap-cand { display:grid; grid-template-columns: 1fr 60px 80px;',
        '  gap:8px; padding:10px 12px; border:1px solid #e2e8f0; border-radius:10px;',
        '  margin-bottom:6px; align-items:center; background:#fff; cursor:pointer; transition:all 0.15s; }',
        '#aliasPickModal .ap-cand:hover { background:#f0f9ff; border-color:#3b82f6; }',
        '#aliasPickModal .ap-cand-name { font-size:12.5px; font-weight:700; color:#0f172a; word-break:break-all; }',
        '#aliasPickModal .ap-cand-price { font-size:12px; color:#065f46; font-weight:700; text-align:right; }',
        '#aliasPickModal .ap-cand-conf { font-size:10.5px; padding:3px 8px; border-radius:999px;',
        '  text-align:center; font-weight:800; }',
        '#aliasPickModal .ap-cand-conf.high { background:#dcfce7; color:#166534; }',
        '#aliasPickModal .ap-cand-conf.mid { background:#dbeafe; color:#1e40af; }',
        '#aliasPickModal .ap-cand-conf.low { background:#fef3c7; color:#78350f; }',
        '#aliasPickModal .ap-empty { text-align:center; color:#94a3b8; padding:18px; font-size:13px; }',
        '#aliasPickModal .ap-search { width:100%; padding:10px 14px; border:1.5px solid #cbd5e1;',
        '  border-radius:10px; font-size:14px; margin-bottom:8px; box-sizing:border-box; }',
        '#aliasPickModal .ap-actions { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }',
        '#aliasPickModal .ap-btn { flex:1; padding:11px 14px; border-radius:10px; border:1px solid #e2e8f0;',
        '  background:#fff; color:#334155; font-weight:700; font-size:12.5px; cursor:pointer; min-height:42px; }',
        '#aliasPickModal .ap-btn.danger { background:#fef2f2; color:#991b1b; border-color:#fecaca; }',
        '#aliasPickModal .ap-btn.manual { background:#fffbeb; color:#78350f; border-color:#fcd34d; }',
        '#aliasPickModal .ap-btn:hover { background:#f8fafc; }',
        '#aliasPickModal .ap-btn.danger:hover { background:#fee2e2; }',
        '@media (max-width: 600px) {',
        '  #aliasPickModal .ap-box { padding:14px 12px; }',
        '  #aliasPickModal .ap-cand { grid-template-columns: 1fr 70px; }',
        '  #aliasPickModal .ap-cand-price { grid-column: 1 / -1; text-align:left; font-size:11.5px; }',
        '}'
      ].join('\n');
      document.head.appendChild(st);
    }
    // DOM
    var modal = document.createElement('div');
    modal.id = 'aliasPickModal';
    modal.innerHTML = [
      '<div class="ap-box">',
      '  <div class="ap-head">',
      '    <div class="ap-title">🔗 단가 매칭 학습</div>',
      '    <button class="ap-close" type="button" data-ap-close>✕</button>',
      '  </div>',
      '  <div class="ap-target" id="apTarget">대상 약품명 표시</div>',
      '  <input type="text" class="ap-search" id="apSearch" placeholder="🔍 약품명으로 검색 (직접 매핑)">',
      '  <div class="ap-sub">추천 후보 (유사도 순)</div>',
      '  <div id="apCandidates"></div>',
      '  <div class="ap-actions">',
      '    <button type="button" class="ap-btn manual" data-ap-manual>💰 직접 단가 입력</button>',
      '    <button type="button" class="ap-btn danger" data-ap-remove>🗑 별칭 삭제</button>',
      '    <button type="button" class="ap-btn" data-ap-close>닫기</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    document.body.appendChild(modal);

    // 닫기 (직접 리스너)
    modal.querySelectorAll('[data-ap-close]').forEach(function (b) {
      b.addEventListener('click', closeAliasModal);
      b.addEventListener('touchend', function (e) { e.preventDefault(); closeAliasModal(); }, { passive: false });
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeAliasModal(); });

    // 직접 단가 입력 (기존 모달로 이전)
    modal.querySelector('[data-ap-manual]').addEventListener('click', function () {
      var t = document.getElementById('apTarget');
      var name = t && t.dataset && t.dataset.name;
      closeAliasModal();
      if (typeof window.openMissingPriceModal === 'function') {
        window.openMissingPriceModal(name || '', t.dataset.spec || '', t.dataset.qty || '');
      }
    });
    // 별칭 삭제
    modal.querySelector('[data-ap-remove]').addEventListener('click', function () {
      var t = document.getElementById('apTarget');
      var name = t && t.dataset && t.dataset.name;
      if (!name) return;
      if (!confirm('이 약품명의 학습된 매핑을 삭제하시겠습니까?\n\n' + name)) return;
      removeAlias(name).then(function () {
        alert('✅ 별칭 삭제됨');
        closeAliasModal();
        if (typeof window.renderAll === 'function') window.renderAll();
      }).catch(function (err) {
        alert('삭제 실패: ' + (err && err.message ? err.message : err));
      });
    });

    // 검색 (수동 매핑)
    var searchInput = modal.querySelector('#apSearch');
    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = searchInput.value.trim();
        renderCandidates(q || (modal.querySelector('#apTarget').dataset.name || ''), q ? true : false);
      }, 150);
    });
  }

  function renderCandidates(name, isManualSearch) {
    var host = document.getElementById('apCandidates');
    if (!host) return;
    var allItems = getMedPriceItems();
    console.log('[단가추론] 단가 DB 총 항목 수:', allItems.length, '· 검색어:', name, '· 수동검색:', !!isManualSearch);
    if (!allItems.length) {
      host.innerHTML = '<div class="ap-empty" style="color:#991b1b;text-align:left;line-height:1.6;">⚠️ <b>단가 데이터가 로드되지 않았습니다</b><br><br>가능 원인:<br>① 단가 탭에서 xlsx 업로드 필요<br>② Firebase 연결 끊김 (오프라인)<br>③ 로그인 후 잠시 기다린 후 재시도<br><br>F12 콘솔 확인:<br><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">typeof medPrices</code> → 결과가 "undefined"면 미로드</div>';
      return;
    }
    var candidates;
    if (isManualSearch) {
      // 검색어로 모든 단가 항목 필터
      var q = String(name || '').toLowerCase();
      candidates = allItems
        .filter(function (it) { return it && it.name && it.name.toLowerCase().indexOf(q) !== -1; })
        .slice(0, 20)
        .map(function (it) { return { item: it, confidence: 0.99, source: 'manual' }; });
      console.log('[단가추론] 수동검색 결과:', candidates.length, '건');
    } else {
      candidates = findCandidates(name, 10);
      console.log('[단가추론] 자동추론 결과:', candidates.length, '건 (DB ' + allItems.length + '개 중)');
    }
    if (!candidates.length) {
      host.innerHTML = '<div class="ap-empty">매칭 후보가 없습니다.<br>총 ' + allItems.length + '개 단가 중 유사 약품 없음.<br><br>위 검색창에 약품명을 입력해 직접 검색하세요.</div>';
      return;
    }
    host.innerHTML = candidates.map(function (c, idx) {
      var conf = c.confidence;
      var confCls = conf >= 0.9 ? 'high' : (conf >= 0.7 ? 'mid' : 'low');
      var confPct = Math.round(conf * 100) + '%';
      var price = c.item.price != null
        ? '₩' + Number(c.item.price).toLocaleString()
        : '-';
      // id 가 없는 단가 항목 → 배열 인덱스를 임시 키로 사용 (HTML escape 불필요)
      var safeName = String(c.item.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      return '<div class="ap-cand" data-ap-pick-idx="' + idx + '">' +
        '<div class="ap-cand-name">' + safeName + '</div>' +
        '<div class="ap-cand-price">' + price + '</div>' +
        '<div class="ap-cand-conf ' + confCls + '">' + confPct + '</div>' +
        '</div>';
    }).join('');
    // 후보 배열을 클로저에 보관 (id 없는 항목 대비)
    var candidatesSnapshot = candidates.slice();
    // 클릭 핸들러 (위임)
    host.querySelectorAll('[data-ap-pick-idx]').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.getAttribute('data-ap-pick-idx'), 10);
        var pickedCand = candidatesSnapshot[idx];
        var picked = pickedCand && pickedCand.item;
        if (!picked || !picked.name) {
          console.error('[단가추론] 항목 매칭 실패 idx:', idx, 'snapshot:', candidatesSnapshot);
          alert('항목을 찾을 수 없습니다. 콘솔 확인 (F12)');
          return;
        }
        var t = document.getElementById('apTarget');
        var orderName = t && t.dataset && t.dataset.name;
        if (!orderName) { alert('대상 약품명 없음'); return; }
        saveAlias(orderName, picked).then(function () {
          alert('✅ 매핑 완료\n\n[' + orderName + '] → [' + picked.name + ']\n\n이후 같은 표기는 자동 매칭됩니다.');
          closeAliasModal();
          if (typeof window.renderAll === 'function') window.renderAll();
        }).catch(function (err) {
          var msg = err && err.message ? err.message : String(err);
          if (/PERMISSION_DENIED/i.test(msg)) {
            alert('⛔ Firebase 규칙에서 /medAliases 쓰기 차단\n\n규칙 추가 필요:\n\n"medAliases": {\n  ".read": "auth != null",\n  ".write": "auth != null"\n}');
          } else {
            alert('저장 실패: ' + msg);
          }
        });
      });
    });
  }

  function openAliasPickModal(orderName, spec, qty) {
    ensureAliasModal();
    var modal = document.getElementById('aliasPickModal');
    var t = document.getElementById('apTarget');
    t.textContent = '대상: ' + orderName + (spec ? ' · ' + spec : '') + (qty ? ' · ' + qty : '');
    t.dataset.name = orderName;
    t.dataset.spec = spec || '';
    t.dataset.qty = qty || '';
    var searchInput = document.getElementById('apSearch');
    if (searchInput) searchInput.value = '';
    renderCandidates(orderName, false);
    modal.classList.add('show');
  }
  function closeAliasModal() {
    var modal = document.getElementById('aliasPickModal');
    if (modal) modal.classList.remove('show');
  }

  /* ──────── 글로벌 노출 ──────── */
  window.PriceMatcher = {
    findBest: findBest,
    findCandidates: findCandidates,
    getMatchBadge: getMatchBadge,
    levenshtein: levenshtein,
    jaccardSim: jaccardSim,
    stripNorm: stripNorm,
    EN_TO_KO: EN_TO_KO,
  };
  window.PriceAliases = {
    load: loadAliases,
    save: saveAlias,
    remove: removeAlias,
    lookup: lookupAlias,
    getMap: function () { return aliasMap; },
    isLoaded: function () { return aliasLoaded; },
  };
  window.openAliasPickModal = openAliasPickModal;
  window.closeAliasPickModal = closeAliasModal;

  /* ──────── 자동 시작 ──────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAliases);
  } else {
    loadAliases();
  }

  console.log('✓ 단가 매칭 추론 모듈 로드됨 (pricematch.js) — Phase 2~6');
})();
