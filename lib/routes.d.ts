/**
 * dsh-vision-nexus — 设置面板同源路由（Host / Client 共享常量）
 * 单一事实来源，避免 Host 注册路径与 Client 请求路径漂移。
 */
export declare const ROUTES: {
    readonly health: "/plugins/dsh-vision-nexus/health";
    readonly status: "/plugins/dsh-vision-nexus/status";
    readonly probePython: "/plugins/dsh-vision-nexus/probe-python";
    readonly probeBrowser: "/plugins/dsh-vision-nexus/probe-browser";
    readonly testVl: "/plugins/dsh-vision-nexus/test-vl";
    readonly export: "/plugins/dsh-vision-nexus/export";
};
export type PanelRoutes = typeof ROUTES;
