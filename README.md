# dsh-vision-nexus

**多引擎视觉增强工具插件**（DeepSeek Harness 插件，TypeScript，遵循 DSH 插件开发规范）

给「不具备看图能力」的文本主模型提供视觉能力。主模型本身不能看图，**所有图像信息必须通过本插件的 `vision_*` 工具调用获取**；插件底层绝不把原图 / base64 塞进主 LLM 上下文，强制走工具调用链路。

内置双引擎架构：**本地 CV 计算引擎（引擎 A）** + **远端 VL 模型路由调度引擎（引擎 B）**，自动自适应切换、支持渐进式工具挂载、会话隔离 Artifact、完整审计与四级降级。

另含 **DSH 原生侧边设置面板**（六大分区 / 表单化配置 / 健康自检 / 实时状态 / 热生效），详见 [README.PANEL.md](README.PANEL.md)。

> 不引入任何其他外部插件依赖，不引用任何其他插件名称。

---

## 1. 目录结构（DSH 标准插件结构）

```
dsh-vision-nexus/
├── package.json          # 插件清单：main / ./client / dsh.client.inject / dsh.bundle.patch
├── manifest.json         # 插件能力与安全边界声明（含设置面板元数据）
├── cordis.patch.yml      # Loader 补丁：把插件挂进运行中的插件树
├── tsconfig.json / tsdown.config.ts  # TypeScript / Client 打包配置
├── README.md             # 本文档（安装指令 + 默认参数）
├── README.PANEL.md       # 设置面板：分区 / 渲染代码 / 配置 schema / 默认值
├── scripts/build.mjs     # 构建编排：tsc + tsdown
├── src/
│   ├── index.ts          # 主 TS 入口：name / inject / Config / apply / 事件钩子 / 健康自检
│   ├── types.ts          # 共享类型（统一信封 / 引擎 / 配置 / 审计 / 会话状态）
│   ├── config.ts         # 默认参数 DEFAULTS + schemastery Config schema（全字段 volatile）
│   ├── routes.ts         # 设置面板同源路由（Host/Client 共享）
│   ├── toolSchemas.ts    # 11 个标准化工具定义（入参 schema + 统一输出信封 schema）
│   ├── toolSkill.ts      # 工具技能层：渐进按需激活 / 全量预加载 + defineTool + render
│   ├── scheduler.ts      # 调度层：队列 / 并发 / 超时熔断 / 降级 / 统一信封 / 审计
│   ├── session.ts        # 会话隔离：工作目录 / 状态持久化 / 并发计数 / 定时清理
│   ├── artifacts.ts      # Artifact 托管：压缩预处理 / base64 托管 / 产出登记
│   ├── audit.ts          # 完整审计链路：入参脱敏 / 错误脱敏 / 单独输出
│   ├── client/           # 设置面板 Client 半
│   │   ├── index.ts      #   apply / 设置 scope 绑定 / 座位注册
│   │   ├── panel.tsx     #   六大分区 React 组件（React.createElement）
│   │   ├── settingsModel.ts # 配置模型 / 校验 / 导入导出
│   │   ├── styles.ts     #   DSH 主题感知 CSS
│   │   └── routes.ts     #   路由常量重导出
│   ├── panel/            # 设置面板 Host 半
│   │   ├── hostPanel.ts  #   webServer 路由 / 健康自检 / 连通性探测
│   │   └── stats.ts      #   实时统计聚合
│   └── engines/
│       ├── localCv.ts    # 引擎 A：本地 Python CV 运行时 + 健康探测
│       ├── remoteVl.ts   # 引擎 B：OpenAI 兼容 VL 多后端优先级路由
│       └── wasmOcr.ts    # WASM 本地 OCR 最低兜底
└── runtime/
    └── cv_worker.py      # 本地 CV 运行时（JSON 行协议，离线可用，结果带置信度）
```

---

## 2. 安装指令

