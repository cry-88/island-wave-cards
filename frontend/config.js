// 孤岛卡片 · WorkBuddy Cloud Service 公共配置
// 这三个值来自云服务激活返回的 publicConfig，可安全出现在前端代码中：
// publishableKey 仅标识应用、本身不带任何权限（服务端还会校验 Origin）。
// 2026-11-03 已替换为「孤岛浪花」应用（wbapp_VpmWTzUDt5AHTDCnm55B6Y）的真实配置。
window.ISLAND_CONFIG = {
  endpoint: 'https://island-wave-cards.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_VpmWTzUDt5AHTDCnm55B6Y_PolInn9eHnN4boiZ9MdvAkTkbYgtEq3Y',

  // 访问门禁的钥匙。平台层要求请求带对这个参数才放行整页，
  // 否则会返回 403「链接不完整」的拦截页——我们自己的代码根本不会被送达浏览器。
  // 它本来就已经公开出现在 README、演示版和 entry.html 里，
  // 所以这里不是「藏密钥」，只是把散落三处的那一份收拢到一处，
  // 由 test/smoke.js 断言各处一致。
  shareCode: 'R7PJGFFCEZ',

  // 无参入口页：分享给别人时用这个。
  // 门禁只认 query 参数，而 query 恰恰是聊天工具转发时最容易截断的部分；
  // 这个链接一个参数都没有，截断无从发生。它会自动把人送进真实版。
  entryUrl: 'https://cry-88.github.io/island-wave-cards/entry.html'
};
