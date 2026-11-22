# dsh-vision-nexus · 侧边设置面板

给 `dsh-vision-nexus` 插件新增的 **DSH 原生风格侧边设置面板**：表单化配置、状态自检、实时状态展示。贴合浅色/深色主题、控件对齐、提示简洁；配置变更实时写入插件 storage 并**热生效（无需重启）**；非法输入实时校验标红。

> 与 Host 半引擎配置共用同一套字段、默认值与校验区间（单一事实来源：`src/config.ts` 的 `DEFAULTS` / `resolveConfig()` + `src/client/settingsModel.ts`）。不引入任何其他外部插件依赖，不引用其他插件名称。

---

## 1. 六大分区（与需求逐项对应）

```dsh-ui
{"title":"设置面板分区","gap":10,"items":[{"type":"steps","steps":[{"title":"① 运行模式总开关"},{"title":"② 引擎配置区"},{"title":"③ 工具调度策略"},{"title":"④ 任务限流与超时"},{"title":"⑤ 产物与存储"},{"title":"⑥ 健康自检面板（实时）"}]},{"type":"table","columns":["分区","控件","对应配置字段"],"rows":[["① 运行模式总开关","总开关 Toggle / 运行模式 Radio / 加载策略 Radio / 大图分块 Toggle + 阈值数字框","enabled, runMode, loadingStrategy, autoTileEnabled, oversizeEdgePx"],["② 引擎配置区","Python 路径输入 + 自动检测按钮 / 浏览器内核检测 / 本地CV开关 / VL 后端可拖拽列表（地址·keyRef·模型·最大尺寸）/ 内置兜底开关 / WASM OCR 开关 + 语言下拉","pythonPath, browserRenderEnabled, localCvEnabled, vlBackends, builtinVlEnabled, builtinVlModel, wasmOcrEnabled, ocrLanguage"],["③ 任务调度策略","并发数(1~5) / 超时秒 / 队列长度 / 置信度告警滑块 / 降级通知开关","sessionConcurrency, taskTimeoutMs, maxQueueLength, confidenceAlertThreshold, degradeNotifyAgent"],["④ 任务限流与超时","分块边长 / 压缩最长边 / 审计条数 / 清理周期 / 状态持久化 / 审计单独输出","tileEdgePx, preprocessMaxEdgePx, auditMaxEntries, cleanupIntervalMs, persistSessionState, auditSeparate"],["⑤ 产物与存储","保留时长下拉 / 自动清理开关 / 自动保存产物开关 / 压缩质量滑块 / CV 脚本路径","retentionPreset, tempRetentionMs, autoCleanupEnabled, autoSaveArtifacts, preprocessQuality, cvRuntimePath"],["⑥ 健康自检","一键自检按钮 / 正常·警告·异常标签 + 原因 + 修复指引 / 实时运行状态（激活引擎·已注册工具·队列·今日调用·今日降级·平均置信度）","由 Host 路由 /health、/status 提供"],["辅助按钮","重置为默认 / 导出配置JSON / 导入配置JSON","exportConfigText / parseImport / draftFrom"]]}]}
```

- **检测失败高亮**：引擎 A 的 Python 自动检测 / 浏览器内核检测结果以「警告 / 异常」标签 + 修复指引呈现；`localCvEnabled=false` 或 Python 缺失时 Host 侧自动禁用像素类工具（纯路由模式），面板同步提示。
- **拖拽排序**：VL 后端列表用 HTML5 `draggable` 上下拖拽，数组顺序即优先级（靠前优先）。每条含：接口地址、API Key（`keyRef` 引用名，明文由凭证服务保管）、模型名称、最大图片尺寸。
- **实时状态**：`get /status` 每 15 秒刷新，展示当前激活引擎、已注册工具清单、队列等待/运行中任务数、今日调用/降级计数与平均置信度。

### 面板字段 → 运行时行为（每个控件都真实生效，无空操作）

