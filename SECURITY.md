# 安全策略

## 支持的版本

只对最新发布版本提供安全修复。

| 版本 | 是否支持 |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## 报告漏洞

**请不要通过公开 issue 报告安全漏洞。**

请使用 GitHub 的私密报告渠道：

<https://github.com/Lonis89/dsh-vision-nexus/security/advisories/new>

报告时请尽量包含：

- 受影响的版本与操作系统
- 复现步骤或最小验证样例
- 影响范围（例如：能否绕过目录白名单、能否读到凭据）
- 你建议的修复方向（可选）

我们会尽快确认并回复；修复发布后会在 advisory 里致谢（除非你希望匿名）。

## 本插件的安全模型

理解下面几条有助于判断某个行为是否**属于**漏洞：

1. **密钥永不落盘明文。**
   `BackendSpec.apiKeyRef` 只存引用名（形如 `VISION_NEXUS_<ID>_API_KEY`），
   实际值经 DSH 的 `ctx.credentials` 读写。配置文件里不存在明文密钥。

2. **导出即脱敏。**
   配置导出会经过 `redact.ts`，`sk-` 前缀、Bearer 头、长随机串统一替换为 `***`。

3. **文件访问受白名单约束。**
   只有 `directoryAllowlist` 内的目录允许读写；空白名单 = 拒绝一切磁盘访问。
   路径解析会先 `realpath` 再比对，`..` 与符号链接逃逸都会失败。

4. **出站请求受限制。**
   强制超时、禁止跟随重定向、响应体上限 32MB，避免被恶意服务端拖死。

5. **不向第三方上报数据。**
   `plugin.json` 里 `telemetry.localOnly = true`。指标、链路、日志只落在
   `$DSH_HOME` 下的本地目录。

6. **日志脱敏。**
   写入前统一过 `redactText` / `redactValue`，包含环引用保护。

### 常见误区（这些不算漏洞）

- **能在配置里看到后端地址与模型名**——设计如此，它们不是机密。
- **Agent 能调用视觉工具**——这是插件存在的目的；限制请用
  `agentAllowlist`，非空时只放行名单内会话。
- **本地 Python 运行时被执行**——这是显式启用的增强能力，
  默认 `python.enabled` 可关闭；脚本由插件自带，不接受外部任意代码。

## 依赖安全

本项目**零第三方运行时依赖**（只有 `@deepseek-ai/schemastery`，由 DSH 宿主提供）。
测试与构建脚本只用 Node 内置模块，因此不存在常见的 npm 供应链面。
前端的 React / Tailwind / shadcn / react-flow / ECharts 全部是
`devDependencies` / `peerDependencies`，不进入发布产物。
