import type { ImageRef, VisionConfig } from './types.js';
export interface ArtifactRecord {
    id: string;
    sessionKey: string;
    /** 会话内相对路径（隔离目录下）。 */
    relPath: string;
    mediaType: string;
    bytes: number;
    width: number;
    height: number;
    /** 宿主 attachments 服务返回的正式引用（若可用）。 */
    attachmentId?: string;
    createdAt: number;
    /** 是否临时产物（受保留时长清理）。 */
    temporary: boolean;
    label?: string;
}
/**
 * 压缩预处理 + 尺寸探测。
 * 真实实现由本地 CV 运行时的 `preprocess` 操作完成（见 cv_worker.py）；
 * 这里做无依赖的兜底：读取字节、按扩展名推断 MIME、从 PNG/JPEG 头解析尺寸。
 */
export declare function preprocessImage(buffer: Buffer, config: VisionConfig): Promise<{
    data: Buffer;
    mediaType: string;
    width: number;
    height: number;
    oversized: boolean;
    tiles: number;
}>;
/** 极轻量图片头解析：PNG IHDR / JPEG SOF / GIF，失败返回 0 尺寸。 */
export declare function sniff(buffer: Buffer): {
    mediaType: string;
    width: number;
    height: number;
};
/** Artifact 存储：会话隔离 + 自动登记 + 复用引用。 */
export declare class ArtifactStore {
    private readonly baseDir;
    /** 配置 getter：大图阈值等面板字段热更新后即时生效。 */
    private readonly getConfig;
    private seq;
    /** 可选宿主 attachments 服务引用。 */
    private attachments;
    constructor(baseDir: string, config: VisionConfig | (() => VisionConfig), attachments?: any);
    private get config();
    /**
     * 把一份产物字节注册为 Artifact，返回会话内 id。
     * @param bytes 产物字节（绝不进入模型上下文）
     * @param opts.temporary 是否为临时产物（进入 temp 目录，受定时清理）
     */
    register(sessionKey: string, bytes: Buffer, opts?: {
        mediaType?: string;
        width?: number;
        height?: number;
        label?: string;
        temporary?: boolean;
        ext?: string;
        /** 已知的宿主 attachmentId（由调度层先调用 saveImage 得到）。 */
        attachmentId?: string;
    }): Promise<{
        id: string;
        ref: ImageRef;
        record: ArtifactRecord;
    }>;
    /** 读取产物字节（仅供引擎层内部使用，绝不注入模型上下文）。 */
    read(sessionKey: string, id: string): Promise<Buffer | undefined>;
    /** 列出会话内全部 Artifact（支持会话内反复引用）。 */
    list(sessionKey: string): Promise<ArtifactRecord[]>;
    private writeMeta;
    private readMeta;
}
