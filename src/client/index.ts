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
import * as React from 'react';
import { createSettingsPanel, type SettingsScope } from './panel.js';
import { PANEL_CSS } from './styles.js';
import { ROUTES } from './routes.js';

export const name = 'dsh-vision-nexus';

/**
 * 运行期必需服务。设置表单读取器故意不静态声明（不同 DSH 版本服务名不同），
 * 在 apply 里探测；静态 inject 会在缺该服务的版本上把 fiber 永久挂起。
 */
export const inject = ['slots', 'locale'];

/** 可读但不可写时的降级 scope。 */
function degradedScope(): SettingsScope {
  return {
    getSnapshot: () => ({ value: undefined, status: 'unavailable', writable: false }),
    subscribe: () => () => {},
    set: async () => false,
  };
}

/**
 * 递归解包 schemastery 的 volatile 包装：字段值可能是带 `.get()` 的 box，
 * 数组元素 / 嵌套对象里也可能带。与 Host 侧 `flattenConfig` 同语义，避免
 * 面板把 box 当成对象而退化为默认值。
 */
function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as any).get === 'function') {
    return unwrap((value as any).get());
  }
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = unwrap(v);
    return out;
  }
  return value;
}

/** 把带 `.get()` 的 volatile 值解包的兼容读取（旧版 settingsScope 无需）。 */
function makeScope(raw: any): SettingsScope {
  if (!raw) return degradedScope();
  return {
    getSnapshot: () => {
      const snap = raw.getSnapshot?.() ?? { value: undefined, writable: false, status: 'unavailable' };
      return {
        value: unwrap(snap.value) as Record<string, unknown> | undefined,
        status: snap.status,
        writable: snap.writable,
      };
    },
    subscribe: (fn: () => void) => {
      const off = raw.subscribe?.(fn);
      return typeof off === 'function' ? off : () => {};
    },
    set: async (field: string, value: unknown) => {
      if (typeof raw.set !== 'function') return false;
      return await raw.set(field, value);
    },
  };
}

/** 创建一次面板组件（React 组件工厂）。 */
function buildPanel(scope: SettingsScope, lang: 'zh' | 'en'): any {
  return createSettingsPanel({
    React: React as unknown as any,
    scope,
    routes: ROUTES,
    lang,
  });
}

export function apply(ctx: any): void {
  // ── 1. 解析设置表单 scope ──
  const configForms = ctx.get?.('configForms');
  const settingsScopeApi = configForms === undefined ? ctx.get?.('settingsScope') : undefined;
  // ENTRY_ID 与 cordis.patch.yml / 包入口一致：优先用 configForms 的条目 id，
  // 旧版回退到 namespace 绑定。
  const raw =
    (configForms && typeof configForms.get === 'function' ? configForms.get('dsh-vision-nexus') : undefined) ??
    (settingsScopeApi && typeof settingsScopeApi.bind === 'function'
      ? settingsScopeApi.bind({ namespace: 'dsh-vision-nexus' })
      : undefined);
  const scope = makeScope(raw);

  // ── 2. 注入主题感知样式（随 Client run 自动清理） ──
  ctx.effect?.(() => {
    const insert = (globalThis as any).styles?.insert;
    if (typeof insert === 'function') return insert(PANEL_CSS);
    // 退化：直接往 document.head 插 <style>。
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-vision-nexus';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'dsh-vision-nexus: panel styles');

  // ── 3. 语言 ──
  const locale = ctx.get?.('locale');
  const lang: 'zh' | 'en' = (locale?.getSnapshot?.()?.active ?? '').startsWith('en') ? 'en' : 'zh';

  // ── 4. 挂载设置面板到两个座位 ──
  const register = ctx.slots?.register?.bind(ctx.slots);
  if (!register) return;

  const injectFace = () => ({
    scope,
    routes: ROUTES,
    lang,
    React,
  });
  // 面板组件工厂：挂在 inject 面里，让座位渲染器拿到组件。
  const Panel = buildPanel(scope, lang);
  const faceWithPanel = () => ({ ...injectFace(), Panel });

  /**
   * 座位注册（跨 DSH 版本兼容）：
   *  - `plugins.bundle.config`（keyed，key=包名）：插件详情页配置区，当前版本确认存在。
   *  - `settings.plugin.item` / `web-ui.plugin.item`（list）：不同版本的设置页插件条目座位。
   * 用可选链逐个尝试；不存在的座位会安静跳过，不会让整个 Client fiber 挂起。
   */
  const keyedSeats: Array<[string, string]> = [
    ['plugins.bundle.config', 'key'],
    ['settings.plugin.item', 'key'],
    ['web-ui.plugin.item', 'id'],
  ];
  for (const [seat, keyField] of keyedSeats) {
    try {
      ctx.slots.inject?.(seat, () => register({
        name: seat,
        [keyField]: 'dsh-vision-nexus',
        label: 'Vision Nexus 视觉增强',
        inject: faceWithPanel,
      }, Panel));
    } catch { /* 该版本无此座位：忽略 */ }
  }
}
