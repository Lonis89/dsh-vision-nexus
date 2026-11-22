/**
 * dsh-vision-nexus — 完整审计链路
 *
 *  - 每一次调用记录：工具名称、入参（脱敏摘要）、引擎、耗时、置信度、产物 ID、
 *    是否降级、降级链、会话键、状态、脱敏错误。
 *  - 审计信息单独输出（写独立审计文件 + 可选命令导出），不污染主回答。
 *  - 入参脱敏：剥离 base64 / 大段 HTML / 密钥样式字符串，仅保留结构指纹。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureSessionDirs } from './session.js';
const SENSITIVE_KEY = /(key|token|secret|password|authorization|api[_-]?key|credential|base64|data)/i;
const BASE64_LIKE = /^[A-Za-z0-9+/\r\n]+={0,2}$/;
/** 把工具入参转成脱敏摘要：保留结构，剥离敏感 / 大体积内容。 */
export function digestArgs(args) {
    const out = {};
    for (const [k, v] of Object.entries(args ?? {})) {
        if (SENSITIVE_KEY.test(k)) {
            out[k] = '<redacted>';
            continue;
        }
        if (typeof v === 'string') {
            if (v.length > 256 || BASE64_LIKE.test(v) && v.length > 64) {
                out[k] = `<string len=${v.length} sha=${shortHash(v)}>`;
            }
            else {
                out[k] = redactInline(v);
            }
        }
        else if (Array.isArray(v)) {
            out[k] = { type: 'array', length: v.length, sample: v.slice(0, 3).map(redactInline) };
        }
        else if (v && typeof v === 'object') {
            out[k] = digestArgs(v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
/**
 * 密钥片段脱敏：覆盖 sk- / sk_live_ 等 OpenAI 风格、api-key / token / key 的裸键值形态
 * 以及 Bearer 头。键值形态保留「key=」前缀便于判因，sk 形态整体替换（整个串都是标识，
 * 没有可靠边界）。用函数式替换避免捕获组贪婪回溯导致密钥前段残留。
 */
const REDACT_SECRET = /((?:api[_-]?key|access[_-]?token|bearer|token|key)\s*[=:]\s*)[A-Za-z0-9._-]{4,}|\bsk[_-][A-Za-z0-9_-]{4,}/gi;
const redactSecretValue = (_m, namedPrefix) => (namedPrefix ? `${namedPrefix}<redacted>` : '<redacted>');
/** 错误脱敏：去掉 URL、密钥片段、堆栈路径，只留可判因的摘要。 */
export function redactError(err) {
    const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return raw
        .replace(/https?:\/\/[^\s)'"]+/g, '<url>')
        .replace(REDACT_SECRET, redactSecretValue)
        .replace(/[A-Za-z]:\\[^\s)]+/g, '<path>')
        .slice(0, 400);
}
function redactInline(v) {
    if (typeof v !== 'string')
        return v;
    return v
        .replace(REDACT_SECRET, redactSecretValue)
        .slice(0, 120);
}
function shortHash(s) {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}
export function newAuditId() {
    return `aud-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}
export function beginAudit(toolName, args, sessionKey) {
    return {
        auditId: newAuditId(),
        toolName,
        argsDigest: digestArgs(args),
        sessionKey,
        startedAt: Date.now(),
        degradeChain: [],
    };
}
/** 记录一次降级跳。 */
export function noteDegrade(draft, from, to, reason) {
    draft.degradeChain.push({ from, to, reason: redactError(reason), at: Date.now() });
}
/** 审计日志管理器：按会话隔离、单独落盘、可单独导出。 */
export class AuditLog {
    baseDir;
    /** 配置 getter：审计条数上限等面板字段热更新后即时生效。 */
    getConfig;
    /** 内存索引：sessionKey -> 最近 N 条（供快速导出）。 */
    index = new Map();
    /** 提交观察者（供设置面板实时统计订阅，不改写入口语义）。 */
    listeners = new Set();
    constructor(baseDir, config) {
        this.baseDir = baseDir;
        this.getConfig = typeof config === 'function' ? config : () => config;
    }
    get config() {
        return this.getConfig();
    }
    /** 订阅每次审计提交；返回取消订阅函数。 */
    onCommit(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** 完成并落盘一条审计记录。 */
    async commit(draft, result) {
        const record = {
            auditId: draft.auditId,
            toolName: draft.toolName,
            argsDigest: draft.argsDigest,
            engine: result.engine,
            durationMs: Date.now() - draft.startedAt,
            confidence: result.confidence,
            artifactIds: result.artifactIds,
            degraded: draft.degradeChain.length > 0,
            // 快照而非活引用：超时后 Promise.race 的败者仍在后台运行，可能继续 push 到
            // draft.degradeChain；已提交记录不应被后台改写（与返回信封保持一致）。
            degradeChain: draft.degradeChain.slice(),
            sessionKey: draft.sessionKey,
            status: result.status,
            ...(result.errorDigest ? { errorDigest: result.errorDigest } : {}),
            at: Date.now(),
        };
        // 内存索引（供 vision 审计导出命令读取，不进入主回答）。
        const list = this.index.get(draft.sessionKey) ?? [];
        list.push(record);
        if (list.length > this.config.auditMaxEntries)
            list.shift();
        this.index.set(draft.sessionKey, list);
        // 单独落盘到会话隔离目录的 audit/ 子目录，绝不混入工具结果。
        const d = await ensureSessionDirs(this.baseDir, draft.sessionKey);
        const auditDir = path.join(d.root, 'audit');
        await fs.mkdir(auditDir, { recursive: true });
        const date = new Date(record.at).toISOString().slice(0, 10);
        const file = path.join(auditDir, `${date}.jsonl`);
        await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
        // 磁盘日志滚动：JSONL 只追加会无上限增长（内存索引已有 auditMaxEntries 上限，
        // 但磁盘没有）。按「自上次轮转后写入行数」精确触发：达到 2×上限 时重写为最近
        // auditMaxEntries 行；另设字节阈值兜底（跨实例重启后内存计数丢失时仍生效）。
        // rotateIfNeeded 内部吞异常，绝不影响主流程。
        await this.rotateIfNeeded(file);
        // 通知实时统计（面板「当前运行状态」）。
        for (const listener of this.listeners) {
            try {
                listener(record);
            }
            catch { /* 观察者不得影响审计落盘 */ }
        }
        return record;
    }
    /** 正在轮转中的文件集合：去重，避免多条审计并发提交时同一文件重复轮转。 */
    rotating = new Set();
    /** 每个 JSONL 文件自上次轮转后追加的行数（精确触发，避免字节阈值误判行数）。 */
    fileLineCounts = new Map();
    /**
     * 单文件 JSONL 轮转：自上次轮转写入行数达到 2×上限，或文件字节超过
     * 「上限 × 4KB」（跨实例重启后内存计数丢失的兜底）时，保留最近 auditMaxEntries
     * 行。用临时文件 + rename 原子替换，任何异常都吞掉（审计落盘不得影响主流程）。
     */
    async rotateIfNeeded(file) {
        if (this.rotating.has(file))
            return;
        const max = this.config.auditMaxEntries;
        const count = (this.fileLineCounts.get(file) ?? 0) + 1;
        this.fileLineCounts.set(file, count);
        try {
            const st = await fs.stat(file);
            if (count < max * 2 && st.size <= max * 4096)
                return;
            this.rotating.add(file);
            const text = await fs.readFile(file, 'utf8');
            const lines = text.split('\n').filter(Boolean);
            if (lines.length <= max)
                return;
            const kept = lines.slice(-max).join('\n') + '\n';
            const tmp = `${file}.${process.pid}.tmp`;
            await fs.writeFile(tmp, kept, 'utf8');
            await fs.rename(tmp, file);
            this.fileLineCounts.set(file, Math.min(lines.length, max));
        }
        catch {
            // 轮转失败保留原文件（只增不损），下次提交会重试。
        }
        finally {
            this.rotating.delete(file);
        }
    }
    /** 单独输出审计信息（供命令 / 健康自检调用，不污染主回答）。 */
    export(sessionKey) {
        return [...(this.index.get(sessionKey) ?? [])];
    }
}
