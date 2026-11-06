# dsh-vision-nexus — 阶段一交付：项目结构、文件职责、插件清单

> 本文件是阶段一的评审件。阶段一不写业务代码，只锁定目录结构、文件职责边界与 `plugin.json` 清单。
> 确认后再进入阶段二（后端调度引擎 → 适配器 → 工具注册）与阶段三（前端 6 个标签页）。

---

## 0. 命名与装载约定

| 概念 | 文件 | 说明 |
| --- | --- | --- |
| DSH 插件清单 | `plugin.json` | 本插件自有的声明式清单：身份、能力、权限、配置、路由、工具目录。**评审对象**。 |
| Loader 清单 | `package.json` | DSH / npm 真正读取的入口清单：`main`、`exports`、`dsh.bundle.patch`、`dsh.client`。 |
| 装载补丁 | `cordis.patch.yml` | bundle 补丁，把 `dsh-vision-nexus` 行插入 profile 的插件名册。 |
| Host 半边 | `lib/index.js` | 由 `src/index.ts` 构建，导出 `name` / `inject` / `Config` / `apply`。 |
| Client 半边 | `lib/client.js` | 由 `src/client/index.ts` 构建，`window.__ModuleLoader__.load({ id, factory })` 包装。 |

`plugin.json` 与 `package.json` 是**两份不同职责的清单**，不是重复：
`plugin.json` 面向人、面向插件市场、面向自检工具；`package.json` 面向 Node / DSH Loader。
两者由 `scripts/check-package.mjs` 在构建时做一致性校验（id、version、工具数、路由数）。

---

## 1. 完整目录结构

