/* ============================================================
   孤岛浪花 · 活海背景动图抓帧器
   ------------------------------------------------------------
   目的：README 里放一张 GIF，直观展示"背景是活的"。
   做法：用 Chrome DevTools 协议直连一个 headless Edge 实例，
        在**同一个页面**上按固定间隔连续截图。
        为什么不用「多次启动浏览器分别截图」：
        那样每次都是全新会话，卡片内容与海面相位都不一样，
        拼出来的 GIF 会跳帧。同一实例连拍才能拍到同一片海在流动。

   用法：node tools/capture-gif.js <输出目录>
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const FRONTEND = path.join(__dirname, '..', 'frontend');
const OUT = process.argv[2] || path.join(__dirname, '..', 'assets', '_frames');

// 要拍的画面：主界面的海面（等深线 + 灯扫 + 浮沫 + 涟漪）
// 宽度必须够宽：窄于此会触发响应式布局，卡片堆叠成一列，海面被卡片挡住
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 12;          // 抓帧率
const SECONDS = 4;       // 总时长

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- 启动 headless Edge 并开启调试端口 ---------- */
function launchEdge() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iwd-gif-'));
  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  proc.on('error', (e) => {
    console.error('无法启动 Edge：', e.message);
    process.exit(1);
  });
  return { proc, profile };
}

/* ---------- 等调试端口就绪，拿到 webSocketDebuggerUrl ---------- */
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

/* ---------- 极简 CDP 客户端 ---------- */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      close() { ws.close(); }
    }));
    ws.addEventListener('error', (e) => reject(new Error('WS 连接失败')));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result);
      }
    });
  });
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const { proc, profile } = launchEdge();
  let cdp = null;
  try {
    const wsUrl = await getTarget();
    cdp = await connect(wsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
    });

    // 打开演示版（本地后端，无需云端）
    const url = 'file:///' + path.join(FRONTEND, 'demo.html').replace(/\\/g, '/');
    await cdp.send('Page.navigate', { url });

    // 等页面加载完
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r.result.value === 'complete') break;
      await sleep(200);
    }
    await sleep(1200);   // 让样式与初始化跑完

    // 自动登岛（演示版：本地后端）
    await cdp.send('Runtime.evaluate', {
      expression: `(function(){
        var p=document.getElementById('phone');
        if(!p) return 'no-phone';
        p.value='13800138000';
        document.getElementById('send-code-btn').click();
        return 'sent';
      })()`, returnByValue: true
    });
    // 等验证码出现并提交
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(function(){
          var c=document.getElementById('code');
          if(!c || c.value.length<4) return 'wait';
          var p=document.getElementById('phone'); if(p) p.value='13800138000';
          document.getElementById('phone-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          return 'submit';
        })()`, returnByValue: true
      });
      if (r.result.value === 'submit') break;
      await sleep(150);
    }
    await sleep(1500);   // 等卡片海渲染 + 海面挂载

    // 确认进了主界面
    const st = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        on: document.getElementById('app-view').classList.contains('on'),
        cards: document.querySelectorAll('#card-grid .card').length,
        sea: !!(window.ISLAND_SEA && window.ISLAND_SEA.info().mounted),
        contours: window.ISLAND_SEA ? window.ISLAND_SEA.info().contours : 0
      })`, returnByValue: true
    });
    console.log('页面状态：', st.result.value);
    const state = JSON.parse(st.result.value);
    if (!state.on) throw new Error('未进入主界面，终止');
    if (!state.sea) throw new Error('背景海面未挂载，终止');

    // 连续抓帧
    const total = FPS * SECONDS;
    const interval = 1000 / FPS;
    console.log(`开始抓帧：${total} 帧 @ ${FPS}fps`);
    for (let i = 0; i < total; i++) {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false
      });
      fs.writeFileSync(path.join(OUT, `f${String(i).padStart(3, '0')}.png`),
        Buffer.from(shot.data, 'base64'));
      if (i % 12 === 0) process.stdout.write(`  ${i}/${total}\n`);
      // 用固定延时控制节奏（不依赖页面时间）
      await sleep(Math.max(0, interval - 30));
    }
    console.log('抓帧完成 →', OUT);
  } finally {
    if (cdp) cdp.close();
    try { proc.kill(); } catch (e) { /* 已退出 */ }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
})().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
