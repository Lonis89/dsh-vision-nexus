/**
 * dsh-vision-nexus — 工具 schema 定义（标准化）
 *
 * 严格按需求输出的 11 个标准化工具名。每个工具声明：
 *  - name / description（给主模型看的语义）
 *  - parameters（入参 JSON Schema 子集：type / enum / required / description / items）
 *  - output.schema（统一信封 VisionEnvelope 的 JSON Schema）
 *  - engine hint（标记该工具默认走哪个引擎、是否属于像素计算类）
 *
 * 统一返回信封（所有工具都必须带）：
 *  {
 *    data,                 // 业务结果（结构化文本，绝不含图像二进制）
 *    confidence,           // 置信度 0..1
 *    artifactIds: string[],// 产物 Artifact ID 列表
 *    engine,               // 'local-cv'|'custom-vl'|'builtin-vl'|'wasm-ocr'|'none'
 *    degraded,            // 是否降级
 *    degradeChain,        // 降级链
 *    capabilityNotice?,   // 降级时告知模型当前能力限制
 *    auditId              // 审计记录 ID
 *  }
 *
 * 关键点：模型不能绕过工具直接脑补图片内容 —— 入参只接受托管后的
 * `image_id`（Artifact 索引）或 HTML 字符串，绝不接收 / 返回 base64 原图；
 * 工具结果的 render() 也只输出文本信封。
 */
// ───────────────────────── 公共 schema 片段 ─────────────────────────
const P = {
    /** 托管图像 id（会话内 Artifact 索引）。 */
    imageId: (description) => ({
        type: 'string',
        required: true,
        description,
    }),
    /** 可选的第二张图（pixel_diff 用）。 */
    imageIdB: (description) => ({
        type: 'string',
        required: true,
        description,
    }),
    /** 自然语言问题 / 描述。 */
    text: (description, required = true) => ({
        type: 'string',
        required,
        description,
    }),
    /** 标准化坐标框。 */
    bbox: (description) => ({
        type: 'object',
        required: false,
        description,
        properties: {
            x: { type: 'number', required: true, description: '左上角 x（像素）' },
            y: { type: 'number', required: true, description: '左上角 y（像素）' },
            width: { type: 'number', required: true, description: '宽度（像素）' },
            height: { type: 'number', required: true, description: '高度（像素）' },
        },
    }),
    /** 置信度下限过滤。 */
    minConfidence: () => ({
        type: 'number',
        required: false,
        description: '可选：仅保留置信度 >= 该值的检测结果(0..1)',
    }),
    /** 强制走量化比对开关（多图比对强制 pixel_diff 量化）。 */
};
/**
 * 统一输出信封的「原始 JSON Schema」（已编译形态）。
 * 本文件里的 defineTool 直接把它作为 output.schema 传给 ctx.tools.register，
 * 因此这里必须是受支持的子集语法：对象级 required 为 string[]，字段里不再带
 * author 形态的 `required: true` 布尔。
 * 注释型（无 type / 约束关键字）的 data 节点表示「未约束 JSON」。
 */
export const ENVELOPE_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'confidence', 'artifactIds', 'engine', 'degraded', 'degradeChain', 'auditId'],
    properties: {
        // 注释型 schema（无 type / oneOf / 约束关键字）= 未约束 JSON，可承载任意结构化业务结果。
        // 工具返回的 data 绝不含图像二进制，只含文本 / 数值 / 坐标 / 列表。
        data: { description: '业务结果（结构化文本 / 数值 / 坐标，绝不含图像二进制或 base64）' },
        confidence: { type: 'number', description: '置信度 0..1' },
        artifactIds: {
            type: 'array', items: { type: 'string' },
            description: '本次调用产出的 Artifact ID 列表',
        },
        engine: {
            type: 'string',
            enum: ['local-cv', 'custom-vl', 'builtin-vl', 'wasm-ocr', 'none'],
            description: '实际完成任务的引擎来源标记',
        },
        degraded: { type: 'boolean', description: '是否发生过降级' },
        degradeChain: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['from', 'to', 'reason', 'at'],
                properties: {
                    from: { type: 'string' }, to: { type: 'string' },
                    reason: { type: 'string' }, at: { type: 'number' },
                },
            },
            description: '降级链（仅 degraded=true 时非空）',
        },
        capabilityNotice: { type: 'string', description: '降级时告知模型当前能力限制' },
        auditId: { type: 'string', description: '审计记录 ID，可单独输出' },
        queued: { type: 'boolean', description: '并发超限时任务在队列中排队' },
        queuePosition: { type: 'number', description: '排队序号' },
    },
};
/**
 * 全部 11 个标准化工具定义。
 * 顺序即渐进激活后注册到工具表的顺序。
 */