### 2.1 构建（需要 Node.js 22.19+ / 24+ 与 TypeScript）

```bash
cd dsh-vision-nexus
npm install            # 或 pnpm install
npm run build          # = tsc -p tsconfig.json && tsdown --config tsdown.config.ts
npm run typecheck      # tsc --noEmit 校验
npm test               # 先 build，再跑 node --test（55 项，含 Python 预处理 / CV worker 健壮性 / 残留风险 / 面板 Host 白名单 / 运行模式集成测试）
```

> 产物：`lib/index.js`（Host 半，`main`）、`lib/client.js`（设置面板 Client 半，`./client` export）。
> `runtime/cv_worker.py` 随包分发，无需编译。设置面板的构建 / 挂载细节见 `README.PANEL.md`。
> `npm run build` 末尾会校验 `lib/client.js` 的 `__ModuleLoader__` 包装契约，避免 Client 半因退回普通 ESM 而静默不加载。

### 2.2 安装到 DSH（三种等价方式）

**方式 A — 本地目录安装（开发/创造模式推荐）**

在 DSH 插件管理里安装本地目录：

```
/plugin install dsh-vision-nexus
```

或把整个 `dsh-vision-nexus/` 目录复制到当前 profile 的插件目录后，由插件管理器「重新扫描」启用：

```
%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-vision-nexus
```

**方式 B — 通过 `cordis.patch.yml` 注册（Loader 直挂）**

`cordis.patch.yml` 已声明挂载项：

```yaml
- insert:
    - id: dsh-vision-nexus
      name: dsh-vision-nexus
      config:
        loadingStrategy: progressive
        sessionConcurrency: 1
        taskTimeoutMs: 30000
```

`package.json` 的 `dsh.bundle.patch` 指向它。安装后 DSH Loader 会把该 `insert` 合并进运行中的插件树。

**方式 C — npm 包安装**

```bash
npm pack                       # 生成 dsh-vision-nexus-1.0.0.tgz
```

在 DSH 插件管理里安装该 tgz，或发布后按包名安装。

### 2.3 启用与验证

1. 安装后在「插件管理」启用 `dsh-vision-nexus`。
2. 重启 / 刷新会话，使工具表生效。
3. 渐进模式（默认）：会话初始化只暴露 `vision_activate` 一条指令；模型首次需要视觉时调用它，动态注册全部 `vision_*` 工具。
4. 健康自检：调用导出的 `healthSelfCheck(ctx, config)`（或设置页诊断），返回全部引擎可用性与工具子集。
5. 配置敏感项：**API Key / 后端地址明文不写进 `cordis.patch.yml`**，通过插件配置存储 / 凭证服务以 `keyRef` 引用名登记（见 §4）。

### 2.4 本地 CV 运行时依赖（可选，缺失自动降级）

```bash
# 引擎 A 需要 Python 3 + Pillow（numpy 可选，缺失时能力降级）
pip install Pillow numpy
# 长图 OCR 可选：
pip install pytesseract      # 还需系统安装 tesseract
# HTML 渲染截图可选：
pip install playwright && playwright install chromium
```

Python 缺失时：插件自动禁用全部像素计算类工具，切换为「纯路由模式」（远端 VL / WASM OCR 兜底），并在激活结果与系统提示里告知模型可用工具子集变化。

---

## 3. 工具列表（11 个标准化工具，schema 见 `src/toolSchemas.ts`）

