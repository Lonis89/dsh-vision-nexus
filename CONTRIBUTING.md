# 参与贡献

感谢你愿意花时间改进 dsh-vision-nexus。

## 开发环境

| 要求 | 版本 |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>= 0.2.1-rc.5`（仅运行插件时需要） |

本项目**零第三方运行时依赖**，克隆后不需要 `npm install` 就能构建与测试。
只有跑类型检查或前端工具链时才需要装开发依赖（见 README「开发与测试」）。

### Windows 用户先做这一步

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001
```

否则中文测试日志会变成乱码。详见 README 的「Windows 开发前置命令」。

## 常用命令

```bash
npm run test                # 后端 + 前端 + 边界，全套
npm run test:backend        # 仅后端
npm run test:frontend       # 仅前端
npm run test:boundaries     # 仅边界隔离
node scripts/build.mjs      # 生成 lib/
node scripts/check-package.mjs
```

提交前请确保 `npm run test` 与 `node scripts/check-package.mjs` 都通过——CI 会跑同样的检查。

## 代码边界（重要）

项目分三层，**边界是硬约束**，由 `scripts/check-boundaries.mjs` 在测试中强制执行：

| 层 | 目录 | 可以依赖 | 禁止 |
| --- | --- | --- | --- |
| 后端插件逻辑 | `src/host/**`、`src/shared/**`、`src/index.ts` | Node 内置、`@deepseek-ai/schemastery` | `src/client/**`、react、任何前端库 |
| 前端代码 | `src/client/**` | react、react-dom、`src/shared` 的类型 | `src/host/**` 的运行时实现 |
| 后端测试脚本 | `scripts/*.mjs`（除前端专用） | 仅 `src/shared/**`、`src/host/**` | react、`src/client` 下的 hooks / 组件 |

违反边界的后果不是"风格问题"：后端脚本一旦加载了带 `import 'react'` 的模块，
在只装后端依赖的环境里会直接抛 `ERR_MODULE_NOT_FOUND`。

需要共享纯逻辑时，把它放到 `src/shared/`，而不是从后端反向 import 前端。

## 新增脚本必须带 UTF-8 引导

`scripts/` 下每个会打印中文的脚本，顶部都要有：

```js
import { bootstrapConsole } from './lib/utf8.mjs'

bootstrapConsole()
```

`check-boundaries.mjs` 会扫描全部 `.mjs`，漏了就直接失败。只有 `scripts/lib/**`
和纯 ESM loader 钩子豁免。

## 提交规范

提交信息用 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

```
<type>(<scope>): <subject>

<body>
```

常见 type：`feat`、`fix`、`refactor`、`docs`、`test`、`build`、`chore`。
scope 用模块名，例如 `scheduler`、`client`、`scripts`。

示例：

```
fix(scripts): 强制 stdout 为 UTF-8，修复 Windows 中文日志乱码

Windows 控制台默认 GBK，与 Node 的 UTF-8 输出不一致。
改为在 scripts/lib/utf8.mjs 统一 bootstrap。
```

## 提交 PR

1. Fork 并从 `main` 切出分支
2. 改动后跑通全部检查
3. 填写 PR 模板里的自检清单
4. 说明"如何验证"——附命令或操作步骤

## 报告问题

- Bug：用 [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) 模板
- 新功能：用 [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml) 模板
- 安全漏洞：**不要开公开 issue**，见 [SECURITY.md](SECURITY.md)

## 许可证

提交贡献即表示你同意以 [Apache License 2.0](LICENSE) 授权你的改动。