```text
dsh-vision-nexus/
├── plugin.json                          # DSH 插件清单（声明式能力清单）
├── package.json                         # Loader / npm 清单：main、exports、dsh.bundle、dsh.client
├── cordis.patch.yml                     # bundle 补丁：insert 一行 id=dsh-vision-nexus
├── tsconfig.json                        # 开发期 TS 配置（含 client 的 DOM lib）
├── tsconfig.build.json                  # 构建期 TS 配置（declaration only）
├── icon.svg                             # 插件图标（深蓝→淡紫渐变）
├── LICENSE                              # Apache-2.0
├── README.md                            # 中文文档
├── README.en.md                         # 英文文档
├── CHANGELOG.md                         # 更新日志（Keep a Changelog 格式）
├── CONTRIBUTING.md                      # 贡献指南（含边界约定与提交规范）
├── CODE_OF_CONDUCT.md                   # 行为准则（Contributor Covenant 2.1）
├── SECURITY.md                          # 安全策略与漏洞报告渠道
├── PROJECT-STRUCTURE.md                 # 本文件：目录与职责
├── .gitignore                           # 忽略 node_modules / lib / 密钥 / 临时文件
├── .github/
│   ├── workflows/ci.yml                 # CI：Ubuntu+Windows × Node 22+24 测试矩阵
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml               # Bug 表单
│   │   ├── feature_request.yml          # 功能建议表单
│   │   └── config.yml                   # 模板选择页（禁用空白 issue）
│   └── PULL_REQUEST_TEMPLATE.md         # PR 自检清单
├── locale/
│   ├── zh.json                          # 中文词典（由 gen:locales 从 locales.ts 导出）
│   └── en.json                          # 英文词典（与 zh 全键对齐）
├── scripts/
│   ├── lib/utf8.mjs                     # 控制台 UTF-8 引导（Windows 乱码修复的唯一真相源）
│   ├── run-all-tests.mjs                # 测试总入口：后端 → 前端 → 边界，顺序执行并汇总
│   ├── gen-locales.mjs                  # 从 locales.ts 导出 locale/*.json
│   ├── smoke.mjs                        # 后端冒烟：schema / 调度 / 配额 / 缓存 / 沙盒 / 脱敏
│   ├── render-check.mjs                 # 前端检查：词典 / 样式 / API / 校验逻辑（零 React 依赖）
│   ├── check-boundaries.mjs             # 前后端隔离校验 + 前端依赖清单 + UTF-8 引导全覆盖
│   ├── check-package.mjs                # 清单一致性 + 前端依赖 + locale 同步 + 发布文件齐全
│   ├── verify-imports.mjs               # 相对导入可达性 + 重复导出
│   ├── verify-build.mjs                 # 构建产物可加载性
│   ├── verify-readme.mjs                # README 事实校验（数字、章节、命令、引用文件）
│   ├── build.mjs                        # 类型剥离构建（不依赖 tsc）
│   ├── list-routes.mjs                  # 列出实际注册的路由
│   ├── client-load-check.mjs            # 用 React 桩加载全部前端模块
│   └── client-load-hooks.mjs            # ESM loader：把 react 重定向到桩
└── src/
    ├── index.ts                         # Host 入口：Config 定义 + apply() 装配
    ├── shared/                          # Host 与 Client 共享的纯类型/常量（零副作用）
    │   ├── constants.ts                 # 路由前缀、默认 TTL、缓存键、版本号
    │   ├── types.ts                     # BackendSpec、ToolSpec、TraceRecord、QuotaState …
    │   ├── tool-catalog.ts              # 14 个工具的元数据唯一真相源
    │   └── errors.ts                    # VisionNexusError + 稳定错误码
    ├── host/
    │   ├── service.ts                   # VisionNexusService：对外统一门面
    │   ├── scheduler/
    │   │   ├── strategy.ts              # 四种调度策略的纯函数实现
    │   │   ├── circuit-breaker.ts       # 连续失败 → 冷却隔离 → 半开探测
    │   │   └── dispatcher.ts            # 一次请求的完整编排：缓存→配额→并发→调度→追踪
    │   ├── adapters/
    │   │   ├── base.ts                  # VisionAdapter 抽象：capabilities / health / run
    │   │   ├── openai-compat.ts         # OpenAI 兼容多模态 chat/completions
    │   │   ├── ollama.ts                # 本地 Ollama /api/chat 视觉模型
    │   │   ├── python-local.ts          # 托管 Python 运行时作业
    │   │   ├── tesseract.ts             # 离线 OCR 兜底（子进程）
    │   │   ├── custom.ts                # 自定义 HTTP 适配器（模板化请求/响应映射）
    │   │   └── registry.ts              # 类型 → 构造器注册表，支持外部扩展
    │   ├── tools/
    │   │   ├── define.ts                # defineVisionTool：参数 schema + 守卫 + 输出渲染
    │   │   ├── registry.ts              # 按配置注册/注销工具，实现独立开关
    │   │   └── handlers/                # 14 个工具，一工具一文件
    │   │       ├── insight.ts
    │   │       ├── ground.ts
    │   │       ├── detect.ts
    │   │       ├── crop.ts
    │   │       ├── image-diff.ts
    │   │       ├── long-ocr.ts
    │   │       ├── remove-bg.ts
    │   │       ├── extract-color.ts
    │   │       ├── html-capture.ts
    │   │       ├── svg-trace.ts
    │   │       ├── batch-ocr.ts
    │   │       ├── video-sample.ts
    │   │       ├── chart-analyze.ts
    │   │       └── code-scan.ts
    │   ├── runtime/
    │   │   ├── artifacts.ts             # 产物落盘与下载
    │   │   ├── image-buffer.ts          # 会话级 Buffer 存储，同图不重复上传
    │   │   ├── image-meta.ts            # 魔数嗅探、尺寸、哈希（sha256 内容寻址）
    │   │   ├── cache.ts                 # 内容寻址缓存 + TTL + LRU 淘汰 + 统计
    │   │   ├── quota.ts                 # 全局/后端/工具三级滑窗配额
    │   │   ├── concurrency.ts           # 单会话与全局并发闸门 + 超时取消
    │   │   ├── python-runtime.ts        # 解释器探测、venv 初始化、依赖安装、健康检测
    │   │   ├── python-prelude.ts        # Python 作业协议前导（stdin-JSON → stdout-JSON）
    │   │   ├── python-scripts.ts        # 内置 Python 作业脚本（PY_SCRIPTS）
    │   │   ├── video-script.ts          # 视频抽帧脚本
    │   │   ├── paths.ts                 # DSH_HOME 与插件私有目录解析
    │   │   ├── migrate.ts               # 旧版数据迁移
    │   │   └── sandbox.ts               # 目录白名单解析与越界拒绝
    │   ├── observability/
    │   │   ├── logger.ts                # 分级日志 + 环形缓冲 + 链路持久化（TraceStore）
    │   │   ├── metrics.ts               # 24h 序列、成功率、后端占比
    │   │   └── redact.ts                # 密钥/凭证脱敏（日志与导出共用）
    │   ├── config/
    │   │   ├── store.ts                 # 配置读写（只存引用，不存明文）
    │   │   ├── snapshots.ts             # 快照保存/切换/删除
    │   │   ├── credentials.ts           # Credentials 引用解析与写入
    │   │   └── import-export.ts         # 配置 JSON 导入导出（导出即脱敏）
    │   ├── http/
    │   │   ├── respond.ts               # 统一 JSON 响应、错误码映射、no-store
    │   │   ├── router.ts                # 30 条路由处理器的注册与释放（按 kind+path；plugin.json 展开为 37 条 method+path）
    │   │   └── routes/                  # 一域一文件
    │   │       ├── overview.ts
    │   │       ├── backends.ts
    │   │       ├── tools.ts
    │   │       ├── workbench.ts
    │   │       ├── traces.ts
    │   │       ├── logs.ts
    │   │       ├── quota.ts
    │   │       ├── settings.ts
    │   │       ├── cache.ts
    │   │       ├── snapshots.ts
    │   │       ├── config-io.ts
    │   │       ├── python.ts
    │   │       └── dirs.ts
    │   └── security/
    │       └── net-guard.ts             # 出站超时、禁重定向、响应体上限
    └── client/
        ├── index.ts                     # Client 入口：注册 locale + 挂载 settings.section
        ├── api.ts                       # 带超时与序列守卫的 HTTP 客户端
        ├── format.ts                    # 数字/时间/百分比格式化
        ├── hooks.ts                     # useAsync + loadXxx（状态由 hooks 管理，无独立 store.ts）
        ├── locales.ts                   # NS + zh/en 字典（唯一真相源）
        ├── styles.ts                    # 玻璃拟态 CSS（注入 <style data-plugin>）
        ├── ui/
        │   ├── primitives.ts            # Card / Stat / Toggle / Field / Skeleton / Toast / Dialog / Select
        │   └── charts.ts                # 纯 SVG 饼图与折线图（零第三方依赖）
        └── tabs/
            ├── Shell.ts                 # 6 标签页外壳与窄屏堆叠
            ├── DashboardTab.ts
            ├── CanvasTab.ts             # 轻量自研拖拽画布（不引入 react-flow 依赖）
            ├── ToolsTab.ts
            ├── WorkbenchTab.ts
            ├── RuntimeTab.ts
            └── GovernanceTab.ts
```