| 工具 | 引擎 | 作用 |
|---|---|---|
| `vision_activate` | 调度层 | 渐进模式下激活整套视觉工具集（幂等，首次需要视觉时调用） |
| `vision_glance` | VL→OCR | 图像问答 / 内容描述 / 基础图文理解（大图自动分块采样） |
| `vision_detect` | 本地CV | 元素检测：组件清单 + 编号 + 标准化 xy 坐标框 + 置信度 |
| `vision_ground` | VL→OCR | 目标定位：按描述返回 bbox 坐标 |
| `vision_crop` | 本地CV | 按 bbox 裁剪子图，产物存入 Artifact |
| `vision_long_ocr` | 本地CV→OCR | 长图分段结构化 OCR：带位置标记 markdown + 逐段置信度 |
| `vision_pixel_diff` | 本地CV | 两图像素比对：差异热力图 / 坐标 / 占比 / 量化评估 |
| `vision_extract_foreground` | 本地CV | 抠图 / 去背景，产物带 alpha 存入 Artifact |
| `vision_color_extract` | 本地CV | 主色调提取：色板 + 十六进制色值 + 占比 |
| `vision_trace_svg` | 本地CV | 轮廓追踪：位图转 SVG 矢量图形 |
| `vision_html_render_snapshot` | 本地CV | 渲染 HTML 生成截图存入 Artifact（UI 复现闭环校验） |

**统一返回信封**（`VisionEnvelope`，所有工具必带）：

```jsonc
{
  "data": { /* 结构化文本 / 数值 / 坐标，绝不含图像二进制 */ },
  "confidence": 0.0,                 // 置信度 0..1
  "artifactIds": ["art:3-xxxxxx"],   // 产物 Artifact ID 列表
  "engine": "local-cv",              // local-cv|custom-vl|builtin-vl|wasm-ocr|none
  "degraded": false,                 // 是否降级
  "degradeChain": [],                // 降级链（审计）
  "capabilityNotice": "...",         // 降级时告知模型当前能力限制（可选）
  "auditId": "aud-..."               // 审计记录 ID（单独输出，不污染主回答）
}
```

`render()` 只把上述信封投影成**文本**给主模型，不回传任何图像字节 / base64。

**图像摄取通道（image_id 从哪来）**：宿主在收到图片附件时，插件的
`agent/inbox/inserted` 钩子会把图片字节压缩托管为会话内 Artifact，或由宿主主动调用
`ctx['dsh-vision-nexus:ingest'](sessionKey, bytes, {mediaType, label})`。
两种方式都只登记字节并返回会话内 Artifact id（`art:*`），**原图 / base64 绝不进入模型上下文**。
模型调用 `vision_activate` 后从返回的 `registeredImages` 拿到 `image_id`，再用它调用各
`vision_*` 工具（工具入参也接受会话隔离目录内的绝对路径作为回退）。批量图片自动维护索引。

---

## 4. 架构与关键机制

### 4.1 三层架构

- **调度层**（`scheduler.ts` / `session.ts` / `audit.ts` / `artifacts.ts`）：凭证管理（委托 `ctx.credentials`，密钥不进上下文）、会话隔离、任务队列、并发控制、超时熔断、错误脱敏、会话状态持久化、统一结果信封、完整审计。图片统一压缩预处理 + base64 托管，原图不注入 LLM。
- **工具技能层**（`toolSkill.ts`）：`progressive`（默认）/ `eager` 两种加载策略。渐进模式会话初始化仅暴露 `vision_activate`，需要视觉时才动态注册全套工具，减少系统提示词 token 开销。
- **引擎管理层**：引擎 A 本地 CV（`localCv.ts` + `cv_worker.py`），引擎 B 远端 VL 路由（`remoteVl.ts`）+ WASM OCR 兜底（`wasmOcr.ts`）。

### 4.2 降级优先级（硬性约束）

```
本地 CV 引擎 → 自定义 VL 后端(按 priority) → 内置兜底 VL 链路 → WASM 本地 OCR 兜底
```

- 每次降级自动写审计（`DegradeHop`），并在返回的 `capabilityNotice` 告知模型能力限制。
- 远端服务异常自动降到本地 OCR，**不中断会话**；最底层仍不可用时返回低置信度 + 明确的能力限制说明，**绝不编造图中内容**（严禁脑补）。

### 4.3 任务调度规则

