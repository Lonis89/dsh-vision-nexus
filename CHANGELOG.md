# 更新日志

本项目的所有重要变更都会记录在这里。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 变更（2026-11-06 安装命令统一）

- README（中 / 英）删除各平台安装示例（Windows PowerShell / cmd / macOS / Linux 示例表、
  `$(pwd)` 与 PowerShell 双命令块、无 profile 的简写形式），安装命令统一为单条
  `dsh plugin --profile desktop add dsh-vision-nexus`；本地源码场景统一为
  `dsh plugin --profile desktop add link:<本地路径>`（英文为 `<local-path>`）。
- `scripts/verify-readme.mjs`：本地加载命令断言同步改为统一形式。

### 修复（2026-11-06 全面审计后的一轮修复，58 条发现）

本次修复针对 `audit/` 下的三份分项审计报告（Host 31 条 / Client 14 条 / Contract 13 条）。
修复后本机实测：`node scripts/build.mjs`、`npm run test`（6 套）、`check-package`、
`verify-imports`、`verify-build`、`verify-readme` **全部退出码 0**。

#### 阻断级 / 功能明显错误（P1）

- **客户端语言切换完全失效**（`src/client/index.ts`）。
  两处根因：① 词典用 `'zh-CN'/'en-US'` 作键，而宿主 `dsh-client-locale` 只认短码 `zh/en`
  （证据：asar 内 `dsh-client-locale/lib/client.js:1818-1837`）；② 读 `getLocale().id`，
  而真实的 `LocaleSnapshot` 是 `{active, locales, revision}`（同文件 `:1731-1736`），
  于是 `?? 'zh-CN'` 恒生效、界面永远中文。现改为同时注册 `zh/en` 与 BCP-47 两套键、
  并从 `active` 取当前语言（兼容字符串与 `{id}` 两种形态）。
- **清单声明的类型产物永不产出**（`plugin.json` / `package.json`）。
  `entry.host.types` 指向 `lib/types/index.d.ts`，但构建脚本只做类型剥离、不产 `.d.ts`，
  且 `tsconfig.build.json` 又 `exclude` 了 `src/client`。已移除这两个 types 声明，
  并把 `build` 脚本改为真实可执行的 `node scripts/build.mjs`。
- **并发闸门：排队无超时 + 队首阻塞饿死其它会话**（`src/host/runtime/concurrency.ts`）。
  排队阶段新增超时（取 `taskTimeoutMs`），`drain()` 改为扫描队列找第一个可准入的
  waiter，不再"队首不可准入就整体 return"。
- **超时不是硬截止**（`src/host/scheduler/dispatcher.ts`）。
  适配器返回后补 `if (slot.signal.aborted) throw VN_TIMEOUT`，避免已超时的调用
  继续写缓存、记成功链路、占配额。
- **能力不匹配被当作后端故障，可熔断健康后端**（`strategy.ts` / `dispatcher.ts`）。
  选完候选后先按 `adapter.supports(tool)` 过滤；过滤后为空返回 `VN_BACKEND_UNAVAILABLE`(503)
  而不是 `VN_INVALID_ARGUMENT`(400)；循环内的能力不匹配改为"退还配额 + 释放探测名额 + 跳过"。
- **会话图片池永不回收**（`src/host/service.ts` / `image-buffer.ts`）。
  `releaseSessionImages()` 此前全仓无调用方；现在 `ImageBufferStore` 提供空闲回收，
  并挂到既有的 `maintain()` 定时器（不新增定时器）。
- **配额超限被计为后端故障**（`dispatcher.ts` / `circuit-breaker.ts`）。
  新增 `releaseProbe(id)`（只归还 half-open 探测名额，不累加失败计数），
  配额分支改调它并记 warn，不再 `recordFailure`。
