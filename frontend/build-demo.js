#!/usr/bin/env node
/* ============================================================
   孤岛浪花 · 演示版生成器
   ------------------------------------------------------------
   demo.html（本地演示版，本地Storage 模拟云端）与 index.html（真实版）
   结构必须完全一致，否则样式会错位、测试会误判。

   过去两次踩坑都是因为手工同步两个文件导致漂移，
   所以这里改成：demo.html 永远由 index.html 派生，不手工维护。

   用法：node frontend/build-demo.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname);

/* 从 config.js 读配置，不在这里另抄一份——
   sharecode 散落多处正是这类 bug 的来源，改一处忘另一处就出灵异事件。 */
const CONFIG_SRC = fs.readFileSync(path.join(FRONTEND, 'config.js'), 'utf8');
function cfgValue(key) {
  const m = CONFIG_SRC.match(new RegExp(key + "\\s*:\\s*'([^']+)'"));
  return m ? m[1] : '';
}
const SHARE_CODE = cfgValue('shareCode');
const ENTRY_URL = cfgValue('entryUrl');

/* 对外分享一律用「无参入口页」。
   真实版的访问钥匙（sharecode）只能待在 query 里，而 query 恰恰是聊天工具
   转发时最容易截断的部分——平台门禁的拦截页第一条建议就是这个。
   入口页挂在 GitHub Pages 上，没有门禁，一个参数都没有，截断无从发生；
   它在运行时把完整链接拼出来，再把人送进真实版。 */
const ENTRY_LINK = ENTRY_URL || 'https://cry-88.github.io/island-wave-cards/entry.html';
/* 真实版直链：留作备用（比如要写进文档、或者在已种过 Cookie 的设备上直接打开） */
const REAL_SHARE_LINK = 'https://island-wave-cards.app.workbuddy.host/?sharecode=' + SHARE_CODE;

let html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');
/* 源文件是 CRLF，统一按 LF 处理，最后再写回 CRLF，保持与 index.html 一致 */
const CRLF = html.includes('\r\n');
html = html.replace(/\r\n/g, '\n');

/* 1) 标题与描述 */
html = html.replace(
  '<title>孤岛浪花 · 浪花只光顾一次</title>',
  '<title>孤岛浪花 · 演示模式</title>'
);
html = html.replace(
  '<meta name="description" content="每个人都是一座孤岛。把想说的话写成卡片，它会漂进某一片海，被某一个人看到一次，然后永远退去。" />',
  '<meta name="description" content="孤岛浪花演示模式：卡片只存在你的浏览器里。真实版在全球共享的卡片海上。" />'
);

/* 2) 演示条样式：自包含在 head，不碰共享 styles.css */
const bannerCss = `  <style>
    /* 演示版引导条：真实版在 WorkBuddy 托管域（Pages 域名被云端 Origin 校验挡住，登不上） */
    .demo-banner {
      position: sticky; top: 0; z-index: 60;
      display: flex; flex-wrap: wrap; gap: 3px 16px;
      align-items: center; justify-content: center;
      padding: 9px 14px;
      background: #101C1F; color: #8A9C9A;
      border-bottom: 1px solid #223034;
      font-size: 12px; letter-spacing: .04em;
    }
    .demo-banner a { color: #E0A24A; text-decoration: none; border-bottom: 1px solid rgba(224,162,74,.4); }
    .demo-banner a:hover { color: #fff; border-bottom-color: #fff; }
    /* 演示条占位：让顶栏与仪表台往下让位 */
    :root { --banner-h: 41px; }
  </style>
`;
html = html.replace(
  '  <link rel="stylesheet" href="styles.css" />',
  '  <link rel="stylesheet" href="styles.css" />\n' + bannerCss
);

/* 3) 演示条本体 */
const banner = `  <!-- 演示版引导条：本地版数据只存在自己浏览器；真实版（全球共享的卡片海）在托管域 -->
  <div class="demo-banner" role="note">
    <span>本地演示版 · 写的卡只住在你的浏览器里</span>
    <a href="${ENTRY_LINK}" target="_blank" rel="noopener">进入真实版，把浪花放进所有人的海 →</a>
  </div>

`;
html = html.replace('<body>\n', '<body>\n' + banner);

/* 4) 换掉云端 SDK，改用本地模拟后端 */
html = html.replace(
  '  <script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"></script>',
  '  <script src="local-backend.js"></script>'
);

/* 5) 写回：保持与 index.html 相同的换行风格 */
if (CRLF) html = html.replace(/\n/g, '\r\n');
fs.writeFileSync(path.join(FRONTEND, 'demo.html'), html, 'utf8');

/* 入口页也要校验：它的 sharecode 必须与 config.js 一致。
   这一页是「链接被截断时的救命稻草」，钥匙写错就等于没有。 */
const entrySrc = fs.readFileSync(path.join(FRONTEND, 'entry.html'), 'utf8');
const entryHasCode = entrySrc.includes(SHARE_CODE);

/* 自检：真实版不该出现在演示版里，反之亦然 */
const checks = [
  ['使用本地后端', html.includes('local-backend.js')],
  ['未残留云端 SDK', !html.includes('workbuddy-cloud-sdk')],
  ['含演示条', html.includes('demo-banner')],
  /* 对外链接必须是无参入口页：带 sharecode 的链接会被聊天工具截断 */
  ['含无参入口页链接', html.includes(ENTRY_LINK)],
  ['对外链接不含 sharecode', !html.includes('?sharecode=')],
  ['未残留真实版标题', !html.includes('<title>孤岛浪花 · 浪花只光顾一次</title>')],
  /* 活海背景的三个必要件：画布、潮汐模型、海面引擎 */
  ['含海面画布', html.includes('id="sea-canvas"')],
  ['含潮汐模型', html.includes('src="tide.js"')],
  ['含海面引擎', html.includes('src="sea.js"')],
  ['脚本顺序正确', (() => {
    const i1 = html.indexOf('src="tide.js"');
    const i2 = html.indexOf('src="sea.js"');
    const i3 = html.indexOf('src="app.js"');
    return i1 > 0 && i1 < i2 && i2 < i3;
  })()],
  /* 分享入口：登岛页要有这个按钮 */
  ['含分享按钮', html.includes('id="share-btn"')],
  /* 钥匙一致性：config.js / entry.html / 直链三处必须同一个 */
  ['config.js 有 sharecode', !!SHARE_CODE],
  ['entry.html 钥匙与 config.js 一致', entryHasCode],
  ['真实版直链含钥匙', REAL_SHARE_LINK.includes(SHARE_CODE)],
];
let bad = 0;
for (const [name, pass] of checks) {
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name);
  if (!pass) bad++;
}
console.log(bad ? '\n!!! 生成失败，demo.html 不要提交' : '\n=== demo.html 已生成并通过自检 ===');
process.exit(bad ? 1 : 0);
