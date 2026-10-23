/* ============================================================
   孤岛卡片 · 本地演示后端（local-backend.js）
   ------------------------------------------------------------
   用浏览器 localStorage 模拟 WorkBuddy Cloud 的认证与数据库，
   API 形状与云端版保持一致，因此 app.js 几乎不需要改动：

     window.WorkBuddyCloud.createWorkBuddyCloud(opts)
       -> { auth: { getSession, sendOtp, verifyOtp, signOut,
                    signInWithOAuth, handleWechatWebCallback,
                    onAuthStateChange },
            database: { from(table) -> 查询构建器 } }

   与云端版的对应关系：
   - auth.*          ↔ 云端手机号 OTP / 微信登录（演示模式自动给出验证码）
   - cards 表        ↔ 云端 cards（owner_id 由后端附加，客户端绝不发送）
   - card_seen 表    ↔ 云端 card_seen（仅本人可读写）
   - 「看过即消失」   ↔ 云端由 RLS 策略强制执行，这里由读取时过滤实现
   - 其他岛漂来的卡  ↔ 演示用模拟器：每隔一段时间海上会多一朵新浪
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 存储键 ---------- */
  var KEYS = {
    users:   'island.users',    // { phone: { id, phone, createdAt } }
    session: 'island.session',  // { user: { id, phone } } | null
    otp:     'island.otp',      // { phone, code, verificationId, expiresAt }
    cards:   'island.cards',    // [{ id, owner_id, content, tint, created_at }]
    seen:    'island.seen',     // { userId: [cardId, ...] }
    seq:     'island.seq',      // 自增 id 游标（用户卡片从 5000 起，避开种子卡 1001+）
    sim:     'island.simCount'  // 模拟其他岛已漂出的卡片数（上限 30）
  };

  var TINTS = ['sea', 'rain', 'dusk', 'leaf', 'ember', 'dawn'];
  var SIM_CAP = 30;

  /* ---------- 存储（file:// 或隐私模式下 localStorage 可能不可用，退化为内存） ---------- */
  var storageOk = true;
  try {
    var probe = '__island_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch (err) {
    storageOk = false;
  }
  var memory = {};

  function read(key, dflt) {
    try {
      var raw = storageOk ? window.localStorage.getItem(key) : memory[key];
      if (raw == null) return dflt;
      var val = JSON.parse(raw);
      return val == null ? dflt : val;
    } catch (err) {
      return dflt;
    }
  }

  function write(key, val) {
    var raw = JSON.stringify(val);
    if (storageOk) {
      try { window.localStorage.setItem(key, raw); } catch (err) { memory[key] = raw; }
    } else {
      memory[key] = raw;
    }
  }

  function resetAll() {
    Object.keys(KEYS).forEach(function (k) {
      if (storageOk) {
        try { window.localStorage.removeItem(KEYS[k]); } catch (err) { /* ignore */ }
      }
      delete memory[KEYS[k]];
    });
  }

  /* ---------- 种子卡片：十朵来自其他岛的浪 ---------- */
  var SEED_CARDS = [
    { owner: 'seed-01', tint: 'sea',  hoursAgo: 1,
      content: '凌晨三点还是睡不着。倒水的时候看见窗外的月亮，忽然想起你说，月亮是古人寄给今人的信。那我今晚收到的这封，写了什么呢。' },
    { owner: 'seed-02', tint: 'rain', hoursAgo: 4,
      content: '今天在地铁上哭了一个站。\n不是发生了什么大事，只是有人给我让座，我突然就崩了。\n原来我已经很久没被人照顾过了。' },
    { owner: 'seed-03', tint: 'dusk', hoursAgo: 9,
      content: '把三年的聊天记录翻完，又全部删了。不是放下了，是不敢留着。\n有些东西像潮水，退下去一次，就再也不回到那条线了。' },
    { owner: 'seed-04', tint: 'leaf', hoursAgo: 20,
      content: '辞职信写了四版，最后发出去的那版只有一行字。\n领导秒回「想好了？」。\n想好了。这三年没有一天是想好的，但今天想好了。' },
    { owner: 'seed-05', tint: 'ember', hoursAgo: 30,
      content: '外婆走后的第三年，我终于敢整理她的抽屉。\n她的老花镜压在毛线针下面，镜腿上还缠着一小段没织完的枣红色。\n我把那段毛线绕在手指上，绕了很多圈。' },
    { owner: 'seed-06', tint: 'dawn', hoursAgo: 40,
      content: '复诊结果一切正常。走出医院的时候阳光很好，我在马路对面买了一个烤红薯，站着吃完了。\n原来「正常」两个字，是这么烫，这么甜。' },
    { owner: 'seed-07', tint: 'sea', hoursAgo: 52,
      content: '有时候会想，如果当初勇敢一点点，现在陪你看烟花的人会不会是我。\n但烟花早就散了，我连你坐在哪看的都记不清了。\n只记得那天的风很大。' },
    { owner: 'seed-08', tint: 'rain', hoursAgo: 62,
      content: '妈今天打电话来，问我钱够不够花。\n我说够。\n其实不够。但她说「不够要讲」的时候，我差点就讲了。' },
    { owner: 'seed-09', tint: 'leaf', hoursAgo: 69,
      content: '考上了。\n没有人可以分享，所以讲给这片海听。\n如果你看到了，就算你见证过。' },
    { owner: 'seed-10', tint: 'dusk', hoursAgo: 74,
      content: '我又梦见他了。梦里我们和好了，醒来以后枕头是干的，心是湿的。\n听说梦到一个人三次，缘尽。\n这是第三次。' }
  ];

  /* ---------- 模拟其他岛的卡片池（循环取用） ---------- */
  var DRIFT_CARDS = [
    '匿名树洞第 47 天：今天有人夸我外套好看，我开心了一整天。原来快乐可以这么便宜。',
    '把想说的话打成字，又一个一个删掉。最后发出去的只有「嗯嗯」。\n我这个人，连倾诉都是打折的。',
    '凌晨的便利店是城市唯一还亮着灯的地方。关东煮的热气糊在玻璃上，像我糊住的人生。',
    '今天第一次独自吃了两人份的火锅。服务员问几位，我说两位，另一位在路上。\n其实没有另一位。',
    '面试被拒第七次。HR 说「你很优秀，只是不合适」。\n我知道这是客套，但我还是把它存下来了。',
    '猫死了，十二年。我抱着它走完了最后一段路，它的身体轻得像一件旧毛衣。\n原来告别是这么轻的一件事。',
    '存钱去看了海。真的海。比我梦里的还要吵。\n我在岸边坐了一下午，一句话也没说，但好像什么都说了。',
    '结婚十年，他今天顺手买了一袋菜花，说炒着吃。\n我笑着笑着就哭了。我要的从来不是花，是「顺手」。',
    '考公第三年，差 0.5 分。我妈说没关系。她越没关系，我越有关系。',
    '在地铁上给一位老人让座，他连连道谢。\n我说不用谢，他坚持要谢。\n原来被感谢是这种感觉，像欠了很久的债被还上了。',
    '今天卸载了微博。不是戒掉了什么，是终于承认刷了三年，一条也不记得。',
    '父亲住院，我陪夜。他睡着以后我握着他的手，发现我的手掌已经比他大了。\n这个认知让我在原地站了很久。',
    '写了一首很烂的歌，弹给风听。风没有鼓掌，但也没有走。',
    '分手那天很平静。我们一起吃了散伙饭，AA 制，找零他买了两瓶水，一人一瓶。\n爱情结束的时候，原来是这种声音：易拉罐打开的声音。',
    '高考前一夜，全班在教室里用投影仪看电影。放到一半灯灭了，有人开始哭。\n后来我们再也没有聚齐过。',
    '第一次一个人做完手术。签字的时候手在抖，但笔迹很稳。\n原来长大就是抖着把字签完。',
    '他把我拉黑了。我用小号看了一眼，他过得很好，笑得很大声。\n嗯，那就好。我是说真的。',
    '楼下的桂花开了。外婆家的院子里也有一棵，她总说桂花要下了雨才香。\n今年故乡没有下雨，这里的桂花也不香。',
    '今天发工资，给妈妈转了五千。她退了回来说你自己留着。\n我又转过去，她收了。\n这一来一回，就是我们之间的爱。',
    '三十岁生日，只有银行和运营商记得。\n我自己煮了一碗面，加了个蛋。\n蛋是溏心的，像我这半熟的人生。',
    '吵赢了一场架，输了整个人。回家路上一直在想那句话重说一遍会怎样。\n想不出来，风太大了。',
    '在旧大衣口袋里摸到一张电影票根，2019 年的，字都磨没了。\n我记得那场电影很难看，但我笑得很开心。',
    '咨询师问我：你上次觉得安全是什么时候。\n我想了二十分钟，说可能是六岁，发烧，我妈背着我去医院。\n说着就哭了。二十八岁的人，在诊室里找六岁。',
    '把房子退了，东西卖了，买了张单程票。\n不知道去哪，但知道不能再待在原地了。\n海啊，如果我沉了，记得捞我一下。'
  ];

  /* ---------- 基础工具 ---------- */
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function copy(row) {
    var out = {};
    Object.keys(row).forEach(function (k) { out[k] = row[k]; });
    return out;
  }

  function currentUser() {
    var s = read(KEYS.session, null);
    return s && s.user ? s.user : null;
  }

  function nextId() {
    var seq = read(KEYS.seq, 5000);
    seq += 1;
    write(KEYS.seq, seq);
    return seq;
  }

  function seenSet(uid) {
    var all = read(KEYS.seen, {});
    return new Set((all[uid] || []).map(Number));
  }

  /* ---------- 种子与模拟器 ---------- */
  var seeded = false;

  function ensureSeeded() {
    if (seeded) return;
    seeded = true;
    if (read(KEYS.cards, null) !== null) return; // 已有数据（含空数组）不重复播种
    var now = Date.now();
    var seeds = SEED_CARDS.map(function (s, i) {
      return {
        id: 1001 + i,
        owner_id: s.owner,
        content: s.content,
        tint: s.tint,
        created_at: new Date(now - s.hoursAgo * 3600 * 1000).toISOString()
      };
    });
    write(KEYS.cards, seeds);
    write(KEYS.seq, 5000);
    write(KEYS.sim, 0);
  }

  var simStarted = false;

  function startSimulator() {
    if (simStarted) return;
    simStarted = true;
    setTimeout(function tick() {
      var count = read(KEYS.sim, 0);
      if (count < SIM_CAP) {
        var text = DRIFT_CARDS[count % DRIFT_CARDS.length];
        var list = read(KEYS.cards, []);
        list.push({
          id: nextId(),
          owner_id: 'drift-' + count,
          content: text,
          tint: TINTS[Math.floor(Math.random() * TINTS.length)],
          created_at: new Date().toISOString()
        });
        write(KEYS.cards, list);
        write(KEYS.sim, count + 1);
      }
      setTimeout(tick, 35000 + Math.random() * 45000);
    }, 16000 + Math.random() * 9000);
  }

  /* ---------- 查询构建器（PostgREST 风格的链式调用） ---------- */
  function Query(table) {
    this._table = table;
    this._op = 'select';
    this._cols = '*';
    this._where = [];
    this._order = null;
    this._limit = null;
    this._payload = null;
    this._returning = false;
    this._promise = null;
  }

  Query.prototype.select = function (cols) {
    this._cols = cols || '*';
    this._returning = true;
    return this;
  };

  Query.prototype.insert = function (row) {
    this._op = 'insert';
    this._payload = row || {};
    return this;
  };

  Query.prototype.delete = function () {
    this._op = 'delete';
    return this;
  };

  Query.prototype.eq = function (col, val) {
    this._where.push({ t: 'eq', col: col, val: val });
    return this;
  };

  Query.prototype.neq = function (col, val) {
    this._where.push({ t: 'neq', col: col, val: val });
    return this;
  };

  Query.prototype.not = function (col, op, val) {
    // 仅支持 not('id', 'in', '(1,2,3)')
    if (op === 'in') {
      var ids = String(val).replace(/[()\s]/g, '').split(',')
        .filter(function (x) { return x !== ''; })
        .map(Number);
      this._where.push({ t: 'notIn', col: col, val: ids });
    }
    return this;
  };

  Query.prototype.order = function (col, opts) {
    this._order = { col: col, asc: !!(opts && opts.ascending) };
    return this;
  };

  Query.prototype.limit = function (n) {
    this._limit = n;
    return this;
  };

  Query.prototype._matches = function (row) {
    for (var i = 0; i < this._where.length; i++) {
      var w = this._where[i];
      if (w.t === 'eq' && row[w.col] !== w.val) return false;
      if (w.t === 'neq' && row[w.col] === w.val) return false;
      if (w.t === 'notIn' && w.val.indexOf(Number(row[w.col])) >= 0) return false;
    }
    return true;
  };

  Query.prototype._project = function (rows) {
    if (this._cols === '*') return rows.map(copy);
    var cols = this._cols.split(',').map(function (c) { return c.trim(); });
    return rows.map(function (r) {
      var out = {};
      cols.forEach(function (c) { if (c in r) out[c] = r[c]; });
      return out;
    });
  };

  Query.prototype._select = function () {
    var uid = currentUser() ? currentUser().id : null;
    var rows;
    if (this._table === 'cards') {
      rows = read(KEYS.cards, []);
    } else if (this._table === 'card_seen') {
      // 与云端策略一致：只能看见自己的阅读记录
      var all = read(KEYS.seen, {});
      rows = uid ? (all[uid] || []).map(function (cid) {
        return { owner_id: uid, card_id: cid };
      }) : [];
    } else {
      rows = [];
    }

    // 前端携带的查询条件
    rows = rows.filter(this._matches, this);

    // —— 本地「RLS」：与云端策略等价的读取过滤 ——
    // cards：不是自己的卡片，且自己没有看过，才可见
    if (this._table === 'cards' && uid) {
      var seen = seenSet(uid);
      rows = rows.filter(function (r) {
        return (r.owner_id !== uid && !seen.has(Number(r.id))) || r.owner_id === uid;
      });
    }

    if (this._order) {
      var col = this._order.col;
      var dir = this._order.asc ? 1 : -1;
      rows = rows.slice().sort(function (a, b) {
        if (a[col] === b[col]) return 0;
        return (a[col] > b[col] ? 1 : -1) * dir;
      });
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return this._project(rows);
  };

  Query.prototype._insert = function () {
    var user = currentUser();
    if (!user) throw new Error('尚未登岛，无法写入');

    if (this._table === 'cards') {
      var content = String(this._payload.content == null ? '' : this._payload.content);
      if (!content) throw new Error('卡片内容不能为空');
      if (content.length > 800) throw new Error('卡片太长，海装不下（最多 800 字）');
      var tint = TINTS.indexOf(this._payload.tint) >= 0
        ? this._payload.tint
        : TINTS[Math.floor(Math.random() * TINTS.length)];
      var row = {
        id: nextId(),
        owner_id: user.id, // 对应云端版的 DEFAULT auth.uid()
        content: content,
        tint: tint,
        created_at: new Date().toISOString()
      };
      var list = read(KEYS.cards, []);
      list.push(row);
      write(KEYS.cards, list);
      return this._returning ? [copy(row)] : [];
    }

    if (this._table === 'card_seen') {
      var cid = Number(this._payload.card_id);
      var all = read(KEYS.seen, {});
      var mine = all[user.id] || [];
      if (mine.indexOf(cid) < 0) {
        mine.push(cid);
        all[user.id] = mine;
        write(KEYS.seen, all);
      }
      // 对应云端 (owner_id, card_id) UNIQUE：重复记录视为成功
      return this._returning ? [{ owner_id: user.id, card_id: cid }] : [];
    }

    return [];
  };

  Query.prototype._delete = function () {
    var user = currentUser();
    var list = read(KEYS.cards, []);
    var removed = [];
    var keep = [];
    var self = this;
    list.forEach(function (r) {
      // 与云端策略一致：只能抹去自己的卡片
      if (user && r.owner_id === user.id && self._matches(r)) {
        removed.push(r);
      } else {
        keep.push(r);
      }
    });
    write(KEYS.cards, keep);
    return this._returning ? removed.map(copy) : [];
  };

  Query.prototype._run = function () {
    if (this._op === 'insert') return this._insert();
    if (this._op === 'delete') return this._delete();
    return this._select();
  };

  Query.prototype.then = function (onFulfilled, onRejected) {
    if (!this._promise) {
      var self = this;
      this._promise = delay(60 + Math.random() * 120).then(function () {
        try {
          return { data: self._run(), error: null };
        } catch (err) {
          return { data: null, error: { message: String((err && err.message) || err) } };
        }
      });
    }
    return this._promise.then(onFulfilled, onRejected);
  };

  Query.prototype.catch = function (onRejected) {
    return this.then(null, onRejected);
  };

  /* ---------- 认证 ---------- */
  var authListeners = [];

  var authApi = {
    getSession: function () {
      return delay(40).then(function () {
        return { data: read(KEYS.session, null), error: null };
      });
    },

    sendOtp: function (opts) {
      var phone = String((opts && opts.phone) || '').trim();
      if (!/^1\d{10}$/.test(phone)) {
        return delay(60).then(function () {
          return { data: null, error: { message: '请输入正确的 11 位手机号' } };
        });
      }
      var code = String(Math.floor(Math.random() * 900000) + 100000);
      var verificationId = 'vb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      write(KEYS.otp, {
        phone: phone,
        code: code,
        verificationId: verificationId,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      var users = read(KEYS.users, {});
      return delay(500).then(function () {
        return {
          data: {
            verificationId: verificationId,
            isExistingUser: !!users[phone],
            // 演示模式专有字段：本地生成验证码，直接回显供前端自动填入
            demoCode: code
          },
          error: null
        };
      });
    },

    verifyOtp: function (opts) {
      var phone = String((opts && opts.phone) || '').trim();
      var token = String((opts && opts.token) || '').trim();
      var vid = opts && opts.verificationId;
      var otp = read(KEYS.otp, null);
      return delay(500).then(function () {
        if (!otp || otp.phone !== phone || otp.verificationId !== vid) {
          return { data: null, error: { message: '请先获取验证码。' } };
        }
        if (otp.expiresAt < Date.now()) {
          return { data: null, error: { message: '验证码已过期，请重新获取。' } };
        }
        if (otp.code !== token) {
          return { data: null, error: { message: '验证码有误，请重新输入。' } };
        }
        var users = read(KEYS.users, {});
        if (!users[phone]) {
          users[phone] = { id: 'u_' + phone, phone: phone, createdAt: new Date().toISOString() };
          write(KEYS.users, users);
        }
        var session = { user: { id: users[phone].id, phone: phone } };
        write(KEYS.session, session);
        write(KEYS.otp, null);
        return { data: session, error: null };
      });
    },

    signOut: function () {
      write(KEYS.session, null);
      authListeners.forEach(function (cb) {
        try { cb('SIGNED_OUT'); } catch (err) { /* ignore */ }
      });
      return delay(40).then(function () { return { error: null }; });
    },

    signInWithOAuth: function () {
      return delay(200).then(function () {
        return {
          data: null,
          error: { message: '演示模式暂不支持微信登录——请用手机号登岛（微信登录需要在网站正式发布后进行）。' }
        };
      });
    },

    handleWechatWebCallback: function () {
      return delay(200).then(function () {
        return { data: null, error: { message: '演示模式不支持微信授权回调，请用手机号登岛。' } };
      });
    },

    onAuthStateChange: function (cb) {
      if (typeof cb === 'function') authListeners.push(cb);
      return { data: { subscription: { unsubscribe: function () { /* noop */ } } } };
    }
  };

  /* ---------- 入口 ---------- */
  function createWorkBuddyCloud(opts) {
    // opts.demoMode 仅作标记：本地后端不需要任何密钥或网络
    ensureSeeded();
    startSimulator();
    return {
      auth: authApi,
      database: {
        from: function (table) { return new Query(table); }
      }
    };
  }

  window.WorkBuddyCloud = { createWorkBuddyCloud: createWorkBuddyCloud };

  // 供前端演示功能使用（重置数据 / 查询存储可用性）
  window.ISLAND_DEMO = {
    reset: resetAll,
    storageOk: storageOk,
    version: 'local-demo-1'
  };
})();