- **测试体系假绿**（`scripts/`）。
  - `verify-build.mjs`：客户端 `__require` 检查的正则此前只匹配双引号、且要求工厂带
    `require` 形参 → 两个集合恒空、断言恒真。现同时接受单双引号与
    `function (module, exports)` 签名，并在集合为空时**主动失败**。
  - `verify-build.mjs`：`schemastery` 缺失时 4 项契约检查直接 `return`，而 `check()`
    把正常 return 记为通过 → CI（不装依赖）上「Host 入口契约」从未被验证。现改为
    缺失即失败，并在 `locateHostPackage()` 中增加 `ROOT/node_modules` 候选。
  - `render-check.mjs`：重命名注释与用例，不再声称"渲染组件"；原「序列号守卫」用例
    改为验证真实机制（`AbortSignal` + alive 守卫），不再调用已删除的 API。
  - `check-package.mjs`：路由一致性从"双向前缀模糊匹配 + `unique.size>0` 恒真断言"
    改为**精确路径比对 + 方法级去重 + 合法性校验**；顺带发现并修正了
    `/traces/{id}` 与 `/traces` 在归一化时相撞的误报。
  - `check-boundaries.mjs` / `check-package.mjs`：删除"强制声明源码 0 引用的
    reactflow/echarts/tailwindcss/class-variance-authority/@radix-ui 等"的硬断言，
    改为反向断言（不得回归），否则清理未使用依赖会被测试阻止。
  - `client-load-check.mjs`：此前从未被任何入口调用，现已加入 `run-all-tests`（第 6 套）
    与 `package.json` 的 `test:client-load`。
  - `check-dsh-contract.mjs`：注解白名单删掉 `format`（宿主 `dsh-tools` 只认
    description/title/default/examples），避免"本地绿、宿主注册抛错"。

#### 声明与清单一致性（P2）

- `package.json`：`dsh.engines.dsh` 是 DSH 不读的死字段，已移到**顶层** `engines.dsh`；
  `check-package.mjs` 增加"不得再出现 `dsh.engines`"的断言。
- `dsh.client.inject`：移除 3 个宿主运行时不存在的包（`dsh-client-store`、
  `dsh-client-ui-slots`、`dsh-client-ui-primitives`）。经宿主源码确认这不会阻断加载
  （浏览器侧对不在 boot graph 的 inject 目标静默跳过），但属清单撒谎。
- `plugin.json`：删除 DSH 不存在的 `entry.bundle.rowId`；`services.required` 中的
  `credentials` 移到 optional（与 `src/index.ts` 的 `inject=['webServer','tools']` 一致）；
  `vision_long_ocr` 的 backends 与唯一真相源 `tool-catalog.ts` 对齐（去掉多余的
  `python-local`）；`/health` 的方法声明由 GET 改为 POST（与客户端 `post('health')` 一致）。
- `package.json`：清理 11 个源码 0 引用的前端依赖与不实 keywords；
  CI 增加 `npm install` 与 `npm run typecheck` 步骤。

#### 其它（P2/P3）

