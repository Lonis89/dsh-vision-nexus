import type { SessionState, VisionConfig, ImageRef } from './types.js';
/** 会话键归一化：从 exec 上下文提取稳定、隔离的 sessionKey。 */
export declare function sessionKeyOf(exec: any): string;
/** 会话隔离根目录：DSH 工作目录下 .dsh-vision-nexus/sessions/<sessionKey>。 */
export declare function sessionRoot(baseDir: string, sessionKey: string): string;
/** 会话内的工作子目录集合。 */
export declare function sessionDirs(baseDir: string, sessionKey: string): {
    root: string;
    images: string;
    artifacts: string;
    temp: string;
    state: string;
};
/** 确保会话目录树存在（所有写入前的统一入口）。 */
export declare function ensureSessionDirs(baseDir: string, sessionKey: string): Promise<{
    root: string;
    images: string;
    artifacts: string;
    temp: string;
    state: string;
}>;
/**
 * 会话状态管理器。并发控制、队列、图片索引、审计、持久化的统一宿主。
 */
export declare class SessionManager {
    private states;
    /** 配置 getter：并发上限 / 队列长度 / 清理周期等面板字段热更新后即时生效。 */
    private readonly getConfig;
    private readonly baseDir;
    private gcTimer;
    private readonly idleTtlMs;
    constructor(baseDir: string, config: VisionConfig | (() => VisionConfig));
    private get config();
    /** 取（或惰性创建并加载持久化的）会话状态。 */
    get(sessionKey: string): Promise<SessionState>;
    /** 持久化会话状态（图片索引 + 激活态）。审计日志单独存，避免污染。 */
    persist(sessionKey: string): Promise<void>;
    /** 登记一张托管图像，返回其会话内索引 id。批量任务自动维护索引。 */
    registerImage(sessionKey: string, ref: Omit<ImageRef, 'id'>, hint?: string): Promise<ImageRef>;
    /** 解析图像 id：不存在返回 undefined（强制模型走工具登记链路，不能脑补）。 */
    resolveImage(sessionKey: string, imageId: string): Promise<ImageRef | undefined>;
    /** 列出会话内全部图像索引。 */
    listImages(sessionKey: string): Promise<ImageRef[]>;
    /**
     * 获取一个执行槽。并发未超限立即返回；超限则进入队列等待，
     * 返回 { queued:true, position } 让调用方把排队状态回传模型。
     */
    acquire(sessionKey: string): Promise<{
        release: () => void;
        queued: boolean;
        position: number;
    }>;
    /** 释放一个执行槽：作用于 acquire 时捕获的那份 state 对象（与 sessionKey 解耦）。 */
    private releaseState;
    /**
     * 把当前所有内存会话标记为「已激活」。用于 loadingStrategy 从 eager 热切到
     * progressive：eager 模式下工具全量注册、从不设置 activated，若不迁移会让
     * 既有会话在切换后被渐进门禁全部拦住。持久化失败不影响内存状态。
     */
    activateAll(): Promise<void>;
    /** 全局并发负载快照（供设置面板「当前运行状态」展示）。 */
    load(): {
        queuedTasks: number;
        runningTasks: number;
    };
    /** 启动空闲会话回收 + 临时文件定时清理。通过 ctx.effect 注册 disposer。 */
    startMaintenance(): () => void;
    private maintenance;
    /** 会话销毁：清空内存状态（保留磁盘 Artifact 供会话内反复引用）。 */
    disposeSession(sessionKey: string): void;
}