- 串行优先，单会话并发上限 `sessionConcurrency`（默认 1）。超限时任务在会话队列中**等待轮次**（工具调用为单次往返，不丢弃任务），轮到后继续执行；最终结果的统一信封里带 `queued=true` + `queuePosition`，让模型知晓该任务曾排队及排队位置。
- 每个任务独立超时 `taskTimeoutMs`，超时自动终止并触发降级 / 熔断。
- 大图（最长边 > `oversizeEdgePx`）自动分块采样；**禁止模型对超高密度大图一次性全图 `vision_glance`**。
- 批量图片自动维护会话内图片索引（`img:N` / `art:*`），多图比对强制走 `vision_pixel_diff` 量化，禁止模糊文字对比。

### 4.4 安全与存储

- 工作目录严格会话隔离：`.dsh-vision-nexus/sessions/<sessionKey>/{images,artifacts,temp,audit}`。
- API 密钥 / 后端地址等敏感配置只存 `keyRef` 引用名，明文由 `ctx.credentials` 解析，**不进入模型上下文、不写进 patch、不出现在错误 / 审计日志**（`audit.ts` 做入参与错误脱敏）。
- 临时文件按 `tempRetentionMs` 定时清理；所有产出图像自动注册为 DSH Artifact，支持会话内反复引用。
- 会话状态（图片索引 / 激活态）持久化到 `session-state.json`。
- 设置面板路由默认做浏览器同源校验（`Origin`/`Host`/`Sec-Fetch-Site`）。如需防 DNS rebinding，可配置 `panelAllowedHosts` 白名单：留空时行为与默认完全一致；填写后仅允许列表内主机名访问设置路由。因 DSH 宿主的实际绑定地址由运行时决定，插件不强制 Host 必须是 loopback，把这一决策交给部署者（详见 [README.PANEL.md](README.PANEL.md)「安全」节）。

### 4.5 事件钩子（见 `src/index.ts`）

| 事件 | 作用 |
|---|---|
| `session/created` | 初始化会话隔离目录与状态 |
| `session/disposed` | 回收会话内存状态（保留磁盘 Artifact） |
| `agent/inbox/inserted` | 摄取消息里的图片附件为会话内 Artifact（只登记字节，不进上下文） |
| `tools/result` | 单独输出审计行（不污染主回答） |
| 系统提示段 `systemPrompt.context` | 写入视觉能力边界，防止模型绕过工具脑补图片 |

渐进挂载时 `ctx.tools.register()` 由宿主 tools 服务内部发出 `tools/change` 刷新工具表，插件无需自行监听该事件。

`ctx.effect(...)` 注册资源 disposer（工具卸载 / 定时器清理）。

### 4.6 健康自检函数

`healthSelfCheck(ctx, config)`：探测 Python CV 运行时、自定义 VL 后端数、内置兜底、WASM OCR，返回 `ok / mode(full|route-only) / engines / tools(capable,disabled)`。引擎 A 缺失时 `mode=route-only`，像素类工具列入 `disabled`。

---

## 5. 插件内部默认参数（`src/config.ts` 的 `DEFAULTS`）

