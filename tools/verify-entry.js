/* ============================================================
   登岛入口端到端验证
   ------------------------------------------------------------
   目的：确认「无参入口页 → 自动跳转 → 真实版登录页可用」这条链路
        在真实浏览器里真的走得通。

   为什么不用 curl：curl 只能验证单个 URL 返回什么，
   验证不了「页面加载后脚本是否真的跳了」「跳过去之后能不能用」。
   这里用 Chrome DevTools 协议驱动一个真实 headless Edge，
   走完整条链路并检查落点。

   用法：node tools/verify-entry.js
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9345;

const ENTRY = 'https://cry-88.github.io/island-wave-cards/entry.html';
const REAL = 'https://island-wave-cards.app.workbuddy.host';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function launchEdge() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iwd-entry-'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: 'ignore' });
  return { proc, profile };
}

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* 端口还没起来 */ }
    await sleep(250);
  }
  throw new Error('调试端口未就绪');
}

/* 极简 CDP 客户端 */
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error('CDP 连接失败'));
  });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }
  return { ready, send, events, close: () => ws.close() };
}

(async function run() {
  const { proc, profile } = launchEdge();
  const client = await (async () => {
    const url = await getTarget();
    const c = connect(url);
    await c.ready;
    return c;
  })();

  const results = [];
  const ok = (name, pass, extra) => {
    results.push({ name, pass, extra });
    console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  →  ' + extra : ''));
  };

  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    // 记下所有导航事件——这样能看到跳转链条
    const navs = [];
    client.events.length = 0;
    const collect = setInterval(() => {
      while (client.events.length) {
        const e = client.events.shift();
        if (e.method === 'Page.frameNavigated') {
          const u = e.params.frame && e.params.frame.url;
          if (u && !u.startsWith('about:')) navs.push(u);
        }
      }
    }, 100);

    console.log('=== 打开无参入口页 ===');
    await client.send('Page.navigate', { url: ENTRY });
    await sleep(1200);

    let r = await client.send('Runtime.evaluate', {
      expression: 'JSON.stringify({url: location.href, title: document.title, link: (document.getElementById("full-url")||{}).value || ""})',
      returnByValue: true
    });
    let state = JSON.parse(r.result.value);
    ok('入口页已加载', state.url.indexOf('entry.html') !== -1, state.url);
    ok('入口页 URL 无 query 参数', state.url.indexOf('?') === -1, state.url);
    ok('入口页给出了完整链接', state.link.indexOf('sharecode=') !== -1, state.link);

    console.log('');
    console.log('=== 等自动跳转（最多 12 秒）===');
    let landed = null;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      r = await client.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true
      });
      const u = r.result.value;
      if (u.indexOf('workbuddy.host') !== -1) { landed = u; break; }
    }
    ok('已跳转到真实版', !!landed, landed || '未跳转');

    if (landed) {
      ok('跳转后带上了 sharecode', landed.indexOf('sharecode=') !== -1, landed);

      // 等真实版渲染完，取页面关键元素
      await sleep(1500);
      r = await client.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          title: document.title,
          phone: !!document.getElementById('phone'),
          sendBtn: !!document.getElementById('send-code-btn'),
          wechat: !!document.getElementById('wechat-login-btn'),
          share: !!document.getElementById('share-btn'),
          shareText: (document.getElementById('share-hint')||{}).textContent || ''
        })`,
        returnByValue: true
      });
      state = JSON.parse(r.result.value);
      ok('真实版标题正确', state.title.indexOf('孤岛浪花') !== -1, state.title);
      ok('手机号输入框存在', state.phone);
      ok('「获取验证码」按钮存在', state.sendBtn);
      ok('「微信登录」按钮存在', state.wechat);
      ok('分享按钮存在', state.share);
    }

    console.log('');
    console.log('=== 导航链条 ===');
    navs.forEach((u, i) => console.log('  ' + (i + 1) + '. ' + u));

    clearInterval(collect);
  } catch (e) {
    console.error('验证过程出错：', e.message);
    results.push({ name: '验证过程', pass: false, extra: e.message });
  } finally {
    client.close();
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  const bad = results.filter(r => !r.pass);
  console.log('');
  if (bad.length) {
    console.log('!!! ' + bad.length + ' 项未通过');
    process.exit(1);
  }
  console.log('=== 端到端链路全部通过（' + results.length + ' 项）===');
  process.exit(0);
})();