| 字段 | 运行时落点 |
|---|---|
| `enabled` | `apply` 按开关决定是否 `skill.init()` 注册工具；`loader/volatile-update` 动态注册 / 卸载 |
| `runMode` | `healthSelfCheck` 的能力判定 + `activeEngine` 展示；`local-only`/`remote-only` 收敛可用工具集 |
| `autoTileEnabled` / `oversizeEdgePx` | `preprocessImage()` 的 `oversized` 判定（关闭则不触发分块） |
| `browserRenderEnabled` | 健康自检措辞 + `cv_worker.py` 的 `html_render_snapshot` 关闭时不生成截图、返回能力限制 |
| `ocrLanguage` | 调度层注入 `params.language` → WASM OCR / `cv_worker.py` 的 tesseract `lang`（zh→chi_sim / en→eng / mix→chi_sim+eng） |
| `confidenceAlertThreshold` | 调度层结果低于阈值时在 `capabilityNotice` 追加「建议二次校验」提醒 |
| `degradeNotifyAgent` | 关闭时不写降级 `capabilityNotice`（审计仍记录降级链） |
| `autoSaveArtifacts` | 关闭时不把产物注册为 DSH Artifact |
| `autoCleanupEnabled` / `retentionPreset` | `SessionManager.maintenance()` 按开关与保留时长清理临时文件（never=0 不清理） |
| `sessionConcurrency` / `taskTimeoutMs` / VL 后端列表 | 全部经 `currentConfig()` getter 注入引擎 / 调度层，热更新即时生效 |

### 安全

- `/test-vl` 只探测**已在 `vlBackends` 配置里登记**的 `(baseURL, model, keyRef)` 三元组，拒绝任意 URL + 任意 keyRef 组合，防止凭据被同源请求外泄。
- 所有路由做同源校验（有 `Origin` 必须与 `Host` 一致；`Sec-Fetch-Site: cross-site` 直接拒绝）；只回结构化状态，不回传 API Key 明文 / 图片字节。
- **可选 Host 白名单 `panelAllowedHosts`（防 DNS rebinding）**：rebinding 时浏览器会认为攻击域名「同源」，`Origin==Host` 与 `same-origin` 信号都可能被满足，此时只有部署者声明的可信主机名能挡住。留空（默认）= 沿用同源校验，行为与旧版完全一致；填写后（如 `127.0.0.1, localhost, [::1]`）仅允许列表内主机名访问设置路由。主机名经规范化比较（去协议 / 端口 / 大小写 / 末尾点，IPv6 去方括号），面板「④ 任务限流与超时」区可编辑。**因 DSH webServer 的实际绑定地址由宿主决定，插件不强制 Host 必须为 loopback**——白名单把这一决策交给部署者；填错会导致面板被 403，请按面板实际访问主机名填写。
- 导出 JSON 只含 `keyRef` 引用名，并额外抹掉疑似密钥字段；导入提示「凭据请在目标机器重新登记」。

---

## 2. 文件与渲染代码位置

| 文件 | 作用 |
|---|---|
| `src/client/index.ts` | Client 半入口：`name` / `inject` / `apply`；绑定设置表单 scope，注入样式，注册面板座位 |
| `src/client/panel.tsx` | **面板渲染代码**：六大分区 React 组件（`React.createElement`，无 JSX）、表单控件、拖拽、自检、实时状态、导入导出 |
| `src/client/settingsModel.ts` | 配置模型：字段默认值、草稿构造、实时校验、差异写入、导入/导出脱敏 |
| `src/client/styles.ts` | DSH 主题感知 CSS（仅用 `--dsw-alias-*` 变量，自动适配浅色/深色） |
| `src/client/routes.ts` / `src/routes.ts` | Host/Client 共享的同源路由常量 |
| `src/panel/hostPanel.ts` | Host 半：`ctx.webServer.register` 路由（自检/状态/探测/连通性/导出）+ 自检实现 |
| `src/panel/stats.ts` | 今日调用/降级/置信度实时聚合（订阅审计提交） |
| `src/config.ts` | **配置 schema**（`buildConfigSchema(z)`，全字段 `volatile()`）+ `DEFAULTS` |
| `src/types.ts` | `VisionConfig` / `PanelVlBackend` / 枚举类型 |