> 设置面板新增字段（`enabled` / `runMode` / `autoTileEnabled` / `browserRenderEnabled` /
> `ocrLanguage` / `confidenceAlertThreshold` / `degradeNotifyAgent` / `autoCleanupEnabled` /
> `retentionPreset` / `autoSaveArtifacts` / `builtinVlEnabled` 等）的完整默认值与校验区间
> 见 [README.PANEL.md](README.PANEL.md) 第 3、4 节；下表为引擎核心参数。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `loadingStrategy` | `progressive` | 工具加载策略：渐进按需激活 |
| `sessionConcurrency` | `1` | 单会话并发上限（串行优先） |
| `maxQueueLength` | `32` | 等待队列最大长度 |
| `taskTimeoutMs` | `30000` | 单任务独立超时(ms) |
| `oversizeEdgePx` | `1600` | 大图判定阈值(最长边px)，超过触发分块采样 |
| `tileEdgePx` | `768` | 大图分块边长(px) |
| `preprocessMaxEdgePx` | `1280` | 压缩预处理最长边(px)，由本地 CV 运行时降采样；仅在能减小体积时采用结果 |
| `preprocessQuality` | `82` | 压缩质量 |
| `tempRetentionMs` | `86400000` | 临时文件保留时长(24h) |
| `cleanupIntervalMs` | `1800000` | 临时文件清理周期(30min) |
| `pythonPath` | `""` | 本地 Python 路径（空=自动探测 python3/python/py） |
| `cvRuntimePath` | `""` | CV 运行时脚本路径（空=内置 `runtime/cv_worker.py`） |
| `localCvEnabled` | `true` | 是否启用本地 CV 引擎 |
| `vlBackends` | `[]` | 自定义 VL 后端列表（含 `keyRef` / `baseURL` / `model` / `priority`） |
| `builtinVlKeyRef` | `""` | 内置兜底 VL 凭据引用名（空=不启用） |
| `builtinVlBaseURL` | `""` | 内置兜底 VL 端点 |
| `builtinVlModel` | `gpt-4o-mini` | 内置兜底 VL 模型 |
| `wasmOcrEnabled` | `true` | WASM 本地 OCR 兜底开关 |
| `auditSeparate` | `true` | 审计日志单独输出，不污染主回答 |
| `auditMaxEntries` | `500` | 每会话审计日志最大条数 |
| `persistSessionState` | `true` | 会话状态持久化 |
| `panelAllowedHosts` | `[]` | 面板 Host 白名单（空=仅同源校验；非空=仅允许列表内主机名，防 DNS rebinding） |

**自定义 VL 后端配置示例**（写入插件配置存储，密钥用 `keyRef` 引用名，明文由凭证服务保管）：

```json
{
  "vlBackends": [
    { "id": "vl-primary", "label": "主 VL", "priority": 10,
      "keyRef": "DSH_VISION_NEXUS_VL_PRIMARY_KEY",
      "baseURL": "https://your-vl-endpoint/v1", "model": "your-vl-model", "enabled": true },
    { "id": "vl-backup", "label": "备 VL", "priority": 20,
      "keyRef": "DSH_VISION_NEXUS_VL_BACKUP_KEY",
      "baseURL": "https://backup-vl-endpoint/v1", "model": "your-vl-model", "enabled": true }
  ]
}
```

> `keyRef` 指向的值通过 DSH 凭证服务设置，**绝不要**把明文密钥写进 `cordis.patch.yml` 或任何会进入模型上下文的位置。

---

## 6. 对外能力边界（不可逾越）

- 模型不能绕过工具直接脑补图片内容；插件底层不允许直接把图片塞给主 LLM，强制走工具调用链路。
- 引擎 A 缺失 Python 运行环境时自动禁用本地像素计算类工具，切换纯路由模式，并通知模型可用工具子集变化。
- 支持批量图片任务，自动维护图片索引；多图比对强制 `vision_pixel_diff` 量化，禁止模糊文字对比。

---

## 7. 开发约定对齐（与 DSH 标准插件一致）

- `package.json`：`main=lib/index.js`、`dsh.bundle.patch=./cordis.patch.yml`、`dsh.engines.dsh`、peerDeps 为 `@deepseek-ai/cordis` + `@deepseek-ai/schemastery`。
- `cordis.patch.yml`：格式 `- insert: [{ id, name, config }]`。
- `src/index.ts`：导出 `name` / `inject` / `Config` / `apply` / `healthSelfCheck`；`apply()` 内 `ctx.tools.register(...)` 注册工具、`ctx.on(...)` 挂事件钩子、`ctx.effect(...)` 注册资源 disposer。
- 工具定义沿用 `defineTool({ name, description, parameters, output:{schema,render}, execute })` 形态，参数 / 输出 schema 为受支持的 JSON Schema 子集。
