/* ============================================================
   孤岛浪花 · 活的背景海面
   ------------------------------------------------------------
   这不是一层贴上去的装饰动画，而是主界面真正所在的那片海。

   它的形态取自海图（bathymetric chart）的语言：
     · 等深线——一排排横贯画面的细线，就是海的水深结构
     · 计曲线——每第 4 根线加粗加亮，这是海图的老规矩
     · 流向——等深线被潮流推着走，方向与速度跟着真实潮汐走
       （涨潮往东、退潮往西，和左栏「潮势」读数一致）
     · 灯扫——每隔十几秒，一道信号光扫过海面，
       扫过之处等深线被点亮（这才是"夜航信号"的信号）
     · 浮沫——浪峰上偶尔亮起的一点白，浪越大越多

   数据全部来自 tide.js（与左栏潮位仪表同一个模型）：
     潮位高 → 浪更大、浮沫更多
     潮势正（涨）→ 流向东北；潮势负（退）→ 流向西南
     潮势接近零（平潮）→ 海面几乎静止下来

   还有一处联动：卡片被读走、退场的那一刻，
   它在海图上会留下一圈荡开的涟漪——
   "看过即消失"这件事，在背景上是真的看得见的。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 状态 ---------- */
  var canvas = null, ctx = null;
  var raf = 0, running = false, mounted = false;
  var W = 0, H = 0, dpr = 1;
  var t = 0, lastTs = 0;
  var contours = [];      // 等深线
  var sparks = [];        // 浮沫
  var pulses = [];        // 涟漪
  var grad = null, glow = null, sweepGrad = null;

  /* 潮流：flow 是「已经流过的距离」（累积），flowSpeed 是当前流速。
     之所以要累积而不是直接拿流速当偏移量——那样水面只会被挪到某个
     位置然后停住，不会真的"流"。累积之后，退潮时海会真的往回走。 */
  var flow = 0, flowSpeed = 0, flowTarget = 0;
  var level = 0.5, levelTarget = 0.5;   // 潮位归一化
  var range = 1.0;
  var ampNow = 1.0;                    // 当前浪高系数（随潮位平滑变化）

  var sweep = { on: false, x: -0.14, wait: 2.0, trail: [] };

  var reduced = false;

  /* 确定性伪随机：同一张图每次刷新位置一致，不会闪 */
  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 构建几何 ---------- */
  function build() {
    W = Math.max(320, global.innerWidth || 1024);
    H = Math.max(320, global.innerHeight || 768);
    dpr = clamp(global.devicePixelRatio || 1, 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 底色：上深下略沉，右侧有一团观测站的冷光。
       深浅差要够大——否则等深线再亮也显不出来。 */
    grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#03080A');
    grad.addColorStop(0.30, '#071317');
    grad.addColorStop(0.62, '#0C1D23');
    grad.addColorStop(1, '#050C0F');
    glow = ctx.createRadialGradient(W * 0.76, -H * 0.12, 0, W * 0.76, -H * 0.12, H * 0.95);
    glow.addColorStop(0, 'rgba(47,111,126,.30)');
    glow.addColorStop(1, 'rgba(47,111,126,0)');
    sweepGrad = ctx.createLinearGradient(0, 0, 0, H);
    sweepGrad.addColorStop(0, 'rgba(120,196,206,0)');
    sweepGrad.addColorStop(0.28, 'rgba(140,208,216,1)');
    sweepGrad.addColorStop(0.72, 'rgba(80,160,176,.7)');
    sweepGrad.addColorStop(1, 'rgba(47,111,126,0)');

    /* 等深线：越靠下越近，波纹越大、走得越快 */
    var count = clamp(Math.round(H / 30), 14, 30);
    contours = [];
    for (var i = 0; i < count; i++) {
      var depth = count > 1 ? i / (count - 1) : 0;
      contours.push({
        baseY: H * (0.03 + 0.94 * depth),
        depth: depth,
        /* 波长随深度变化：远处浪长而缓，近处浪短而碎。
           三层不同波长的正弦叠加，才不会像条形码那样整齐。 */
        k1: (Math.PI * 2) / (150 + depth * 460 + hash(i) * 160),
        k2: (Math.PI * 2) / (47 + depth * 96 + hash(i + 41) * 40),
        k3: (Math.PI * 2) / (23 + depth * 34 + hash(i + 77) * 16),
        ph1: hash(i) * 6.283,
        ph2: hash(i + 99) * 6.283,
        ph3: hash(i + 55) * 6.283,
        speed: 0.55 + depth * 0.9,      // 深水走得快，浅水走得慢
        amp: 2.2 + depth * 9,
        /* 上浅下深：靠近观察者的水更深，线也越淡（远处看不清） */
        alpha: 0.26 - depth * 0.17,
        lw: 0.9
      });
    }

    /* 浮沫：分布在整片海上 */
    sparks = [];
    for (var s = 0; s < 40; s++) {
      sparks.push({
        x: hash(s + 7) * W,
        y: hash(s + 31) * H,
        ph: hash(s + 3) * 6.283,
        sp: 0.5 + hash(s + 13) * 1.5,
        len: 2 + hash(s + 53) * 7
      });
    }
  }

  /* ---------- 绘制 ---------- */
  function paintBase() {
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function paintContours(dt) {
    var ampScale = 0.55 + level * 0.95;          // 潮位越高，浪越大
    ampNow = ampScale;
    var step = 22;
    ctx.lineCap = 'round';

    for (var i = 0; i < contours.length; i++) {
      var c = contours[i];
      var shift = flow * c.speed;                 // 累积位移：水面真的在流
      var baseY = c.baseY + (level - 0.5) * 20 * (0.35 + c.depth);

      ctx.beginPath();
      for (var x = -40; x <= W + 40; x += step) {
        /* 三层不同波长的正弦叠加：长浪托底、中浪推涌、短浪碎浪。
           只用一层正弦会规整得像条形码，三层错开才像水。 */
        var y = baseY
          + c.amp * ampScale * Math.sin(c.k1 * (x - shift) + c.ph1 + t * 0.04)
          + c.amp * 0.45 * ampScale * Math.sin(c.k2 * (x - shift * 1.7) + c.ph2 - t * 0.09)
          + c.amp * 0.22 * ampScale * Math.sin(c.k3 * (x - shift * 2.6) + c.ph3 + t * 0.15);

        // 涟漪：卡片退场时在这里推开水面
        for (var p = 0; p < pulses.length; p++) {
          var pu = pulses[p];
          var age = t - pu.t;
          if (age < 0 || age > 1.8) continue;
          var dx = x - pu.x, dy = y - pu.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 210) continue;
          y += 17 * Math.exp(-d / 82) * Math.sin(d / 25 - age * 7.5) * (1 - age / 1.8);
        }

        if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }

      if (c.index) {
        // 计曲线：海图的老规矩，每第 4 根加粗加亮
        ctx.strokeStyle = 'rgba(214,227,224,' + (c.alpha * (0.75 + level * 0.55)).toFixed(3) + ')';
        ctx.lineWidth = 1.3;
      } else {
        ctx.strokeStyle = 'rgba(72,150,166,' + (c.alpha * (0.75 + level * 0.6)).toFixed(3) + ')';
        ctx.lineWidth = c.lw;
      }
      ctx.stroke();
    }
  }

  /* 水面反光：把等深线的浪峰提亮一层。
     有了它，平面的线条才有起伏的体积感——否则只是几道画上去的线。 */
  function paintSheen() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < contours.length; i++) {
      var c = contours[i];
      if (i % 2 !== 0) continue;         // 每隔一条提一次，避免太密
      var shift = flow * c.speed;
      var baseY = c.baseY + (level - 0.5) * 20 * (0.35 + c.depth);
      ctx.beginPath();
      for (var x = -40; x <= W + 40; x += 26) {
        var y = baseY
          + c.amp * ampNow * Math.sin(c.k1 * (x - shift) + c.ph1 + t * 0.04)
          + c.amp * 0.45 * ampNow * Math.sin(c.k2 * (x - shift * 1.7) + c.ph2 - t * 0.09)
          + c.amp * 0.22 * ampNow * Math.sin(c.k3 * (x - shift * 2.6) + c.ph3 + t * 0.15);
        if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      // 只提亮浪峰那一侧：正弦上半段
      ctx.strokeStyle = 'rgba(120,196,206,' + (0.055 * (1 - c.depth * 0.5)).toFixed(3) + ')';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintSparks() {
    var live = Math.round(8 + 30 * level);   // 浪越大，浮沫越多
    for (var i = 0; i < sparks.length && i < live; i++) {
      var s = sparks[i];
      var tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      var a = tw * tw * (0.22 + 0.45 * level);
      if (a < 0.02) continue;
      var y = s.y + Math.sin(t * 0.42 + s.ph) * 3.5;
      ctx.fillStyle = 'rgba(214,227,224,' + a.toFixed(3) + ')';
      ctx.fillRect(s.x, y, s.len, 1);
    }
  }

  function paintSweep(dt) {
    if (!sweep.on) {
      sweep.wait -= dt;
      if (sweep.wait <= 0) { sweep.on = true; sweep.x = -0.14; sweep.trail.length = 0; }
    } else {
      sweep.x += dt * (1.25 / 3.6);
      sweep.trail.push(sweep.x);
      if (sweep.trail.length > 26) sweep.trail.shift();
      if (sweep.x > 1.14) { sweep.on = false; sweep.wait = 7.0; }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < sweep.trail.length; i++) {
      var px = sweep.trail[i] * W;
      var a = (i + 1) / sweep.trail.length;
      ctx.globalAlpha = 0.055 * a * a;
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(px - 1.5, 0, 3, H);
    }
    if (sweep.on) {
      // 信号灯本体：一条很淡的琥珀色竖线
      ctx.globalAlpha = 0.17;
      ctx.fillStyle = '#E0A24A';
      ctx.fillRect(sweep.x * W - 0.5, 0, 1.2, H);
    }
    ctx.restore();
  }

  function paintPulses() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var p = pulses.length - 1; p >= 0; p--) {
      var pu = pulses[p];
      var age = t - pu.t;
      if (age > 1.8) { pulses.splice(p, 1); continue; }
      var k = age / 1.8;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, 22 + k * 165, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224,162,74,' + (0.2 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = 1.2 * (1 - k) + 0.3;
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(dt) {
    ctx.clearRect(0, 0, W, H);
    paintBase();
    paintContours(dt);
    paintSheen();
    paintSparks();
    paintSweep(dt);
    paintPulses();
  }

  /* ---------- 主循环 ---------- */
  function frame(ts) {
    if (!running) return;
    raf = global.requestAnimationFrame(frame);
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;          // 切回标签页时不要跳一大步

    t += dt;
    // 流速与浪高都平滑趋近目标：掉头时才不会突兀
    flowSpeed += (flowTarget - flowSpeed) * Math.min(1, dt * 1.1);
    flow += flowSpeed * dt;            // 累积：海真的在流
    level += (levelTarget - level) * Math.min(1, dt * 0.7);
    draw(dt);
  }

  /* ---------- 对外接口 ---------- */
  var api = {
    mount: function (el) {
      canvas = el;
      if (!canvas) return;
      mounted = true;
      reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
      if (!ctx) { mounted = false; return; }   // 没有 canvas 支持：安静退场
      build();
      canvas.classList.add('on');            // 淡入：海面浮出来
      global.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibility);
      if (!reduced) {
        running = true;
        lastTs = 0;
        raf = global.requestAnimationFrame(frame);
      } else {
        // 不支持动画的环境：画一帧静态海面，海还在，只是不会动
        draw(0.016);
      }
    },
    unmount: function () {
      mounted = false;
      running = false;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      global.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (canvas) canvas.classList.remove('on');   // 海面退下去
      if (ctx) ctx.clearRect(0, 0, W, H);
    },
    /* 潮汐输入：level 归一化潮位、rate 潮势（厘米/小时）、range 本次落差 */
    setTide: function (lvl, r, rg) {
      levelTarget = clamp(lvl, 0, 1);
      range = rg;
      // 涨潮往东、退潮往西；平潮（潮势趋零）时海面几乎静止
      flowTarget = clamp(r / 55, -1, 1) * 16;
    },
    /* 涟漪：卡片读走时在它原本的位置推一下水面 */
    pulse: function (x, y) {
      pulses.push({ x: x, y: y, t: t });
      if (pulses.length > 4) pulses.shift();
    },
    info: function () {
      return {
        mounted: mounted,
        running: running,
        contours: contours.length,
        level: level,           // 当前值（正在平滑趋近目标）
        levelTarget: levelTarget, // 目标值（与左栏仪表读数同源）
        flow: flow,
        flowSpeed: flowSpeed,
        range: range,
        pulses: pulses.length
      };
    }
  };

  function onResize() {
    if (!mounted) return;
    build();
    if (ctx && !running) draw(0.016);
  }

  function onVisibility() {
    if (!mounted || reduced) return;
    if (document.hidden) {
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      running = false;
    } else if (!running) {
      running = true;
      lastTs = 0;
      raf = global.requestAnimationFrame(frame);
    }
  }

  global.ISLAND_SEA = api;
})(window);