- `src/host/runtime/sandbox.ts`：白名单根目录补 `realpathSync` 归一化（符号链接/8.3 短名
  不再误拒）；修正盘根 `C:\`、`/` 被归一化成 `C:`/空串的边界；`safeRealpath` 失败时
  逐级向上 realpath 最近的已存在祖先。
- `src/host/observability/metrics.ts`：缓存命中不再以 `backendId='cache'` 计为一个
  幽灵后端的流量占比。
- `src/host/runtime/cache.ts`：磁盘条目缺数值 `bytes` 时不再让 `totalBytes` 变 NaN
  （否则每次写入都会清空整池）；`persist()` 写盘前校验条目仍在池内，避免已删除条目复活。
- `src/host/observability/logger.ts` / `store.ts`：`logging.retainDays` 此前从未被消费
  （日志永久堆积），现挂到 `maintain()` 清理过期日志；日志文件名改用本地日期；
  `TraceStore` 改为脏标记 + 定期 flush，不再每条链路都全量序列化落盘。
- `src/shared/constants.ts`：补齐 `video/webm` 与 `video/quicktime` 的魔数（此前在
  MIME 白名单里但魔数表没有，上传必然被拒）。
- `src/host/http/routes/overview.ts`：`/health` 增加方法守卫（仅接受 POST）。
- `scripts/check-encoding.mjs`：把 `lib/`（发布产物）纳入扫描并加断言防止回归；
  扩展名补 `.py/.pyi/.patch` 与无扩展名的 `LICENSE`/`.gitignore` 等。
- `scripts/lib/utf8.mjs`：管道模式下 `console.error` 也遵守"非 ASCII 只进报告"；
  自动报告文件做数量上限清理；`chcp` 修改的控制台代码页在退出时恢复。
- `PROJECT-STRUCTURE.md`：修正陈旧内容——路由数（35 → 30 个处理器 / 37 条 method+path）、
  不存在的 `src/client/store.ts`、`theme.ts`、`toast.tsx`、`confirm.tsx`、
  `src/shared/protocol.ts`、`src/host/config.ts`、`src/host/plugin.ts`、
  `src/host/runtime/ffmpeg.ts`、`src/host/observability/trace-store.ts`、
  `src/host/security/{agent-allowlist,upload-guard}.ts`，以及并不存在的 `python/` 目录。

- **彻底解决中文日志乱码反复出现的问题**。
  实测定位根因：乱码不在 Node 而在 PowerShell 用 `$OutputEncoding`（默认 GBK）
  解码子进程 stdout 的环节，`setDefaultEncoding` 之类脚本侧设置无法修复父进程。
  - 重写 `scripts/lib/utf8.mjs`：提供 `enableReport()`，把所有 console 输出
    镜像到 UTF-8 文件（Node 直接写盘，绕开终端解码）；
  - 所有脚本的 `bootstrapConsole()` 自动识别 `--report <文件>`，一处改动全局生效；
  - 新增 `scripts/check-encoding.mjs`：扫描全部源码，确保无 GBK 文件 / BOM /
    U+FFFD，把"乱码"变成会失败的测试；
  - `npm run test` 现在是**五套**：后端 → 前端 → 边界 → DSH 契约 → 编码；
  - README 更正此前"`setDefaultEncoding` 能保证管道输出正确"的错误说明。

- **修复 14 个工具无法注册到 DSH 宿主的严重问题**。
  通过解包 `app.asar` 取得宿主真实的 `assertSupportedJsonSchema`，实测发现
  本项目把必填性写成"属性内 `required: true`"，而 DSH 只接受标准 JSON Schema
  （`required` 必须是 `type: "object"` 节点上的字符串数组），
  宿主会抛 `required is not supported on type "..."`，导致全部工具注册失败。
  - 新增 `src/host/tools/schema-normalize.ts`：在 `buildToolDefinition`
    唯一出口把简写规范化为标准写法；纯函数，不修改入参；
  - 新增 `scripts/check-dsh-contract.mjs`：把 DSH 的 schema 子集规则固化为
    可移植回归测试，覆盖 14 个工具的 `parameters` 与 `output.schema`；
  - 新增 `--report <文件>` 给测试总入口：由脚本直接写 UTF-8 文件，
    绕开 PowerShell 的 GBK 解码，彻底解决中文日志/报告乱码；
  - `npm run test` 现在是**四套**：后端 → 前端 → 边界 → DSH 契约。

### 变更

- **插件重命名为 `dsh-vision-nexus`**（原 `vision-nexus`）。同步调整：
  包名、`plugin.json` 的 id/package/rowId/slotId、i18n 命名空间、
  client bundle 模块 id、HTTP 路由前缀 `/api/dsh-vision-nexus`，
  以及私有数据目录 `$DSH_HOME/dsh-vision-nexus`。

### 新增

- **旧版数据自动迁移**：首次启动时若检测到 `$DSH_HOME/vision-nexus`，
  自动把 `state.json`、`quota.json`、`traces.json`、`cache/`、`snapshots/`
  等复制到新目录，无需手工搬移。
  - 迁移是**复制而非移动**，旧目录保留，可安全回滚；
  - 新目录已有 `state.json` 时跳过，绝不覆盖用户新配置；
  - 写入 `migrated.marker` 保证幂等，只执行一次；
  - 跳过 `pyenv/`（venv 内含硬编码绝对路径，复制后不可用）；
  - 迁移失败只记 warn，不影响插件启动。

## [0.1.0] - 2026-11-05

首个可发布版本。

### 新增

- **调度引擎**：四种策略（顺序降级 / 权重轮询 / 优先本地 / 最低延迟），
  与熔断器正交，支持按后端覆盖阈值与冷却时长。
- **熔断器**：三态迁移（closed → open → half-open）、指数退避冷却、
  半开态单次探测、失败阈值与冷却时长可按后端独立配置。
- **多后端适配器**：OpenAI 兼容、Ollama、托管 Python 运行时、
  Tesseract 离线 OCR、自定义 HTTP 模板映射。
- **14 个视觉工具**：`vision_insight`、`vision_ground`、`vision_detect`、
  `vision_crop`、`vision_image_diff`、`vision_long_ocr`、`vision_remove_bg`、
  `vision_extract_color`、`vision_html_capture`、`vision_svg_trace`、
  `vision_batch_ocr`、`vision_video_sample`、`vision_chart_analyze`、
  `vision_code_scan`。
- **运行时治理**：内容寻址缓存（TTL + LRU + 统计）、三级配额
  （全局 / 单后端 / 单工具）、并发闸门（单会话 + 全局，带超时取消）、
  目录白名单沙盒。
- **可观测性**：链路追踪（traceId 贯穿请求）、分级日志与环形缓冲、
  24 小时指标序列、成功率与后端占比统计、统一脱敏。
- **前端 6 个标签页**：数据总览、调度画布、工具管理、测试工作台、
  运行时与安全、配额与日志。中英双语。
- **配置管理**：配置快照的保存 / 切换 / 删除、JSON 导入导出（导出即脱敏）。

### 修复

- **Windows 中文日志乱码**：新增 `scripts/lib/utf8.mjs`，所有脚本在顶部
  强制把 `process.stdout` / `process.stderr` 的默认编码设为 UTF-8。
  根因是进程按 UTF-8 写出、终端按 GBK 解码，两侧不一致。
  同时修正 `render-check.mjs` 误用 `assert.throws`（该文件的 `assert`
  是本地极简实现，没有该方法）。
- **`ERR_MODULE_NOT_FOUND: Cannot find package 'react'`**：后端测试脚本
  越界加载了 `src/client` 下的 React 组件。现在：
  - `smoke.mjs` 用 `assertBackendOnly()` 在导入前拦截，白名单只放
    `src/shared/`、`src/host/`、`src/index.ts`；
  - `render-check.mjs` 用 `REACT_FREE_MODULES` 白名单，只允许
    locales / styles / format / api 四个零 React 依赖模块；
  - 新增 `scripts/check-boundaries.mjs`，8 项检查覆盖三层隔离。
- **`check-package.mjs` 路径误报**：新增 `normalizePath()` /
  `relativeToSrc()`，解决 `new URL('../src/client/...')` 的 `../` 前缀
  导致的"不在白名单"误判，并补回归用例锁死行为。
- **`package.json` 类型引用指向未产出文件**：`types` 曾指向
  `lib/types/index.d.ts`，但构建脚本只做类型剥离、不产出 `.d.ts`。
  已移除坏引用（需要完整类型时再启用 `tsc -p tsconfig.build.json`）。

### 变更

- `package.json` 补齐前端依赖清单：`react`、`react-dom`、`@types/react`、
  `@types/react-dom`、`reactflow`、`echarts`、`tailwindcss`（含
  `postcss` / `autoprefixer` / `tailwindcss-animate`）以及 shadcn/ui 底座
  （`class-variance-authority` / `clsx` / `tailwind-merge` / `lucide-react` /
  `@radix-ui/*`）。`react` 与 `react-dom` 走 `peerDependencies`，
  由 DSH 宿主提供，避免双实例。
- 新增 `scripts/run-all-tests.mjs` 作为测试总入口：按 后端 → 前端 → 边界
  顺序执行，三套都会跑完并输出汇总表（区别于 `a && b && c` 的短路语义）。
  `npm run test` 指向它，另保留 `test:sequential` 作短路版。
- UTF-8 引导检查由硬编码名单改为**扫描 `scripts/` 下全部 `.mjs`**，
  新增脚本漏引导即失败，避免名单腐化。

### 安全

- 密钥只存引用名，明文经 DSH credentials 读写。
- 配置导出强制脱敏。
- 目录白名单外拒绝一切磁盘访问，`..` 与符号链接逃逸均被拦截。
- 出站请求强制超时、禁重定向、响应体上限 32MB。
- 指标、链路、日志仅落本地，不向第三方上报。

[未发布]: https://github.com/Lonis89/dsh-vision-nexus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Lonis89/dsh-vision-nexus/releases/tag/v0.1.0