### Client 挂载方式（`apply`）

```ts
const configForms = ctx.get('configForms');                 // DSH 0.1.7+
const settingsScopeApi = configForms ? undefined : ctx.get('settingsScope'); // 旧版
const scope = configForms?.get('dsh-vision-nexus')
  ?? settingsScopeApi?.bind({ namespace: 'dsh-vision-nexus' })
  ?? degradedScope();
ctx.slots.inject('plugins.bundle.config', () => register({ name, key, inject: face }, Panel));
// 跨版本兼容：同时尝试 settings.plugin.item / web-ui.plugin.item
```

- 表单读写：`scope.getSnapshot()` / `scope.subscribe(fn)` / `scope.set(field, value)`（字段级写入）。
- 非法输入：`validate(draft)` 返回 `{errors, valid}`，非法字段标红且**不写回** scope。
- 热生效：Host 侧 `Config` 所有字段经 `volatile()` 标记 → DSH 把设置写成 Volatile box → `apply` 内 `currentConfig()` 每次重新摊平读取，修改后无需重启。
- 辅助按钮：`diffFields()` 只写改动字段；导出走 `exportConfigText()`（脱敏）；导入走 `parseImport()`（校验后一次性写回）。

### Host 路由（`registerPanelRoutes`）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/plugins/dsh-vision-nexus/health` | 一键自检：Python / 浏览器内核 / 远端连通性 / WASM OCR / 配置合法性 |
| GET | `/plugins/dsh-vision-nexus/status` | 实时运行状态 |
| POST | `/plugins/dsh-vision-nexus/probe-python` | 自动检测 Python 解释器与 cv_worker |
| POST | `/plugins/dsh-vision-nexus/probe-browser` | 检测 Playwright / Chromium |
| POST | `/plugins/dsh-vision-nexus/test-vl` | 单个 VL 后端连通性（不回传密钥） |
| GET | `/plugins/dsh-vision-nexus/export` | 导出脱敏配置 JSON |

所有路由做同源校验（origin === host / `Sec-Fetch-Site` 纵深）；可选 `panelAllowedHosts` 白名单进一步防 DNS rebinding（详见「安全」节）。只回结构化状态，绝不回传 API Key 明文 / 图片字节。

---

## 3. 配置 schema（schemastery，全字段 volatile）

`src/config.ts` → `buildConfigSchema(z)` 导出的 `Config`。字段顺序与面板分区一致：