export const TOOL_DEFINITIONS = [
    {
        name: 'vision_activate',
        prefer: 'none',
        pixelClass: false,
        ocrFallback: false,
        description: '渐进模式下激活整套视觉工具集：仅在会话中首次需要视觉能力时调用一次。' +
            '调用后动态注册全部 vision_* 工具（减少系统提示词 token 开销）。' +
            '返回当前可用工具子集、引擎健康状态与能力边界说明；重复调用幂等。',
        parameters: {},
    },
    {
        name: 'vision_glance',
        prefer: 'custom-vl',
        pixelClass: false,
        ocrFallback: true,
        description: '图像问答 / 内容描述 / 基础图文理解。返回内容描述 + 置信度。' +
            '注意：超高密度大图禁止一次性全图 glance，调度层会自动分块采样后聚合。' +
            '原图不注入上下文，只接受托管后的 image_id。',
        parameters: {
            image_id: P.imageId('托管图像 id（会话内 Artifact 索引，来自 vision_* 的 artifactIds 或上传登记）'),
            question: P.text('针对图像的自然语言问题；留空则做整体内容描述', false),
        },
    },
    {
        name: 'vision_detect',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '图像元素检测：输出组件清单、编号、标准化 xy 坐标框(bbox)与逐元素置信度。' +
            '编号从 1 开始，供 vision_ground / vision_crop 引用。',
        parameters: {
            image_id: P.imageId('托管图像 id'),
            categories: {
                type: 'array', required: false, items: { type: 'string' },
                description: '可选：只检测指定类别（如 button / text / icon）；留空检测全部',
            },
            min_confidence: P.minConfidence(),
        },
    },
    {
        name: 'vision_ground',
        prefer: 'custom-vl',
        pixelClass: false,
        ocrFallback: true,
        description: '目标定位：根据文字描述在图上定位目标，返回标准化坐标框(bbox) + 置信度。' +
            '可引用 vision_detect 的元素编号提升精度。',
        parameters: {
            image_id: P.imageId('托管图像 id'),
            target: P.text('要定位目标的文字描述，如「右上角的蓝色提交按钮」'),
            element_index: {
                type: 'number', required: false,
                description: '可选：引用 vision_detect 输出的元素编号，直接返回该元素坐标',
            },
        },
    },
    {
        name: 'vision_crop',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '根据坐标裁剪子图：裁剪产物存入 Artifact，返回子图标识(artifact id)。' +
            '裁剪后的子图可在会话内被后续工具反复引用。',
        parameters: {
            image_id: P.imageId('源图托管 id'),
            bbox: {
                ...P.bbox('裁剪区域（像素坐标，原点左上）'),
                required: true,
            },
            label: P.text('可选：子图标签，便于索引', false),
        },
    },
    {
        name: 'vision_long_ocr',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: true,
        description: '长截图 / 长文档分段结构化 OCR：输出带位置标记的结构化 markdown，' +
            '附带逐段置信度。自动分块，避免一次性超高密度全图。',
        parameters: {
            image_id: P.imageId('长图托管 id'),
            language: {
                type: 'string', required: false,
                description: '可选：OCR 语言提示（如 zh / en / auto），默认 auto',
            },
        },
    },
    {
        name: 'vision_pixel_diff',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '两张图片像素比对：输出差异热力图(Artifact)、差异坐标清单、差异占比、量化评估结果。' +
            '多图比对强制走此量化路径，禁止用模糊文字对比代替。',
        parameters: {
            image_a: P.imageId('图 A 托管 id'),
            image_b: P.imageIdB('图 B 托管 id'),
            threshold: {
                type: 'number', required: false,
                description: '可选：像素差异阈值(0..255)，默认 24',
            },
        },
    },
    {
        name: 'vision_extract_foreground',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '图像抠图 / 去除背景：前景产物存入 Artifact，返回带 alpha 的子图标识与置信度。',
        parameters: {
            image_id: P.imageId('托管图像 id'),
            mode: {
                type: 'string', required: false,
                enum: ['auto', 'grabcut', 'threshold'],
                description: '可选：抠图算法，默认 auto',
            },
        },
    },
    {
        name: 'vision_color_extract',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '提取图片主色调：生成色板(Artifact)、输出十六进制色值列表、各色占比与置信度。',
        parameters: {
            image_id: P.imageId('托管图像 id'),
            color_count: {
                type: 'number', required: false,
                description: '可选：主色数量，默认 6',
            },
        },
    },
    {
        name: 'vision_trace_svg',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '轮廓追踪：位图转 SVG 矢量图形。SVG 产物存入 Artifact，返回矢量图标识与路径复杂度。',
        parameters: {
            image_id: P.imageId('托管图像 id'),
            simplify: {
                type: 'number', required: false,
                description: '可选：轮廓简化容差(0..1)，默认 0.02',
            },
        },
    },
    {
        name: 'vision_html_render_snapshot',
        prefer: 'local-cv',
        pixelClass: true,
        ocrFallback: false,
        description: '渲染输入 HTML 代码并生成截图，截图存入 Artifact，用于 UI 复现闭环校验。' +
            '可配合 vision_pixel_diff 与设计稿做量化比对。',
        parameters: {
            html: P.text('完整 HTML 源码字符串（含内联样式）'),
            width: { type: 'number', required: false, description: '可选：视口宽度(px)，默认 1280' },
            height: { type: 'number', required: false, description: '可选：视口高度(px)，默认 720' },
        },
    },
];
/** 工具名 → 元数据索引。 */
export const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));
/** 需要本地 CV 运行时的工具名集合（Python 缺失时自动禁用）。 */
export const PIXEL_TOOLS = new Set(TOOL_DEFINITIONS.filter((t) => t.pixelClass).map((t) => t.name));
/** 可被 WASM OCR 兜底的工具名集合。 */
export const OCR_FALLBACK_TOOLS = new Set(TOOL_DEFINITIONS.filter((t) => t.ocrFallback).map((t) => t.name));
/** 渐进激活时需要动态注册的「全套视觉工具」（不含激活指令自身）。 */
export const VISION_TOOL_NAMES = TOOL_DEFINITIONS
    .filter((t) => t.name !== 'vision_activate')
    .map((t) => t.name);
