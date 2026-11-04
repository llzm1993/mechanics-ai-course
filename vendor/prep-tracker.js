/*!
 * prep-tracker.js — 《力学》AI 智慧课程 · 课前预习数据采集器
 * 职责：
 *   1. 跟踪「实际预习时长」（仅页面可见时累加，避免后台挂机虚高）
 *   2. 为静态 3D 翻转闪卡页注入「自检清单」（掌握 / 模糊 / 不会）
 *   3. 提交时把 {章节, 预习时长, 各卡自评} upsert 到 Supabase（匿名 / 登录均可）
 *   4. 支持页面自定义：window.PREP_CHAPTER（章号 1-12）、window.PREP_GET_RESULTS()（ch2 专属适配器）
 * 注意：仅使用 Supabase anon 公钥（前端可见，安全）；service_role 仅用于建表，绝不出现在本文件。
 */
(function () {
  'use strict';

  var SUPABASE_URL = "https://yvsgpmoudmorjmukbxgu.supabase.co";
  var SUPABASE_ANON = "sb_publishable_exGYITDk5sn2hXKaZodxiQ_CXO_jx7f";

  var CHAPTER = (typeof window.PREP_CHAPTER === 'number') ? window.PREP_CHAPTER : null;

  // ---------- Supabase 客户端 ----------
  var client = null;
  try {
    if (window.supabase && window.supabase.createClient) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
  } catch (e) { client = null; }

  // ---------- 工具 ----------
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  var SESSION_KEY = 'prep_session_tag';
  function getTag() {
    try { var t = localStorage.getItem(SESSION_KEY); if (t) return t; } catch (e) {}
    var g = 'g-' + uuid();
    try { localStorage.setItem(SESSION_KEY, g); } catch (e) {}
    return g;
  }

  // ---------- 预习时长（活跃秒数） ----------
  var prepSeconds = 0, lastTick = Date.now();
  setInterval(function () {
    var now = Date.now();
    if (document.visibilityState === 'visible') {
      prepSeconds += Math.round((now - lastTick) / 1000);
    }
    lastTick = now;
  }, 1000);

  // ---------- 自检结果（静态页） ----------
  var cardResults = {}; // { 卡序(1-based): 掌握度 0/1/2 }

  function injectSelfCheckCSS() {
    if (document.getElementById('prep-tracker-css')) return;
    var s = document.createElement('style');
    s.id = 'prep-tracker-css';
    s.textContent =
      '.prep-selfcheck-panel{margin-top:26px;padding:18px 20px;border-radius:16px;' +
      'background:rgba(15,23,42,0.55);border:1px solid rgba(56,189,248,0.28);}' +
      '.prep-selfcheck-panel h3{font-size:1rem;font-weight:700;color:#e2e8f0;margin-bottom:4px;}' +
      '.prep-selfcheck-panel p.sub{font-size:.8rem;color:#94a3b8;margin-bottom:14px;}' +
      '.prep-selfcheck-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;}' +
      '.prep-sc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
      'padding:10px 12px;border-radius:12px;background:rgba(11,17,32,0.6);border:1px solid rgba(148,163,184,0.16);}' +
      '.prep-sc-label{flex:1;min-width:0;font-size:.82rem;color:#cbd5e1;line-height:1.4;' +
      'display:flex;gap:8px;align-items:flex-start;}' +
      '.prep-sc-num{flex:none;width:20px;height:20px;border-radius:6px;background:rgba(56,189,248,0.16);' +
      'color:#7dd3fc;font-size:.72rem;font-weight:700;display:grid;place-items:center;}' +
      '.prep-sc-btns{display:flex;gap:6px;flex:none;}' +
      '.prep-sc-btns button{padding:5px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.25);' +
      'background:rgba(30,41,59,0.7);color:#cbd5e1;font-size:.74rem;font-weight:600;cursor:pointer;transition:all .15s;}' +
      '.prep-sc-btns button:hover{border-color:rgba(56,189,248,0.5);}' +
      '.prep-sc-btns button[data-m="0"].active{background:rgba(251,113,133,0.22);border-color:rgba(251,113,133,0.6);color:#fecdd3;}' +
      '.prep-sc-btns button[data-m="1"].active{background:rgba(251,191,36,0.20);border-color:rgba(251,191,36,0.6);color:#fde68a;}' +
      '.prep-sc-btns button[data-m="2"].active{background:rgba(52,211,153,0.20);border-color:rgba(52,211,153,0.6);color:#a7f3d0;}';
    document.head.appendChild(s);
  }

  function injectSelfCheck() {
    var stage3 = document.getElementById('stage-3');
    if (!stage3) return;
    var cards = stage3.querySelectorAll('.flip-card');
    if (!cards.length) return; // ch2 等自定义页由 PREP_GET_RESULTS 提供
    injectSelfCheckCSS();

    var panel = document.createElement('div');
    panel.className = 'prep-selfcheck-panel';
    panel.innerHTML =
      '<h3>📋 3D 闪卡自检</h3>' +
      '<p class="sub">翻转卡片学习后，给每一张卡自评掌握程度，结果将匿名汇入班级预习热力图。</p>';
    var grid = document.createElement('div');
    grid.className = 'prep-selfcheck-grid';

    cards.forEach(function (card, i) {
      var idx = i + 1;
      var inner = card.querySelector('.flip-card-inner');
      var front = inner ? inner.children[0] : null;
      var raw = front ? front.textContent || '' : ('第 ' + idx + ' 张');
      var label = raw.replace(/\s+/g, ' ').replace(/^(正面|反面)\s*·\s*\S+\s*/, '').trim();
      if (label.length > 34) label = label.slice(0, 34) + '…';

      var row = document.createElement('div');
      row.className = 'prep-sc-row';
      row.innerHTML =
        '<div class="prep-sc-label"><span class="prep-sc-num">' + idx + '</span><span>' + label + '</span></div>' +
        '<div class="prep-sc-btns">' +
        '<button type="button" data-m="0">需重来</button>' +
        '<button type="button" data-m="1">模糊</button>' +
        '<button type="button" data-m="2">已掌握</button>' +
        '</div>';
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          cardResults[idx] = parseInt(b.getAttribute('data-m'), 10);
          row.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          scheduleSubmit(1200); // 自评后稍作防抖即上报，让热力图实时更新
        });
      });
      grid.appendChild(row);
    });

    panel.appendChild(grid);
    stage3.appendChild(panel);
  }

  // ---------- 结果收集 ----------
  function getResults() {
    if (typeof window.PREP_GET_RESULTS === 'function') {
      try { return window.PREP_GET_RESULTS() || {}; } catch (e) { /* ignore */ }
    }
    return { prep_seconds: prepSeconds, card_results: cardResults };
  }

  function buildPayload() {
    var r = getResults();
    var secs = (typeof r.prep_seconds === 'number') ? r.prep_seconds : prepSeconds;
    return { prep_seconds: secs, card_results: r.card_results || {} };
  }

  // ---------- 上报 ----------
  var lastSubmitAt = 0, submitTimer = null, hasSubmitted = false, cachedTag = null;
  function scheduleSubmit(delay) {
    clearTimeout(submitTimer);
    submitTimer = setTimeout(function () { submit(); }, delay || 1500);
  }
  function showToast(msg) {
    var t = document.getElementById('prep-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'prep-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);' +
        'background:rgba(15,23,42,0.92);color:#a7f3d0;border:1px solid rgba(52,211,153,0.5);' +
        'padding:10px 18px;border-radius:12px;font-size:.85rem;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.5);' +
        'transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = '✓ ' + msg;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = '0'; }, 2600);
  }

  async function submit(force) {
    if (!client || CHAPTER == null) return;
    var p = buildPayload();
    // 过滤噪声：既无自评、停留又不足 30 秒，视为误触（force 时仍上报已有数据）
    var rated = Object.keys(p.card_results || {}).length;
    if (!rated && (p.prep_seconds || 0) < 30 && !force) return;
    // 节流：4 秒内重复触发则稍后再试
    var now = Date.now();
    if (!force && now - lastSubmitAt < 4000) { scheduleSubmit(4000); return; }

    var userId = null;
    try {
      var s = await client.auth.getSession();
      if (s && s.data && s.data.session && s.data.session.user) userId = s.data.session.user.id;
    } catch (e) { userId = null; }

    var tag = userId ? ('u:' + userId) : getTag();
    cachedTag = tag;

    try {
      // 走 SECURITY DEFINER 写入函数：匿名无表级权限，仅能调用此 RPC，
      // 既支持重复提交 upsert，也保证个体原始记录不可被前端读取。
      var res = await client.rpc('submit_prep_record', {
        p_chapter: CHAPTER,
        p_session_tag: tag,
        p_prep_seconds: p.prep_seconds || 0,
        p_card_results: p.card_results || {},
        p_user_id: userId || null
      });
      if (res && !res.error) {
        lastSubmitAt = Date.now();
        if (!hasSubmitted) { hasSubmitted = true; showToast('预习数据已匿名上报'); }
      }
      // 若后端尚未初始化，res.error 存在 → 静默忽略，不阻断页面
    } catch (e) { /* 网络/后端未初始化：忽略 */ }
  }

  window.PREP_SUBMIT = submit;

  // 长时间停留时定期累计预习时长（同一 session_tag+chapter 走 upsert 覆盖）
  setInterval(function () {
    if (document.visibilityState === 'visible') submit();
  }, 60000);

  // ---------- 挂载 ----------
  function onReady() {
    injectSelfCheck();
    // 复用页面已有的「生成回执」按钮作为提交触发点
    if (typeof window.openExportModal === 'function') {
      var orig = window.openExportModal;
      window.openExportModal = function () {
        try { submit(); } catch (e) {}
        return orig.apply(this, arguments);
      };
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(onReady, 0);
  } else {
    window.addEventListener('DOMContentLoaded', onReady);
  }

  // 页面卸载时异步 fetch 可能被取消，用 sendBeacon 兜底（走同一 RPC，upsert 幂等）
  function beaconSubmit() {
    if (!CHAPTER || typeof navigator.sendBeacon !== 'function') return;
    var p = buildPayload();
    var rated = Object.keys(p.card_results || {}).length;
    if (!rated && (p.prep_seconds || 0) < 30) return;
    try {
      var payload = {
        p_chapter: CHAPTER,
        p_session_tag: cachedTag || getTag(),
        p_prep_seconds: p.prep_seconds || 0,
        p_card_results: p.card_results || {},
        p_user_id: null
      };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(
        SUPABASE_URL + '/rest/v1/rpc/submit_prep_record?apikey=' + encodeURIComponent(SUPABASE_ANON),
        blob
      );
    } catch (e) { /* 忽略 */ }
  }

  window.addEventListener('pagehide', function () { submit(true); beaconSubmit(); });
  window.addEventListener('beforeunload', function () { submit(true); beaconSubmit(); });
})();