---

## 2. 关键设计决策（需要你确认）

1. **画布不引入 `react-flow`**。DSH 客户端 bundle 是外部构建的 ES 模块，第三方重依赖会显著抬高体积并引入 React 版本冲突风险。Tab2 用自研的绝对定位 + Pointer Events 拖拽实现同等的"拖节点调优先级"体验，视觉与交互一致，体积从 ~120KB 降到 ~6KB。若你坚持要 react-flow，我在阶段三改成可选依赖并降级。
2. **`plugin.json` 不是 DSH 官方文件名**。DSH 官方只读 `package.json`。`plugin.json` 按你的要求作为**声明式能力清单**存在，由 `scripts/check-package.mjs` 保证与 `package.json` 一致；两者不冲突。
3. **Python 运行时是可选增强**。所有 14 个工具都有纯 Node 或纯 HTTP 的降级路径；没有 Python 时 `vision_crop` 等本地算法工具会返回明确的 `VN_RUNTIME_MISSING` 而非静默失败。
4. **密钥永不落配置文件**。`BackendSpec.apiKeyRef` 只存引用名（`VISION_NEXUS_<ID>_API_KEY`），实际值经 `ctx.credentials` 读写；导出配置时该字段被替换为 `<KEEP_EXISTING>` 占位。
5. **配置存储**用 Schemastery `Config` + `volatile()`，写设置即热更新，不重启插件、不断路由。
6. **工具配额三级**：全局 / 后端 / 单工具，任一超限即返回友好错误并计入指标。

---

## 3. 阶段划分

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **一（本次）** | 目录结构 + 文件职责 + `plugin.json` | `plugin.json`、本文件 |
| 二 | 后端：config → service → scheduler → adapters → runtime → observability | `src/host/**`、`src/shared/**` |
| 三 | 后端：14 个工具注册 + 30 条路由处理器 + 安全层 | `src/host/tools/**`、`src/host/http/**`、`src/host/security/**` |
| 四 | 前端：6 个标签页 + UI 原语 + 图表 + 玻璃拟态样式 | `src/client/**` |
| 五 | 双语 README + 打包校验 + 在当前工作区安装/测试步骤 | `README*.md`、`scripts/**` |

---

## 4. 清单自检结果

`plugin.json` 已通过 JSON 解析校验：`id=dsh-vision-nexus`、`version=0.1.0`、`capabilities.tools=14`、`capabilities.routes=37`（按 method+path 展开；`src/host/http/routes/**` 实际注册 30 条 `kind+path` 处理器，一个路径内按 HTTP 方法分派）。
