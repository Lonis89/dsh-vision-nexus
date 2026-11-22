window.__ModuleLoader__.load({
	id: "dsh-vision-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		// src/client/settingsModel.ts
		/**
		* dsh-vision-nexus — 设置面板的数据模型（Client 侧）
		*
		* 与 Host 侧 `config.ts` 的 DEFAULTS / resolveConfig 保持同一套字段与默认值。
		* 这里只负责：字段元数据（供表单渲染）、实时校验、导入/导出脱敏、
		* 以及「重置为默认」的纯值构造。表单读写一律走 DSH 设置表单 scope。
		*
		* 注意：本文件不得包含任何 API Key 明文；后端条目里的 `keyRef` 只是引用名。
		*/
		const DEFAULTS = {
			enabled: true,
			runMode: "auto",
			loadingStrategy: "progressive",
			autoTileEnabled: true,
			oversizeEdgePx: 1600,
			pythonPath: "",
			cvRuntimePath: "",
			localCvEnabled: true,
			browserRenderEnabled: true,
			vlBackends: [],
			builtinVlEnabled: false,
			builtinVlKeyRef: "",
			builtinVlBaseURL: "",
			builtinVlModel: "gpt-4o-mini",
			wasmOcrEnabled: true,
			ocrLanguage: "mix",
			sessionConcurrency: 1,
			taskTimeoutMs: 3e4,
			maxQueueLength: 32,
			confidenceAlertThreshold: .6,
			degradeNotifyAgent: true,
			retentionPreset: "24h",
			tempRetentionMs: 864e5,
			cleanupIntervalMs: 18e5,
			autoCleanupEnabled: true,
			autoSaveArtifacts: true,
			tileEdgePx: 768,
			preprocessMaxEdgePx: 1280,
			preprocessQuality: 82,
			persistSessionState: true,
			auditSeparate: true,
			auditMaxEntries: 500,
			panelAllowedHosts: []
		};
		/** DEFAULTS 中按「字符串数组」处理的字段（区别于 vlBackends 的对象数组）。 */
		const STRING_ARRAY_KEYS = /* @__PURE__ */ new Set(["panelAllowedHosts"]);
		/** 从 scope 的 value 构造完整草稿（缺字段补默认值）。 */
		function draftFrom(value) {
			const v = value ?? {};
			const draft = {};
			for (const [k, def] of Object.entries(DEFAULTS)) {
				const raw = v[k];
				if (raw === void 0 || raw === null) draft[k] = cloneDefault(def);
				else if (STRING_ARRAY_KEYS.has(k)) draft[k] = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
				else if (Array.isArray(def)) draft[k] = Array.isArray(raw) ? raw.map(normalizeRow) : [];
				else if (typeof def === "number") draft[k] = typeof raw === "number" && Number.isFinite(raw) ? raw : def;
				else if (typeof def === "boolean") draft[k] = typeof raw === "boolean" ? raw : def;
				else draft[k] = typeof raw === "string" ? raw : def;
			}
			return draft;
		}
		function cloneDefault(def) {
			if (Array.isArray(def)) return [];
			return def;
		}
		function normalizeRow(raw) {
			const r = raw ?? {};
			return {
				id: typeof r.id === "string" && r.id ? r.id : `vl-${Math.random().toString(36).slice(2, 8)}`,
				label: typeof r.label === "string" ? r.label : "",
				baseURL: typeof r.baseURL === "string" ? r.baseURL : "",
				keyRef: typeof r.keyRef === "string" ? r.keyRef : "",
				model: typeof r.model === "string" ? r.model : "",
				maxImageEdgePx: typeof r.maxImageEdgePx === "number" ? r.maxImageEdgePx : 2048,
				enabled: r.enabled !== false
			};
		}
		function newBackendRow(existing) {
			let n = existing.length + 1;
			let id = `vl-${n}`;
			while (existing.some((b) => b.id === id)) {
				n++;
				id = `vl-${n}`;
			}
			return {
				id,
				label: `后端 ${n}`,
				baseURL: "",
				keyRef: "",
				model: "",
				maxImageEdgePx: 2048,
				enabled: true
			};
		}
		/**
		* 实时校验：非法输入立即在对应控件下方标红，且阻止写回 scope。
		* 规则与 Host 侧 resolveConfig 的钳制区间保持一致。
		*/
		function validate(draft) {
			const errors = {};
			const numRange = (key, lo, hi, label) => {
				const v = draft[key];
				if (typeof v !== "number" || !Number.isFinite(v)) {
					errors[key] = `${label}必须是数字`;
					return;
				}
				if (v < lo || v > hi) errors[key] = `${label}需在 ${lo}~${hi} 之间`;
			};
			numRange("oversizeEdgePx", 512, 16384, "长边阈值");
			numRange("sessionConcurrency", 1, 5, "并发数");
			numRange("taskTimeoutMs", 1e3, 36e5, "超时(ms)");
			numRange("maxQueueLength", 1, 512, "队列长度");
			numRange("tileEdgePx", 256, 2048, "分块边长");
			numRange("preprocessMaxEdgePx", 256, 4096, "压缩最长边");
			numRange("preprocessQuality", 1, 100, "压缩质量");
			numRange("confidenceAlertThreshold", 0, 1, "置信度阈值");
			numRange("auditMaxEntries", 10, 1e4, "审计条数");
			numRange("cleanupIntervalMs", 1e4, 864e5, "清理周期");
			const hosts = draft.panelAllowedHosts;
			if (Array.isArray(hosts)) {
				const cleaned = hosts.filter((x) => typeof x === "string").flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
				if (cleaned.length > 64) errors.panelAllowedHosts = "Host 白名单最多 64 项";
				else if (cleaned.some((h) => /[\s/]/.test(h))) errors.panelAllowedHosts = "每个 Host 不能含空白或斜杠";
			} else errors.panelAllowedHosts = "Host 白名单格式非法";
			const rows = draft.vlBackends;
			if (Array.isArray(rows)) rows.forEach((row, i) => {
				if (row.enabled && !/^https?:\/\//.test(row.baseURL.trim())) errors[`vlBackends.${i}.baseURL`] = "接口地址需以 http(s):// 开头";
				if (row.enabled && !row.model.trim()) errors[`vlBackends.${i}.model`] = "启用状态需填写模型名称";
				const edge = row.maxImageEdgePx;
				if (!Number.isFinite(edge) || edge < 256 || edge > 8192) errors[`vlBackends.${i}.maxImageEdgePx`] = "最大图片尺寸需在 256~8192";
			});
			return {
				errors,
				valid: Object.keys(errors).length === 0
			};
		}
		/** 计算需要写回的字段差异（只写真正改过的字段，减少写放大）。 */
		function diffFields(draft, served) {
			const out = [];
			const base = draftFrom(served);
			for (const key of Object.keys(DEFAULTS)) if (JSON.stringify(base[key]) !== JSON.stringify(draft[key])) out.push([key, draft[key]]);
			return out;
		}
		/** 导出：生成脱敏 JSON 文本（配置里本就只有 keyRef，额外抹掉疑似密钥字段）。 */
		function exportConfigText(draft) {
			const clone = JSON.parse(JSON.stringify(draft));
			const rows = clone.vlBackends;
			if (Array.isArray(rows)) clone.vlBackends = rows.map((r) => {
				const c = { ...r };
				for (const k of Object.keys(c)) if (/apiKey|token|secret|password/i.test(k)) delete c[k];
				return c;
			});
			return JSON.stringify({
				_plugin: "dsh-vision-nexus",
				_version: 1,
				_notice: "导出内容不含 API Key 明文；凭据请在目标机器通过凭证服务重新登记 keyRef。",
				config: clone
			}, null, 2);
		}
		/** 导入：解析并校验 JSON，返回归一化草稿；失败给出可读错误。 */
		function parseImport(text) {
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				return {
					ok: false,
					error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`
				};
			}
			const payload = parsed;
			const part = payload && typeof payload === "object" && "config" in payload ? payload.config : payload;
			if (!part || typeof part !== "object") return {
				ok: false,
				error: "JSON 中未找到配置对象"
			};
			const draft = draftFrom(part);
			const check = validate(draft);
			if (!check.valid) return {
				ok: false,
				error: `导入配置存在非法值：${Object.values(check.errors)[0]}`
			};
			return {
				ok: true,
				draft,
				notice: "导入成功：明文 API Key 不会随 JSON 迁移，请在目标机器通过凭证服务重新登记各后端的 keyRef。"
			};
		}
		/** 枚举选项（value/label），贴合面板文案。 */
		const OPTIONS = {
			runMode: [
				{
					value: "auto",
					label: "自动自适应（推荐）"
				},
				{
					value: "local-only",
					label: "仅本地CV引擎模式"
				},
				{
					value: "remote-only",
					label: "仅远端VL路由模式"
				}
			],
			loadingStrategy: [{
				value: "progressive",
				label: "渐进按需激活（默认）"
			}, {
				value: "eager",
				label: "会话启动全量注册工具"
			}],
			ocrLanguage: [
				{
					value: "zh",
					label: "中文"
				},
				{
					value: "en",
					label: "英文"
				},
				{
					value: "mix",
					label: "中英混合"
				}
			],
			retentionPreset: [
				{
					value: "1h",
					label: "1 小时"
				},
				{
					value: "6h",
					label: "6 小时"
				},
				{
					value: "24h",
					label: "24 小时"
				},
				{
					value: "72h",
					label: "3 天"
				},
				{
					value: "7d",
					label: "7 天"
				},
				{
					value: "never",
					label: "永不清理"
				}
			]
		};
		/** 保留档位 → 毫秒。 */
		const RETENTION_MS = {
			"1h": 36e5,
			"6h": 216e5,
			"24h": 864e5,
			"72h": 2592e5,
			"7d": 6048e5,
			never: 0
		};
		// src/client/panel.tsx
		/**
		* dsh-vision-nexus — 设置面板主体（DSH 原生风格表单）
		*
		* 六大分区：运行模式总开关 / 引擎配置区 / 工具调度策略 / 任务限流与超时 /
		* 产物与存储 / 健康自检面板，外加辅助按钮（重置 / 导出 / 导入）。
		*
		* 实现约定（与 DSH 原生设置 UI 一致）：
		*  - 不写 JSX：用 `React.createElement`（Dynamic Client 暴露 React 运行时，
		*    tsdown 打包时也能用 jsx-runtime；这里统一用 h() 保证两种载体都可用）。
		*  - 配置读写走 `scope`：getSnapshot()/subscribe()/set(field, value)；
		*    字段级写入 + 实时校验，非法输入标红且不写回。
		*  - 修改后 scope 写入即热生效（Host 侧 Config 全字段 volatile）。
		*  - 状态自检 / 连通性探测 / 导出走同源 HTTP 路由（hostRoutes）。
		*  - 样式只用 DSH 主题变量，自动适配浅色/深色。
		*/
		function createSettingsPanel(deps) {
			const R = deps.React;
			const h = R.createElement.bind(R);
			const { useState, useEffect, useRef, useMemo } = R;
			const cx = (...parts) => parts.filter(Boolean).join(" ");
			const Row = (props) => h("div", { className: cx("vnx-row", props.block && "block") }, h("div", { className: "vnx-label" }, h("b", null, props.label), props.hint ? h("span", { className: "vnx-hint" }, props.hint) : null), h("div", { className: "vnx-control" }, props.children, props.error ? h("span", { className: "vnx-error" }, props.error) : null));
			const Toggle = (props) => h("input", {
				type: "checkbox",
				className: "vnx-toggle",
				checked: props.checked,
				"aria-label": props.label,
				onChange: (e) => props.onChange(Boolean(e?.target?.checked))
			});
			const TextField = (props) => h("input", {
				type: props.type ?? "text",
				className: cx("vnx-input", props.small && "small", props.invalid && "invalid"),
				value: props.value,
				placeholder: props.placeholder ?? "",
				disabled: props.disabled,
				onChange: (e) => props.onChange(String(e?.target?.value ?? ""))
			});
			const NumberField = (props) => h("input", {
				type: "number",
				className: cx("vnx-input", props.small && "small", props.invalid && "invalid"),
				value: String(props.value),
				min: props.min,
				max: props.max,
				step: props.step ?? 1,
				disabled: props.disabled,
				onChange: (e) => {
					const raw = e?.target?.value ?? "";
					const n = raw === "" ? NaN : Number(raw);
					props.onChange(n);
				}
			});
			const SelectField = (props) => h("select", {
				className: "vnx-select",
				value: props.value,
				onChange: (e) => props.onChange(String(e?.target?.value ?? ""))
			}, ...props.options.map((o) => h("option", {
				key: o.value,
				value: o.value
			}, o.label)));
			const RadioGroup = (props) => h("div", { className: "vnx-radio-group" }, ...props.options.map((o) => h("label", {
				key: o.value,
				className: cx("vnx-radio", props.value === o.value && "active")
			}, h("input", {
				type: "radio",
				name: props.name,
				value: o.value,
				checked: props.value === o.value,
				onChange: () => props.onChange(o.value)
			}), o.label)));
			const Slider = (props) => h("div", { className: "vnx-slider-row" }, h("input", {
				type: "range",
				className: "vnx-slider",
				min: props.min,
				max: props.max,
				step: props.step ?? 1,
				value: props.value,
				onChange: (e) => props.onChange(Number(e?.target?.value ?? 0))
			}), h("span", { className: "vnx-slider-value" }, props.format ? props.format(props.value) : String(props.value)));
			const Btn = (props) => h("button", {
				type: "button",
				className: cx("vnx-btn", props.kind === "primary" && "primary", props.kind === "danger" && "danger", props.small && "small"),
				disabled: props.disabled,
				title: props.title,
				onClick: props.onClick
			}, props.children);
			const Badge = (props) => h("span", { className: cx("vnx-badge", props.state) }, h("span", { className: "vnx-dot" }), props.children);
			const BackendList = (props) => {
				const dragIndex = useRef(null);
				const [dragOver, setDragOver] = useState(null);
				const move = (from, to) => {
					if (from === to || from < 0 || to < 0) return;
					const next = [...props.rows];
					const [item] = next.splice(from, 1);
					if (item) next.splice(to, 0, item);
					props.onChange(next);
				};
				const patch = (i, key, value) => {
					const next = [...props.rows];
					next[i] = {
						...next[i],
						[key]: value
					};
					props.onChange(next);
				};
				return h("div", { className: "vnx-control" }, ...props.rows.length === 0 ? [h("div", {
					className: "vnx-notice info",
					key: "empty"
				}, "暂无 VL 后端。点击「添加后端」新增一条；数组顺序即优先级（靠前优先）。")] : props.rows.map((row, i) => h("div", {
					key: row.id,
					className: cx("vnx-backend", !row.enabled && "disabled"),
					draggable: true,
					onDragStart: () => {
						dragIndex.current = i;
					},
					onDragOver: (e) => {
						e?.preventDefault?.();
						setDragOver(i);
					},
					onDrop: (e) => {
						e?.preventDefault?.();
						if (dragIndex.current !== null) move(dragIndex.current, i);
						dragIndex.current = null;
						setDragOver(null);
					},
					onDragEnd: () => {
						dragIndex.current = null;
						setDragOver(null);
					},
					style: dragOver === i ? { borderColor: "var(--dsw-alias-brand-primary)" } : void 0
				}, h("div", { className: "vnx-backend-head" }, h("span", {
					className: "vnx-grip",
					title: "拖拽排序"
				}, "⠿"), h("span", { className: "vnx-backend-title" }, `${i + 1}. ${row.label || row.id}`), h("span", { className: "vnx-hint" }, row.enabled ? "启用" : "停用"), h(Toggle, {
					checked: row.enabled,
					label: "启用该后端",
					onChange: (v) => patch(i, "enabled", v)
				}), h(Btn, {
					small: true,
					onClick: () => props.onTest(row),
					disabled: props.testingId === row.id || !row.baseURL
				}, props.testingId === row.id ? "检测中…" : "连通性"), h(Btn, {
					small: true,
					kind: "danger",
					onClick: () => props.onChange(props.rows.filter((_, j) => j !== i))
				}, "删除")), h("div", { className: "vnx-backend-grid" }, h("div", { className: "vnx-field" }, h("label", null, "展示名"), h(TextField, {
					value: row.label,
					onChange: (v) => patch(i, "label", v),
					placeholder: "主 VL"
				})), h("div", { className: "vnx-field" }, h("label", null, "接口地址 baseURL"), h(TextField, {
					value: row.baseURL,
					onChange: (v) => patch(i, "baseURL", v),
					placeholder: "https://api.example.com/v1",
					invalid: Boolean(props.errors[`vlBackends.${i}.baseURL`])
				}), props.errors[`vlBackends.${i}.baseURL`] ? h("span", { className: "vnx-error" }, props.errors[`vlBackends.${i}.baseURL`]) : null), h("div", { className: "vnx-field" }, h("label", null, "模型名称"), h(TextField, {
					value: row.model,
					onChange: (v) => patch(i, "model", v),
					placeholder: "gpt-4o-mini",
					invalid: Boolean(props.errors[`vlBackends.${i}.model`])
				}), props.errors[`vlBackends.${i}.model`] ? h("span", { className: "vnx-error" }, props.errors[`vlBackends.${i}.model`]) : null), h("div", { className: "vnx-field" }, h("label", null, "凭据引用名 keyRef（明文密钥由凭证服务保管）"), h(TextField, {
					value: row.keyRef,
					onChange: (v) => patch(i, "keyRef", v),
					placeholder: "DSH_VISION_NEXUS_VL_1_KEY"
				})), h("div", { className: "vnx-field" }, h("label", null, "最大图片尺寸(px)"), h(NumberField, {
					value: row.maxImageEdgePx,
					min: 256,
					max: 8192,
					step: 64,
					onChange: (v) => patch(i, "maxImageEdgePx", v),
					invalid: Boolean(props.errors[`vlBackends.${i}.maxImageEdgePx`])
				}))))), h("div", {
					className: "vnx-btn-row",
					style: { marginTop: 8 }
				}, h(Btn, {
					small: true,
					onClick: () => props.onChange([...props.rows, newBackendRow(props.rows)])
				}, "+ 添加后端")));
			};
			const fetchJson = async (url, init) => {
				const res = await fetch(url, {
					method: init?.method,
					body: init?.body,
					signal: init?.signal,
					headers: { "Content-Type": "application/json" }
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			};
			const HealthSectionBody = (props) => {
				const [checking, setChecking] = useState(false);
				const [report, setReport] = useState(null);
				const [status, setStatus] = useState(null);
				const [statusErr, setStatusErr] = useState("");
				const loadStatus = async () => {
					try {
						setStatus(await fetchJson(deps.routes.status));
						setStatusErr("");
					} catch (e) {
						setStatusErr(`状态获取失败：${e instanceof Error ? e.message : String(e)}`);
					}
				};
				useEffect(() => {
					loadStatus();
					const timer = window.setInterval(() => void loadStatus(), 15e3);
					return () => window.clearInterval(timer);
				}, []);
				const runCheck = async () => {
					setChecking(true);
					try {
						const r = await fetchJson(deps.routes.health);
						setReport(r);
						props.onNotice(r.ok ? "自检完成：全部正常" : `自检完成：存在 ${r.items.filter((i) => i.state !== "ok").length} 个待处理项`, r.ok ? "ok" : "warn");
						loadStatus();
					} catch (e) {
						props.onNotice(`自检失败：${e instanceof Error ? e.message : String(e)}`, "error");
					} finally {
						setChecking(false);
					}
				};
				return h("div", { className: "vnx-section-body" }, h(Row, {
					label: "一键自检",
					block: true,
					hint: "依次检测 Python 环境、浏览器渲染能力、远端后端连通性、WASM OCR 加载状态与配置合法性。"
				}, h("div", { className: "vnx-btn-row" }, h(Btn, {
					kind: "primary",
					onClick: runCheck,
					disabled: checking
				}, checking ? "检测中…" : "运行健康自检"), h(Btn, {
					small: true,
					onClick: () => void loadStatus()
				}, "刷新状态")), report ? h("div", {
					className: "vnx-health-list",
					style: { marginTop: 8 }
				}, ...report.items.map((it) => h("div", {
					key: it.key,
					className: "vnx-health-item"
				}, h("div", { className: "vnx-health-line" }, h(Badge, { state: it.state }, it.state === "ok" ? "正常" : it.state === "warn" ? "警告" : "异常"), h("span", { className: "vnx-health-name" }, it.label)), h("div", { className: "vnx-health-detail" }, it.detail), it.fix ? h("div", { className: "vnx-health-fix" }, `修复指引：${it.fix}`) : null))) : h("div", { className: "vnx-notice info" }, "尚未运行自检。点击「运行健康自检」查看各项状态。")), h(Row, {
					label: "当前运行状态",
					block: true,
					hint: "实时展示激活引擎、已注册工具、队列等待与今日调用统计（每 15 秒自动刷新）。"
				}, statusErr ? h("div", { className: "vnx-notice error" }, statusErr) : null, h("div", { className: "vnx-stats" }, h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "插件状态"), h("span", { className: "vnx-stat-value" }, status ? status.pluginEnabled ? "已启用" : "已禁用" : "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "当前激活引擎"), h("span", {
					className: "vnx-stat-value",
					style: { fontSize: 12 }
				}, status?.activeEngine ?? "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "队列中等待"), h("span", { className: "vnx-stat-value" }, status ? String(status.queuedTasks) : "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "运行中任务"), h("span", { className: "vnx-stat-value" }, status ? String(status.runningTasks) : "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "今日调用"), h("span", { className: "vnx-stat-value" }, status ? String(status.todayCalls) : "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "今日降级"), h("span", { className: "vnx-stat-value" }, status ? String(status.todayDegrades) : "—")), h("div", { className: "vnx-stat" }, h("span", { className: "vnx-stat-label" }, "平均置信度"), h("span", { className: "vnx-stat-value" }, status ? status.avgConfidence.toFixed(2) : "—"))), status ? h("div", { style: { marginTop: 10 } }, h("div", {
					className: "vnx-hint",
					style: { marginBottom: 6 }
				}, `已注册工具清单（${status.registeredTools.length}）：`), h("div", { className: "vnx-tools" }, ...status.registeredTools.length ? status.registeredTools.map((t) => h("span", {
					key: t,
					className: "vnx-tool-chip"
				}, t)) : [h("span", {
					key: "none",
					className: "vnx-hint"
				}, "未注册（渐进模式待激活，或总开关关闭）")])) : null));
			};
			const Section = (props) => {
				const [open, setOpen] = useState(props.defaultOpen !== false);
				return h("section", { className: cx("vnx-section", !open && "collapsed") }, h("button", {
					type: "button",
					className: "vnx-section-header",
					"aria-expanded": open,
					onClick: () => setOpen(!open)
				}, h("span", { className: "vnx-section-title" }, h("span", { className: "vnx-section-index" }, String(props.index)), props.title), h("span", { className: cx("vnx-section-chevron", open && "open") }, "›")), h("div", { className: "vnx-section-body" }, props.children));
			};
			return function VisionNexusSettingsPanel(props) {
				const [snapshot, setSnapshot] = useState(() => deps.scope.getSnapshot());
				const [draft, setDraft] = useState(() => draftFrom(deps.scope.getSnapshot().value));
				const [saveState, setSaveState] = useState({
					text: "",
					kind: ""
				});
				const [notice, setNotice] = useState(null);
				const [showImport, setShowImport] = useState(false);
				const [importText, setImportText] = useState("");
				const [testingId, setTestingId] = useState("");
				const [probeMsg, setProbeMsg] = useState("");
				const dirtyRef = useRef(false);
				useEffect(() => {
					const sync = () => {
						const snap = deps.scope.getSnapshot();
						setSnapshot(snap);
						if (!dirtyRef.current) setDraft(draftFrom(snap.value));
					};
					const unsub = deps.scope.subscribe(sync);
					sync();
					return unsub;
				}, []);
				const validation = useMemo(() => validate(draft), [draft]);
				const writable = snapshot.writable !== false && snapshot.status !== "unavailable";
				/** 修改一个字段：立即本地更新 + 实时校验，合法才写回 scope（热生效）。 */
				const patch = (key, value) => {
					const next = {
						...draft,
						[key]: value
					};
					setDraft(next);
					dirtyRef.current = true;
					const check = validate(next);
					const fieldError = Object.entries(check.errors).find(([k]) => k === key || k.startsWith(`${key}.`));
					if (fieldError) {
						setSaveState({
							text: `「${fieldError[0]}」输入非法，未保存：${fieldError[1]}`,
							kind: "error"
						});
						return;
					}
					if (!writable) {
						setSaveState({
							text: "当前设置为只读（配置源未开放写入）",
							kind: "error"
						});
						return;
					}
					(async () => {
						try {
							if (await deps.scope.set(key, value) === false) throw new Error("设置源拒绝写入");
							if (key === "retentionPreset") {
								const ms = RETENTION_MS[String(value)] ?? 864e5;
								await deps.scope.set("tempRetentionMs", ms);
							}
							dirtyRef.current = false;
							setSaveState({
								text: "已保存并热生效",
								kind: "ok"
							});
						} catch (e) {
							setSaveState({
								text: `保存失败：${e instanceof Error ? e.message : String(e)}`,
								kind: "error"
							});
						}
					})();
				};
				/** 保存全部改动（用于后端列表 / 批量导入等一次性写入多字段）。 */
				const saveAll = async (next, successText) => {
					const check = validate(next);
					if (!check.valid) {
						setSaveState({
							text: `存在非法输入，未保存：${Object.values(check.errors)[0]}`,
							kind: "error"
						});
						return;
					}
					if (!writable) {
						setSaveState({
							text: "当前设置为只读",
							kind: "error"
						});
						return;
					}
					setDraft(next);
					try {
						const served = deps.scope.getSnapshot().value;
						const fields = diffFields(next, served);
						for (const [k, v] of fields) if (await deps.scope.set(k, v) === false) throw new Error(`字段 ${k} 被拒绝`);
						dirtyRef.current = false;
						setSaveState({
							text: successText,
							kind: "ok"
						});
					} catch (e) {
						setSaveState({
							text: `保存失败：${e instanceof Error ? e.message : String(e)}`,
							kind: "error"
						});
					}
				};
				const setField = (key) => (v) => patch(key, v);
				const doReset = () => {
					const next = draftFrom({});
					setNotice({
						text: "已重置为默认配置（明文凭据需重新登记）",
						kind: "ok"
					});
					saveAll(next, "已重置为默认并热生效");
				};
				const doExport = async () => {
					const text = exportConfigText(draft);
					const fallback = (reason) => {
						setImportText(text);
						setShowImport(true);
						setNotice({
							text: `剪贴板不可用（${reason}），已把导出内容放入下方文本框，请手动复制`,
							kind: "warn"
						});
					};
					try {
						const clipboard = navigator.clipboard;
						if (!clipboard || typeof clipboard.writeText !== "function") {
							fallback("当前环境未开放 Clipboard API");
							return;
						}
						await clipboard.writeText(text);
						setNotice({
							text: "配置 JSON 已复制到剪贴板（不含明文密钥）",
							kind: "ok"
						});
					} catch (e) {
						fallback(e instanceof Error ? e.message : String(e));
					}
				};
				const doImport = () => {
					const parsed = parseImport(importText);
					if (!parsed.ok || !parsed.draft) {
						setNotice({
							text: parsed.error ?? "导入失败",
							kind: "error"
						});
						return;
					}
					setNotice({
						text: parsed.notice ?? "导入成功",
						kind: "ok"
					});
					setShowImport(false);
					saveAll(parsed.draft, "导入的配置已保存并热生效");
				};
				const probePython = async () => {
					setProbeMsg("检测中…");
					try {
						const r = await fetchJson(deps.routes.probePython, {
							method: "POST",
							body: "{}"
						});
						setProbeMsg(r.found ? `已检测到 ${r.path}${r.runtimeOk ? "，CV 运行时可用" : "，但 cv_worker 探测失败"}` : "未检测到 Python，请安装或填写解释器路径");
					} catch (e) {
						setProbeMsg(`检测失败：${e instanceof Error ? e.message : String(e)}`);
					}
				};
				const probeBrowser = async () => {
					setProbeMsg("检测中…");
					try {
						const r = await fetchJson(deps.routes.probeBrowser, {
							method: "POST",
							body: "{}"
						});
						setProbeMsg(r.available ? `渲染内核可用：${r.name}` : "未检测到浏览器渲染内核，可安装 playwright/chromium");
					} catch (e) {
						setProbeMsg(`检测失败：${e instanceof Error ? e.message : String(e)}`);
					}
				};
				const testBackend = async (row) => {
					setTestingId(row.id);
					try {
						const r = await fetchJson(deps.routes.testVl, {
							method: "POST",
							body: JSON.stringify({
								baseURL: row.baseURL,
								model: row.model,
								keyRef: row.keyRef
							})
						});
						setNotice({
							text: `${row.label || row.id}：${r.ok ? "连通正常" : "不可达"} — ${r.detail}`,
							kind: r.ok ? "ok" : "warn"
						});
					} catch (e) {
						setNotice({
							text: `连通性检测失败：${e instanceof Error ? e.message : String(e)}`,
							kind: "error"
						});
					} finally {
						setTestingId("");
					}
				};
				const num = (k) => typeof draft[k] === "number" ? draft[k] : 0;
				const str = (k) => typeof draft[k] === "string" ? draft[k] : "";
				const bool = (k) => draft[k] === true;
				const rows = () => Array.isArray(draft.vlBackends) ? draft.vlBackends : [];
				const hostList = () => Array.isArray(draft.panelAllowedHosts) ? draft.panelAllowedHosts.filter((x) => typeof x === "string") : [];
				/** 逗号分隔文本 → 字符串数组写回；空串=清空白名单（恢复默认同源校验）。 */
				const setHostList = (v) => patch("panelAllowedHosts", v.split(",").map((s) => s.trim()).filter(Boolean));
				if (props?.view === "summary") {
					const on = bool("enabled");
					const strategy = str("loadingStrategy") === "progressive" ? "渐进激活" : "全量预加载";
					const backends = rows().length;
					return h("div", { className: "vnx-panel-summary" }, h("span", { className: cx("vnx-badge", on ? "ok" : "warn") }, h("span", { className: "vnx-dot" }), on ? "已启用" : "已停用"), h("span", { className: "vnx-hint" }, `${strategy} · VL 后端 ${backends} 个 · 本地 CV ${bool("localCvEnabled") ? "开" : "关"}`));
				}
				return h("div", { className: "vnx-panel" }, h("div", { className: "vnx-toolbar" }, h("div", { className: "vnx-btn-row" }, h(Btn, {
					small: true,
					onClick: doReset,
					title: "恢复全部默认参数"
				}, "重置为默认配置"), h(Btn, {
					small: true,
					onClick: doExport,
					title: "导出脱敏配置 JSON"
				}, "导出配置 JSON"), h(Btn, {
					small: true,
					onClick: () => {
						setShowImport(!showImport);
						setImportText("");
					}
				}, "导入配置 JSON")), h("span", { className: cx("vnx-save-state", saveState.kind) }, !validation.valid ? `${Object.keys(validation.errors).length} 处输入待修正` : saveState.text || (writable ? "配置自动保存并热生效" : "只读模式"))), snapshot.status === "unavailable" ? h("div", { className: "vnx-notice warn" }, "当前 DSH 版本未开放本插件的设置表单：下方显示的是默认参数（只读），不会写回。请通过 profile patch 配置，或升级到支持 configForms 的版本。") : null, notice ? h("div", { className: cx("vnx-notice", notice.kind) }, notice.text) : null, showImport ? h("div", { className: "vnx-section" }, h("div", {
					className: "vnx-section-header",
					style: { cursor: "default" }
				}, h("span", { className: "vnx-section-title" }, "粘贴配置 JSON")), h("div", { className: "vnx-section-body" }, h("textarea", {
					className: "vnx-import-area",
					value: importText,
					placeholder: "{\n  \"_plugin\": \"dsh-vision-nexus\",\n  \"config\": { ... }\n}",
					onChange: (e) => setImportText(String(e?.target?.value ?? ""))
				}), h("div", { className: "vnx-btn-row" }, h(Btn, {
					kind: "primary",
					small: true,
					onClick: doImport,
					disabled: !importText.trim()
				}, "校验并导入"), h(Btn, {
					small: true,
					onClick: () => setShowImport(false)
				}, "取消")))) : null, h(Section, {
					index: 1,
					title: "运行模式总开关"
				}, h(Row, {
					label: "启用视觉插件",
					hint: "关闭后不注册任何 vision_* 工具；引擎与面板自检仍保留。"
				}, h(Toggle, {
					checked: bool("enabled"),
					label: "启用视觉插件",
					onChange: setField("enabled")
				})), h(Row, {
					label: "运行模式",
					hint: "自动自适应按「本地CV → 自定义VL → 内置兜底 → WASM OCR」自动切换。"
				}, h(RadioGroup, {
					name: "vnx-runMode",
					value: str("runMode"),
					options: OPTIONS.runMode,
					onChange: setField("runMode")
				})), h(Row, {
					label: "工具加载策略",
					hint: "渐进按需激活可减少系统提示词 token 开销。"
				}, h(RadioGroup, {
					name: "vnx-loading",
					value: str("loadingStrategy"),
					options: OPTIONS.loadingStrategy,
					onChange: setField("loadingStrategy")
				})), h(Row, {
					label: "大图自动分块策略",
					hint: "超过长边阈值的图片自动分块采样，并建议分区裁剪，禁止一次性全图 glance。"
				}, h("div", { className: "vnx-control inline" }, h(Toggle, {
					checked: bool("autoTileEnabled"),
					label: "大图自动分块",
					onChange: setField("autoTileEnabled")
				}), h("span", { className: "vnx-hint" }, "长边阈值"), h(NumberField, {
					value: num("oversizeEdgePx"),
					min: 512,
					max: 16384,
					step: 64,
					small: true,
					onChange: setField("oversizeEdgePx"),
					invalid: Boolean(validation.errors.oversizeEdgePx)
				}), h("span", { className: "vnx-hint" }, "px"), validation.errors.oversizeEdgePx ? h("span", { className: "vnx-error" }, validation.errors.oversizeEdgePx) : null))), h(Section, {
					index: 2,
					title: "引擎配置区"
				}, h("div", {
					className: "vnx-hint",
					style: {
						padding: "8px 0 2px",
						fontWeight: 600
					}
				}, "引擎 A · 本地 CV 计算引擎"), h(Row, {
					label: "启用本地 CV 引擎",
					hint: "检测失败时高亮提示，并自动禁用相关像素类工具（纯路由模式）。"
				}, h(Toggle, {
					checked: bool("localCvEnabled"),
					label: "启用本地 CV",
					onChange: setField("localCvEnabled")
				})), h(Row, {
					label: "Python 运行时路径",
					hint: "留空自动探测 python3 / python / py。"
				}, h("div", { className: "vnx-control inline" }, h(TextField, {
					value: str("pythonPath"),
					onChange: setField("pythonPath"),
					placeholder: "自动检测"
				}), h(Btn, {
					small: true,
					onClick: () => void probePython()
				}, "自动检测"))), probeMsg ? h("div", { className: "vnx-notice info" }, probeMsg) : null, h(Row, {
					label: "渲染截图依赖检测",
					hint: "检测浏览器内核（Playwright / Chromium），供 HTML 渲染截图使用。"
				}, h("div", { className: "vnx-control inline" }, h(Toggle, {
					checked: bool("browserRenderEnabled"),
					label: "启用渲染检测",
					onChange: setField("browserRenderEnabled")
				}), h(Btn, {
					small: true,
					onClick: () => void probeBrowser()
				}, "检测浏览器内核"))), h("div", {
					className: "vnx-hint",
					style: {
						padding: "12px 0 2px",
						fontWeight: 600,
						borderTop: "1px dashed var(--dsw-alias-border-l1)"
					}
				}, "引擎 B · 远端 VL 路由引擎"), h(Row, {
					label: "后端优先级列表",
					block: true,
					hint: "拖拽排序（数组顺序即优先级）。每条配置：接口地址 / API Key 引用名 / 模型名称 / 最大图片尺寸。明文密钥不在此处保存。"
				}, h(BackendList, {
					rows: rows(),
					onChange: (r) => patch("vlBackends", r),
					errors: validation.errors,
					onTest: (row) => void testBackend(row),
					testingId
				})), h(Row, {
					label: "内置匿名兜底 VL 服务",
					hint: "开启后作为自定义后端全失败后的次级兜底链路。"
				}, h(Toggle, {
					checked: bool("builtinVlEnabled"),
					label: "内置兜底 VL",
					onChange: setField("builtinVlEnabled")
				})), h(Row, {
					label: "内置兜底 VL 模型",
					hint: "可选：内置链路使用的模型名。"
				}, h(TextField, {
					value: str("builtinVlModel"),
					onChange: setField("builtinVlModel"),
					placeholder: "gpt-4o-mini"
				})), h(Row, {
					label: "WASM 本地 OCR 兜底",
					hint: "远端服务异常时自动降级的最终链路，离线可用、不中断会话。"
				}, h("div", { className: "vnx-control inline" }, h(Toggle, {
					checked: bool("wasmOcrEnabled"),
					label: "WASM OCR",
					onChange: setField("wasmOcrEnabled")
				}), h("span", { className: "vnx-hint" }, "OCR 识别语言"), h(SelectField, {
					value: str("ocrLanguage"),
					options: OPTIONS.ocrLanguage,
					onChange: setField("ocrLanguage")
				})))), h(Section, {
					index: 3,
					title: "工具调度策略"
				}, h(Row, {
					label: "单会话最大并发视觉任务数",
					hint: "串行优先；1~5。超过上限的任务进入队列等待。"
				}, h("div", { className: "vnx-control inline" }, h(NumberField, {
					value: num("sessionConcurrency"),
					min: 1,
					max: 5,
					small: true,
					onChange: setField("sessionConcurrency"),
					invalid: Boolean(validation.errors.sessionConcurrency)
				}), validation.errors.sessionConcurrency ? h("span", { className: "vnx-error" }, validation.errors.sessionConcurrency) : null)), h(Row, {
					label: "单任务超时时间（秒）",
					hint: "超时自动熔断并触发降级。"
				}, h("div", { className: "vnx-control inline" }, h(NumberField, {
					value: Math.round(num("taskTimeoutMs") / 1e3),
					min: 1,
					max: 3600,
					small: true,
					onChange: (v) => patch("taskTimeoutMs", Math.round(v * 1e3)),
					invalid: Boolean(validation.errors.taskTimeoutMs)
				}), h("span", { className: "vnx-hint" }, "秒"), validation.errors.taskTimeoutMs ? h("span", { className: "vnx-error" }, validation.errors.taskTimeoutMs) : null)), h(Row, {
					label: "等待队列最大长度",
					hint: "超出后新任务返回过载错误。"
				}, h(NumberField, {
					value: num("maxQueueLength"),
					min: 1,
					max: 512,
					small: true,
					onChange: setField("maxQueueLength"),
					invalid: Boolean(validation.errors.maxQueueLength)
				})), h(Row, {
					label: "置信度告警阈值",
					hint: "低于该置信度自动触发二次校验提醒。"
				}, h(Slider, {
					value: num("confidenceAlertThreshold"),
					min: 0,
					max: 1,
					step: .05,
					onChange: setField("confidenceAlertThreshold"),
					format: (v) => v.toFixed(2)
				})), h(Row, {
					label: "降级日志提示",
					hint: "降级发生时是否主动通知 Agent（写入 capabilityNotice）。"
				}, h(Toggle, {
					checked: bool("degradeNotifyAgent"),
					label: "降级通知",
					onChange: setField("degradeNotifyAgent")
				}))), h(Section, {
					index: 4,
					title: "任务限流与超时"
				}, h(Row, {
					label: "大图分块边长(px)",
					hint: "长图 / 大图分块采样的单块边长。"
				}, h(NumberField, {
					value: num("tileEdgePx"),
					min: 256,
					max: 2048,
					step: 64,
					small: true,
					onChange: setField("tileEdgePx"),
					invalid: Boolean(validation.errors.tileEdgePx)
				})), h(Row, {
					label: "压缩预处理最长边(px)",
					hint: "图片上传前统一降采样，降低 token / 带宽。"
				}, h(NumberField, {
					value: num("preprocessMaxEdgePx"),
					min: 256,
					max: 4096,
					step: 64,
					small: true,
					onChange: setField("preprocessMaxEdgePx"),
					invalid: Boolean(validation.errors.preprocessMaxEdgePx)
				})), h(Row, {
					label: "审计日志最大条数",
					hint: "每会话保留的审计记录上限。"
				}, h(NumberField, {
					value: num("auditMaxEntries"),
					min: 10,
					max: 1e4,
					step: 10,
					small: true,
					onChange: setField("auditMaxEntries"),
					invalid: Boolean(validation.errors.auditMaxEntries)
				})), h(Row, {
					label: "临时文件清理周期(ms)",
					hint: "定时清理任务的运行间隔。"
				}, h(NumberField, {
					value: num("cleanupIntervalMs"),
					min: 1e4,
					max: 864e5,
					step: 1e4,
					small: true,
					onChange: setField("cleanupIntervalMs"),
					invalid: Boolean(validation.errors.cleanupIntervalMs)
				})), h(Row, {
					label: "会话状态持久化",
					hint: "持久化图片索引 / 激活态，支持会话内反复引用 Artifact。"
				}, h(Toggle, {
					checked: bool("persistSessionState"),
					label: "持久化",
					onChange: setField("persistSessionState")
				})), h(Row, {
					label: "审计日志单独输出",
					hint: "审计信息不污染主回答。"
				}, h(Toggle, {
					checked: bool("auditSeparate"),
					label: "单独输出",
					onChange: setField("auditSeparate")
				})), h(Row, {
					label: "面板 Host 白名单",
					block: true,
					hint: "留空=沿用浏览器同源校验（默认，不改现有行为）；填写后仅允许列表内主机名访问设置路由，逗号分隔，如 127.0.0.1, localhost, [::1]。用于抵御 DNS rebinding；请填 DSH 面板实际访问主机名，填错会导致面板被拒绝，请谨慎。"
				}, h(TextField, {
					value: hostList().join(", "),
					onChange: setHostList,
					placeholder: "留空=同源校验；如 127.0.0.1, localhost",
					invalid: Boolean(validation.errors.panelAllowedHosts)
				}), validation.errors.panelAllowedHosts ? h("span", { className: "vnx-error" }, validation.errors.panelAllowedHosts) : null)), h(Section, {
					index: 5,
					title: "产物与存储"
				}, h(Row, {
					label: "Artifact 临时文件保留时长",
					hint: "超过时长的临时产物由定时清理任务删除。"
				}, h(SelectField, {
					value: str("retentionPreset"),
					options: OPTIONS.retentionPreset,
					onChange: setField("retentionPreset")
				})), h(Row, {
					label: "自动清理临时文件",
					hint: "关闭后临时文件将一直保留，直到手动清理。"
				}, h(Toggle, {
					checked: bool("autoCleanupEnabled"),
					label: "自动清理",
					onChange: setField("autoCleanupEnabled")
				})), h(Row, {
					label: "自动保存产物",
					hint: "自动注册 diff 热力图 / 裁剪子图 / SVG 矢量产物为 DSH Artifact。"
				}, h(Toggle, {
					checked: bool("autoSaveArtifacts"),
					label: "自动保存",
					onChange: setField("autoSaveArtifacts")
				})), h(Row, {
					label: "图片压缩质量",
					hint: "上传前压缩，降低 token；PNG 带 alpha 时保持 PNG。"
				}, h(Slider, {
					value: num("preprocessQuality"),
					min: 1,
					max: 100,
					step: 1,
					onChange: setField("preprocessQuality"),
					format: (v) => `${v}%`
				})), h(Row, {
					label: "CV 运行时脚本路径",
					hint: "留空使用插件内置的 runtime/cv_worker.py。"
				}, h(TextField, {
					value: str("cvRuntimePath"),
					onChange: setField("cvRuntimePath"),
					placeholder: "内置"
				}))), h(Section, {
					index: 6,
					title: "健康自检面板（实时）"
				}, h(HealthSectionBody, { onNotice: (text, kind) => setNotice({
					text,
					kind
				}) })));
			};
		}
		// src/client/styles.ts
		/**
		* dsh-vision-nexus — 设置面板样式（DSH 原生主题）
		*
		* 只使用 DSH 主题 CSS 变量（--dsw-alias-*），自动适配浅色 / 深色，不写死颜色。
		* 通过 `styles.insert(css)` 注入（Client 内置能力），随 Client run 自动清理。
		* 布局：表单控件对齐（label 列 + control 列）、卡片分区、紧凑提示文字。
		*/
		const PANEL_CSS = `
.vnx-panel{color:var(--dsw-alias-label-primary);font:inherit;display:flex;flex-direction:column;gap:16px;min-width:0;container:vnx-panel/inline-size}
.vnx-panel *{box-sizing:border-box}
.vnx-section{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;min-width:0}
.vnx-section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;user-select:none;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.vnx-section-header:hover{background:var(--dsw-alias-bg-layer-2)}
.vnx-section-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.vnx-section-index{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-section-chevron{font-size:12px;color:var(--dsw-alias-label-secondary);transition:transform .16s}
.vnx-section-chevron.open{transform:rotate(90deg)}
.vnx-section-body{display:flex;flex-direction:column;gap:2px;padding:6px 16px 14px}
.vnx-section.collapsed .vnx-section-body{display:none}
.vnx-row{display:grid;grid-template-columns:minmax(180px,42%) 1fr;gap:12px;align-items:start;padding:9px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.vnx-row:last-child{border-bottom:0}
.vnx-row.block{grid-template-columns:1fr}
.vnx-label{font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:3px;min-width:0}
.vnx-label b{font-weight:500}
.vnx-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
/* 插件详情页摘要位：只占一行，避免把整块表单塞进 summary 视图。 */
.vnx-panel-summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0}
.vnx-panel-summary .vnx-hint{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vnx-control{display:flex;flex-direction:column;gap:6px;min-width:0}
.vnx-control.inline{flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px}
.vnx-input,.vnx-select{appearance:none;color:inherit;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;min-height:32px;width:100%;max-width:340px}
.vnx-input:focus,.vnx-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vnx-input.small{max-width:120px}
.vnx-input.invalid{border-color:var(--dsw-alias-state-error-primary)}
.vnx-input[type=number]{font-variant-numeric:tabular-nums}
.vnx-select{cursor:pointer;max-width:260px}
.vnx-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.vnx-toggle{appearance:none;position:relative;width:38px;height:22px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;flex:none;transition:background .16s}
.vnx-toggle:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vnx-toggle::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .16s}
.vnx-toggle:checked::after{transform:translateX(16px);background:#fff}
.vnx-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.vnx-radio-group{display:flex;flex-wrap:wrap;gap:8px}
.vnx-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-2)}
.vnx-radio.active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.vnx-radio input{accent-color:var(--dsw-alias-brand-primary);margin:0}
.vnx-slider-row{display:flex;align-items:center;gap:10px;width:100%;max-width:340px}
.vnx-slider{flex:1;accent-color:var(--dsw-alias-brand-primary)}
.vnx-slider-value{font-variant-numeric:tabular-nums;font-size:12px;min-width:48px;text-align:right;color:var(--dsw-alias-label-secondary)}
.vnx-btn{appearance:none;color:inherit;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px;background:var(--dsw-alias-bg-layer-2);white-space:nowrap;transition:background .12s,border-color .12s}
.vnx-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-brand-primary)}
.vnx-btn:disabled{opacity:.5;cursor:default}
.vnx-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.vnx-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.vnx-btn.small{padding:3px 9px;font-size:11px}
.vnx-btn-row{display:flex;flex-wrap:wrap;gap:8px}
.vnx-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.vnx-badge.ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.vnx-badge.warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.vnx-badge.error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.vnx-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.vnx-backend{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}
.vnx-backend.disabled{opacity:.55}
.vnx-backend-head{display:flex;align-items:center;gap:8px}
.vnx-grip{cursor:grab;color:var(--dsw-alias-label-secondary);font-size:14px;user-select:none;touch-action:none}
.vnx-grip:active{cursor:grabbing}
.vnx-backend-title{font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vnx-backend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@container vnx-panel (max-width:520px){.vnx-backend-grid{grid-template-columns:1fr}.vnx-row{grid-template-columns:1fr}}
.vnx-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.vnx-field label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-field .vnx-input,.vnx-field .vnx-select{max-width:none;width:100%}
.vnx-health-list{display:flex;flex-direction:column;gap:8px}
.vnx-health-item{display:flex;flex-direction:column;gap:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 11px;background:var(--dsw-alias-bg-layer-2)}
.vnx-health-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vnx-health-name{font-size:13px;font-weight:500}
.vnx-health-detail{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.vnx-health-fix{font-size:11px;color:var(--dsw-alias-state-warn-primary);line-height:1.5}
.vnx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.vnx-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.vnx-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-stat-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.vnx-tools{display:flex;flex-wrap:wrap;gap:6px}
.vnx-tool-chip{font-size:11px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,monospace}
.vnx-notice{font-size:11px;line-height:1.6;border-radius:8px;padding:8px 11px}
.vnx-notice.info{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.vnx-notice.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.vnx-notice.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.vnx-notice.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.vnx-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.vnx-save-state{font-size:11px;color:var(--dsw-alias-label-secondary)}
.vnx-save-state.error{color:var(--dsw-alias-state-error-primary)}
.vnx-save-state.ok{color:var(--dsw-alias-state-success-primary)}
.vnx-import-area{width:100%;min-height:80px;resize:vertical;font-family:ui-monospace,monospace;font-size:11px;color:inherit;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px}
`;
		// src/routes.ts
		/**
		* dsh-vision-nexus — 设置面板同源路由（Host / Client 共享常量）
		* 单一事实来源，避免 Host 注册路径与 Client 请求路径漂移。
		*/
		const ROUTES = {
			health: "/plugins/dsh-vision-nexus/health",
			status: "/plugins/dsh-vision-nexus/status",
			probePython: "/plugins/dsh-vision-nexus/probe-python",
			probeBrowser: "/plugins/dsh-vision-nexus/probe-browser",
			testVl: "/plugins/dsh-vision-nexus/test-vl",
			export: "/plugins/dsh-vision-nexus/export"
		};
		// src/client/index.ts
		/**
		* dsh-vision-nexus — Client 半入口（设置面板挂载）
		*
		* 遵循 DSH 标准插件 Client 约定：
		*  - 导出 `name` / `inject` / `apply`（由 `lib/client.js` 暴露给宿主）。
		*  - `apply(ctx)` 中：
		*      1. 解析设置表单 scope（DSH 0.1.7+ 用 `configForms.get(ENTRY_ID)`，
		*         旧版用 `settingsScope.bind({namespace})`，都没有则降级为只读）；
		*      2. 通过 `styles.insert` 注入主题感知样式；
		*      3. 用 `ctx.slots.register` 把设置面板挂进
		*         `plugins.bundle.config`（key=包名）与 `settings.plugin.item` 两个座位；
		*      4. 把 `scope / routes / React / locale` 作为 inject 面传给面板组件。
		*  - 面板读写一律走 scope（`set(field,value)` 字段级写入），Host 侧 Config
		*    全字段 `volatile()` → 修改后无需重启即可热生效。
		*  - 同源路由（健康自检 / 状态 / 探测 / 导出）由 Host 半 `hostPanel.ts` 提供。
		*
		* 构建：`tsdown` 把本文件及其依赖打包为 `lib/client.js`
		* （`window.__ModuleLoader__.load` 工厂格式），`react` 由 `dsh.client.inject` 提供。
		*/
		const name = "dsh-vision-nexus";
		/**
		* 运行期必需服务。设置表单读取器故意不静态声明（不同 DSH 版本服务名不同），
		* 在 apply 里探测；静态 inject 会在缺该服务的版本上把 fiber 永久挂起。
		*/
		const inject = ["slots", "locale"];
		/** 可读但不可写时的降级 scope。 */
		function degradedScope() {
			return {
				getSnapshot: () => ({
					value: void 0,
					status: "unavailable",
					writable: false
				}),
				subscribe: () => () => {},
				set: async () => false
			};
		}
		/**
		* 递归解包 schemastery 的 volatile 包装：字段值可能是带 `.get()` 的 box，
		* 数组元素 / 嵌套对象里也可能带。与 Host 侧 `flattenConfig` 同语义，避免
		* 面板把 box 当成对象而退化为默认值。
		*/
		function unwrap(value) {
			if (value && typeof value === "object" && typeof value.get === "function") return unwrap(value.get());
			if (Array.isArray(value)) return value.map(unwrap);
			if (value && typeof value === "object") {
				const out = {};
				for (const [k, v] of Object.entries(value)) out[k] = unwrap(v);
				return out;
			}
			return value;
		}
		/** 把带 `.get()` 的 volatile 值解包的兼容读取（旧版 settingsScope 无需）。 */
		function makeScope(raw) {
			if (!raw) return degradedScope();
			return {
				getSnapshot: () => {
					const snap = raw.getSnapshot?.() ?? {
						value: void 0,
						writable: false,
						status: "unavailable"
					};
					return {
						value: unwrap(snap.value),
						status: snap.status,
						writable: snap.writable
					};
				},
				subscribe: (fn) => {
					const off = raw.subscribe?.(fn);
					return typeof off === "function" ? off : () => {};
				},
				set: async (field, value) => {
					if (typeof raw.set !== "function") return false;
					return await raw.set(field, value);
				}
			};
		}
		/** 创建一次面板组件（React 组件工厂）。 */
		function buildPanel(scope, lang) {
			return createSettingsPanel({
				React: react,
				scope,
				routes: ROUTES,
				lang
			});
		}
		function apply(ctx) {
			const configForms = ctx.get?.("configForms");
			const settingsScopeApi = configForms === void 0 ? ctx.get?.("settingsScope") : void 0;
			const scope = makeScope((configForms && typeof configForms.get === "function" ? configForms.get("dsh-vision-nexus") : void 0) ?? (settingsScopeApi && typeof settingsScopeApi.bind === "function" ? settingsScopeApi.bind({ namespace: "dsh-vision-nexus" }) : void 0));
			ctx.effect?.(() => {
				const insert = globalThis.styles?.insert;
				if (typeof insert === "function") return insert(PANEL_CSS);
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-vision-nexus";
				style.textContent = PANEL_CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-vision-nexus: panel styles");
			const lang = ((ctx.get?.("locale"))?.getSnapshot?.()?.active ?? "").startsWith("en") ? "en" : "zh";
			const register = ctx.slots?.register?.bind(ctx.slots);
			if (!register) return;
			const injectFace = () => ({
				scope,
				routes: ROUTES,
				lang,
				React: react
			});
			const Panel = buildPanel(scope, lang);
			const faceWithPanel = () => ({
				...injectFace(),
				Panel
			});
			for (const [seat, keyField] of [
				["plugins.bundle.config", "key"],
				["settings.plugin.item", "key"],
				["web-ui.plugin.item", "id"]
			]) try {
				ctx.slots.inject?.(seat, () => register({
					name: seat,
					[keyField]: "dsh-vision-nexus",
					label: "Vision Nexus 视觉增强",
					inject: faceWithPanel
				}, Panel));
			} catch {}
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