```ts
z.object({
  // ① 运行模式总开关
  enabled:            z.boolean().default(true).volatile(),
  runMode:            z.union(['auto','local-only','remote-only']).default('auto').volatile(),
  loadingStrategy:    z.union(['progressive','eager']).default('progressive').volatile(),
  autoTileEnabled:    z.boolean().default(true).volatile(),
  oversizeEdgePx:     z.number().min(512).max(16384).default(1600).volatile(),
  // ② 引擎配置区
  pythonPath:         z.string().default('').volatile(),
  cvRuntimePath:      z.string().default('').volatile(),
  localCvEnabled:     z.boolean().default(true).volatile(),
  browserRenderEnabled: z.boolean().default(true).volatile(),
  vlBackends:         z.array(z.object({
                        id: z.string(), label: z.string(),
                        baseURL: z.string(), keyRef: z.string(), model: z.string(),
                        maxImageEdgePx: z.number().min(256).max(8192).default(2048),
                        enabled: z.boolean().default(true),
                      })).default([]).volatile(),
  builtinVlEnabled:   z.boolean().default(false).volatile(),
  builtinVlKeyRef:    z.string().default('').volatile(),
  builtinVlBaseURL:   z.string().default('').volatile(),
  builtinVlModel:     z.string().default('gpt-4o-mini').volatile(),
  wasmOcrEnabled:     z.boolean().default(true).volatile(),
  ocrLanguage:        z.union(['zh','en','mix']).default('mix').volatile(),
  // ③④ 调度 / 限流
  sessionConcurrency: z.number().min(1).max(5).default(1).volatile(),
  taskTimeoutMs:      z.number().min(1000).max(3600000).default(30000).volatile(),
  maxQueueLength:     z.number().min(1).max(512).default(32).volatile(),
  confidenceAlertThreshold: z.number().min(0).max(1).default(0.6).volatile(),
  degradeNotifyAgent: z.boolean().default(true).volatile(),
  tileEdgePx:         z.number().min(256).max(2048).default(768).volatile(),
  preprocessMaxEdgePx:z.number().min(256).max(4096).default(1280).volatile(),
  auditMaxEntries:    z.number().min(10).max(10000).default(500).volatile(),
  cleanupIntervalMs:  z.number().min(10000).max(86400000).default(1800000).volatile(),
  persistSessionState:z.boolean().default(true).volatile(),
  auditSeparate:      z.boolean().default(true).volatile(),
  // ⑥ 面板安全
  panelAllowedHosts:  z.array(z.string()).default([]).volatile(),
  // ⑤ 产物与存储
  retentionPreset:    z.union(['1h','6h','24h','72h','7d','never']).default('24h').volatile(),
  tempRetentionMs:    z.number().min(0).volatile(),   // 无 default：由档位推导，避免默认值盖掉档位
  autoCleanupEnabled: z.boolean().default(true).volatile(),
  autoSaveArtifacts:  z.boolean().default(true).volatile(),
  preprocessQuality:  z.number().min(1).max(100).default(82).volatile(),
})
```

> `.volatile()` 由 `volatile(schema)` 帮助函数条件调用（DSH ≤0.1.6 的 schemastery 无此方法时安静跳过），保证跨版本可加载。校验区间与 `resolveConfig()` 的钳制完全一致。

---

## 4. 参数默认值（`DEFAULTS`）

| 分区 | 字段 | 默认值 | 说明 |
|---|---|---|---|
| ① | `enabled` | `true` | 启用视觉插件 |
| ① | `runMode` | `auto` | 自动自适应 |
| ① | `loadingStrategy` | `progressive` | 渐进按需激活 |
| ① | `autoTileEnabled` | `true` | 大图自动分块 |
| ① | `oversizeEdgePx` | `1600` | 长边阈值(px) |
| ② | `pythonPath` | `''` | 空=自动检测 |
| ② | `cvRuntimePath` | `''` | 空=内置 cv_worker.py |
| ② | `localCvEnabled` | `true` | 本地 CV 引擎 |
| ② | `browserRenderEnabled` | `true` | 渲染截图内核检测 |
| ② | `vlBackends` | `[]` | 后端列表（顺序即优先级） |
| ② | `builtinVlEnabled` | `false` | 内置匿名兜底 VL |
| ② | `builtinVlModel` | `gpt-4o-mini` | 兜底模型 |
| ② | `wasmOcrEnabled` | `true` | WASM OCR 兜底 |
| ② | `ocrLanguage` | `mix` | 中英混合 |
| ③ | `sessionConcurrency` | `1` | 并发上限(1~5) |
| ③ | `taskTimeoutMs` | `30000` | 超时(ms)，面板按秒展示=30 |
| ③ | `maxQueueLength` | `32` | 队列长度 |
| ③ | `confidenceAlertThreshold` | `0.6` | 置信度告警阈值 |
| ③ | `degradeNotifyAgent` | `true` | 降级主动通知 Agent |
| ④ | `tileEdgePx` | `768` | 分块边长 |
| ④ | `preprocessMaxEdgePx` | `1280` | 压缩最长边 |
| ④ | `auditMaxEntries` | `500` | 审计条数 |
| ④ | `cleanupIntervalMs` | `1800000` | 清理周期(30min) |
| ④ | `persistSessionState` | `true` | 会话状态持久化 |
| ④ | `auditSeparate` | `true` | 审计单独输出 |
| ⑤ | `retentionPreset` | `24h` | 临时文件保留 |
| ⑤ | `tempRetentionMs` | `86400000` | 由档位映射（24h） |
| ⑤ | `autoCleanupEnabled` | `true` | 自动清理 |
| ⑤ | `autoSaveArtifacts` | `true` | 自动保存三类产物 |
| ⑤ | `preprocessQuality` | `82` | 压缩质量 |
| ⑥ | `panelAllowedHosts` | `[]` | 面板 Host 白名单（空=同源校验；非空=仅允许列表内主机名） |

