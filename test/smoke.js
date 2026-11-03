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
for (const f of ['config.js', 'local-backend.js', 'app.js']) {
  const js = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
  html = html.replace(
    new RegExp('<script src="' + f.replace('.', '\\.') + '"></script>'),
    '<script>' + js + '</script>'
  );
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1:8766/demo.html',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
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
