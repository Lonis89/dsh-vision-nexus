/**
 * dsh-vision-nexus — 设置面板同源路由（Host / Client 共享常量）
 * 单一事实来源，避免 Host 注册路径与 Client 请求路径漂移。
 */
export const ROUTES = {
  health: '/plugins/dsh-vision-nexus/health',
  status: '/plugins/dsh-vision-nexus/status',
  probePython: '/plugins/dsh-vision-nexus/probe-python',
  probeBrowser: '/plugins/dsh-vision-nexus/probe-browser',
  testVl: '/plugins/dsh-vision-nexus/test-vl',
  export: '/plugins/dsh-vision-nexus/export',
} as const;

export type PanelRoutes = typeof ROUTES;