**保留时长档位映射**：`1h=3,600,000` · `6h=21,600,000` · `24h=86,400,000` · `72h=259,200,000` · `7d=604,800,000` · `never=0`（不清理）。

---

## 5. 安装 / 构建指令

构建沿用 DSH 标准插件流程（`tsc` 编译 Host/Client TS，`tsdown` 把 Client 打包为 CJS 闭包工厂并套上 `window.__ModuleLoader__.load({ id, factory })` 引导/收尾）。`build.mjs` 在末尾校验包装契约，避免 Client 半退回普通 ESM 而静默不加载。已在 Node v22.22.2 实测 `typecheck` 与 `build` 均通过。

```bash
cd dsh-vision-nexus
npm install            # 或 pnpm install
npm run build          # = tsc -p tsconfig.json && tsdown --config tsdown.config.ts，产出 lib/index.js + lib/client.js
npm run typecheck      # tsc --noEmit 校验
```

产物：`lib/index.js`（Host 半，`main`）、`lib/client.js`（Client 半，`./client` export）。

**安装到 DSH**（与主插件一致，见 `README.md`）：

```
/plugin install dsh-vision-nexus
```

安装后：

1. 在插件管理启用 `dsh-vision-nexus`（`cordis.patch.yml` 已声明 `dsh.client.inject`，宿主会自动加载 Client 半）。
2. 打开 **设置 → 插件 → Vision Nexus 视觉增强**（或插件详情页配置区），面板即挂载。
3. 修改任意字段 → 字段级写入 scope → Host 侧 volatile 配置热生效，无需重启。
4. 点击「运行健康自检」查看五项检测结果；「当前运行状态」每 15 秒自动刷新。

`dsh.client.inject` 列表（React / 设置 / 插槽 / 渲染器由宿主提供）：

```json
["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-locale",
 "@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-slots",
 "@deepseek-ai/dsh-client-ui-renderer"]
```

> 面板不持久化任何明文 API Key：后端条目只编辑 `keyRef` 引用名，导出 JSON 会额外抹掉疑似密钥字段并提示「凭据请在目标机器重新登记」。

---

## 6. 实时校验规则（与 Host 钳制一致）

| 字段 | 合法区间 | 非法时行为 |
|---|---|---|
| `oversizeEdgePx` | 512~16384 | 标红 + 不写回 |
| `sessionConcurrency` | 1~5 | 标红 + 不写回 |
| `taskTimeoutMs` | 1000~3600000 | 标红 + 不写回 |
| `maxQueueLength` | 1~512 | 标红 + 不写回 |
| `tileEdgePx` / `preprocessMaxEdgePx` | 256~2048 / 256~4096 | 标红 + 不写回 |
| `preprocessQuality` | 1~100 | 标红 + 不写回 |
| `confidenceAlertThreshold` | 0~1 | 标红 + 不写回 |
| VL 后端（启用时） | baseURL 需 `http(s)://`，model 非空，最大尺寸 256~8192 | 对应行标红 + 阻止整表保存 |
| `panelAllowedHosts` | 字符串数组，≤64 项，元素不含空白 / 斜杠（逗号分隔输入自动拆分） | 标红 + 不写回 |

整表（后端列表 / 导入）保存前统一 `validate()`；任一非法阻止写回并在顶部提示「N 处输入待修正」。
