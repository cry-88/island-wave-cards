/* ============================================================
   孤岛卡片 · 前端逻辑
   - 手机号验证码登录 / 微信登录
   - 卡片海：实时刷新、随机偶遇、点开即永远消失
   - 我的孤岛：仅自己可见的往日卡片
   - 「看过即消失」由数据库 RLS 策略服务端强制执行，
     前端只负责记录与表现
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 基础 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.ISLAND_CONFIG;

  var TINTS = ['sea', 'rain', 'dusk', 'leaf', 'ember', 'dawn'];
  var MAX_LEN = 800;
  var POLL_MS = 10000;

  var cloud = null;
  var me = null;                 // 当前岛民 { id }
  var seaCards = [];             // 海面上尚未看过的卡片
  var renderedSeaIds = new Set();
  var currentView = 'sea';
  var pollTimer = null;
  var resendTimer = null;
  var pendingOtp = null;         // { phone, verificationId, isExistingUser }
  var activeCard = null;         // 详情弹层中的卡片
  var chosenTint = 'sea';

  /* ---------- 小工具 ---------- */
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, ms || 2400);
  }

  function relTime(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var m = Math.floor((Date.now() - then) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    var dt = new Date(iso);
    return dt.getFullYear() + '.' + (dt.getMonth() + 1) + '.' + dt.getDate();
  }

  function pickTint(id) { return TINTS[Math.abs(Number(id)) % TINTS.length]; }

  // 把 ISO 时间转成 HH:MM，海上的时间只精确到分钟
  function clockTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 记录编号：NO. + id（不足 4 位补零，超过 4 位原样保留）
  function recordNo(id) {
    var n = String(Math.abs(Number(id) || 0));
    while (n.length < 4) n = '0' + n;
    return 'NO.' + n;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function maskPhone(phone) {
    if (!phone) return '';
    var digits = String(phone).replace(/\D/g, '');
    if (digits.length < 7) return digits;
    var tail = digits.slice(-11);
    if (tail.length === 11) return tail.slice(0, 3) + '****' + tail.slice(7);
    return digits.slice(0, 3) + '****' + digits.slice(-4);
  }

  /* ---------- SDK 初始化 ---------- */
  function initCloud() {
    if (typeof window.WorkBuddyCloud === 'undefined' || !window.WorkBuddyCloud.createWorkBuddyCloud) {
      showAuthError('卡片云组件没有加载成功，请检查网络后刷新页面。');
      return false;
    }
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
      publishableKey: cfg.publishableKey
    });
    return true;
  }

  /* ---------- 启动：授权回调分发先于路由守卫 ---------- */
  function bootstrap() {
    if (!initCloud()) return;

    var url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      continueNormalStartup();
      return;
    }

    var provider = url.searchParams.get('provider');
    if (provider !== 'wechat') {
      showAuthError('授权回调缺少有效的登录方式，请重新登录。');
      return;
    }
    var handle = cloud.auth.handleWechatWebCallback;
    if (typeof handle !== 'function') {
      showAuthError('暂时无法使用微信登录，请改用手机号登岛。');
      return;
    }
    handle.call(cloud.auth).then(function (res) {
      if (res && res.error) {
        showAuthError(res.error.message || '微信授权失败，请重新登录。');
      } else if (res && res.data) {
        ['code', 'state', 'provider'].forEach(function (k) { url.searchParams.delete(k); });
        history.replaceState(null, '', url.pathname + url.search + url.hash);
        enterApp(res.data);
      } else {
        continueNormalStartup();
      }
    }).catch(function () {
      showAuthError('微信授权处理失败，请重新登录。');
    });
  }

  function continueNormalStartup() {
    cloud.auth.getSession().then(function (res) {
      if (res && !res.error && res.data) {
        enterApp(res.data);
        cloud.auth.onAuthStateChange(function (event) {
          if (event === 'SIGNED_OUT') {
            stopPolling();
            showAuth();
          }
        });
      } else {
        showAuth();
      }
    }).catch(function () {
      showAuthError('读取登录状态失败，请刷新页面重试。');
    });
  }

  /* ---------- 视图切换 ---------- */
  function showAuth() {
    me = null;
    seaCards = [];
    renderedSeaIds.clear();
    activeCard = null;
    $('card-grid').innerHTML = '';
    $('island-grid').innerHTML = '';
    $('card-overlay').classList.remove('on');
    $('compose-overlay').classList.remove('on');
    $('app-view').classList.remove('on');
    $('auth-view').style.display = '';
    $('phone').value = '';
    $('code').value = '';
    pendingOtp = null;
    setPhoneError('');
    hideAuthError();
    $('login-btn').disabled = false;
    $('login-btn').textContent = '登 岛';
  }

  function enterApp(session) {
    var user = session && session.user ? session.user : null;
    var uid = user && (user.id || user.uid);
    if (!uid) {
      showAuthError('没能确认你的身份，请重新登岛。');
      return;
    }
    me = { id: uid };
    $('who').textContent = maskPhone(user.phone) || '一位岛民';
    $('auth-view').style.display = 'none';
    $('app-view').classList.add('on');
    switchView('sea');
    startPolling();
  }

  function switchView(v) {
    currentView = v;
    $('nav-sea').classList.toggle('active', v === 'sea');
    $('nav-island').classList.toggle('active', v === 'island');
    $('sea-view').style.display = v === 'sea' ? '' : 'none';
    $('island-view').style.display = v === 'island' ? '' : 'none';
    if (v === 'island') loadIsland(false);
    else loadSea(false);
  }

  /* ---------- 登录：手机号验证码 ---------- */
  function setPhoneError(msg) {
    var el = $('phone-error');
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function showAuthError(msg) {
    var el = $('auth-error');
    el.textContent = msg;
    el.classList.add('show');
  }

  function hideAuthError() { $('auth-error').classList.remove('show'); }

  function startResendCountdown(btn) {
    var s = 60;
    btn.disabled = true;
    btn.textContent = s + ' 秒后重发';
    clearInterval(resendTimer);
    resendTimer = setInterval(function () {
      s -= 1;
      if (s <= 0) {
        clearInterval(resendTimer);
        resendTimer = null;
        btn.disabled = false;
        btn.textContent = '重新获取';
      } else {
        btn.textContent = s + ' 秒后重发';
      }
    }, 1000);
  }

  function sendCode() {
    var phone = $('phone').value.trim();
    if (!/^1\d{10}$/.test(phone)) {
      setPhoneError('请输入正确的 11 位手机号');
      return;
    }
    setPhoneError('');
    hideAuthError();
    var btn = $('send-code-btn');
    btn.disabled = true;
    cloud.auth.sendOtp({ phone: phone }).then(function (sent) {
      if (sent.error) {
        showAuthError(sent.error.message || '验证码发送失败，请稍后再试。');
        btn.disabled = false;
        return;
      }
      pendingOtp = {
        phone: phone,
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser
      };
      startResendCountdown(btn);
      if (sent.data.demoCode) {
        $('code').value = sent.data.demoCode;
        toast('演示模式验证码：' + sent.data.demoCode);
      } else {
        toast('验证码已启程，请注意查收');
      }
    }).catch(function () {
      showAuthError('海浪打湿了线路，验证码发送失败，请稍后再试。');
      btn.disabled = false;
    });
  }

  function submitLogin(e) {
    e.preventDefault();
    hideAuthError();
    var phone = $('phone').value.trim();
    var code = $('code').value.trim();
    if (!/^1\d{10}$/.test(phone)) {
      setPhoneError('请输入正确的 11 位手机号');
      return;
    }
    if (!pendingOtp || pendingOtp.phone !== phone) {
      showAuthError('请先获取验证码。');
      return;
    }
    if (!/^\d{4,6}$/.test(code)) {
      showAuthError('请输入收到的验证码。');
      return;
    }
    var btn = $('login-btn');
    btn.disabled = true;
    btn.textContent = '登 岛 中 ……';
    cloud.auth.verifyOtp({
      phone: pendingOtp.phone,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    }).then(function (completed) {
      if (completed.error) {
        showAuthError(completed.error.message || '验证码有误，请重新输入。');
        return;
      }
      pendingOtp = null;
      clearInterval(resendTimer);
      $('send-code-btn').disabled = false;
      $('send-code-btn').textContent = '获取验证码';
      enterApp(completed.data);
    }).catch(function () {
      showAuthError('登岛失败，请稍后再试。');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '登 岛';
    });
  }

  /* ---------- 登录：微信（需发布后的域名） ---------- */
  function wechatLogin() {
    hideAuthError();
    cloud.auth.signInWithOAuth({
      provider: 'wechat',
      redirectTo: location.origin
    }).then(function (res) {
      if (res.error) {
        showAuthError((res.error.message || '微信登录暂不可用') + '（微信登录需在网站正式发布后的域名中进行）');
        return;
      }
      location.assign(res.data.url);
    }).catch(function () {
      showAuthError('微信登录启动失败，请改用手机号登岛。');
    });
  }

  /* ---------- 卡片海 ---------- */
  function loadSea(quiet) {
    if (!me) return Promise.resolve();
    var overflowIds = null; // 已看卡片超过 250 张时，退化为拉取后本地过滤
    var seenCount = 0;      // 已看过的卡片总数，供仪表台读数用

    return cloud.database.from('card_seen').select('card_id').then(function (seenRes) {
      if (seenRes.error) {
        if (!quiet) toast('没能想起哪些浪花已经来过，稍后再试试');
        return null;
      }
      var seenIds = new Set();
      (seenRes.data || []).forEach(function (r) { seenIds.add(Number(r.card_id)); });
      seenCount = seenIds.size;

      var q = cloud.database.from('cards')
        .select('id, content, tint, created_at')
        .neq('owner_id', me.id)
        .order('created_at', { ascending: false })
        .limit(seenIds.size > 250 ? 300 : 80);
      if (seenIds.size > 0 && seenIds.size <= 250) {
        // 服务端排除已看过的（RLS 策略同样会排除，这里是减少传输）
        q = q.not('id', 'in', '(' + Array.from(seenIds).join(',') + ')');
      } else if (seenIds.size > 250) {
        overflowIds = seenIds;
      }
      return q;
    }).then(function (res) {
      if (!res) return; // 已看记录查询失败，已提示
      if (res.error) {
        if (!quiet) toast('海面暂时看不清，请稍后再试');
        return;
      }
      var list = res.data || [];
      if (overflowIds) {
        list = list.filter(function (c) { return !overflowIds.has(Number(c.id)); });
      }
      shuffle(list);
      var before = renderedSeaIds.size;
      seaCards = list;
      renderSea(list);
      var arrived = renderedSeaIds.size - before;
      if (quiet && arrived > 0) {
        toast('有 ' + arrived + ' 朵新的浪花拍向你的岛');
      }
      updateSeaCount();
      updateReadouts(seenCount);
    }).catch(function () {
      if (!quiet) toast('海面暂时看不清，请稍后再试');
    });
  }

  function renderSea(list) {
    var grid = $('card-grid');
    var incoming = new Set(list.map(function (c) { return Number(c.id); }));

    // 移除已经不在列表里的卡片（被看过、已退去）
    Array.prototype.slice.call(grid.children).forEach(function (el) {
      var id = Number(el.dataset.id);
      if (!incoming.has(id) && !el.classList.contains('dissolving')) {
        el.remove();
        renderedSeaIds.delete(id);
      }
    });

    // 新卡片插到最前面——最新的浪先拍上来
    var frag = document.createDocumentFragment();
    var added = 0;
    list.forEach(function (c) {
      var id = Number(c.id);
      if (renderedSeaIds.has(id)) return;
      frag.appendChild(buildCardEl(c, { clickable: true, full: false }));
      renderedSeaIds.add(id);
      added += 1;
    });
    if (added > 0) {
      grid.insertBefore(frag, grid.firstChild);
    }
    var anyLeft = !!grid.querySelector('.card:not(.dissolving)');
    $('sea-empty').classList.toggle('on', !anyLeft);
  }

  function updateSeaCount() {
    var n = seaCards.length;
    $('sea-count').textContent = n === 0 ? '海面很安静……' : '海面上泊着 ' + n + ' 朵浪';
    // 仪表台联动：主读数 + 海面可见
    if ($('gauge-count')) $('gauge-count').textContent = n;
    if ($('ro-visible')) $('ro-visible').textContent = n + ' 条';
  }

  // 仪表台：今日已读 / 我的记录
  function updateReadouts(seenCount, myCount) {
    if (seenCount !== undefined && $('ro-read')) {
      $('ro-read').textContent = seenCount + ' 条';
    }
    if (myCount !== undefined && $('ro-mine')) {
      $('ro-mine').textContent = myCount + ' 条';
    }
  }

  function buildCardEl(c, opts) {
    var el = document.createElement('article');
    var id = Number(c.id);
    var tint = c.tint && TINTS.indexOf(c.tint) >= 0 ? c.tint : pickTint(id);
    el.className = 'card tint-' + tint;
    el.dataset.id = c.id;

    // 卡头：状态 / 编号 / 时刻
    var head = document.createElement('div');
    head.className = 'head-line';
    var st = document.createElement('span');
    st.className = opts.island ? 'st read' : 'st';
    st.textContent = opts.island ? '已漂出' : '未读';
    var no = document.createElement('span');
    no.className = 'no';
    no.textContent = recordNo(id);
    var t = document.createElement('span');
    t.className = 'time';
    t.textContent = clockTime(c.created_at);
    head.appendChild(st); head.appendChild(no); head.appendChild(t);

    var body = document.createElement('p');
    body.className = 'excerpt';
    body.textContent = (!opts.full && c.content.length > 90)
      ? c.content.slice(0, 90) + ' ……'
      : c.content;

    var meta = document.createElement('div');
    meta.className = 'meta';
    var time = document.createElement('span');
    time.textContent = relTime(c.created_at);
    var dot = document.createElement('span');
    dot.className = 'dot';
    var from = document.createElement('span');
    from.className = 'from';
    from.textContent = opts.island ? '写自这座岛' : '来自某座不知名的岛';
    meta.appendChild(time); meta.appendChild(dot); meta.appendChild(from);

    el.appendChild(head);
    el.appendChild(body);
    el.appendChild(meta);

    if (opts.clickable) {
      el.addEventListener('click', function () { openCard(c); });
    }
    return el;
  }

  /* ---------- 打开卡片：看过一次，永远退去 ---------- */
  function openCard(c) {
    activeCard = c;
    var card = c;
    var id = Number(c.id);
    var tint = c.tint && TINTS.indexOf(c.tint) >= 0 ? c.tint : pickTint(id);
    var detail = $('detail-card');
    detail.className = 'detail-card tint-' + tint;
    $('detail-text').textContent = c.content;
    $('detail-time').textContent = relTime(c.created_at);
    $('detail-no').textContent = recordNo(id);
    $('card-overlay').classList.add('on');

    // 点开即记为看过；若记录失败，合上后卡片仍留在海面
    // __seen 三态：undefined=记档中，true=已记住，false=记档失败
    card.__seen = undefined;
    cloud.database.from('card_seen').insert({ card_id: id }).then(function (res) {
      if (res.error && res.error.code !== '23505') {
        toast('这朵浪花没能记下你的足迹，合上后它还会在这里');
        card.__seen = false;
        // 如果用户已经抢先合上了，此刻才判定为"没记住"，卡片留在海面
        if (card.__closed) revealCard(card);
        return;
      }
      card.__seen = true;
      seaCards = seaCards.filter(function (x) { return Number(x.id) !== id; });
      updateSeaCount();
      // 用户可能读得很快，在记档返回前就点了合上——此时才执行退场
      if (card.__closed) revealCard(card);
    }).catch(function () {
      toast('这朵浪花没能记下你的足迹，合上后它还会在这里');
      card.__seen = false;
      if (card.__closed) revealCard(card);
    });
  }

  // 卡片退场：加消退动画 → 从海面移除 → 提示
  function revealCard(c) {
    var el = $('card-grid').querySelector('.card[data-id="' + c.id + '"]');
    renderedSeaIds.delete(Number(c.id));
    if (el) {
      el.classList.add('dissolving');
      setTimeout(function () { el.remove(); }, 800);
      setTimeout(function () { toast('这朵浪花退去了，不会再光顾这座岛'); }, 260);
    }
    updateSeaCount();
    // 如果海面空了，露出空态
    if (seaCards.length === 0) {
      setTimeout(function () {
        if (seaCards.length === 0 && $('card-grid').children.length === 0) {
          $('sea-empty').classList.add('on');
        }
      }, 840);
    }
  }

  function closeCard() {
    $('card-overlay').classList.remove('on');
    var c = activeCard;
    activeCard = null;
    if (!c) return;

    if (c.__seen === true) {
      // 已确认记档，直接退场
      revealCard(c);
    } else if (c.__seen === undefined) {
      // 记档还在路上：先关弹层，等 insert 返回后再决定退场还是留下
      c.__closed = true;
    } else {
      // 记档失败，卡片留在海面（前端已提示过）
      c.__closed = true;
    }
  }

  /* ---------- 发布卡片 ---------- */
  function openCompose() {
    $('compose-overlay').classList.add('on');
    setTimeout(function () { $('compose-text').focus(); }, 60);
  }

  function closeCompose() {
    $('compose-overlay').classList.remove('on');
    $('compose-text').value = '';
    $('char-count').textContent = '0 / ' + MAX_LEN;
    $('char-count').classList.remove('over');
    $('compose-error').classList.remove('show');
  }

  function showComposeError(msg) {
    var el = $('compose-error');
    el.textContent = msg;
    el.classList.add('show');
  }

  function publishCard(e) {
    e.preventDefault();
    var text = $('compose-text').value.trim();
    if (!text) { showComposeError('写点什么，再放它入海。'); return; }
    if (text.length > MAX_LEN) { showComposeError('卡片太长，海装不下（最多 ' + MAX_LEN + ' 字）。'); return; }

    var btn = $('publish-btn');
    btn.disabled = true;
    btn.textContent = '漂 入 海 中 ……';
    // owner_id 由数据库 DEFAULT auth.uid() 写入，客户端绝不发送
    cloud.database.from('cards').insert({
      content: text,
      tint: chosenTint
    }).select().then(function (res) {
      if (res.error) {
        showComposeError(res.error.code === '23505'
          ? '这张卡片已经存在了。'
          : (res.error.message || '放入海中失败，请稍后再试。'));
        return;
      }
      closeCompose();
      toast('你的卡片已漂入海中，不知道会拍打哪座孤岛', 3200);
      if (currentView === 'island') loadIsland(false);
    }).catch(function () {
      showComposeError('海浪打湿了线路，请稍后再试。');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '放 入 海 中';
    });
  }

  /* ---------- 我的孤岛（仅自己可见） ---------- */
  function loadIsland(quiet) {
    if (!me) return Promise.resolve();
    return cloud.database.from('cards')
      .select('id, content, tint, created_at')
      .eq('owner_id', me.id)
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          if (!quiet) toast('没能取回你的往日卡片，请稍后再试');
          return;
        }
        var grid = $('island-grid');
        grid.innerHTML = '';
        (res.data || []).forEach(function (c) {
          var el = buildCardEl(c, { clickable: false, full: true, island: true });
          el.classList.add('island-card');
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'del';
          del.textContent = '抹去';
          del.addEventListener('click', function (ev) {
            ev.stopPropagation();
            deleteCard(c.id, el);
          });
          el.appendChild(del);
          grid.appendChild(el);
        });
        $('island-empty').classList.toggle('on', !res.data || res.data.length === 0);
        updateReadouts(undefined, (res.data || []).length);
      }).catch(function () {
        if (!quiet) toast('没能取回你的往日卡片，请稍后再试');
      });
  }

  function deleteCard(id, el) {
    cloud.database.from('cards').delete().eq('id', id).select().then(function (res) {
      if (res.error) { toast('抹去失败，请稍后再试'); return; }
      var removed = Array.isArray(res.data) ? res.data : [];
      if (removed.length === 0) {
        toast('这张卡片已经不在了');
      } else {
        toast('卡片已从孤岛上抹去');
      }
      el.remove();
      $('island-empty').classList.toggle('on', $('island-grid').children.length === 0);
    }).catch(function () {
      toast('抹去失败，请稍后再试');
    });
  }

  /* ---------- 实时轮询 ---------- */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      var modalOpen = $('card-overlay').classList.contains('on') ||
                      $('compose-overlay').classList.contains('on');
      if (currentView === 'sea' && !modalOpen) {
        loadSea(true);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $('send-code-btn').addEventListener('click', sendCode);
    $('phone-form').addEventListener('submit', submitLogin);
    $('phone').addEventListener('input', function () { setPhoneError(''); });
    $('wechat-login-btn').addEventListener('click', wechatLogin);

    $('nav-sea').addEventListener('click', function () { switchView('sea'); });
    $('nav-island').addEventListener('click', function () { switchView('island'); });
    $('logout-btn').addEventListener('click', function () {
      stopPolling();
      cloud.auth.signOut().then(function () {
        showAuth();
      }).catch(function () {
        showAuth();
      });
    });

    $('compose-btn').addEventListener('click', openCompose);
    $('compose-close').addEventListener('click', closeCompose);
    $('compose-form').addEventListener('submit', publishCard);
    $('compose-text').addEventListener('input', function () {
      var n = $('compose-text').value.length;
      $('char-count').textContent = n + ' / ' + MAX_LEN;
      $('char-count').classList.toggle('over', n > MAX_LEN);
    });
    $('tint-picker').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tint-dot') : null;
      if (!btn) return;
      Array.prototype.forEach.call(document.querySelectorAll('.tint-dot'), function (d) {
        d.classList.remove('sel');
      });
      btn.classList.add('sel');
      chosenTint = btn.dataset.tint;
    });

    $('detail-close').addEventListener('click', closeCard);
    $('detail-done').addEventListener('click', closeCard);
    $('card-overlay').addEventListener('click', function (e) {
      if (e.target === $('card-overlay')) closeCard();
    });
    $('compose-overlay').addEventListener('click', function (e) {
      if (e.target === $('compose-overlay')) closeCompose();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('card-overlay').classList.contains('on')) closeCard();
        else if ($('compose-overlay').classList.contains('on')) closeCompose();
      }
    });
  }

  /* ---------- 启动 ---------- */
  bindEvents();
  bootstrap();
})();
