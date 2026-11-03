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
const REAL_SHARE_LINK = 'https://island-wave-cards.app.workbuddy.host/?sharecode=R7PJGFFCEZ';

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
    <a href="${REAL_SHARE_LINK}" target="_blank" rel="noopener">进入真实版，把浪花放进所有人的海 →</a>
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

/* 自检：真实版不该出现在演示版里，反之亦然 */
const checks = [
  ['使用本地后端', html.includes('local-backend.js')],
  ['未残留云端 SDK', !html.includes('workbuddy-cloud-sdk')],
  ['含演示条', html.includes('demo-banner')],
  ['含真实版链接', html.includes(REAL_SHARE_LINK)],
  ['未残留真实版标题', !html.includes('<title>孤岛浪花 · 浪花只光顾一次</title>')],
];
let bad = 0;
for (const [name, pass] of checks) {
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name);
  if (!pass) bad++;
}
console.log(bad ? '\n!!! 生成失败，demo.html 不要提交' : '\n=== demo.html 已生成并通过自检 ===');
process.exit(bad ? 1 : 0);
