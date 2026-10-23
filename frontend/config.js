// 孤岛卡片 · WorkBuddy Cloud Service 公共配置
// 这三个值来自云服务激活返回的 publicConfig，可安全出现在前端代码中：
// publishableKey 仅标识应用、本身不带任何权限（服务端还会校验 Origin）。
// 以下是占位符——部署前请替换为你自己激活云服务后获得的值。
window.ISLAND_CONFIG = {
  endpoint: 'https://YOUR-APP-PREFIX.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_YOUR_PUBLISHABLE_KEY'
};
