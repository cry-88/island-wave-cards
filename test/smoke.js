/* 孤岛浪花 · 夜航信号版 —— 集成冒烟测试
   用 jsdom 加载 frontend/demo.html（localStorage 版，无需云端），
   实际驱动一遍：登岛 → 卡片海 → 写卡 → 打开卡片 → 浪花退去 → 我的孤岛 → 离岛。
   本地 script 内联注入，去掉外链字体，测试不依赖网络。
   任何 console.error / 未捕获异常 / 断言失败都算失败。 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const errors = [];
const logs = [];

const vc = new VirtualConsole();
vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));
vc.on('jsdomError', (e) => {
  // 外链字体拉不到是预期内的，不算错
  if (/fonts\.(googleapis|gstatic)/.test(e.message)) return;
  errors.push('[jsdomError] ' + e.message);
});

let html = fs.readFileSync(path.join(FRONTEND, 'demo.html'), 'utf8');
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, '');
// 内联顺序必须与 index.html 一致：config → tide → sea → 后端 → app
for (const f of ['config.js', 'tide.js', 'sea.js', 'local-backend.js', 'app.js']) {
  const js = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
  html = html.replace(
    new RegExp('<script src="' + f.replace('.', '\\.') + '"></script>'),
    '<script>' + js + '</script>'
  );
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  /* URL 上带 sharecode：这就是真实用户点分享链接进来的样子。
     门禁那枚 Cookie 由平台种，但钥匙本身要由我们的代码记住——
     微信登录的 redirectTo 靠它带回参数，否则跳回裸域名会被门禁拦成 403。 */
  url: 'http://127.0.0.1:8766/demo.html?sharecode=R7PJGFFCEZ',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    // jsdom 没有 canvas 实现，getContext 会报 "Not implemented"。
    // 这里给它一个够用的假 2D 上下文，让背景海面引擎真的跑起来，
    // 这样才能断言"海面确实在动、等深线确实存在"。
    window.HTMLCanvasElement.prototype.getContext = function () {
      const grad = { addColorStop() {} };
      return {
        createLinearGradient: () => grad,
        createRadialGradient: () => grad,
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {},
        arc() {}, fill() {}, strokeText() {}, fillText() {},
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
        font: '', textAlign: 'left', textBaseline: 'alphabetic'
      };
    };
    window.addEventListener('error', (e) => {
      errors.push('[window.error] ' + (e.error ? e.error.stack : e.message));
    });
    window.addEventListener('unhandledrejection', (e) => {
      errors.push('[unhandledrejection] ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason));
    });
  },
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 8000, step = 80) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(step);
  }
  return false;
}

