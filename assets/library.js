/* ===== 靈糧閱讀引擎（牧師的話 / 靈修筆記 共用） =====
 * 由各頁面在載入前定義 window.LIB_CONFIG:
 *   { kind: 'devotion'|'pastor', indexUrl, bucketBase, pageId, i18n: {lang: {...}} }
 */
(function () {
  'use strict';
  var CFG = window.LIB_CONFIG;

  // ---------- 共用文案 ----------
  var SHARED = {
    'zh-TW': {
      'nav.home': '回首頁', 'nav.about': '關於我們', 'nav.pastor': '牧師介紹',
      'nav.devotion': '靈修筆記', 'nav.pword': '牧師的話', 'nav.services': '聚會時間',
      'search.ph': '搜尋題目、經文或日期…', 'year.all': '全部',
      'count': '共 {n} 篇', 'result': '符合「{q}」的結果：{n} 篇',
      'loading': '載入中…', 'empty': '找不到符合的內容', 'back': '返回列表',
      'newer': '較新', 'older': '較舊', 'by': '馬宏偉 牧師',
      'note': '本專欄文章以中文撰寫', 'footer.back': '← 回到教會首頁'
    },
    'zh-CN': {
      'nav.home': '回首页', 'nav.about': '关于我们', 'nav.pastor': '牧师介绍',
      'nav.devotion': '灵修笔记', 'nav.pword': '牧师的话', 'nav.services': '聚会时间',
      'search.ph': '搜索题目、经文或日期…', 'year.all': '全部',
      'count': '共 {n} 篇', 'result': '符合“{q}”的结果：{n} 篇',
      'loading': '加载中…', 'empty': '找不到符合的内容', 'back': '返回列表',
      'newer': '较新', 'older': '较旧', 'by': '马宏伟 牧师',
      'note': '本专栏文章以中文撰写', 'footer.back': '← 回到教会首页'
    },
    'ja': {
      'nav.home': 'ホーム', 'nav.about': '私たちについて', 'nav.pastor': '牧師紹介',
      'nav.devotion': 'ディボーション', 'nav.pword': '牧師の言葉', 'nav.services': '集会案内',
      'search.ph': 'タイトル・聖句・日付で検索…', 'year.all': 'すべて',
      'count': '全 {n} 篇', 'result': '「{q}」の検索結果：{n} 件',
      'loading': '読み込み中…', 'empty': '該当する内容が見つかりません', 'back': '一覧へ戻る',
      'newer': '新しい', 'older': '古い', 'by': '馬宏偉 牧師',
      'note': 'このコラムは中国語で書かれています', 'footer.back': '← 教会トップへ戻る'
    }
  };

  var lang = localStorage.getItem('lang') || 'zh-TW';
  function dict() {
    var s = SHARED[lang] || SHARED['zh-TW'];
    var p = (CFG.i18n && CFG.i18n[lang]) || {};
    var out = {};
    for (var k in s) out[k] = s[k];
    for (var k2 in p) out[k2] = p[k2];
    return out;
  }
  function t(key, vars) {
    var d = dict(); var str = d[key] != null ? d[key] : key;
    if (vars) for (var v in vars) str = str.replace('{' + v + '}', vars[v]);
    return str;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- 狀態 ----------
  var state = {
    index: [],        // 全部條目（已按日期倒序）
    view: [],         // 當前過濾後的條目
    rendered: 0,
    query: '',
    year: 'all',
    buckets: {},      // 靈修筆記正文快取 ym -> {id:{...}}
    pastorMap: {},    // 牧師的話 id -> 完整條目
    listScroll: 0
  };
  var PAGE = 48;

  // ---------- 載入資料 ----------
  function loadIndex() {
    return fetch(CFG.indexUrl).then(function (r) { return r.json(); }).then(function (data) {
      if (CFG.kind === 'pastor') {
        state.index = data.map(function (e) {
          state.pastorMap[e.id] = e;
          return { id: e.id, date: e.date, ym: e.ym, title: e.title, scripture: '' };
        });
      } else {
        state.index = data;
      }
    });
  }

  function getEntry(id) {
    if (CFG.kind === 'pastor') {
      return Promise.resolve(state.pastorMap[id] || null);
    }
    var meta = state.index.find(function (e) { return e.id === id; });
    if (!meta) return Promise.resolve(null);
    var ym = meta.ym;
    if (state.buckets[ym]) return Promise.resolve(state.buckets[ym][id] || null);
    return fetch(CFG.bucketBase + ym + '.json').then(function (r) { return r.json(); })
      .then(function (obj) {
        state.buckets[ym] = obj;
        var e = obj[id] || null;
        if (e) e.id = id;
        return e;
      }).catch(function () { return null; });
  }

  // ---------- 列表 ----------
  function applyFilter() {
    var q = state.query.trim().toLowerCase();
    state.view = state.index.filter(function (e) {
      if (state.year !== 'all' && e.date.slice(0, 4) !== state.year) return false;
      if (!q) return true;
      return (e.title + ' ' + (e.scripture || '') + ' ' + e.date).toLowerCase().indexOf(q) >= 0;
    });
    state.rendered = 0;
    document.getElementById('cardGrid').innerHTML = '';
    renderMore();
    var meta = document.getElementById('resultMeta');
    meta.textContent = q ? t('result', { q: state.query, n: state.view.length })
                         : t('count', { n: state.view.length });
    var empty = document.getElementById('emptyRow');
    empty.style.display = state.view.length === 0 ? 'block' : 'none';
  }

  function fmtDate(iso) {
    var p = iso.split('-');
    if (lang === 'ja') return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日';
    return p[0] + '.' + p[1] + '.' + p[2];
  }

  function cardHTML(e) {
    var chip = e.scripture ? '<span class="chip">' + esc(e.scripture) + '</span>' : '';
    var ex = e.excerpt ? '<p class="excerpt">' + esc(e.excerpt) + '…</p>' : '';
    return '<article class="entry-card" data-id="' + e.id + '" tabindex="0" role="button">' +
      '<div class="meta-row"><span class="date">' + fmtDate(e.date) + '</span>' + chip + '</div>' +
      '<h3>' + esc(e.title) + '</h3>' + ex +
      '<span class="more">' + (CFG.kind === 'pastor' ? '閱讀 →' : '展開 →') + '</span>' +
      '</article>';
  }

  function renderMore() {
    var grid = document.getElementById('cardGrid');
    var slice = state.view.slice(state.rendered, state.rendered + PAGE);
    var html = '';
    for (var i = 0; i < slice.length; i++) html += cardHTML(slice[i]);
    grid.insertAdjacentHTML('beforeend', html);
    state.rendered += slice.length;
  }

  // ---------- 文章 ----------
  function renderBody(paras) {
    var html = ''; var inPrayer = false;
    function closeP() { if (inPrayer) { html += '</div>'; inPrayer = false; } }
    for (var i = 0; i < paras.length; i++) {
      var p = (paras[i] || '').trim();
      if (!p) continue;
      var hm = /^【([^】]+)】$/.exec(p);
      if (hm) {
        var label = hm[1];
        if (/[祷禱]告/.test(label)) {
          closeP(); html += '<div class="prayer-block"><div class="subhead">' + esc(label) + '</div>'; inPrayer = true;
        } else {
          closeP(); html += '<div class="subhead">' + esc(label) + '</div>';
        }
        continue;
      }
      if (/^[经經]文/.test(p)) {
        var withRef = esc(p).replace(/【([^】]+)】/, '<span class="ref">【$1】</span>');
        html += '<div class="scripture">' + withRef + '</div>';
        continue;
      }
      html += '<p>' + esc(p) + '</p>';
    }
    closeP();
    return html;
  }

  function openArticle(id) {
    var idx = state.view.findIndex(function (e) { return e.id === id; });
    var listForNav = idx >= 0 ? state.view : state.index;
    if (idx < 0) idx = state.index.findIndex(function (e) { return e.id === id; });
    var box = document.getElementById('articleBox');
    box.innerHTML = '<div class="loading-row">' + t('loading') + '</div>';
    document.body.classList.add('reading');
    window.scrollTo(0, 0);

    getEntry(id).then(function (e) {
      if (!e) { box.innerHTML = '<div class="empty-row">' + t('empty') + '</div>'; return; }
      var refChip = (CFG.kind === 'devotion' && e.scripture)
        ? '<span class="scripture-ref">' + esc(e.scripture) + '</span>' : '';
      var newer = listForNav[idx - 1], older = listForNav[idx + 1];
      var navHTML = '<div class="article-nav">' +
        navBtn(newer, 'newer') + navBtn(older, 'older') + '</div>';
      box.innerHTML =
        '<button class="back" id="backBtn">&#8592; ' + t('back') + '</button>' +
        '<header class="article-head">' +
          '<div class="date">' + fmtDate(e.date) + '</div>' +
          refChip +
          '<div class="deco">&#10013;</div>' +
          '<h1>' + esc(e.title) + '</h1>' +
        '</header>' +
        '<div class="article-body">' + renderBody(e.paras) + '</div>' +
        '<div class="article-sign">— <span class="by">' + t('by') + '</span></div>' +
        navHTML;
      document.title = e.title + ' | ' + t(CFG.kind === 'pastor' ? 'nav.pword' : 'nav.devotion');
    });
  }

  function navBtn(entry, dir) {
    if (!entry) return '<button class="' + (dir === 'older' ? 'next' : '') + '" disabled></button>';
    var cls = dir === 'older' ? 'next' : '';
    return '<button class="' + cls + '" data-go="' + entry.id + '">' +
      '<span class="dir">' + (dir === 'older' ? t('older') + ' →' : '← ' + t('newer')) + '</span>' +
      '<span class="ttl">' + esc(entry.title) + '</span></button>';
  }

  function showList() {
    document.body.classList.remove('reading');
    document.title = CFG.docTitle || document.title;
    window.scrollTo(0, state.listScroll || 0);
  }

  // ---------- 路由 ----------
  function route() {
    var id = location.hash.replace(/^#\/?/, '');
    if (id && /^[dp]\d{8}/.test(id)) {
      if (!document.body.classList.contains('reading')) state.listScroll = window.scrollY;
      openArticle(id);
    } else {
      showList();
    }
  }

  // ---------- 年份膠囊 ----------
  function buildYears() {
    var years = {};
    state.index.forEach(function (e) { years[e.date.slice(0, 4)] = 1; });
    var list = Object.keys(years).sort().reverse();
    var wrap = document.getElementById('yearPills');
    var html = '<button data-year="all" class="active">' + t('year.all') + '</button>';
    list.forEach(function (y) { html += '<button data-year="' + y + '">' + y + '</button>'; });
    wrap.innerHTML = html;
  }

  // ---------- i18n 套用 ----------
  function applyI18n() {
    var d = dict();
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n'); if (d[k] != null) el.textContent = d[k];
    });
    var si = document.getElementById('searchInput');
    if (si) si.placeholder = t('search.ph');
    document.querySelectorAll('.lang-switcher button').forEach(function (b) { b.classList.remove('active'); });
    var btn = document.querySelector('.lang-switcher button[data-lang="' + lang + '"]');
    if (btn) btn.classList.add('active');
    document.body.classList.toggle('lang-ja', lang === 'ja');
    document.documentElement.lang = lang === 'zh-TW' ? 'zh-Hant' : lang === 'zh-CN' ? 'zh-Hans' : 'ja';
    CFG.docTitle = t('page.title') + ' | ' + t('site');
    if (!document.body.classList.contains('reading')) document.title = CFG.docTitle;
  }

  window.switchLang = function (l) {
    lang = l; localStorage.setItem('lang', l);
    applyI18n();
    buildYears();
    // 重新渲染年份目前選取
    var yb = document.querySelector('#yearPills button[data-year="' + state.year + '"]');
    document.querySelectorAll('#yearPills button').forEach(function (b) { b.classList.remove('active'); });
    if (yb) yb.classList.add('active');
    applyFilter();
    if (document.body.classList.contains('reading')) openArticle(location.hash.replace(/^#\/?/, ''));
  };

  // ---------- 綁定 ----------
  function bind() {
    var si = document.getElementById('searchInput');
    var deb;
    si.addEventListener('input', function () {
      clearTimeout(deb); deb = setTimeout(function () { state.query = si.value; applyFilter(); }, 180);
    });

    document.getElementById('yearPills').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-year]'); if (!b) return;
      state.year = b.getAttribute('data-year');
      document.querySelectorAll('#yearPills button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      applyFilter();
    });

    document.getElementById('cardGrid').addEventListener('click', function (e) {
      var c = e.target.closest('.entry-card'); if (!c) return;
      location.hash = c.getAttribute('data-id');
    });
    document.getElementById('cardGrid').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest('.entry-card'); if (!c) return;
      e.preventDefault(); location.hash = c.getAttribute('data-id');
    });

    document.getElementById('articleBox').addEventListener('click', function (e) {
      if (e.target.closest('#backBtn')) { location.hash = ''; return; }
      var g = e.target.closest('button[data-go]');
      if (g) location.hash = g.getAttribute('data-go');
    });

    // 無限載入
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && state.rendered < state.view.length) renderMore();
    }, { rootMargin: '600px' });
    io.observe(document.getElementById('sentinel'));

    window.addEventListener('hashchange', route);

    // 行動選單
    var mt = document.querySelector('.menu-toggle');
    if (mt) mt.addEventListener('click', function () { document.querySelector('nav ul').classList.toggle('active'); });
    document.querySelectorAll('nav a').forEach(function (a) {
      a.addEventListener('click', function () { document.querySelector('nav ul').classList.remove('active'); });
    });
  }

  // ---------- 啟動 ----------
  applyI18n();
  bind();
  loadIndex().then(function () {
    buildYears();
    applyFilter();
    route();
  }).catch(function (err) {
    document.getElementById('resultMeta').textContent = '⚠ ' + t('empty');
    console.error(err);
  });
})();
