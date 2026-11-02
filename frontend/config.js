// 孤岛卡片 · WorkBuddy Cloud Service 公共配置
// 这三个值来自云服务激活返回的 publicConfig，可安全出现在前端代码中：
// publishableKey 仅标识应用、本身不带任何权限（服务端还会校验 Origin）。
// 2026-11-03 已替换为「孤岛浪花」应用（wbapp_VpmWTzUDt5AHTDCnm55B6Y）的真实配置。
window.ISLAND_CONFIG = {
  endpoint: 'https://island-wave-cards.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_VpmWTzUDt5AHTDCnm55B6Y_PolInn9eHnN4boiZ9MdvAkTkbYgtEq3Y'
};