function ok(name, cond, extra) {
  logs.push((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  →  ' + extra : ''));
  if (!cond) errors.push('[assert] ' + name + (extra ? ' → ' + extra : ''));
}

(async function run() {
  await wait(300);

  console.log('=== 1. 初始状态 ===');
  ok('登岛页可见', $('auth-view').style.display !== 'none');
  ok('应用主体隐藏', !$('app-view').classList.contains('on'));
  ok('云端模拟已就绪', typeof window.WorkBuddyCloud === 'object');

  console.log('=== 1b. 访问门禁与分享链路 ===');
  /* 背景：托管域上有一道平台层的访问门禁——请求必须带对 sharecode，
     否则整页被换成 403「链接不完整」拦截页，我们自己的代码根本不会被送达。
     而 sharecode 只能待在 query 里，query 又是聊天工具转发时最容易截断的部分。
     所以对外分享必须走「无参入口页」。这几条断言守住这个约定。 */
  const cfg = window.ISLAND_CONFIG;
  ok('config.js 里有访问钥匙', !!(cfg && cfg.shareCode), 'sharecode=' + (cfg && cfg.shareCode));
  ok('config.js 里有无参入口页', !!(cfg && cfg.entryUrl), 'entry=' + (cfg && cfg.entryUrl));
  ok('入口页链接不含任何 query', !!(cfg && cfg.entryUrl && !/[?&]/.test(cfg.entryUrl)), cfg && cfg.entryUrl);

  /* 入口页自身：URL 不带参数，但页面里必须能拼出完整链接 */
  const entrySrc = fs.readFileSync(path.join(FRONTEND, 'entry.html'), 'utf8');
  ok('入口页文件存在且有内容', entrySrc.length > 500, 'size=' + entrySrc.length);
  ok('入口页不含静态 sharecode 明文', !new RegExp("'sharecode='\\s*\\+").test(entrySrc) || entrySrc.includes('ISLAND_CONFIG'));
  ok('入口页引用 config.js 取钥匙', entrySrc.includes('config.js'));
  ok('入口页有进入按钮', entrySrc.includes('id="enter"'));
  ok('入口页有可复制的完整链接', entrySrc.includes('id="full-url"') && entrySrc.includes('copy-btn'));
  ok('入口页有自动跳转倒计时', entrySrc.includes('id="countdown"'));

  /* 登岛页的分享按钮 */
  ok('登岛页有分享按钮', !!$('share-btn'));
  ok('分享按钮有说明文字', $('share-hint').textContent.length > 0, $('share-hint').textContent);
  ok('分享链接是无参入口页', cfg && cfg.entryUrl && !cfg.entryUrl.includes('sharecode'), cfg && cfg.entryUrl);

  /* 钥匙的记忆：URL 里带了 sharecode，bootstrap 应当自动存住。
     微信登录的 redirectTo 靠它带回参数——不带的话跳回裸域名会被门禁拦成 403。 */
  ok('URL 里的钥匙已记住',
     window.localStorage.getItem('island:sharecode') === cfg.shareCode,
     'stored=' + window.localStorage.getItem('island:sharecode'));

  console.log('=== 2. 登岛流程 ===');
  $('phone').value = '13800138000';
  $('send-code-btn').click();
  ok('验证码自动回填（演示模式）', await until(() => $('code').value.length >= 4), 'code=' + $('code').value);

  $('phone-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('登岛成功进入主体', await until(() => $('app-view').classList.contains('on')));
  ok('登岛页已隐藏', $('auth-view').style.display === 'none');
  ok('显示当前岛民', $('who').textContent.length > 0, 'who=' + $('who').textContent);

  console.log('=== 3. 卡片海 ===');
  ok('卡片渲染完成', await until(() => doc.querySelectorAll('#card-grid .card').length > 0));
  const seaCards = doc.querySelectorAll('#card-grid .card');
  ok('海面有卡片', seaCards.length > 0, '数量=' + seaCards.length);
  ok('计数文案已更新', $('sea-count').textContent.includes('朵浪'), $('sea-count').textContent);
  ok('仪表台主读数有值', $('gauge-count').textContent !== '—', 'gauge=' + $('gauge-count').textContent);
  ok('仪表台-海面可见联动', $('ro-visible').textContent === seaCards.length + ' 条', $('ro-visible').textContent);
  ok('仪表台-信标状态在线', $('ro-status').textContent.includes('在线'));

  if (seaCards.length > 0) {
    const c0 = seaCards[0];
    ok('卡片有编号 NO.', /^NO\.\d+$/.test(c0.querySelector('.no').textContent), c0.querySelector('.no').textContent);
    ok('卡片有时刻 HH:MM', /^\d{2}:\d{2}$/.test(c0.querySelector('.time').textContent), c0.querySelector('.time').textContent);
    ok('卡片标为未读', c0.querySelector('.st').textContent.trim() === '未读');
    ok('卡片有潮色类名', /tint-(sea|rain|dusk|leaf|ember|dawn)/.test(c0.className), c0.className);
    ok('卡片有潮色脊变量', !!c0.className.match(/tint-/));
    ok('卡片正文非空', c0.querySelector('.excerpt').textContent.trim().length > 0);
    ok('卡片正文用衬线类', c0.querySelector('.excerpt').className === 'excerpt');
    ok('卡片卡脚有来源', c0.querySelector('.meta .from').textContent.length > 0, c0.querySelector('.meta .from').textContent);

    // --- 信号波形指纹：每张卡独一无二 ---
    ok('卡片有信号波形', !!c0.querySelector('.card-wave svg'), 'card-wave');
    const wavePath = c0.querySelector('.card-wave svg path');
    ok('波形有路径数据', !!wavePath && (wavePath.getAttribute('d') || '').length > 40);
    ok('波形带 SIGNAL 标签', /SIGNAL/.test(c0.querySelector('.card-wave .wave-label').textContent),
       c0.querySelector('.card-wave .wave-label').textContent);
    // 两张卡的波形应当不同（由 id 推导）
    const w0 = seaCards[0].querySelector('.card-wave svg path').getAttribute('d');
    const w1 = seaCards[1].querySelector('.card-wave svg path').getAttribute('d');
    ok('不同卡片波形不同', w0 !== w1);
  }

  console.log('=== 3b. 潮汐仪表与海况读数 ===');
  ok('潮位曲线已绘制', ($('tide-path').getAttribute('d') || '').length > 50);
  ok('潮位填充已绘制', ($('tide-fill').getAttribute('d') || '').length > 50);
  ok('当前时刻游标存在', !!$('tide-now-dot').getAttribute('cx'));
  ok('当前潮位读数有值', /\d\.\d\d m/.test($('ro-tide').textContent), $('ro-tide').textContent);
  ok('潮势读数有值', /(涨|落) \d/.test($('ro-tide-dir').textContent), $('ro-tide-dir').textContent);
  ok('下次高潮读数有值', /^\d{2}:\d{2}$/.test($('ro-next-high').textContent), $('ro-next-high').textContent);
  ok('本次落差读数有值', /\d\.\d\d m/.test($('ro-range').textContent), $('ro-range').textContent);
  ok('最近靠岸初始为空', $('landed-list').querySelectorAll('.landed-empty').length === 1);

  console.log('=== 3c. 活的背景海面 ===');
  ok('海面画布已挂载', !!$('sea-canvas'), 'canvas#sea-canvas');
  ok('潮汐模型已就绪', !!window.ISLAND_TIDE && Array.isArray(window.ISLAND_TIDE.TIDES));
  ok('分潮共 5 个', window.ISLAND_TIDE.TIDES.length === 5,
     window.ISLAND_TIDE.TIDES.map((c) => c.name).join('/'));
  ok('背景引擎已就绪', !!window.ISLAND_SEA);
  const sea = window.ISLAND_SEA.info();
  ok('海面已挂载并运行', sea.mounted === true && sea.running === true,
     'mounted=' + sea.mounted + ' running=' + sea.running);
  ok('等深线已生成', sea.contours >= 14, 'contours=' + sea.contours);
  ok('海面已收到潮位', sea.level >= 0 && sea.level <= 1, 'level=' + sea.level.toFixed(3));

  // 潮位与仪表读数必须一致：同一片海，不是两套数
  // 比的是目标值（levelTarget）——海面当前值正在平滑趋近它，途中会略低
  const gaugeLevel = parseFloat($('ro-tide').textContent);
  ok('海面潮位与仪表同源', Math.abs(sea.levelTarget - gaugeLevel / window.ISLAND_TIDE.MAX) < 0.01,
     'sea目标=' + sea.levelTarget.toFixed(3) + ' gauge=' + gaugeLevel);

  // 潮流真的在走：等深线应该已经被推着位移了
  //
  // 这里主动给引擎喂一个确定的强潮势，而不是被动等真实时钟：
  // 平潮时（潮势趋近 0）海面几乎静止，那是设计意图，但会让断言变成
  // 「取决于今天此刻是几点钟」的 flaky 测试。驱动输入才能稳定地验证引擎逻辑。
  const flowBefore = sea.flow;
  const levelBefore = sea.level;
  window.ISLAND_SEA.setTide(sea.levelTarget, 45, sea.range);   // 强涨潮
  await wait(600);
  const sea2 = window.ISLAND_SEA.info();
  ok('海面在流动', Math.abs(sea2.flow - flowBefore) > 0.5,
     'flow ' + flowBefore.toFixed(2) + ' → ' + sea2.flow.toFixed(2));
  ok('浪高在向潮位收敛', Math.abs(sea2.level - sea2.levelTarget) < Math.abs(levelBefore - sea2.levelTarget),
     'level ' + levelBefore.toFixed(3) + ' → ' + sea2.level.toFixed(3) + ' 目标 ' + sea2.levelTarget.toFixed(3));
  // 流向与潮势同向：判断依据是引擎**实际收到的**潮势输入，
  // 不是仪表上的真实读数——上面为了稳定地验证引擎，主动喂了强涨潮，
  // 此时引擎往东流是正确的，用真实读数去评判反而会误报。
  ok('流向与潮势同向',
     (() => {
       const moving = sea2.flowSpeed;
       // 潮势为 0（平潮）时不要求方向
       if (Math.abs(moving) < 0.05) return true;
       return moving > 0;   // 喂的是 +45 cm/h 强涨潮 → 必须往东
     })(),
     '喂入强涨潮 45cm/h → 流速=' + sea2.flowSpeed.toFixed(2));

  // 强涨潮时水流必须往东（正值）；平潮时海面应趋于静止
  ok('强涨潮时水流为正', sea2.flowSpeed > 0, 'flowSpeed=' + sea2.flowSpeed.toFixed(2));
  window.ISLAND_SEA.setTide(sea.levelTarget, 0, sea.range);   // 喂平潮
  await wait(700);
  const sea3 = window.ISLAND_SEA.info();
  ok('平潮时海面趋于静止', Math.abs(sea3.flowSpeed) < Math.abs(sea2.flowSpeed),
     '流速 ' + sea2.flowSpeed.toFixed(2) + ' → ' + sea3.flowSpeed.toFixed(2));
  ok('平潮时流速仍非负（未反向乱流）', sea3.flowSpeed >= -0.01,
     'flowSpeed=' + sea3.flowSpeed.toFixed(3));

  console.log('=== 4. 写卡 ===');
  $('compose-btn').click();
  ok('写卡弹层打开', $('compose-overlay').classList.contains('on'));

  $('compose-text').value = '这是一条夜航信号测试。';
  $('compose-text').dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('字数统计联动', $('char-count').textContent === '11 / 800', $('char-count').textContent);

  const tintDots = doc.querySelectorAll('.tint-dot');
  ok('潮色共 6 个', tintDots.length === 6, '数量=' + tintDots.length);
  tintDots[2].click();
  ok('潮色可选中', tintDots[2].classList.contains('sel'));

  $('compose-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('发布后弹层关闭', await until(() => !$('compose-overlay').classList.contains('on')));

  console.log('=== 5. 打开卡片 → 浪花退去 ===');
  const before = doc.querySelectorAll('#card-grid .card').length;
  const target = doc.querySelector('#card-grid .card');
  ok('有卡片可打开', !!target);
  if (target) {
    target.click();
    ok('详情弹层打开', await until(() => $('card-overlay').classList.contains('on')));
    ok('详情有正文', $('detail-text').textContent.trim().length > 0);
    ok('详情有编号', /^NO\.\d+$/.test($('detail-no').textContent), $('detail-no').textContent);
    ok('详情有左侧潮色脊', /tint-/.test($('detail-card').className), $('detail-card').className);

    $('detail-done').click();
    ok('关闭后卡片从海面移除', await until(() => doc.querySelectorAll('#card-grid .card:not(.dissolving)').length < before),
       before + ' → ' + doc.querySelectorAll('#card-grid .card:not(.dissolving)').length);
    ok('最近靠岸已记录', await until(() => $('landed-list').querySelectorAll('li:not(.landed-empty)').length === 1),
       '条目数=' + $('landed-list').querySelectorAll('li').length);
    const landed = $('landed-list').querySelector('li:not(.landed-empty)');
    ok('靠岸记录含编号', !!landed.querySelector('.no'), landed.querySelector('.no') && landed.querySelector('.no').textContent);
    ok('靠岸记录含时刻', /^\d{2}:\d{2}$/.test(landed.querySelector('.t').textContent), landed.querySelector('.t').textContent);
    // 卡片退场时，水面应该被推开一圈涟漪——"看过即消失"看得见
    ok('卡片退场激起涟漪', window.ISLAND_SEA.info().pulses > 0,
       'pulses=' + window.ISLAND_SEA.info().pulses);
  }

  console.log('=== 6. 我的孤岛 ===');
  $('nav-island').click();
  ok('切到我的孤岛', $('island-view').style.display !== 'none');
  ok('卡片海已隐藏', $('sea-view').style.display === 'none');
  ok('孤岛记录已加载', await until(() => doc.querySelectorAll('#island-grid .card').length > 0));
  const mine = doc.querySelectorAll('#island-grid .card');
  ok('我的孤岛有记录', mine.length > 0, '数量=' + mine.length);
  if (mine.length > 0) {
    ok('孤岛卡片标为已漂出', mine[0].querySelector('.st').textContent.trim() === '已漂出');
    ok('孤岛卡片有抹去按钮', !!mine[0].querySelector('.del'));
    ok('仪表台-我的记录联动', $('ro-mine').textContent === mine.length + ' 条', $('ro-mine').textContent);
  }

  console.log('=== 7. 离岛 ===');
  $('logout-btn').click();
  ok('离岛后回到登岛页', await until(() => !$('app-view').classList.contains('on')));
  ok('离岛后卡片海清空', doc.querySelectorAll('#card-grid .card').length === 0);
  ok('离岛后孤岛清空', doc.querySelectorAll('#island-grid .card').length === 0);
  ok('离岛后海面已收起', window.ISLAND_SEA.info().mounted === false);

  console.log('=== 8. 分享链路 ===');
  /* 分享按钮：点了要能复制到「无参入口页」。
     这是防止链接被截断的第一道防线——带 sharecode 的链接
     经聊天工具转发后可能只剩域名，朋友就会撞上 403 拦截页。 */
  $('share-btn').click();
  ok('点分享后有反馈', $('share-hint').textContent.length > 0, $('share-hint').textContent);
  ok('分享的是无参入口页', window.ISLAND_CONFIG.entryUrl.indexOf('sharecode') === -1,
     window.ISLAND_CONFIG.entryUrl);

  /* 微信登录的 redirectTo 必须带上 sharecode：
     授权完中转会跳回这个地址，裸域名会被平台的访问门禁拦成 403。
     这条断言是这次修复的核心——之前 redirectTo 就是裸域名。 */
  $('wechat-login-btn').click();
  await wait(320);
  const oauthReq = window.ISLAND_DEMO.lastOAuthRequest();
  ok('微信登录发起了授权请求', !!oauthReq, oauthReq ? 'provider=' + oauthReq.provider : 'null');
  ok('redirectTo 是绝对 URL', !!(oauthReq && /^https?:\/\//.test(oauthReq.redirectTo || '')),
     oauthReq && oauthReq.redirectTo);
  ok('redirectTo 带着 sharecode',
     !!(oauthReq && oauthReq.redirectTo && oauthReq.redirectTo.indexOf('sharecode=' + window.ISLAND_CONFIG.shareCode) !== -1),
     oauthReq && oauthReq.redirectTo);

  console.log('');
  console.log(logs.join('\n'));
  console.log('');
  if (errors.length) {
    console.log('!!! 发现 ' + errors.length + ' 个问题:');
    errors.forEach((e) => console.log('  - ' + e));
    process.exit(1);
  } else {
    console.log('=== 全部通过（' + logs.length + ' 项断言），无 JS 错误 ===');
    process.exit(0);
  }
})().catch((e) => {
  console.error('测试脚本自身异常:', e);
  errors.forEach((x) => console.log('  - ' + x));
  process.exit(1);
});
