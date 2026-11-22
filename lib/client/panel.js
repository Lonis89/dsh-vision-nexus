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
import { OPTIONS, RETENTION_MS, draftFrom, validate, diffFields, exportConfigText, parseImport, newBackendRow, } from './settingsModel.js';
export function createSettingsPanel(deps) {
    const R = deps.React;
    const h = R.createElement.bind(R);
    const { useState, useEffect, useRef, useMemo } = R;
    // 小工具：拼 class、条件渲染。
    const cx = (...parts) => parts.filter(Boolean).join(' ');
    // ───────── 表单控件（函数式小组件，闭包共享 h / cx） ─────────
    const Row = (props) => h('div', { className: cx('vnx-row', props.block && 'block') }, h('div', { className: 'vnx-label' }, h('b', null, props.label), props.hint ? h('span', { className: 'vnx-hint' }, props.hint) : null), h('div', { className: 'vnx-control' }, props.children, props.error ? h('span', { className: 'vnx-error' }, props.error) : null));
    const Toggle = (props) => h('input', {
        type: 'checkbox', className: 'vnx-toggle', checked: props.checked,
        'aria-label': props.label,
        onChange: (e) => props.onChange(Boolean(e?.target?.checked)),
    });
    const TextField = (props) => h('input', {
        type: props.type ?? 'text',
        className: cx('vnx-input', props.small && 'small', props.invalid && 'invalid'),
        value: props.value,
        placeholder: props.placeholder ?? '',
        disabled: props.disabled,
        onChange: (e) => props.onChange(String(e?.target?.value ?? '')),
    });
    const NumberField = (props) => h('input', {
        type: 'number',
        className: cx('vnx-input', props.small && 'small', props.invalid && 'invalid'),
        value: String(props.value),
        min: props.min, max: props.max, step: props.step ?? 1,
        disabled: props.disabled,
        onChange: (e) => {
            const raw = e?.target?.value ?? '';
            const n = raw === '' ? NaN : Number(raw);
            props.onChange(n);
        },
    });
    const SelectField = (props) => h('select', {
        className: 'vnx-select', value: props.value,
        onChange: (e) => props.onChange(String(e?.target?.value ?? '')),
    }, ...props.options.map((o) => h('option', { key: o.value, value: o.value }, o.label)));
    const RadioGroup = (props) => h('div', { className: 'vnx-radio-group' }, ...props.options.map((o) => h('label', {
        key: o.value, className: cx('vnx-radio', props.value === o.value && 'active'),
    }, h('input', {
        type: 'radio', name: props.name, value: o.value, checked: props.value === o.value,
        onChange: () => props.onChange(o.value),
    }), o.label)));
    const Slider = (props) => h('div', { className: 'vnx-slider-row' }, h('input', {
        type: 'range', className: 'vnx-slider', min: props.min, max: props.max,
        step: props.step ?? 1, value: props.value,
        onChange: (e) => props.onChange(Number(e?.target?.value ?? 0)),
    }), h('span', { className: 'vnx-slider-value' }, props.format ? props.format(props.value) : String(props.value)));
    const Btn = (props) => h('button', {
        type: 'button',
        className: cx('vnx-btn', props.kind === 'primary' && 'primary', props.kind === 'danger' && 'danger', props.small && 'small'),
        disabled: props.disabled, title: props.title,
        onClick: props.onClick,
    }, props.children);
    const Badge = (props) => h('span', { className: cx('vnx-badge', props.state) }, h('span', { className: 'vnx-dot' }), props.children);
    // ───────── VL 后端可拖拽列表 ─────────
    const BackendList = (props) => {
        const dragIndex = useRef(null);
        const [dragOver, setDragOver] = useState(null);
        const move = (from, to) => {
            if (from === to || from < 0 || to < 0)
                return;
            const next = [...props.rows];
            const [item] = next.splice(from, 1);
            if (item)
                next.splice(to, 0, item);
            props.onChange(next);
        };
        const patch = (i, key, value) => {
            const next = [...props.rows];
            next[i] = { ...next[i], [key]: value };
            props.onChange(next);
        };
        return h('div', { className: 'vnx-control' }, ...props.rows.length === 0
            ? [h('div', { className: 'vnx-notice info', key: 'empty' }, '暂无 VL 后端。点击「添加后端」新增一条；数组顺序即优先级（靠前优先）。')]
            : props.rows.map((row, i) => h('div', {
                key: row.id,
                className: cx('vnx-backend', !row.enabled && 'disabled'),
                draggable: true,
                onDragStart: () => { dragIndex.current = i; },
                onDragOver: (e) => { e?.preventDefault?.(); setDragOver(i); },
                onDrop: (e) => {
                    e?.preventDefault?.();
                    if (dragIndex.current !== null)
                        move(dragIndex.current, i);
                    dragIndex.current = null;
                    setDragOver(null);
                },
                onDragEnd: () => { dragIndex.current = null; setDragOver(null); },
                style: dragOver === i ? { borderColor: 'var(--dsw-alias-brand-primary)' } : undefined,
            }, h('div', { className: 'vnx-backend-head' }, h('span', { className: 'vnx-grip', title: '拖拽排序' }, '⠿'), h('span', { className: 'vnx-backend-title' }, `${i + 1}. ${row.label || row.id}`), h('span', { className: 'vnx-hint' }, row.enabled ? '启用' : '停用'), h(Toggle, { checked: row.enabled, label: '启用该后端', onChange: (v) => patch(i, 'enabled', v) }), h(Btn, {
                small: true, onClick: () => props.onTest(row),
                disabled: props.testingId === row.id || !row.baseURL,
            }, props.testingId === row.id ? '检测中…' : '连通性'), h(Btn, { small: true, kind: 'danger', onClick: () => props.onChange(props.rows.filter((_, j) => j !== i)) }, '删除')), h('div', { className: 'vnx-backend-grid' }, h('div', { className: 'vnx-field' }, h('label', null, '展示名'), h(TextField, { value: row.label, onChange: (v) => patch(i, 'label', v), placeholder: '主 VL' })), h('div', { className: 'vnx-field' }, h('label', null, '接口地址 baseURL'), h(TextField, {
                value: row.baseURL, onChange: (v) => patch(i, 'baseURL', v),
                placeholder: 'https://api.example.com/v1',
                invalid: Boolean(props.errors[`vlBackends.${i}.baseURL`]),
            }), props.errors[`vlBackends.${i}.baseURL`]
                ? h('span', { className: 'vnx-error' }, props.errors[`vlBackends.${i}.baseURL`]) : null), h('div', { className: 'vnx-field' }, h('label', null, '模型名称'), h(TextField, {
                value: row.model, onChange: (v) => patch(i, 'model', v), placeholder: 'gpt-4o-mini',
                invalid: Boolean(props.errors[`vlBackends.${i}.model`]),
            }), props.errors[`vlBackends.${i}.model`]
                ? h('span', { className: 'vnx-error' }, props.errors[`vlBackends.${i}.model`]) : null), h('div', { className: 'vnx-field' }, h('label', null, '凭据引用名 keyRef（明文密钥由凭证服务保管）'), h(TextField, { value: row.keyRef, onChange: (v) => patch(i, 'keyRef', v), placeholder: 'DSH_VISION_NEXUS_VL_1_KEY' })), h('div', { className: 'vnx-field' }, h('label', null, '最大图片尺寸(px)'), h(NumberField, {
                value: row.maxImageEdgePx, min: 256, max: 8192, step: 64,
                onChange: (v) => patch(i, 'maxImageEdgePx', v),
                invalid: Boolean(props.errors[`vlBackends.${i}.maxImageEdgePx`]),
            }))))), h('div', { className: 'vnx-btn-row', style: { marginTop: 8 } }, h(Btn, { small: true, onClick: () => props.onChange([...props.rows, newBackendRow(props.rows)]) }, '+ 添加后端')));
    };
    const fetchJson = async (url, init) => {
        // 调用方只传 method / body；固定 Content-Type，避免 HeadersInit 联合类型铺展问题。
        const res = await fetch(url, {
            method: init?.method,
            body: init?.body,
            signal: init?.signal,
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return res.json();
    };
    const HealthSectionBody = (props) => {
        const [checking, setChecking] = useState(false);
        const [report, setReport] = useState(null);
        const [status, setStatus] = useState(null);
        const [statusErr, setStatusErr] = useState('');
        const loadStatus = async () => {
            try {
                setStatus(await fetchJson(deps.routes.status));
                setStatusErr('');
            }
            catch (e) {
                setStatusErr(`状态获取失败：${e instanceof Error ? e.message : String(e)}`);
            }
        };
        useEffect(() => {
            void loadStatus();
            // 用 window.setInterval 明确取 DOM 版本（浏览器 bundle 返回 number，避免 Node 定时器类型冲突）。
            const timer = window.setInterval(() => void loadStatus(), 15_000);
            return () => window.clearInterval(timer);
        }, []);
        const runCheck = async () => {
            setChecking(true);
            try {
                const r = await fetchJson(deps.routes.health);
                setReport(r);
                props.onNotice(r.ok ? '自检完成：全部正常' : `自检完成：存在 ${r.items.filter((i) => i.state !== 'ok').length} 个待处理项`, r.ok ? 'ok' : 'warn');
                void loadStatus();
            }
            catch (e) {
                props.onNotice(`自检失败：${e instanceof Error ? e.message : String(e)}`, 'error');
            }
            finally {
                setChecking(false);
            }
        };
        return h('div', { className: 'vnx-section-body' }, h(Row, {
            label: '一键自检', block: true,
            hint: '依次检测 Python 环境、浏览器渲染能力、远端后端连通性、WASM OCR 加载状态与配置合法性。',
        }, h('div', { className: 'vnx-btn-row' }, h(Btn, { kind: 'primary', onClick: runCheck, disabled: checking }, checking ? '检测中…' : '运行健康自检'), h(Btn, { small: true, onClick: () => void loadStatus() }, '刷新状态')), report
            ? h('div', { className: 'vnx-health-list', style: { marginTop: 8 } }, ...report.items.map((it) => h('div', { key: it.key, className: 'vnx-health-item' }, h('div', { className: 'vnx-health-line' }, h(Badge, { state: it.state }, it.state === 'ok' ? '正常' : it.state === 'warn' ? '警告' : '异常'), h('span', { className: 'vnx-health-name' }, it.label)), h('div', { className: 'vnx-health-detail' }, it.detail), it.fix ? h('div', { className: 'vnx-health-fix' }, `修复指引：${it.fix}`) : null)))
            : h('div', { className: 'vnx-notice info' }, '尚未运行自检。点击「运行健康自检」查看各项状态。')), h(Row, {
            label: '当前运行状态', block: true,
            hint: '实时展示激活引擎、已注册工具、队列等待与今日调用统计（每 15 秒自动刷新）。',
        }, statusErr ? h('div', { className: 'vnx-notice error' }, statusErr) : null, h('div', { className: 'vnx-stats' }, h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '插件状态'), h('span', { className: 'vnx-stat-value' }, status ? (status.pluginEnabled ? '已启用' : '已禁用') : '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '当前激活引擎'), h('span', { className: 'vnx-stat-value', style: { fontSize: 12 } }, status?.activeEngine ?? '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '队列中等待'), h('span', { className: 'vnx-stat-value' }, status ? String(status.queuedTasks) : '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '运行中任务'), h('span', { className: 'vnx-stat-value' }, status ? String(status.runningTasks) : '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '今日调用'), h('span', { className: 'vnx-stat-value' }, status ? String(status.todayCalls) : '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '今日降级'), h('span', { className: 'vnx-stat-value' }, status ? String(status.todayDegrades) : '—')), h('div', { className: 'vnx-stat' }, h('span', { className: 'vnx-stat-label' }, '平均置信度'), h('span', { className: 'vnx-stat-value' }, status ? status.avgConfidence.toFixed(2) : '—'))), status
            ? h('div', { style: { marginTop: 10 } }, h('div', { className: 'vnx-hint', style: { marginBottom: 6 } }, `已注册工具清单（${status.registeredTools.length}）：`), h('div', { className: 'vnx-tools' }, ...(status.registeredTools.length
                ? status.registeredTools.map((t) => h('span', { key: t, className: 'vnx-tool-chip' }, t))
                : [h('span', { key: 'none', className: 'vnx-hint' }, '未注册（渐进模式待激活，或总开关关闭）')])))
            : null));
    };
    // ───────── 分区外壳（可折叠） ─────────
    const Section = (props) => {
        const [open, setOpen] = useState(props.defaultOpen !== false);
        return h('section', { className: cx('vnx-section', !open && 'collapsed') }, h('button', {
            type: 'button', className: 'vnx-section-header',
            'aria-expanded': open, onClick: () => setOpen(!open),
        }, h('span', { className: 'vnx-section-title' }, h('span', { className: 'vnx-section-index' }, String(props.index)), props.title), h('span', { className: cx('vnx-section-chevron', open && 'open') }, '›')), h('div', { className: 'vnx-section-body' }, props.children));
    };
    // ───────── 主面板 ─────────
    return function VisionNexusSettingsPanel(props) {
        const [snapshot, setSnapshot] = useState(() => deps.scope.getSnapshot());
        const [draft, setDraft] = useState(() => draftFrom(deps.scope.getSnapshot().value));
        const [saveState, setSaveState] = useState({ text: '', kind: '' });
        const [notice, setNotice] = useState(null);
        const [showImport, setShowImport] = useState(false);
        const [importText, setImportText] = useState('');
        const [testingId, setTestingId] = useState('');
        const [probeMsg, setProbeMsg] = useState('');
        const dirtyRef = useRef(false);
        // 订阅 scope 变化（其他视图写入时同步草稿，但不覆盖用户正在输入的脏值）。
        useEffect(() => {
            const sync = () => {
                const snap = deps.scope.getSnapshot();
                setSnapshot(snap);
                if (!dirtyRef.current)
                    setDraft(draftFrom(snap.value));
            };
            const unsub = deps.scope.subscribe(sync);
            sync();
            return unsub;
        }, []);
        const validation = useMemo(() => validate(draft), [draft]);
        const writable = snapshot.writable !== false && snapshot.status !== 'unavailable';
        /** 修改一个字段：立即本地更新 + 实时校验，合法才写回 scope（热生效）。 */
        const patch = (key, value) => {
            const next = { ...draft, [key]: value };
            setDraft(next);
            dirtyRef.current = true;
            const check = validate(next);
            // 错误键可能是平铺字段（如 'sessionConcurrency'）或点号子字段
            // （如 'vlBackends.0.baseURL'）。两者都要拦住，否则后端列表的非法
            // baseURL / model 会被写回 scope 并热生效到 Host。
            const fieldError = Object.entries(check.errors).find(([k]) => k === key || k.startsWith(`${key}.`));
            if (fieldError) {
                setSaveState({ text: `「${fieldError[0]}」输入非法，未保存：${fieldError[1]}`, kind: 'error' });
                return; // 非法字段不写回
            }
            // 该字段合法：写回 scope（其余字段可能仍非法，由整体 valid 决定是否提示）。
            if (!writable) {
                setSaveState({ text: '当前设置为只读（配置源未开放写入）', kind: 'error' });
                return;
            }
            void (async () => {
                try {
                    const r = await deps.scope.set(key, value);
                    if (r === false)
                        throw new Error('设置源拒绝写入');
                    // 关联字段：保留时长档位变更时同步 tempRetentionMs。
                    if (key === 'retentionPreset') {
                        // never=0 也要写回（0 表示永不清理），否则残留默认时长会误清。
                        const ms = RETENTION_MS[String(value)] ?? 86_400_000;
                        await deps.scope.set('tempRetentionMs', ms);
                    }
                    dirtyRef.current = false;
                    setSaveState({ text: '已保存并热生效', kind: 'ok' });
                }
                catch (e) {
                    setSaveState({ text: `保存失败：${e instanceof Error ? e.message : String(e)}`, kind: 'error' });
                }
            })();
        };
        /** 保存全部改动（用于后端列表 / 批量导入等一次性写入多字段）。 */
        const saveAll = async (next, successText) => {
            const check = validate(next);
            if (!check.valid) {
                setSaveState({ text: `存在非法输入，未保存：${Object.values(check.errors)[0]}`, kind: 'error' });
                return;
            }
            if (!writable) {
                setSaveState({ text: '当前设置为只读', kind: 'error' });
                return;
            }
            setDraft(next);
            try {
                // 用实时 scope 快照做差异（而非 render 闭包里可能滞后的 snapshot.value）。
                const served = deps.scope.getSnapshot().value;
                const fields = diffFields(next, served);
                for (const [k, v] of fields) {
                    const r = await deps.scope.set(k, v);
                    if (r === false)
                        throw new Error(`字段 ${k} 被拒绝`);
                }
                dirtyRef.current = false;
                setSaveState({ text: successText, kind: 'ok' });
            }
            catch (e) {
                setSaveState({ text: `保存失败：${e instanceof Error ? e.message : String(e)}`, kind: 'error' });
            }
        };
        const setField = (key) => (v) => patch(key, v);
        // 辅助动作。
        const doReset = () => {
            const next = draftFrom({});
            setNotice({ text: '已重置为默认配置（明文凭据需重新登记）', kind: 'ok' });
            void saveAll(next, '已重置为默认并热生效');
        };
        const doExport = async () => {
            const text = exportConfigText(draft);
            const fallback = (reason) => {
                // 剪贴板不可用时把内容放进导入文本框，用户可手动复制，不谎报成功。
                setImportText(text);
                setShowImport(true);
                setNotice({ text: `剪贴板不可用（${reason}），已把导出内容放入下方文本框，请手动复制`, kind: 'warn' });
            };
            try {
                const clipboard = navigator.clipboard;
                if (!clipboard || typeof clipboard.writeText !== 'function') {
                    fallback('当前环境未开放 Clipboard API');
                    return;
                }
                await clipboard.writeText(text);
                setNotice({ text: '配置 JSON 已复制到剪贴板（不含明文密钥）', kind: 'ok' });
            }
            catch (e) {
                fallback(e instanceof Error ? e.message : String(e));
            }
        };
        const doImport = () => {
            const parsed = parseImport(importText);
            if (!parsed.ok || !parsed.draft) {
                setNotice({ text: parsed.error ?? '导入失败', kind: 'error' });
                return;
            }
            setNotice({ text: parsed.notice ?? '导入成功', kind: 'ok' });
            setShowImport(false);
            void saveAll(parsed.draft, '导入的配置已保存并热生效');
        };
        const probePython = async () => {
            setProbeMsg('检测中…');
            try {
                const r = await fetchJson(deps.routes.probePython, { method: 'POST', body: '{}' });
                setProbeMsg(r.found
                    ? `已检测到 ${r.path}${r.runtimeOk ? '，CV 运行时可用' : '，但 cv_worker 探测失败'}`
                    : '未检测到 Python，请安装或填写解释器路径');
            }
            catch (e) {
                setProbeMsg(`检测失败：${e instanceof Error ? e.message : String(e)}`);
            }
        };
        const probeBrowser = async () => {
            setProbeMsg('检测中…');
            try {
                const r = await fetchJson(deps.routes.probeBrowser, { method: 'POST', body: '{}' });
                setProbeMsg(r.available ? `渲染内核可用：${r.name}` : '未检测到浏览器渲染内核，可安装 playwright/chromium');
            }
            catch (e) {
                setProbeMsg(`检测失败：${e instanceof Error ? e.message : String(e)}`);
            }
        };
        const testBackend = async (row) => {
            setTestingId(row.id);
            try {
                const r = await fetchJson(deps.routes.testVl, {
                    method: 'POST',
                    body: JSON.stringify({ baseURL: row.baseURL, model: row.model, keyRef: row.keyRef }),
                });
                setNotice({ text: `${row.label || row.id}：${r.ok ? '连通正常' : '不可达'} — ${r.detail}`, kind: r.ok ? 'ok' : 'warn' });
            }
            catch (e) {
                setNotice({ text: `连通性检测失败：${e instanceof Error ? e.message : String(e)}`, kind: 'error' });
            }
            finally {
                setTestingId('');
            }
        };
        const num = (k) => typeof draft[k] === 'number' ? draft[k] : 0;
        const str = (k) => typeof draft[k] === 'string' ? draft[k] : '';
        const bool = (k) => draft[k] === true;
        const rows = () => Array.isArray(draft.vlBackends) ? draft.vlBackends : [];
        const hostList = () => Array.isArray(draft.panelAllowedHosts)
            ? draft.panelAllowedHosts.filter((x) => typeof x === 'string')
            : [];
        /** 逗号分隔文本 → 字符串数组写回；空串=清空白名单（恢复默认同源校验）。 */
        const setHostList = (v) => patch('panelAllowedHosts', v.split(',').map((s) => s.trim()).filter(Boolean));
        // 座位契约（PluginConfigViewProps）：view='summary' 只渲染一行摘要，
        // 'page' 才渲染完整表单。不支持时（旧宿主 / 无 view 字段）按 page 处理，
        // 保证设置页仍可用。早期版本忽略 view，会把整块表单塞进摘要位。
        if (props?.view === 'summary') {
            const on = bool('enabled');
            const strategy = str('loadingStrategy') === 'progressive' ? '渐进激活' : '全量预加载';
            const backends = rows().length;
            return h('div', { className: 'vnx-panel-summary' }, h('span', { className: cx('vnx-badge', on ? 'ok' : 'warn') }, h('span', { className: 'vnx-dot' }), on ? '已启用' : '已停用'), h('span', { className: 'vnx-hint' }, `${strategy} · VL 后端 ${backends} 个 · 本地 CV ${bool('localCvEnabled') ? '开' : '关'}`));
        }
        return h('div', { className: 'vnx-panel' }, 
        // 顶部工具栏 + 保存状态 + 辅助按钮
        h('div', { className: 'vnx-toolbar' }, h('div', { className: 'vnx-btn-row' }, h(Btn, { small: true, onClick: doReset, title: '恢复全部默认参数' }, '重置为默认配置'), h(Btn, { small: true, onClick: doExport, title: '导出脱敏配置 JSON' }, '导出配置 JSON'), h(Btn, { small: true, onClick: () => { setShowImport(!showImport); setImportText(''); } }, '导入配置 JSON')), h('span', { className: cx('vnx-save-state', saveState.kind) }, !validation.valid
            ? `${Object.keys(validation.errors).length} 处输入待修正`
            : saveState.text || (writable ? '配置自动保存并热生效' : '只读模式'))), 
        // 设置源不可用/只读时明确提示，避免把默认值误认为实际已下发配置。
        snapshot.status === 'unavailable'
            ? h('div', { className: 'vnx-notice warn' }, '当前 DSH 版本未开放本插件的设置表单：下方显示的是默认参数（只读），不会写回。请通过 profile patch 配置，或升级到支持 configForms 的版本。')
            : null, notice ? h('div', { className: cx('vnx-notice', notice.kind) }, notice.text) : null, showImport ? h('div', { className: 'vnx-section' }, h('div', { className: 'vnx-section-header', style: { cursor: 'default' } }, h('span', { className: 'vnx-section-title' }, '粘贴配置 JSON')), h('div', { className: 'vnx-section-body' }, h('textarea', {
            className: 'vnx-import-area', value: importText,
            placeholder: '{\n  "_plugin": "dsh-vision-nexus",\n  "config": { ... }\n}',
            onChange: (e) => setImportText(String(e?.target?.value ?? '')),
        }), h('div', { className: 'vnx-btn-row' }, h(Btn, { kind: 'primary', small: true, onClick: doImport, disabled: !importText.trim() }, '校验并导入'), h(Btn, { small: true, onClick: () => setShowImport(false) }, '取消')))) : null, 
        // ① 运行模式总开关
        h(Section, { index: 1, title: '运行模式总开关' }, h(Row, { label: '启用视觉插件', hint: '关闭后不注册任何 vision_* 工具；引擎与面板自检仍保留。' }, h(Toggle, { checked: bool('enabled'), label: '启用视觉插件', onChange: setField('enabled') })), h(Row, { label: '运行模式', hint: '自动自适应按「本地CV → 自定义VL → 内置兜底 → WASM OCR」自动切换。' }, h(RadioGroup, { name: 'vnx-runMode', value: str('runMode'), options: OPTIONS.runMode, onChange: setField('runMode') })), h(Row, { label: '工具加载策略', hint: '渐进按需激活可减少系统提示词 token 开销。' }, h(RadioGroup, { name: 'vnx-loading', value: str('loadingStrategy'), options: OPTIONS.loadingStrategy, onChange: setField('loadingStrategy') })), h(Row, { label: '大图自动分块策略', hint: '超过长边阈值的图片自动分块采样，并建议分区裁剪，禁止一次性全图 glance。' }, h('div', { className: 'vnx-control inline' }, h(Toggle, { checked: bool('autoTileEnabled'), label: '大图自动分块', onChange: setField('autoTileEnabled') }), h('span', { className: 'vnx-hint' }, '长边阈值'), h(NumberField, {
            value: num('oversizeEdgePx'), min: 512, max: 16384, step: 64, small: true,
            onChange: setField('oversizeEdgePx'), invalid: Boolean(validation.errors.oversizeEdgePx),
        }), h('span', { className: 'vnx-hint' }, 'px'), validation.errors.oversizeEdgePx ? h('span', { className: 'vnx-error' }, validation.errors.oversizeEdgePx) : null))), 
        // ② 引擎配置区
        h(Section, { index: 2, title: '引擎配置区' }, h('div', { className: 'vnx-hint', style: { padding: '8px 0 2px', fontWeight: 600 } }, '引擎 A · 本地 CV 计算引擎'), h(Row, { label: '启用本地 CV 引擎', hint: '检测失败时高亮提示，并自动禁用相关像素类工具（纯路由模式）。' }, h(Toggle, { checked: bool('localCvEnabled'), label: '启用本地 CV', onChange: setField('localCvEnabled') })), h(Row, { label: 'Python 运行时路径', hint: '留空自动探测 python3 / python / py。' }, h('div', { className: 'vnx-control inline' }, h(TextField, { value: str('pythonPath'), onChange: setField('pythonPath'), placeholder: '自动检测' }), h(Btn, { small: true, onClick: () => void probePython() }, '自动检测'))), probeMsg ? h('div', { className: 'vnx-notice info' }, probeMsg) : null, h(Row, { label: '渲染截图依赖检测', hint: '检测浏览器内核（Playwright / Chromium），供 HTML 渲染截图使用。' }, h('div', { className: 'vnx-control inline' }, h(Toggle, { checked: bool('browserRenderEnabled'), label: '启用渲染检测', onChange: setField('browserRenderEnabled') }), h(Btn, { small: true, onClick: () => void probeBrowser() }, '检测浏览器内核'))), h('div', { className: 'vnx-hint', style: { padding: '12px 0 2px', fontWeight: 600, borderTop: '1px dashed var(--dsw-alias-border-l1)' } }, '引擎 B · 远端 VL 路由引擎'), h(Row, {
            label: '后端优先级列表', block: true,
            hint: '拖拽排序（数组顺序即优先级）。每条配置：接口地址 / API Key 引用名 / 模型名称 / 最大图片尺寸。明文密钥不在此处保存。',
        }, h(BackendList, {
            rows: rows(), onChange: (r) => patch('vlBackends', r), errors: validation.errors,
            onTest: (row) => void testBackend(row), testingId,
        })), h(Row, { label: '内置匿名兜底 VL 服务', hint: '开启后作为自定义后端全失败后的次级兜底链路。' }, h(Toggle, { checked: bool('builtinVlEnabled'), label: '内置兜底 VL', onChange: setField('builtinVlEnabled') })), h(Row, { label: '内置兜底 VL 模型', hint: '可选：内置链路使用的模型名。' }, h(TextField, { value: str('builtinVlModel'), onChange: setField('builtinVlModel'), placeholder: 'gpt-4o-mini' })), h(Row, { label: 'WASM 本地 OCR 兜底', hint: '远端服务异常时自动降级的最终链路，离线可用、不中断会话。' }, h('div', { className: 'vnx-control inline' }, h(Toggle, { checked: bool('wasmOcrEnabled'), label: 'WASM OCR', onChange: setField('wasmOcrEnabled') }), h('span', { className: 'vnx-hint' }, 'OCR 识别语言'), h(SelectField, { value: str('ocrLanguage'), options: OPTIONS.ocrLanguage, onChange: setField('ocrLanguage') })))), 
        // ③ 工具调度策略
        h(Section, { index: 3, title: '工具调度策略' }, h(Row, { label: '单会话最大并发视觉任务数', hint: '串行优先；1~5。超过上限的任务进入队列等待。' }, h('div', { className: 'vnx-control inline' }, h(NumberField, {
            value: num('sessionConcurrency'), min: 1, max: 5, small: true,
            onChange: setField('sessionConcurrency'), invalid: Boolean(validation.errors.sessionConcurrency),
        }), validation.errors.sessionConcurrency ? h('span', { className: 'vnx-error' }, validation.errors.sessionConcurrency) : null)), h(Row, { label: '单任务超时时间（秒）', hint: '超时自动熔断并触发降级。' }, h('div', { className: 'vnx-control inline' }, h(NumberField, {
            value: Math.round(num('taskTimeoutMs') / 1000), min: 1, max: 3600, small: true,
            onChange: (v) => patch('taskTimeoutMs', Math.round(v * 1000)),
            invalid: Boolean(validation.errors.taskTimeoutMs),
        }), h('span', { className: 'vnx-hint' }, '秒'), validation.errors.taskTimeoutMs ? h('span', { className: 'vnx-error' }, validation.errors.taskTimeoutMs) : null)), h(Row, { label: '等待队列最大长度', hint: '超出后新任务返回过载错误。' }, h(NumberField, {
            value: num('maxQueueLength'), min: 1, max: 512, small: true,
            onChange: setField('maxQueueLength'), invalid: Boolean(validation.errors.maxQueueLength),
        })), h(Row, { label: '置信度告警阈值', hint: '低于该置信度自动触发二次校验提醒。' }, h(Slider, {
            value: num('confidenceAlertThreshold'), min: 0, max: 1, step: 0.05,
            onChange: setField('confidenceAlertThreshold'),
            format: (v) => v.toFixed(2),
        })), h(Row, { label: '降级日志提示', hint: '降级发生时是否主动通知 Agent（写入 capabilityNotice）。' }, h(Toggle, { checked: bool('degradeNotifyAgent'), label: '降级通知', onChange: setField('degradeNotifyAgent') }))), 
        // ④ 任务限流与超时（压缩 / 分块参数）
        h(Section, { index: 4, title: '任务限流与超时' }, h(Row, { label: '大图分块边长(px)', hint: '长图 / 大图分块采样的单块边长。' }, h(NumberField, {
            value: num('tileEdgePx'), min: 256, max: 2048, step: 64, small: true,
            onChange: setField('tileEdgePx'), invalid: Boolean(validation.errors.tileEdgePx),
        })), h(Row, { label: '压缩预处理最长边(px)', hint: '图片上传前统一降采样，降低 token / 带宽。' }, h(NumberField, {
            value: num('preprocessMaxEdgePx'), min: 256, max: 4096, step: 64, small: true,
            onChange: setField('preprocessMaxEdgePx'), invalid: Boolean(validation.errors.preprocessMaxEdgePx),
        })), h(Row, { label: '审计日志最大条数', hint: '每会话保留的审计记录上限。' }, h(NumberField, {
            value: num('auditMaxEntries'), min: 10, max: 10000, step: 10, small: true,
            onChange: setField('auditMaxEntries'), invalid: Boolean(validation.errors.auditMaxEntries),
        })), h(Row, { label: '临时文件清理周期(ms)', hint: '定时清理任务的运行间隔。' }, h(NumberField, {
            value: num('cleanupIntervalMs'), min: 10000, max: 86400000, step: 10000, small: true,
            onChange: setField('cleanupIntervalMs'), invalid: Boolean(validation.errors.cleanupIntervalMs),
        })), h(Row, { label: '会话状态持久化', hint: '持久化图片索引 / 激活态，支持会话内反复引用 Artifact。' }, h(Toggle, { checked: bool('persistSessionState'), label: '持久化', onChange: setField('persistSessionState') })), h(Row, { label: '审计日志单独输出', hint: '审计信息不污染主回答。' }, h(Toggle, { checked: bool('auditSeparate'), label: '单独输出', onChange: setField('auditSeparate') })), h(Row, {
            label: '面板 Host 白名单', block: true,
            hint: '留空=沿用浏览器同源校验（默认，不改现有行为）；填写后仅允许列表内主机名访问设置路由，逗号分隔，如 127.0.0.1, localhost, [::1]。用于抵御 DNS rebinding；请填 DSH 面板实际访问主机名，填错会导致面板被拒绝，请谨慎。',
        }, h(TextField, {
            value: hostList().join(', '),
            onChange: setHostList,
            placeholder: '留空=同源校验；如 127.0.0.1, localhost',
            invalid: Boolean(validation.errors.panelAllowedHosts),
        }), validation.errors.panelAllowedHosts
            ? h('span', { className: 'vnx-error' }, validation.errors.panelAllowedHosts) : null)), 
        // ⑤ 产物与存储
        h(Section, { index: 5, title: '产物与存储' }, h(Row, { label: 'Artifact 临时文件保留时长', hint: '超过时长的临时产物由定时清理任务删除。' }, h(SelectField, { value: str('retentionPreset'), options: OPTIONS.retentionPreset, onChange: setField('retentionPreset') })), h(Row, { label: '自动清理临时文件', hint: '关闭后临时文件将一直保留，直到手动清理。' }, h(Toggle, { checked: bool('autoCleanupEnabled'), label: '自动清理', onChange: setField('autoCleanupEnabled') })), h(Row, { label: '自动保存产物', hint: '自动注册 diff 热力图 / 裁剪子图 / SVG 矢量产物为 DSH Artifact。' }, h(Toggle, { checked: bool('autoSaveArtifacts'), label: '自动保存', onChange: setField('autoSaveArtifacts') })), h(Row, { label: '图片压缩质量', hint: '上传前压缩，降低 token；PNG 带 alpha 时保持 PNG。' }, h(Slider, {
            value: num('preprocessQuality'), min: 1, max: 100, step: 1,
            onChange: setField('preprocessQuality'), format: (v) => `${v}%`,
        })), h(Row, { label: 'CV 运行时脚本路径', hint: '留空使用插件内置的 runtime/cv_worker.py。' }, h(TextField, { value: str('cvRuntimePath'), onChange: setField('cvRuntimePath'), placeholder: '内置' }))), 
        // ⑥ 健康自检面板（实时）
        h(Section, { index: 6, title: '健康自检面板（实时）' }, h(HealthSectionBody, { onNotice: (text, kind) => setNotice({ text, kind }) })));
    };
}
