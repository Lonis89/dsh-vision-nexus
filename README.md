# Vision Nexus · 视觉中枢

> 面向 DSH Agent 的一体化视觉能力中枢：多后端调度、14 项图像工具、可视化调试工作台与精细化权限管控。

[![CI](https://github.com/Lonis89/dsh-vision-nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Lonis89/dsh-vision-nexus/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.5-6e56cf.svg)](https://github.com/deepseek-ai)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org)

**[English](README.en.md) · 简体中文**

---

## 简介

**一句话定位**：dsh-vision-nexus 为纯文本大模型补齐图像感知链路——它把「视觉」做成 DSH Agent 可直接调用的 14 项视觉工具，同时把「用哪个后端、花多少配额、哪一步慢、哪里失败」全部纳入可观测、可管控的框架。

纯文本模型看不见图。Vision Nexus 补上这条链路，并坚持三个判断：

**后端应该可替换。** 云端 API 有延迟与成本，本地 Ollama 有隐私与速度，Tesseract 离线可用但没有理解力。它们不该互斥——统一的适配器抽象层把它们放在一起，由调度策略决定谁上场、谁兜底。

**失败必须可见。** 一次视觉请求背后可能有缓存命中、配额检查、并发排队、后端重试、熔断降级五个环节。每次请求都有独立 `traceId`，完整链路落盘，前端可逐阶段查看耗时。

**密钥不该出现在配置文件里。** 所有凭证只经 DSH 内置的 Credentials 加密模块读写，配置文件中只有引用名，日志与导出内容自动脱敏。

### 仓库一览

| 项目 | 值 |
| --- | --- |
| 插件 ID / 包名 | `dsh-vision-nexus` |
| 版本 | `0.1.0`（releaseChannel: `beta`） |
| 工具数量 | **14** 个（`src/shared/tool-catalog.ts` 为唯一真相源） |
| HTTP 路由 | 源码注册 **30** 条路由条目，`plugin.json` 声明 **37** 个 method+path 操作 |
| 前端标签页 | **6** 个（`dashboard` / `canvas` / `tools` / `workbench` / `runtime` / `governance`） |
| 后端类型 | **5** 种（`openai-compat` / `ollama` / `python-local` / `tesseract` / `custom`） |
| 调度策略 | **4** 种（`sequential` / `weighted-round-robin` / `local-first` / `lowest-latency`） |
| 许可证 | Apache-2.0 |

---

## 功能亮点

### 能力矩阵

| 能力域 | 组成 | 关键事实 |
| --- | --- | --- |
| 后端抽象 | 5 种适配器 | OpenAI 兼容多模态 API、Ollama 本地视觉模型、托管 Python 运行时、Tesseract 离线 OCR、自定义 HTTP 模板 |
| 调度引擎 | 4 种策略 + 熔断器 | 顺序降级 / 权重轮询 / 优先本地 / 最低延迟；熔断与策略正交 |
| 视觉工具 | 14 个工具 | 一工具一文件，独立开关、独立超时、独立每日配额 |
| 运行时治理 | 缓存 / 配额 / 并发 / 沙盒 | 内容寻址缓存、三级配额、单会话与全局并发闸门、目录白名单沙盒 |
| 可观测性 | 链路 / 日志 / 指标 | 每请求 `traceId`、分级日志、24 小时趋势、后端流量占比 |
| 配置管理 | 快照 / 导入导出 / 热更新 | 快照保存切换删除、导出即脱敏、保存设置热生效不重启 |
| 前端面板 | 6 个标签页 | 数据总览 / 调度画布 / 工具管理 / 测试工作台 / 运行时与安全 / 配额与日志 |
| 安全 | 密钥 / 上传 / 出站 / 白名单 | 密钥只存引用、MIME+魔数+体积三重校验、出站超时禁重定向、Agent 白名单 |

### 14 项视觉工具

| 工具 | 用途 | 依赖后端 | 默认超时 | 每日配额 |
| --- | --- | --- | --- | --- |
| `vision_insight` | 图像理解问答，描述内容、回答关于图片的问题 | `openai-compat` / `ollama` / `custom` | 120000 ms | 200 |
| `vision_ground` | 按自然语言定位目标，输出归一化标注框 | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 |
| `vision_detect` | 通用目标检测，识别全部物体并给类别与置信度 | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 |
| `vision_crop` | 区域裁剪，支持像素与归一化坐标 | `python-local` | 30000 ms | 300 |
| `vision_image_diff` | 双图逐像素比对，输出差异比例与高亮图 | `python-local` | 60000 ms | 100 |
| `vision_long_ocr` | 长截图分块 OCR，按版面顺序拼接 | `tesseract` / `openai-compat` | 180000 ms | 60 |
| `vision_remove_bg` | 前景抠图，输出透明 PNG | `python-local` / `openai-compat` / `custom` | 120000 ms | 60 |
| `vision_extract_color` | 主色调提取，输出 HEX / RGB / HSL | `python-local` | 30000 ms | 300 |
| `vision_html_capture` | 网页或 HTML 片段截图 | `custom` | 90000 ms | 60 |
| `vision_svg_trace` | 位图矢量化描摹为 SVG | `python-local` | 120000 ms | 60 |
| `vision_batch_ocr` | 批量 OCR，并发受控 | `tesseract` / `openai-compat` | 300000 ms | 20 |
| `vision_video_sample` | 视频按时间点或间隔抽帧 | `python-local` | 180000 ms | 30 |
| `vision_chart_analyze` | 图表解析为结构化数据表 | `openai-compat` / `ollama` / `custom` | 120000 ms | 60 |
| `vision_code_scan` | 二维码与条形码识别 | `python-local` | 30000 ms | 300 |

每个工具**独立开关、独立超时、独立配额**。关闭的工具不会注册给模型——它根本看不到，既省 prompt 又杜绝误调用。

**14 个工具里有 6 个完全依赖本地算法**（`vision_crop`、`vision_image_diff`、`vision_extract_color`、`vision_svg_trace`、`vision_video_sample`、`vision_code_scan`），它们只有 `python-local` 一个后端；另有 `vision_remove_bg` 把本地算法作为可选后端之一。这些操作用大模型做既慢又贵，用本地算法几毫秒就能完成。

### 运行时治理

- **内容寻址缓存**：键为「图片 sha256 + 工具 + 规范化参数」，同图同参只算一次；TTL 默认 24 小时，容量上限默认 512 MiB，LRU 淘汰
- **三级配额**：全局（默认 2000 / 天）/ 单后端（默认 1000 / 天）/ 单工具（见上表），任一超限即拒绝并给出可读提示
- **并发闸门**：单会话默认 2、全局默认 8，排队有上限，超出明确拒绝而非挂死
- **任务超时**：默认 120000 ms，到点自动 abort，槽位立即归还
- **图片 Buffer 流转**：会话级去重，同一张图只解码一次

### 可观测性

- 每次请求独立 `traceId`，记录图片哈希、候选后端、选中后端、各阶段耗时、结果摘要、异常
- 分级日志（`debug` / `info` / `warn` / `error`），支持关键词、级别、后端、工具四维过滤
- 仪表盘实时指标：请求量、成功率、失败数、缓存占用、后端流量占比、24 小时延迟趋势

### 配置管理

- 配置快照：保存、一键切换、删除
- JSON 导入导出（导出即脱敏，密钥替换为 `<KEEP_EXISTING>` 占位符）
- 修改设置热生效，不重启插件、不断路由

---

## 环境要求

| 依赖 | 版本要求 | 必需性 | 缺失后的行为 |
| --- | --- | --- | --- |
| DSH | `>= 0.2.1-rc.5`（`plugin.json` 的 `engines.dsh`） | 必需 | 插件行不装载；设置页无「视觉中枢」入口 |
| Node.js | `^22.19.0 \|\| >=24.0.0`（`package.json` 的 `engines.node`） | 仅源码开发/构建需要 | 无法执行 `node scripts/build.mjs`，因而没有 `lib/` |
| Python | `python3 >= 3.10`（托管运行时） | 可选 | 6 个纯本地算法工具返回 `VN_RUNTIME_MISSING`，其余工具照常 |
| Tesseract | `>= 5.0`（离线 OCR 兜底） | 可选 | `vision_long_ocr` / `vision_batch_ocr` 的离线路径不可用，可回落到 `openai-compat` |
| ffmpeg | `>= 6.0`（视频抽帧） | 可选 | `vision_video_sample` 不可用 |

> **本机实测环境**：DSH `0.2.2-rc.1`（`@deepseek-ai/dsh-desktop-runtime` 的版本号），满足 `>= 0.2.1-rc.5` 的下界要求。
>
> 普通安装（`dsh plugin add`）**不需要** Node、不需要 clone 源码——发行包内已包含 `lib/` 构建产物。

---

## 安装命令

### 标准安装（推荐，所有用户）

```bash
dsh plugin --profile desktop add dsh-vision-nexus
```

DSH 从插件源拉取已发布的包并完成装载，无需 clone 源码、无需 Node、无需构建。装完重启 DSH 进程，进入 **设置 → 视觉中枢** 即可看到 6 个标签页。

### 指定版本

```bash
dsh plugin --profile desktop add dsh-vision-nexus@0.1.0
```

### 从 Git 仓库安装

```bash
dsh plugin --profile desktop add git+https://github.com/Lonis89/dsh-vision-nexus.git
```

> 从 Git 安装时 pnpm 可能拦截 `prepare` 脚本。该脚本会在安装期间执行仓库代码——确认信任后再按 pnpm 提示把对应的包名加入 profile 的 `pnpm-workspace.yaml`。

### 从本地源码安装（仅开发调试）

`link:` 前缀告诉 DSH 这是一个本地目录而非发布包；改动源码后重新构建并重启即可生效，不需要重新安装。

```bash
dsh plugin --profile desktop add link:<本地路径>
```

### 升级

```bash
# 包安装：重新 add 会拉取最新版
dsh plugin --profile desktop add dsh-vision-nexus

# 本地 link 安装：拉取源码后重新构建并重启 DSH 进程
node scripts/build.mjs
```

从旧版 `vision-nexus` 升级：先卸载旧版避免 profile 里同时存在两行，再安装新版，首次启动会自动迁移数据。

```bash
dsh plugin --profile desktop remove vision-nexus
dsh plugin --profile desktop add dsh-vision-nexus
```

### 卸载

```bash
dsh plugin --profile desktop remove dsh-vision-nexus
```

卸载**不会**自动删除 `$DSH_HOME/dsh-vision-nexus` 下的缓存、配置、日志与快照；需要彻底清理请手动删除该目录。

### 如何确认安装成功

1. `dsh --profile desktop --dump-config` 的输出里能看到 `dsh-vision-nexus` 插件行；
2. `lib/client.js` 与 `lib/index.js` 均存在（本地源码安装时由 `node scripts/build.mjs` 生成）；
3. DSH 重启后，**设置 → 插件** 列表里出现 `dsh-vision-nexus` 且状态为已启用、无红色报错；
4. **设置 → 视觉中枢** 能打开并显示 6 个标签页。

> 上述 CLI 形态（`dsh plugin --profile <profile> add|remove`）与 `link:` 前缀取自本仓库 `cordis.patch.yml` 的安装说明。DSH CLI 的子命令与参数随版本演进，**最终以本机 `dsh --help` 为准**；若输出不一致，请以 `dsh --help` 显示的实际用法操作。

---

## 本地加载教程

### 前置条件

- DSH `>= 0.2.1-rc.5`（`dsh --version` 确认）
- Node.js `^22.19.0 || >=24.0.0`（仅从源码开发时需要）
- 一个可用的 DSH profile（下文以 `desktop` 为例）

### 步骤（从源码加载，仅供开发）

**1. 克隆或解压到本地目录**

```bash
git clone https://github.com/Lonis89/dsh-vision-nexus.git
cd dsh-vision-nexus
```

**2. 构建产物**

插件以预构建的 ESM 模块分发，安装前必须先生成 `lib/`：

```bash
node scripts/build.mjs
```

构建脚本只依赖 Node 内置的类型剥离能力，**不需要安装 TypeScript**。

**3. 确认目录结构完整**

```bash
ls
# package.json  plugin.json  cordis.patch.yml  lib/  src/  scripts/
```

`cordis.patch.yml` 是把插件挂进 profile 的补丁文件，`lib/` 是构建产物，两者缺一不可。

**4. 安装到 profile**

```bash
dsh plugin --profile desktop add link:<本地路径>
```

把 `<本地路径>` 替换为插件根目录的实际路径。

**5. 验证挂载**

```bash
dsh --profile desktop --dump-config | grep dsh-vision-nexus
```

应能看到 `dsh-vision-nexus` 的插件行。

**6. 启动并打开设置页**

启动 profile 后，在 DSH 左侧边栏进入设置，找到「视觉中枢」入口。

### 通过插件面板加载本地目录

从源码开发时，也可以完全通过图形界面装载本地目录，不必敲命令：

1. DSH 左侧边栏 → 底部 **设置** → 找到 **插件** 分区（部分版本叫「插件管理」）
2. 点击 **添加插件**（或「+ 安装」）→ 选择 **本地目录 / 从文件夹安装**
3. 在系统目录选择器里选中插件根目录（即 clone 下来的 `dsh-vision-nexus` 文件夹）
4. 面板读取该目录的 `package.json` 与 `cordis.patch.yml`，并把插件行加入 profile
5. 等待状态从 **安装中** 变为 **已启用**

> 如果面板里没有「本地目录」选项，说明当前 DSH 版本只支持包名安装。此时改用命令行 `dsh plugin --profile desktop add link:<本地路径>`，装完后刷新页面即可在面板里看到它。

---

## 首次配置

安装并启用后，入口在**设置页的独立分区**，不在插件列表里点开：

1. DSH 左侧边栏 → 底部 **设置**
2. 设置页左侧导航向下滚动，在插件管理分区之后找到 **视觉中枢**
3. 点击进入，看到 6 个标签页

首次配置只需三件事：**配一个后端**、**（可选）初始化 Python**、**（可选）加目录白名单**。

### 1. 配置后端

进入 **调度画布** 标签页 → 新增后端。各类型所需字段：

| 服务类型 (`kind`) | 必填字段 | 选填字段 | 说明 |
| --- | --- | --- | --- |
| `openai-compat` | `baseUrl`（填到 `/v1`）、`model`、`apiKey` | `timeoutMs` / `retries` / `weight` / `priority` / `tags` | 插件会拼接 `/chat/completions`；连通性测试走 `/models`（不消耗 token） |
| `ollama` | `baseUrl`（如 `http://127.0.0.1:11434`）、`model` | `timeoutMs` / `weight` / `priority` / `tags` | 无需 API Key；`images` 只接受裸 base64，插件已处理该差异 |
| `python-local` | 无（本地进程） | `timeoutMs` / `quota` | `baseUrl` 与 `model` 留空 |
| `tesseract` | 无（用 PATH 中的 `tesseract`） | 可填可执行文件绝对路径到 `baseUrl` | 离线 OCR；语言包在工具参数里指定 |
| `custom` | `custom.endpoint`（URL 模板） | `custom.bodyTemplate` / `custom.resultPath` / `custom.authHeader` / `custom.authPrefix` / `custom.healthPath` | 模板占位符：`{{model}}` / `{{image}}` / `{{prompt}}` / `{{params}}` |

后端通用配置字段（`BackendSpec`，持久化在 `state.json`，密钥除外）：

| 字段 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | 必填 | 非空 | 稳定标识，创建后不可改；用作配置键与凭证引用名的一部分 |
| `label` | string | 同 `id` | — | 展示名 |
| `kind` | enum | 必填 | 5 种服务类型 | 决定使用哪个适配器 |
| `enabled` | boolean | `true` | — | 是否参与调度 |
| `baseUrl` | string | `''` | — | 接口根地址 |
| `model` | string | `''` | — | 模型名；本地运行时型后端可留空 |
| `apiKeyRef` | string | `''`（由 `id` 推导） | 合法环境变量名 | 只存引用名，不存明文 |
| `timeoutMs` | number | `60000` | 1000–900000 | 单次请求超时（毫秒） |
| `retries` | number | `0` | 0–10 | 同后端内重试次数（不含降级） |
| `weight` | number | `1` | 1–100 | 权重轮询下的权重 |
| `priority` | number | `100` | 0–10000 | 调度优先级，越小越先；画布拖拽写回此字段 |
| `tags` | string[] | `[]` | — | 限定该后端支持的工具；空数组表示由目录能力自述 |
| `custom` | object | 无 | — | 自定义适配器的模板参数 |

### 2. 密钥写入与凭证引用

- 后端配置里只保存**引用名** `apiKeyRef`，形如 `VISION_NEXUS_{BACKEND_ID}_API_KEY`，由后端 ID 推导：例如后端 ID `openai-main` → `VISION_NEXUS_OPENAI_MAIN_API_KEY`。
- 真实值通过 `ctx.credentials` 写入 DSH 的加密存储；接口只回传 `configured`（是否已配置）与 `writable`（是否可写）两个布尔，**永不回传明文**。
- 每次调用都重新解析密钥、**不缓存**，因此改了密钥立即生效。
- 空串一律视为未配置：绝不用空白密钥发请求。
- 导出配置时该字段被替换为 `<KEEP_EXISTING>` 占位符；导入时遇到该占位符表示「保留现有值」。

若宿主未提供 credentials 服务（`ctx.get('credentials')` 返回 undefined），`resolve()` 返回 undefined、`describe()` 返回 `writable: false`、`set()` 抛出 `VN_CREDENTIAL_MISSING`——无需鉴权的本地后端（Ollama / Tesseract / Python）仍可正常使用。

### 3. Python 运行时初始化

进入 **运行时与安全 → Python 托管运行时**，点击「一键初始化环境」。详见下一节。

### 4. 目录白名单沙盒

- 所有磁盘读写先解析真实路径，再与白名单做前缀比对；**白名单为空时拒绝一切**磁盘访问（fail-closed），而不是放开。
- 越界访问返回 `VN_SANDBOX_DENIED`（附带被拒路径），而非静默失败。
- 用 `path.relative` 判断包含关系而非字符串前缀，因此 `/allowed-evil` 不会被 `/allowed` 放行；符号链接与 `..` 逃逸同样被拦截。
- 插件私有目录（`$DSH_HOME/dsh-vision-nexus`）始终允许访问，但不出现在用户可见的白名单里。
- 目录选择器在 **运行时与安全 → 目录白名单**，支持可视化浏览与原生选择器；**浏览同样受白名单约束**，不能浏览白名单之外的目录。

---

## 后端服务商配置

### OpenAI 兼容多模态 API

适用：OpenAI、DeepSeek 视觉版、各类中转、vLLM / LM Studio / LiteLLM 等自建网关。

| 字段 | 示例 |
| --- | --- |
| 服务类型 | `openai-compat` |
| 接口地址 | `https://api.openai.com/v1` |
| 模型名 | `gpt-4o` |
| API Key | `sk-...`（存入加密存储） |

接口地址填到 `/v1` 为止，插件会拼接 `/chat/completions`；连通性测试走 `/models`（不消耗 token）。

### Ollama 本地

| 字段 | 示例 |
| --- | --- |
| 服务类型 | `ollama` |
| 接口地址 | `http://127.0.0.1:11434` |
| 模型名 | `llava:13b` / `qwen2.5-vl:7b` |
| API Key | 留空 |

连通性测试会额外校验配置的模型是否真的在本地存在，给出比「连接失败」更有用的提示。

### Python 托管运行时

| 字段 | 示例 |
| --- | --- |
| 服务类型 | `python-local` |
| 接口地址 | 留空（本地进程，无网络） |
| 模型名 | 留空 |

### Tesseract 离线 OCR

| 字段 | 示例 |
| --- | --- |
| 服务类型 | `tesseract` |
| 接口地址 | 留空（用 PATH 中的 `tesseract`）或填可执行文件绝对路径 |
| 模型名 | 留空 |

**离线兜底**：没有网络、没有视觉模型时仍能提取文字。语言包在工具参数里指定（默认 `chi_sim+eng`）。

### 自定义 HTTP 服务

不用改代码就能接入任意 HTTP 视觉服务。在配置的 `custom` 字段里给出模板：

```json
{
  "endpoint": "https://your-service.com/vision?model={{model}}",
  "bodyTemplate": "{\"model\":\"{{model}}\",\"prompt\":\"{{prompt}}\",\"image\":\"{{image}}\"}",
  "resultPath": "data.choices.0.message.content",
  "authHeader": "authorization",
  "authPrefix": "Bearer "
}
```

- `{{image}}` 会被替换成 data URL，`{{prompt}}` / `{{model}}` / `{{params}}` 同理
- `resultPath` 是点路径，支持数组下标（如 `choices.0`）
- `authHeader` 默认 `authorization`，`authPrefix` 默认 `Bearer `
- 若配置了 `tags` 数组，则以它限定支持的工具（`*` 表示放行全部）；留空则回落到工具目录声明的可用后端类型

---

## Python 运行环境部署

### 为什么需要

**14 个工具里有 6 个完全依赖本地算法**（裁剪、主色调、差异比对、矢量化、视频抽帧、码识别）。这些操作用大模型做既慢又贵，用本地算法几毫秒就能完成。另有 `vision_remove_bg` 把 Python 作为可选后端之一——有视觉模型时走模型，没有时降级到本地算法。

没有 Python 时插件**不会崩**——依赖它的工具返回 `VN_RUNTIME_MISSING`，其余工具照常工作。

### 一键初始化

进入「运行时与安全 → Python 托管运行时」，点击「一键初始化环境」。插件会：

1. 探测系统解释器（Windows 优先 `py`，其余平台优先 `python3`）
2. 在 `$DSH_HOME/dsh-vision-nexus/pyenv` 创建独立虚拟环境（`python -m venv`）
3. 升级 pip，再安装依赖：`numpy>=1.26`、`pillow>=10.0`、`opencv-python-headless>=4.9`
4. 复检健康状态

解释器选择优先级：venv 内解释器 > 用户指定的解释器路径 > 自动探测。

> 依赖清单来源：`src/host/runtime/python-runtime.ts` 的 `defaultRequirements()`。仓库内 `python/requirements.txt` 当前**不存在**，`readRequirements()` 读不到文件时会回落为上述内置清单；`state.json` 的 `python.requirements` 若为非空数组，则优先使用它。

### 手动部署

如果自动初始化失败，可以手动准备：

```bash
# 创建 venv
python -m venv "$DSH_HOME/dsh-vision-nexus/pyenv"

# 激活（Windows PowerShell）
& "$DSH_HOME\dsh-vision-nexus\pyenv\Scripts\Activate.ps1"

# 激活（Linux / macOS）
source "$DSH_HOME/dsh-vision-nexus/pyenv/bin/activate"

# 安装依赖
pip install "numpy>=1.26" "pillow>=10.0" "opencv-python-headless>=4.9"
```

然后在「运行时与安全」的「解释器路径」填入该 venv 的解释器绝对路径。

### 健康检测

点击「健康检测」会检查三件事：

1. 解释器可执行
2. 版本 >= 3.10
3. 关键包可导入（`numpy`、`PIL`）

检测结果会明确告诉你缺什么，例如「缺少依赖：PIL，请点击"初始化依赖"」。

### Tesseract 与 ffmpeg

这两个是独立的外部依赖，不通过 pip 安装：

- **Tesseract**：`vision_long_ocr` / `vision_batch_ocr` 的离线路径需要它。Windows 装 `tesseract-ocr` 并确保 `tesseract --version` 可用；中文需额外安装 `chi_sim` 语言包。
- **ffmpeg**：`vision_video_sample` 需要它。安装后确保 `ffmpeg -version` 可用。

两者缺失时对应工具返回明确错误，不影响其他工具。

### 安全说明

所有 Python 调用都以**参数数组**形式 spawn、`shell: false`，杜绝命令注入。子进程有超时上限；stdout 上限 48 MiB、stderr 上限 4 MiB，超限显式标记为溢出（而不是静默截断成残缺 JSON）；终止采用 SIGTERM → 3 秒宽限 → SIGKILL 的两段式，避免卡在 native 调用里的进程变成僵尸。

---

## 工具参考

14 个工具的元数据以 `src/shared/tool-catalog.ts` 为**唯一真相源**；下表的超时与配额即该处的 `defaults`，可在 **工具管理** 标签页逐项覆盖（超时范围 1000–900000 ms，配额 0–1000000，`0` 表示不限）。

| 工具 | 用途 | 关键参数 | 依赖后端 | 默认超时 | 每日配额 | 返回形态 | 示例提示词（1 条） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `vision_insight` | 图像理解问答 | `image`、`prompt`、`detail` | `openai-compat` / `ollama` / `custom` | 120000 ms | 200 | 自然语言文本 + 结构化 JSON | 用 vision_insight 描述这张图里有什么，重点说颜色、物体和场景 |
| `vision_ground` | 目标定位 | `image`、`target`、`maxBoxes` | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 | 归一化标注框列表 | 用 vision_ground 找出图中的"登录按钮"，输出归一化标注框 |
| `vision_detect` | 通用目标检测 | `image`、`classes`、`minConfidence` | `openai-compat` / `ollama` / `custom` | 120000 ms | 100 | 类别 + 置信度 + 标注框 | 用 vision_detect 检测这张图里全部物体并列出类别与置信度 |
| `vision_crop` | 区域裁剪 | `image`、`region`、`scale` | `python-local` | 30000 ms | 300 | PNG 图片产物 | 用 vision_crop 把图中左上角约 20% 的区域裁剪出来保存 |
| `vision_image_diff` | 图片差异比对 | `image`/`imagePath`、`imageB`/`imagePathB`、`threshold`、`align` | `python-local` | 60000 ms | 100 | 差异比例 + 热区图 + 高亮标注 | 用 vision_image_diff 对比这两张图，告诉我差异比例和差异区域 |
| `vision_long_ocr` | 长截图 OCR | `image`、`languages`、`layout` | `tesseract` / `openai-compat` | 180000 ms | 60 | 按版面顺序拼接的文本 | 用 vision_long_ocr 提取这张长截图里的全部文字，按版面顺序输出 |
| `vision_remove_bg` | 前景抠图 | `image`、`replaceColor`、`edgeFeather` | `python-local` / `openai-compat` / `custom` | 120000 ms | 60 | 透明 PNG（可纯色替换） | 用 vision_remove_bg 把图中人物抠出来，背景变透明 PNG |
| `vision_extract_color` | 主色调提取 | `image`、`count`、`region` | `python-local` | 30000 ms | 300 | HEX / RGB / HSL + 占比 | 用 vision_extract_color 提取这张图的主色调，给出 HEX/RGB/HSL |
| `vision_html_capture` | 网页截图 | `url`、`html`、`viewport`、`fullPage`、`deviceScaleFactor` | `custom` | 90000 ms | 60 | PNG 图片产物 | 用 vision_html_capture 对这个 URL 截整页图：https://example.com |
| `vision_svg_trace` | 位图矢量化 | `image`、`colorMode`、`smoothing`、`minArea` | `python-local` | 120000 ms | 60 | SVG 产物 | 用 vision_svg_trace 把这张位图矢量化描摹成干净的 SVG |
| `vision_batch_ocr` | 批量 OCR | `images`、`languages`、`concurrency` | `tesseract` / `openai-compat` | 300000 ms | 20 | 结构化文本清单 | 用 vision_batch_ocr 对这 5 张截图批量 OCR，输出每张的文字 |
| `vision_video_sample` | 视频抽帧 | `video`、`timestamps`、`intervalSec`、`maxFrames` | `python-local` | 180000 ms | 30 | 多张 PNG 帧 | 用 vision_video_sample 从这个视频里每 2 秒抽一帧，共取 5 帧 |
| `vision_chart_analyze` | 图表解析 | `image`、`chartType`、`axesHint` | `openai-compat` / `ollama` / `custom` | 120000 ms | 60 | 结构化数据表 | 用 vision_chart_analyze 把这张柱状图解析成结构化数据表 |
| `vision_code_scan` | 二维码 / 条形码识别 | `image`、`formats` | `python-local` | 30000 ms | 300 | 内容 + 格式 + 位置 | 用 vision_code_scan 识别图里的二维码，输出解码后的内容 |

补充说明：

- `requiresImage` 为 false 的三个工具（`vision_html_capture`、`vision_batch_ocr`、`vision_video_sample`）不要求上传图片，分别使用 `url`/`html`、`images`、`video`。
- 工具的 `parameters` 与 `output.schema` 必须满足 DSH 的 JSON Schema 子集（`required` 必须是 `type: "object"` 节点上的字符串数组），由 `scripts/check-dsh-contract.mjs` 回归锁定。
- 产物（PNG / JPEG / SVG / JSON / 文本）默认随工作区保存，可通过 `GET /api/dsh-vision-nexus/artifacts/{id}` 下载。

---

## 提示词示例（验收提示词）

以下提示词可直接复制发给 Agent。Agent 会据此调用对应工具；括号里注明了它会调用的工具。

### 中文提示词

| 场景 | 可直接复制的提示词 | Agent 调用的工具 |
| --- | --- | --- |
| 图像问答 | 用 vision_insight 描述这张图的内容，并回答：画面里有几只猫？ | `vision_insight` |
| 目标定位 | 用 vision_ground 定位图中的"提交"按钮，给出归一化坐标框 | `vision_ground` |
| 目标检测 | 用 vision_detect 检测这张图里的全部物体，输出类别、置信度和标注框 | `vision_detect` |
| 裁剪 | 用 vision_crop 把图中右下角 1/4 区域裁出来，放大 2 倍保存 | `vision_crop` |
| 图片差异 | 用 vision_image_diff 逐像素对比这两张 UI 截图，告诉我差异比例和高亮区域 | `vision_image_diff` |
| 长截图 OCR | 用 vision_long_ocr 识别这张滚动长截图，按阅读顺序输出全部中文文字 | `vision_long_ocr` |
| 抠图 | 用 vision_remove_bg 把商品主体抠出来，输出透明背景 PNG | `vision_remove_bg` |
| 主色提取 | 用 vision_extract_color 提取这张海报的主色调，给我 HEX、RGB、HSL 和占比 | `vision_extract_color` |
| 网页截图 | 用 vision_html_capture 对 https://example.com 做整页截图，宽度 1440 | `vision_html_capture` |
| SVG 矢量化 | 用 vision_svg_trace 把这个 logo 位图描摹成干净的单色 SVG | `vision_svg_trace` |
| 批量 OCR | 用 vision_batch_ocr 对目录里这 8 张发票截图批量识别，汇总成文本清单 | `vision_batch_ocr` |
| 视频抽帧 | 用 vision_video_sample 从这个视频每 3 秒抽一帧，最多 6 帧 | `vision_video_sample` |
| 图表解析 | 用 vision_chart_analyze 把这张折线图解析成「时间 / 数值」两列数据表 | `vision_chart_analyze` |
| 二维码 | 用 vision_code_scan 识别图中所有二维码和条形码，输出内容与格式 | `vision_code_scan` |

### English prompts

| Scenario | Copy-ready prompt | Tool the agent calls |
| --- | --- | --- |
| Image Q&A | Use vision_insight to describe this image and answer: how many cats are in it? | `vision_insight` |
| Grounding | Use vision_ground to locate the "Submit" button and return its normalised box | `vision_ground` |
| Detection | Use vision_detect to detect every object with class, confidence and boxes | `vision_detect` |
| Crop | Use vision_crop to crop the bottom-right quarter and save it scaled 2x | `vision_crop` |
| Image diff | Use vision_image_diff to compare these two UI screenshots and report the diff ratio and hot spots | `vision_image_diff` |
| Long OCR | Use vision_long_ocr to read this long scrolling screenshot in reading order | `vision_long_ocr` |
| Background removal | Use vision_remove_bg to cut out the product and return a transparent PNG | `vision_remove_bg` |
| Palette | Use vision_extract_color to extract the dominant colours with HEX, RGB, HSL and coverage | `vision_extract_color` |
| Web capture | Use vision_html_capture to take a full-page screenshot of https://example.com at width 1440 | `vision_html_capture` |
| SVG trace | Use vision_svg_trace to trace this logo bitmap into a clean single-colour SVG | `vision_svg_trace` |
| Batch OCR | Use vision_batch_ocr on these 8 invoice screenshots and export a text manifest | `vision_batch_ocr` |
| Video frames | Use vision_video_sample to extract one frame every 3 seconds, up to 6 frames | `vision_video_sample` |
| Chart parsing | Use vision_chart_analyze to parse this line chart into a time/value data table | `vision_chart_analyze` |
| QR / barcode | Use vision_code_scan to decode every QR code and barcode with its format | `vision_code_scan` |

### 一条覆盖多工具的完整验收对话

```text
先配置一个 OpenAI 兼容视觉后端。然后依次验证：
1. vision_insight 描述这张图；
2. vision_ground 定位其中的"按钮"；
3. vision_crop 裁出按钮区域；
4. vision_extract_color 提取按钮主色；
5. vision_remove_bg 抠出按钮前景。
每一步都告诉我调用的工具名、后端、耗时。
```

全部跑通并在链路追踪里能看到本次 `traceId`，即说明插件可用。

---

## 界面预览说明

插件在 DSH 设置页注册为独立入口「视觉中枢」（`settings.section` 席位，`slotId = dsh-vision-nexus`，`order = 152`），包含 6 个标签页：`dashboard` / `canvas` / `tools` / `workbench` / `runtime` / `governance`。玻璃拟态视觉，亮暗自动跟随宿主主题，窄屏（< 960px）自动堆叠。

### Tab 1 · 数据总览（`dashboard`）

**能做什么**：顶部四张指标卡（今日请求、成功率、失败数、缓存占用），中部左侧后端流量占比环形图、右侧近 24 小时耗时折线图，底部工具调用排行与快捷操作（跳转工作台、一键健康检测）。

**典型步骤**：进入即自动刷新概览 → 点「一键健康检测」探测全部后端 → 从排行点进工具或从空态跳转调度画布。

> 今日没有任何请求时，成功率显示为「—」而不是 0% 或 100%——后者都会撒谎（渲染成故障或渲染成健康）。后端流量占比与序列数据来自 `GET /overview` 与 `GET /series`。

### Tab 2 · 调度画布（`canvas`）

**能做什么**：每个后端是一张可拖拽节点卡片，左上角圆角标显示当前调度优先级（1 为最先）。节点带状态灯：绿色正常 / 黄色限流 / 红色离线或冷却中，并显示实时延迟与密钥配置状态。

**典型步骤**：
1. 点「新增后端」填写服务类型、接口地址、密钥、超时、重试、权重；
2. 拖动节点按纵向位置重排优先级，右上角出现「保存调度方案」（写回 `priority` 与画布坐标）；
3. 双击节点打开编辑面板；
4. 对单个后端点「测试」验证连通性（成功会立即解除熔断并清零退避计数）；
5. 顶部下拉切换调度策略。

画布下方还有一张「后端明细」表格，提供拖拽之外的键盘可达操作路径。

### Tab 3 · 工具管理（`tools`）

**能做什么**：14 张工具卡片网格。每张卡包含分类图标、工具名、功能简介、启用开关、超时输入、配额输入，以及今日用量与最近耗时。

**典型步骤**：
1. 开关点击即保存（关闭的工具不会注册给模型）；
2. 超时与配额在**失焦时**校验并提交，避免每敲一个字符打一次接口；
3. 点击卡片展开详细说明：支持的后端类型、今日成败次数、英文简介；
4. 顶部支持**批量启用 / 停用**。

### Tab 4 · 测试工作台（`workbench`）

**能做什么**：三栏布局，窄屏自动堆叠。左栏主图与对比图输入区，中栏工具下拉与执行 / 停止按钮，右栏结果预览（标注框叠加、差异高亮图、OCR 文本、结构化表格、原始 JSON）。

**典型步骤**：拖入图片 → 选工具 → 执行 → 复制 JSON 或下载产物；底部显示链路 ID 前 8 位。此页不消耗 Agent 轮次。详见下一节「工作台使用」。

### Tab 5 · 运行时与安全（`runtime`）

**能做什么**：五张分组卡片——
1. **Python 托管运行时**：启用开关、解释器路径、健康检测、一键初始化虚拟环境与依赖；
2. **目录白名单**：可视化目录浏览器 + 原生选择器，逐个添加 / 移除；
3. **缓存策略**：开关、TTL、容量上限、当前占用统计、一键清空；
4. **并发与熔断**：单会话并发、全局并发、任务超时、失败阈值、冷却时长；
5. **Agent 白名单**：按会话 ID 限制调用权限。

**典型步骤**：此页采用**草稿 + 显式保存**模式，顶部常驻保存条；有未保存改动时切换标签页会弹确认，标签上显示黄色圆点。

### Tab 6 · 配额与日志（`governance`）

**能做什么**：
- **配额设置**：全局每日限额、单后端每日限额、统计窗口（天 / 小时），下方展示工具级用量只读表；
- **运行日志**：级别下拉、关键词搜索（350 ms 防抖）、按工具 / 后端过滤、一键导出（导出文件已脱敏）；
- **配置快照**：保存命名快照、一键切换、删除；另有配置 JSON 导入导出。

**典型步骤**：调限额 → 查日志定位失败 → 保存一份快照作为已知良好配置。

---

## 工作台使用

配置面板里的 **测试工作台** 标签页是不消耗 Agent 轮次的自测入口。工作台本身不产生视觉能力，它只是调用已配置的后端——所以先到 **调度画布 → 新增后端** 配好至少一个后端，并点「测试」确认返回绿色「连通正常」。

### 图片输入的三种方式

1. **点击选择**：点击虚线框打开文件选择器
2. **拖拽放下**：把图片从资源管理器拖到框内
3. **粘贴截图**：受浏览器安全策略限制，部分环境不可用时可改用方式 1

上传成功后显示缩略图与尺寸。图片以**内容哈希**在前后端之间流转：上传一次，后续所有工具都引用同一个哈希，服务端不会重复解码。

### 对比图

只有 `vision_image_diff` 使用第二张图。上传后两张图都会显示，执行时会自动对齐（尺寸不同时缩放，可通过 `align` 参数关闭）。

### 跑一次

1. 进入 **测试工作台**
2. 左栏拖入或选择图片
3. 中栏下拉选择工具，例如 `vision_insight`
4. 点 **执行**
5. 右栏出现结果

### 结果区

结果按可用性依次渲染：

1. **标注框叠加**：`vision_ground` / `vision_detect` 的结果会直接画在原图上，带标签
2. **图片产物**：差异高亮图、裁剪结果、抽帧、透明抠图，可单独下载
3. **OCR 文本**：`vision_long_ocr` / `vision_batch_ocr` 的识别文本
4. **结构化表格**：`vision_chart_analyze` 解析出的行列数据
5. **原始 JSON**：始终展示，可一键复制

### 停止任务

执行中点击「停止」会向后端发送取消请求，服务端 abort 对应任务并立即归还并发槽位。

### 验证 Agent 侧调用

工作台跑通说明后端可用；再回到对话让 Agent 调用一次：

```text
用 vision_insight 描述这张图的内容
```

Agent 能正确调用并返回描述，说明工具注册、权限校验、调度链路全部就绪。

---

## 配置项表

以下字段来自 `src/index.ts` 的 Schemastery `Config`（`plugin.json` 的 `config.schemaSource = "src/index.ts#Config"`）。**全部 11 个字段都是 `volatile()`**：保存设置时走热更新路径，Loader 把新值写入引用并广播 `loader/volatile-update`，不整行重载——因此路由、缓存、配额计数在保存设置时不中断。

| 字段 | 类型 | 默认值 | 取值范围 | 说明 | 是否热更新 |
| --- | --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `true` / `false` | 总开关。关闭后不注册工具、不注册路由、不启动服务 | 是（volatile） |
| `strategy` | enum | `local-first` | `sequential` / `weighted-round-robin` / `local-first` / `lowest-latency` | 调度策略 | 是（volatile） |
| `perSessionConcurrency` | number | `2` | 1–64 | 单会话最大并发任务数 | 是（volatile） |
| `globalConcurrency` | number | `8` | 1–256 | 全局最大并发任务数 | 是（volatile） |
| `taskTimeoutMs` | number | `120000` | 1000–3600000 | 单任务超时（毫秒） | 是（volatile） |
| `circuitThreshold` | number | `3` | 1–100 | 熔断连续失败阈值 | 是（volatile） |
| `circuitCooldownSec` | number | `60` | 1–86400 | 熔断冷却时长（秒） | 是（volatile） |
| `cacheEnabled` | boolean | `true` | `true` / `false` | 内容寻址缓存开关 | 是（volatile） |
| `cacheTtlSec` | number | `86400` | 1–2592000 | 缓存 TTL（秒），默认 24 小时 | 是（volatile） |
| `logLevel` | enum | `info` | `debug` / `info` / `warn` / `error` | 日志级别 | 是（volatile） |
| `pythonEnabled` | boolean | `true` | `true` / `false` | 是否启用托管 Python 运行时 | 是（volatile） |

> 这些是**插件级默认值**。用户通过面板做的细粒度调整（后端列表、每个工具的超时与配额、快照、画布坐标等）持久化在 `$DSH_HOME/dsh-vision-nexus/state.json`，由服务层管理，不在上面的 schema 内。写入采用「临时文件 + rename」的原子写，读取时做结构修复（未知字段丢弃、缺失字段补默认、非法枚举回落）。

### 其它持久化默认值（`defaultState()`）

| 分组 | 字段 | 默认值 | 取值范围 |
| --- | --- | --- | --- |
| `quota` | `globalPerDay` | `2000` | 0–10000000（0 表示不限） |
| `quota` | `perBackendPerDay` | `1000` | 0–10000000 |
| `quota` | `window` | `day` | `day` / `hour` |
| `cache` | `ttlSec` | `86400` | 1–2592000 |
| `cache` | `maxBytes` | `536870912`（512 MiB） | 0–64 GiB |
| `concurrency` | `perSession` / `global` / `taskTimeoutMs` | `2` / `8` / `120000` | 1–64 / 1–256 / 1000–3600000 |
| `circuit` | `failureThreshold` / `cooldownSec` / `maxCooldownSec` | `3` / `60` / `480` | 1–100 / 1–86400 / 1–86400 |
| `logging` | `level` / `retainDays` / `maxTraceRecords` | `info` / `14` / `5000` | 枚举 / 1–365 / 100–50000 |

**出站与上传硬上限**（`src/shared/constants.ts`）：出站 HTTP 默认超时 **30 秒**；响应体上限 **32 MiB**（超限立即中断流）；单张图片上传上限 **20 MiB**。

---

## 调度策略教程

四种策略不是「哪个更好」，而是对应四种不同的使用场景。默认策略是 `local-first`。

### 顺序降级（`sequential`）

**语义**：严格按优先级依次尝试，前一个失败才轮到下一个。
**适用**：主备架构，例如「优先用便宜的云端 API，挂了再切到本地模型」。
**要点**：优先级数字越小越先尝试。顺序降级的代价是每次降级都要等前一个超时。

### 权重轮询（`weighted-round-robin`）

**语义**：按权重平滑分配流量，避免某个后端被连续打爆。
**适用**：多个等价后端做负载均衡。
**要点**：权重 3:1 表示前者承接约 75% 的请求。轮询只决定**首选**顺序，真正的流量分配还受缓存命中与失败降级影响——缓存命中根本不走后端。

### 优先本地（`local-first`）

**语义**：本地算力（Ollama / Python 运行时 / Tesseract）永远排在云端前面。
**适用**：隐私敏感场景、离线环境、想省钱的部署。这是**默认策略**。
**要点**：本地后端之间仍按优先级排序。本地模型通常比云端慢——延迟是硬指标时改用最低延迟策略。

### 最低延迟（`lowest-latency`）

**语义**：按指数加权平均延迟从低到高排序，最快的先上。
**适用**：延迟敏感场景，或后端性能波动大、需要自动择优。
**要点**：延迟是 EWMA（平滑系数 0.3）算出来的，新样本占三成权重。从未成功过的后端按 1000 ms 中性值处理，保证它们仍有被选中的机会——否则冷启动的后端永远排不上。

### 熔断机制（与策略正交）

无论哪种策略，熔断都在策略之前生效：

```text
closed ──连续失败达阈值──> open ──冷却结束──> half-open
                                                 │
                                    探测成功 ────┴──> closed
                                    探测失败 ────────> open（重新计时）
```

- **阈值与冷却时长可配**，并支持**按后端单独覆盖**；
- 冷却期内该后端**完全不参与调度**，不是降权；
- `half-open` 只放**一次**探测，避免冷却刚结束时被并发请求打垮。

**指数退避冷却**：同一后端反复熔断时，冷却时长按 1×、2×、4×… 递增，上限由 `maxCooldownSec`（默认 480 秒）控制：

| 熔断次数 | 基准 60 秒时实际冷却 |
| --- | --- |
| 第 1 次 | 60 秒 |
| 第 2 次 | 120 秒 |
| 第 3 次 | 240 秒 |
| 第 4 次起 | 480 秒（封顶） |

探测成功后退避计数清零。运维手动点「测试」触发一次成功探测，也会立即解除熔断并清零退避计数。

---

## 配额说明

### 三级独立计数

| 层级 | 作用 | 默认 |
| --- | --- | --- |
| 全局 | 所有请求的总上限 | 2000 / 天 |
| 单后端 | 单个后端的请求上限 | 1000 / 天 |
| 单工具 | 单个工具的请求上限 | 见工具默认值（最高 300，最低 20） |

**任一超限即拒绝**，错误信息会说明是哪一级超了。`0` 表示该级不限。

### 窗口滚动

- `day`：本地自然日 00:00 重置
- `hour`：整点重置

计数持久化在 `$DSH_HOME/dsh-vision-nexus/quota.json`，**重启不会绕过配额**。

### 先检查后占用

配额消耗是原子的：先全部检查，再统一占用，因此被拒绝的请求不会消耗额度。后端调用失败时配额会**自动退还**——因为它并没有真正处理这个请求。

### 缓存命中不计配额

内容寻址缓存命中时直接返回，不消耗任何配额，也不计入后端流量占比。重复分析同一张图是免费的。

### 调整建议

- **开发期**：把全局配额调大，避免调试时被拦
- **生产期**：按预算倒推。若某云端 API 单次调用成本 0.01 元、日预算 20 元，则单后端配额设 2000
- **本地后端**：配额意义不大（不花钱），但可用来限制资源占用

---

## 开发与测试

### 安装依赖

插件本身**零第三方运行时依赖**（只有 `@deepseek-ai/schemastery`），直接 `node scripts/build.mjs` 就能构建。若你想跑类型检查或前端工具链，需要先装开发依赖。

**后端开发（最小集合）**：

```bash
npm install --save-dev @types/node typescript
```

**前端开发（最小集合）**——客户端运行时只从宿主注入 `react` / `react/jsx-runtime`，因此只需要 `react`、`react-dom`（peer，由 DSH 宿主提供，避免双实例）与类型声明。UI 原语、画布拖拽、图表全部是仓库内自研代码（`src/client/ui/`、`src/client/tabs/CanvasTab.ts`、`src/client/styles.ts`），**不依赖** reactflow / echarts / tailwindcss / class-variance-authority / @radix-ui 等第三方库——早期版本曾在 `devDependencies` 里声明过它们但从未 import，现已清理：

```bash
npm install --save-dev typescript "@types/node@^22.20.0" \
  "@types/react@~18.3.1" "@types/react-dom@~18.3.0" \
  react@^18.3.1 react-dom@^18.3.1
```

> 产物层面同样轻量：发布产物 `lib/client.js` 只保留 `react` 与 `react/jsx-runtime` 两个外部依赖（由宿主注入）。画布用 Pointer Events，图表用纯 SVG，样式走 DSH 主题 CSS 变量（亮暗自动跟随）——所以 reactflow / echarts / tailwindcss / class-variance-authority 既不进 `package.json`，也不进产物。

### 前后端边界

本插件把代码切成三层，**边界是硬约束**，由 `scripts/check-boundaries.mjs` 在测试里强制执行：

| 层 | 目录 | 允许依赖 | 禁止 |
| --- | --- | --- | --- |
| 后端插件逻辑 | `src/host/**`、`src/shared/**`、`src/index.ts` | Node 内置模块、`@deepseek-ai/schemastery` | `src/client/**`、react、任何前端库 |
| 前端代码 | `src/client/**` | react、react-dom、`src/shared/**` 的类型 | `src/host/**` 的运行时实现 |
| 后端测试脚本 | `scripts/smoke.mjs` 等 | 只导入 `src/shared/**`、`src/host/**` | react、`src/client` 下的 hooks / 组件 |

**为什么必须隔离**：后端脚本跑在 Node 里，没有 DOM、也没有 React。一旦后端脚本 `import` 了 `src/client/hooks.ts`（它 `import 'react'`），在只装后端依赖的环境里就会抛：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react'
```

`scripts/smoke.mjs` 里的 `assertBackendOnly()` 会在导入前主动拦截，把这条模糊的模块解析错误变成一句明确的断言失败；`scripts/check-boundaries.mjs` 则扫描源码定位具体越界文件与行号。需要共享纯逻辑时，把它放到 `src/shared/`，而不是从后端反向 import 前端。

### 词典与 `locale/*.json`

`src/client/locales.ts` 是词典的**唯一真相源**，`locale/zh.json` 与 `locale/en.json` 是它的导出产物（`plugin.json` 的 `i18n.files` 指向它们）。

改文案后请重新导出，不要手改 JSON：

```bash
npm run gen:locales
```

`npm run check` 会校验 JSON 与源码完全一致（键、值都比），不一致直接失败。

### 测试命令

**一键跑全套**（推荐，CI 用这个）：

```bash
npm run test
```

它由 `scripts/run-all-tests.mjs` 驱动，按固定顺序执行 **后端 → 前端 → 边界 → DSH 契约 → 编码** 五套。与 `a && b && c` 的区别：五套**都会跑完**，最后打一张汇总表，任何一套失败则以非零退出。

单套运行：

```bash
npm run test:backend        # 仅后端冒烟
npm run test:frontend       # 仅前端渲染检查
npm run test:boundaries     # 仅前后端边界校验
npm run test:dsh-contract   # 仅 DSH 契约（14 个工具的 schema 子集）
npm run test:encoding       # 仅编码体检（UTF-8 / 无 BOM / 无损坏字符）
npm run test:sequential     # 严格短路版（第一套失败即停），适合快速本地反馈
```

### 每套到底在测什么

| 分项 | 脚本 | 它到底在测什么 |
| --- | --- | --- |
| `test:backend` | `scripts/smoke.mjs` | 工具入参 schema 与调度/熔断/缓存/配额/并发/图片元信息/沙盒/脱敏/配置导入导出的纯逻辑行为；`assertBackendOnly()` 在导入前拦截越界的前端依赖 |
| `test:frontend` | `scripts/render-check.mjs` | 词典中英对齐、样式表完整性、API 客户端行为、校验与视图提取逻辑；只读零 React 依赖模块，因此不需要安装 React |
| `test:boundaries` | `scripts/check-boundaries.mjs` | 三层隔离（`src/host` / `src/shared` / `src/client`）是否被越界引用；前端依赖清单是否完整；`scripts/**/*.mjs` 是否都带 UTF-8 引导 |
| `test:dsh-contract` | `scripts/check-dsh-contract.mjs` | 把 DSH 宿主的 JSON Schema 子集规则固化为回归测试，覆盖 14 个工具的 `parameters` 与 `output.schema`（例如 `required` 必须是 `type: "object"` 上的字符串数组） |
| `test:encoding` | `scripts/check-encoding.mjs` | 扫描全部源码，确保无 GBK 文件、无 BOM、无 U+FFFD 替换字符，把字符编码问题变成会失败的测试 |

> 任何测试脚本都支持 `--report <文件>`，由 `scripts/lib/utf8.mjs` 直接以 UTF-8 写盘，方便留档与 CI 读取：
>
> ```bash
> node scripts/run-all-tests.mjs --report ./test-report.txt
> node scripts/smoke.mjs --report ./smoke-report.txt
> ```

### 发布质量校验

```bash
npm run check             # 插件包清单一致性（plugin.json ↔ package.json ↔ tool-catalog，含前端依赖完整性）
npm run check:imports     # 相对导入可达性与重复导出
npm run check:build       # 构建产物可加载性
npm run check:readme      # README 事实校验
```

### 新增脚本必须带 UTF-8 引导

`scripts/` 下每个会打印中文的脚本，顶部都要有这两行：

```js
import { bootstrapConsole } from './lib/utf8.mjs'

bootstrapConsole()
```

`check-boundaries.mjs` 会**扫描 `scripts/` 下的全部 `.mjs`**，任何脚本缺这两行都会直接判失败——不需要有人记得去更新名单。只有两类文件豁免：`scripts/lib/**`（被导入的工具库）和纯 ESM loader 钩子（从不产生输出）。

### CI 矩阵

推送到 `main` / `master` / `develop`，或向主分支提 PR 时，`.github/workflows/ci.yml` 会：

1. 在 **Ubuntu + Windows** × **Node 22 + 24** 的矩阵上跑（`fail-fast: false`，先把完整矩阵跑完）：
   - `node scripts/build.mjs`（构建）
   - `node scripts/run-all-tests.mjs`（后端 / 前端 / 边界 / DSH 契约 / 编码五套）
   - `check-package` / `verify-imports` / `verify-build` / `verify-readme`
2. 在 Ubuntu 上跑 `npm pack --dry-run`（`pack` job，`needs: test`），确认发布清单自洽。

### 如何解读失败

- `npm run test` 的汇总表会列出每套的通过 / 失败与退出码；**它不会短路**，所以能同时看到「前端过没过」。
- `test:boundaries` 失败 → 输出越界文件与行号，多为后端脚本误 import 前端模块；修法见「前后端边界」。
- `test:dsh-contract` 失败 → 某个工具的 schema 不满足 DSH 子集规则，工具会在宿主机注册失败（现象是「工具不出现」而不是报错）。
- `test:encoding` 失败 → 某个文件是 GBK、带 BOM 或含 U+FFFD；用 UTF-8 无 BOM 重写该文件。
- `check:readme` 失败 → README 里的数字/章节/命令/引用文件与源码不一致，诊断信息会逐条列出。
- Windows 本地看到中文输出显示异常时，先在当前终端把输出编码切到 UTF-8，或用 `--report <文件>` 让脚本直接写 UTF-8 文件。

---

## 故障排查

### 错误码表

所有子系统把异常收敛成 `VisionNexusError`，错误码稳定（前端与 Agent 都按 `code` 分支），共 14 个：

| 错误码 | 含义 | 处置 |
| --- | --- | --- |
| `VN_BACKEND_UNAVAILABLE` | 没有任何可用后端（全部离线或熔断中） | 到调度画布检查状态灯；红色即冷却中，点「测试」手动触发探测；确认至少配了一个后端 |
| `VN_CREDENTIAL_MISSING` | 后端需要 API Key 但未配置（或宿主未提供 credentials 服务） | 在后端编辑面板填写密钥；检查 DSH 是否启用了凭据存储 |
| `VN_QUOTA_EXCEEDED` | 配额已耗尽 | 到「配额与日志」调整限额，或等待窗口重置（`day` / `hour`） |
| `VN_TIMEOUT` | 任务超时/被取消 | 检查后端响应速度，或调大该工具的超时与 `taskTimeoutMs` |
| `VN_RUNTIME_MISSING` | 本地运行时（Python / Tesseract / ffmpeg）不可用 | 到「运行时与安全」做健康检测并一键初始化 Python；或安装 Tesseract / ffmpeg |
| `VN_SANDBOX_DENIED` | 文件路径越出目录白名单（或白名单为空） | 到「运行时与安全 → 目录白名单」加入目标目录 |
| `VN_AGENT_FORBIDDEN` | 当前 Agent 会话不在调用白名单内 | 调整 Agent 白名单，或清空以取消限制 |
| `VN_TOOL_DISABLED` | 该工具已被管理员关闭 | 到「工具管理」重新启用 |
| `VN_INVALID_ARGUMENT` | 入参不合法 | 检查图片引用、坐标范围、必填字段与 HTTP 方法 |
| `VN_BUSY` | 并发队列已满、排队超时 | 稍后重试，或调大「运行时与安全」的单会话/全局并发上限 |
| `VN_BAD_RESPONSE` | 后端返回了无法解析的内容 | 检查该后端是否真的支持所调用的工具；本地 Python 输出溢出或非 JSON 也走此码 |
| `VN_UPLOAD_REJECTED` | 上传被拒绝（MIME / 魔数 / 体积） | 换用 PNG/JPEG/WebP/GIF/BMP/TIFF/SVG 或视频格式，且不超过 20 MiB |
| `VN_NETWORK_DENIED` | 出站网络被安全策略拒绝 | 多为目标返回重定向（不被跟随）或响应体超过 32 MiB |
| `VN_INTERNAL` | 未归类的内部错误 | 查看链路详情与日志定位（`GET /logs` 或「配额与日志」标签页） |

`VN_BACKEND_UNAVAILABLE`、`VN_TIMEOUT`、`VN_BAD_RESPONSE`、`VN_BUSY` 默认可重试：调度器会据此降级到下一个后端。

### 常见现象

**设置页看不到「视觉中枢」**

依次检查：① `dsh --profile <name> --dump-config` 是否有 `dsh-vision-nexus` 行；② `cordis.patch.yml` 与 `lib/client.js` 是否存在；③ DSH 版本是否 `>= 0.2.1-rc.5`；④ 改完 profile 后是否重启了 DSH 进程；⑤ `Config.enabled` 是否为 `true`（关闭后不注册工具与路由）。若插件启动失败，日志里会有 `dsh-vision-nexus 启动失败：插件将以不可用状态挂载` 的 error 级记录，可在「插件详情」里看到具体原因。

**工具调用报后端不可用（`VN_BACKEND_UNAVAILABLE`）**

两种情况：一个后端都没配，或者全部处于熔断冷却中。到调度画布看状态灯——红色即冷却中。点「测试」手动触发一次探测，成功会立即恢复。常见根因：接口地址少了 `/v1`、API Key 未配置或已失效、Ollama 服务未启动、模型名拼错。熔断器在连续失败达阈值（默认 3 次）后进入冷却（默认 60 秒）。

**Python 工具报 `VN_RUNTIME_MISSING`**

说明 Python 运行时不可用。到「运行时与安全」点「健康检测」看具体缺什么（解释器不存在 / 版本低于 3.10 / 缺少 `numpy` 或 `PIL`），再点「一键初始化环境」。若自动失败，按上文「Python 运行环境部署」手动准备 venv 并填入解释器路径。注意：`python-local` 后端仅覆盖 6 个纯本地工具 + `vision_remove_bg` 的可选路径，其余工具走视觉模型后端，不受影响。

**中文日志/输出显示成问号或方块**

这是终端编码不一致：脚本按 UTF-8 写出，而终端按别的代码页解码。插件侧的应对是 `scripts/lib/utf8.mjs` 的 `bootstrapConsole()`——它把所有 console 输出镜像到 UTF-8 文件（Node 直接写盘，绕开终端解码），所有测试脚本都支持 `--report <文件>`：

```bash
node scripts/run-all-tests.mjs --report ./test-report.txt
```

`scripts/check-encoding.mjs` 会把源码层面的字符编码问题（GBK 文件、BOM、U+FFFD）变成会失败的测试。

**OCR 识别不出中文**

Tesseract 需要单独安装中文语言包。检查 `tesseract --list-langs` 是否包含 `chi_sim`；没有则下载 `chi_sim.traineddata` 放入 tessdata 目录。

**为什么同一张图第二次分析快很多**

内容寻址缓存命中。缓存键是「图片哈希 + 工具 + 规范化参数」，参数顺序不同也会命中（做了稳定序列化）。缓存默认 TTL 24 小时，可在「运行时与安全」调整或清空。

**改了工具超时但没生效**

工具的超时在**注册时**写入 DSH 的工具定义。修改后插件会重新注册该工具，但正在执行中的调用不受影响。超时/配额是**失焦时提交**的，确认输入框是否已失焦。

---

## 安全说明

### 密钥

- **只存引用名**：后端配置里只有 `apiKeyRef`（形如 `VISION_NEXUS_{BACKEND_ID}_API_KEY`），真实值由 DSH Credentials 加密模块托管
- **永不回传**：接口只返回 `configured` / `writable` 两个布尔，前端拿不到明文
- **每次重新解析**：不缓存密钥，改了立即生效
- **导出即脱敏**：配置导出的密钥字段被替换为 `<KEEP_EXISTING>` 占位符

### 文件访问

**目录白名单沙盒**，三重防护：

1. 先 `realpath` 解析真实路径——否则一个指向外部的符号链接就能绕过
2. 用 `path.relative` 判断包含关系，而非字符串前缀——后者会让 `/allowed-evil` 通过 `/allowed` 的检查
3. 白名单为空时**拒绝一切**磁盘读取（fail-closed），不是放开

越界访问返回 `VN_SANDBOX_DENIED` 并附带被拒路径，而不是静默失败。目录浏览接口同样受白名单约束。

### 上传

三重校验，扩展名完全不可信：

1. MIME 白名单（`image/png`、`image/jpeg`、`image/webp`、`image/gif`、`image/bmp`、`image/tiff`、`image/svg+xml`、`video/mp4`、`video/webm`、`video/quicktime`）
2. **魔数比对**（PNG / JPEG / GIF / BMP / TIFF / WebP / MP4 各有固定字节序列）
3. 体积上限 20 MiB（20 MB）

客户端声明的 MIME 与实际不符时会记一条警告日志。

### 出站网络

所有对外请求强制施加：

- **超时**（默认 30 秒，可配）
- **禁止跟随重定向**——一个 302 就能把请求导向内网地址，是 SSRF 的经典入口
- **响应体字节上限** 32 MiB，超限立即中断流（不是读完再检查）

### 日志脱敏

日志与配置导出**共用同一套脱敏实现**——两处各写一份是密钥泄漏最常见的来源。三层脱敏：

1. 键名启发式：匹配 `apikey`、`api_key`、`authorization`、`bearer`、`password`、`secret`、`token`、`credential` 等键名片段，值整体替换
2. 值模式匹配：`sk-` 前缀、`Bearer xxx`、JWT、URL 里的 userinfo、长随机串
3. 深度遍历：嵌套对象与数组递归处理，带环检测

### 本地不上报

`plugin.json` 的 `telemetry.localOnly = true`、`uploadsToVendor = false`：指标、链路与日志只落在本地 `$DSH_HOME`，插件不向任何第三方上报数据。

### Agent 白名单

白名单非空时，只有名单内的会话可以调用视觉工具，其余返回 `VN_AGENT_FORBIDDEN`。为空表示不限制。

### 漏洞报告

请**不要**通过公开 issue 报告安全漏洞，改用 GitHub 私密渠道：<https://github.com/Lonis89/dsh-vision-nexus/security/advisories/new>。详见 [SECURITY.md](SECURITY.md)。

---

## 发布到 GitHub

仓库已按 GitHub 的通行约定准备好，克隆或 fork 后开箱可用。

### 仓库结构

```text
dsh-vision-nexus/
├── .github/
│   ├── workflows/ci.yml            # CI：测试矩阵 + 打包干跑
│   ├── ISSUE_TEMPLATE/             # Issue 表单（Bug / Feature / 联系）
│   └── PULL_REQUEST_TEMPLATE.md    # PR 自检清单
├── src/
│   ├── index.ts                    # Host 入口：Config + apply()
│   ├── shared/                     # 双端共享的纯类型与常量
│   ├── host/                       # 服务、调度、适配器、工具、路由、运行时、安全
│   └── client/                     # 前端：locales / api / styles / tabs / ui
├── scripts/                        # 构建、测试、校验脚本
├── locale/                         # 词典产物（由 gen:locales 生成）
├── lib/                            # 构建产物（.gitignore 忽略，本地/CI 现构建）
├── LICENSE                         # Apache-2.0
├── README.md / README.en.md        # 中英双语文档
├── CHANGELOG.md                    # 更新日志
├── CONTRIBUTING.md                 # 贡献指南
├── CODE_OF_CONDUCT.md              # 行为准则
├── SECURITY.md                     # 安全策略与漏洞报告
├── PROJECT-STRUCTURE.md            # 目录与文件职责
├── icon.svg                        # 插件图标
├── plugin.json                     # 声明式能力清单
├── package.json                    # npm / DSH Loader 清单
└── cordis.patch.yml                # 挂载补丁
```

### `lib/` 为什么不在版本库里

`lib/` 由 `node scripts/build.mjs` 从 `src/` 生成。纳入版本库会导致每次改源码都要额外提交一堆产物、且产物与源码不同步时别人 clone 后跑的是旧代码。因此 `.gitignore` 忽略 `lib/`，并在以下位置现构建：

| 场景 | 如何获得 `lib/` |
| --- | --- |
| 本地开发 | `node scripts/build.mjs` |
| 从 GitHub 克隆后使用 | 克隆后先跑一次 `node scripts/build.mjs` |
| CI | workflow 里已自动构建 |
| 从 npm 安装 | 包内已包含（`files` 字段声明），无需构建 |

### 开发与贡献

- 代码边界、提交规范、PR 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 目录与文件职责见 [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md)
- 提交信息用 Conventional Commits 风格；提交前请确保 `npm run test` 与 `node scripts/check-package.mjs` 均通过

### 首次推送

```bash
git init
git add .
git commit -m "feat: initial release v0.1.0"

git remote add origin https://github.com/Lonis89/dsh-vision-nexus.git
git branch -M main
git push -u origin main
```

推送前建议本地先跑一遍，避免 CI 变红：

```bash
node scripts/build.mjs
node scripts/run-all-tests.mjs
node scripts/check-package.mjs
```

### 发布到 npm（可选）

```bash
node scripts/build.mjs
npm publish
```

`prepublishOnly` 钩子会自动重新构建并跑清单校验，避免带着坏清单发版。

### 仓库设置建议

在 GitHub 仓库 **Settings** 里建议开启：对 `main` 的分支保护（要求 CI 通过 + 至少 1 个 review）、Dependabot 依赖漏洞提醒、Private vulnerability reporting（与 `SECURITY.md` 呼应）。

---

## 快速上手

五分钟从零跑通第一个视觉请求。

### 1. 配置一个后端

打开「视觉中枢 → 调度画布」，点击「新增后端」。最小可用配置（以本地 Ollama 为例）：

| 字段 | 值 |
| --- | --- |
| 后端 ID | `ollama-local` |
| 显示名称 | 本地视觉模型 |
| 服务类型 | Ollama 本地 |
| 接口地址 | `http://127.0.0.1:11434` |
| 模型名 | `llava:13b` |

保存后点「测试」确认连通。

### 2. 验证工具已注册

回到对话，让 Agent 描述一张图：

```text
用 vision_insight 描述这张图的内容
```

如果 Agent 能正确调用，说明链路通了。

### 3. 用工作台调试

进入「测试工作台」，拖入一张图片，工具选 `vision_insight`，点「执行」。右侧会显示结构化结果与链路 ID。这一步不消耗 Agent 轮次。

### 4. 查看链路

进入「配额与日志」，能看到刚才那次请求的耗时与结果摘要。如果失败，错误码会明确告诉你原因（见上文错误码表）。

---

## 常见问题

**Q：装好了但设置页看不到「视觉中枢」？**

依次检查：`dsh --profile <name> --dump-config | grep dsh-vision-nexus` 是否有该行；`cordis.patch.yml` 与 `lib/client.js` 是否存在；DSH 版本是否 `>= 0.2.1-rc.5`；改完 profile 是否重启了 DSH 进程。定位顺序见上文「常见现象」。

**Q：工具注册了但 Agent 调用时报「没有可用后端」？**

`VN_BACKEND_UNAVAILABLE` 有两种情况：一个后端都没配，或者全部处于熔断冷却中。到调度画布看状态灯——红色即冷却中。点「测试」手动触发一次探测，成功会立即恢复。

**Q：为什么我的后端一直是红色？**

先点「测试」看具体错误。常见原因：接口地址少了 `/v1`、API Key 未配置或已失效、Ollama 服务未启动、模型名拼错。熔断器在连续 3 次失败后进入冷却，冷却时长默认 60 秒，反复熔断会按指数退避递增到 480 秒封顶。

**Q：本地算法类工具全部报 `VN_RUNTIME_MISSING`？**

说明 Python 运行时不可用。到「运行时与安全」点「健康检测」看具体缺什么，再点「一键初始化环境」。若自动失败，按上文手动部署。也可以把 `pythonEnabled`（`Config`）设为 `false` 明确关闭它。

**Q：OCR 识别不出中文？**

Tesseract 需要单独安装中文语言包。检查 `tesseract --list-langs` 是否包含 `chi_sim`。没有的话下载 `chi_sim.traineddata` 放入 tessdata 目录。

**Q：为什么同一张图第二次分析快很多？**

内容寻址缓存命中。缓存键是「图片哈希 + 工具 + 规范化参数」，参数顺序不同也会命中（做了稳定序列化）。缓存默认 TTL 24 小时（`cacheTtlSec` 默认 86400），可在「运行时与安全」调整或清空。

**Q：改了工具超时但没生效？**

工具的超时在**注册时**写入 DSH 的工具定义。修改后插件会重新注册该工具，但正在执行中的调用不受影响。超时/配额是失焦时提交的，确认输入框已失焦。

**Q：日志里能看到我的 API Key 吗？**

不能。日志写入前统一过脱敏，`sk-` 前缀、Bearer 头、长随机串都会被替换掉；配置导出同样经过脱敏实现。

**Q：卸载插件会删掉我的配置吗？**

不会。`dsh plugin remove` 只移除插件行，`$DSH_HOME/dsh-vision-nexus` 下的配置、缓存、日志、快照都会保留。需要彻底清理请手动删除该目录。

**Q：支持哪些图片格式？**

PNG、JPEG、WebP、GIF、BMP、TIFF、SVG。视频抽帧支持 MP4、WebM、MOV。上传前会做魔数校验，改扩展名蒙混不过去。

**Q：前端用了 Tailwind / shadcn / react-flow / ECharts 吗？**

**都没有，也不再声明它们。** 早期草稿曾在 `devDependencies` 里列出 reactflow / echarts / tailwindcss / class-variance-authority / `@radix-ui/*` 等，但全仓源码 0 引用；本次审计后已全部清理。`package.json` 现在只保留真实需要的 `react`、`react-dom`、`@types/*`、`typescript`、`@deepseek-ai/schemastery`、`@deepseek-ai/cordis`。

发布产物 `lib/client.js` 只保留 `react` 与 `react/jsx-runtime` 两个外部依赖，由宿主注入。样式走 DSH 主题 CSS 变量（亮暗自动跟随），UI 原语是自研的 `src/client/ui/primitives.ts`，画布用 Pointer Events，图表用纯 SVG。

**Q：跑 `node scripts/smoke.mjs` 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'react'`？**

说明后端测试脚本越界加载了前端模块。修复方式二选一：① 把被验证的纯逻辑从 `src/client` 移到 `src/shared`（后端与前端都能用）；② 把这条验证挪到 `scripts/render-check.mjs`（前端脚本）里去。跑 `node scripts/check-boundaries.mjs` 可以定位具体是哪个文件、哪一行越界。

---

## 版本与变更

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)，全部重要变更记录在 [CHANGELOG.md](CHANGELOG.md)（Keep a Changelog 格式）。

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| `0.1.0` | 2026-11-05 | 首个可发布版本：调度引擎、熔断器、5 种适配器、14 个工具、运行时治理、可观测性、6 标签页前端、配置管理 |
| 未发布 | — | 修复：14 个工具无法注册的 schema 契约问题、字符编码问题；变更：插件重命名为 `dsh-vision-nexus`；新增：旧版数据自动迁移 |

升级与迁移细节见 [CHANGELOG.md](CHANGELOG.md) 与上文「升级」。

---

## 开源协议

本项目基于 [Apache License 2.0](LICENSE) 发布。

```text
Copyright 2026 Lonis89

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 文档与源码核对记录

本 README 的每个数字、命令、字段名与工具名均在写入后与源码逐条复核。核对结论如下（差异一律以源码为准）。

| # | 核对项 | 源码依据 | 结论 |
| --- | --- | --- | --- |
| 1 | 工具总数 = **14** | `src/shared/tool-catalog.ts` 的 `TOOL_CATALOG.length`；`plugin.json` `capabilities.tools` | 一致 |
| 2 | 仅依赖 Python 的工具 = **6** | `TOOL_CATALOG.filter(e => e.backends.length === 1 && e.backends[0] === 'python-local')` → `vision_crop`、`vision_image_diff`、`vision_extract_color`、`vision_svg_trace`、`vision_video_sample`、`vision_code_scan` | 一致（README 句式「14 个工具里有 6 个完全依赖本地算法」） |
| 3 | 路由数 | `src/host/http/routes/**` 中 `kind:` 条目 = **30**；`plugin.json` `capabilities.routes` = **37** 个 method+path；`PROJECT-STRUCTURE.md` 写 **35** | **不一致**：运行时实际注册 30 条路由条目（同一路径上的多方法合并为一条，另有若干方法别名未在清单单列）；`plugin.json` 的 37 是 method+path 操作数；`PROJECT-STRUCTURE.md` 的 35 为陈旧数字。README 采用 30 + 37 的双数字表述 |
| 4 | 各工具默认超时 | `tool-catalog.ts` 的 `defaults.timeoutMs` | 一致：120000 / 120000 / 120000 / 30000 / 60000 / 180000 / 120000 / 30000 / 90000 / 120000 / 300000 / 180000 / 120000 / 30000 |
| 5 | 各工具每日配额 | `tool-catalog.ts` 的 `defaults.quotaPerDay` | 一致：200 / 100 / 100 / 300 / 100 / 60 / 60 / 300 / 60 / 60 / 20 / 30 / 60 / 300 |
| 6 | 各工具后端归属 | `tool-catalog.ts` 的 `backends` | 一致。注意：`plugin.json` 对 `vision_long_ocr` 多列了 `python-local`（目录为 `tesseract` + `openai-compat`）；README 以目录为准 |
| 7 | 全局默认配额 2000 / 天 | `defaultState().quota.globalPerDay = 2_000` | 一致 |
| 8 | 单后端默认配额 1000 / 天 | `defaultState().quota.perBackendPerDay = 1_000` | 一致 |
| 9 | 缓存 TTL 默认 24 小时 | `DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60` = 86400；`Config.cacheTtlSec` 默认 86400 | 一致 |
| 10 | 上传上限 20 MiB | `MAX_UPLOAD_BYTES = 20 * 1024 * 1024` | 一致 |
| 11 | 响应体上限 32 MiB | `MAX_RESPONSE_BYTES = 32 * 1024 * 1024` | 一致 |
| 12 | 出站超时默认 30 秒 | `DEFAULT_HTTP_TIMEOUT_MS = 30_000` | 一致 |
| 13 | `Config` 字段数 = **11**，默认值与范围 | `src/index.ts` 的 `Config` | 一致：enabled/strategy/perSessionConcurrency(1–64)/globalConcurrency(1–256)/taskTimeoutMs(1000–3600000)/circuitThreshold(1–100)/circuitCooldownSec(1–86400)/cacheEnabled/cacheTtlSec(1–2592000)/logLevel/pythonEnabled；全部 `.volatile()` |
| 14 | 错误码 = **14** | `src/shared/errors.ts` 的 `ErrorCodes` | 一致，README 错误码表逐条列出 |
| 15 | 前端标签页 = **6** | `plugin.json` `capabilities.ui.tabs`；`src/client/tabs/Shell.ts` 的 `TABS`；`locales.ts` 的 `tab.*` | 一致：dashboard / canvas / tools / workbench / runtime / governance |
| 16 | 后端类型 = **5** | `src/shared/types.ts` 的 `BackendKind`；`store.ts` 的 `readBackendKind` | 一致 |
| 17 | 调度策略 = **4** | `Config.strategy` 的 union | 一致 |
| 18 | npm scripts 存在性 | `package.json` 的 `scripts` | 一致：README 引用的 `test` / `test:backend` / `test:frontend` / `test:boundaries` / `test:dsh-contract` / `test:encoding` / `test:sequential` / `check` / `check:imports` / `check:build` / `check:readme` / `gen:locales` 均真实存在 |
| 19 | 版本要求 | `plugin.json` `engines.dsh = ">=0.2.1-rc.5"`；`package.json` `engines.node = "^22.19.0 \|\| >=24.0.0"`；实测 DSH `0.2.2-rc.1` | 一致 |
| 20 | 安装命令形态 | `cordis.patch.yml` 注释中的 `dsh plugin --profile <profile> add dsh-vision-nexus` 与 `add link:<本地路径>` | 一致（README 另注明「以本机 `dsh --help` 为准」） |
| 21 | Python 依赖清单 | `python-runtime.ts` 的 `defaultRequirements()` = `numpy>=1.26` / `pillow>=10.0` / `opencv-python-headless>=4.9` | 一致。**注意**：`PROJECT-STRUCTURE.md` 提到的 `python/requirements.txt` 当前在磁盘上**不存在**，`readRequirements()` 会回落为上述内置清单 |
| 22 | 沙盒白名单语义 | `sandbox.ts`：`realpath` + `path.relative` + 空白名单 fail-closed | 一致 |
| 23 | 上传 MIME 白名单 | `MEDIA_TYPE_ALLOWLIST` | 一致，10 项逐条列出 |
| 24 | 密钥引用格式 | `plugin.json` `permissions.secrets.refPattern`；`credentials.ts` `defaultKeyRef()` | 一致：`VISION_NEXUS_{BACKEND_ID}_API_KEY` |
| 25 | 前端源码扩展名 | `src/client/tabs/*.ts`、`src/client/ui/*.ts`（非 `.tsx`） | 一致（README 的仓库结构按实际路径描述） |

> 未核实项：DSH CLI 的具体子命令与输出格式随版本变化，`dsh plugin ...` 的写法取自本仓库 `cordis.patch.yml`，请以本机 `dsh --help` 为准；`lib/client.js` 的产物体积等构建期数字未在本文档中给出。

---

## 相关链接

- [English README](README.en.md)
- [项目结构与文件职责](PROJECT-STRUCTURE.md)
- [更新日志](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [插件清单](plugin.json)
- 问题反馈：[GitHub Issues](https://github.com/Lonis89/dsh-vision-nexus/issues)
