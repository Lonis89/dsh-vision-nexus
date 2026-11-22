type ReactLike = {
    createElement: (type: any, props?: any, ...children: any[]) => any;
    useState: <T>(initial: T | (() => T)) => [T, (v: T | ((prev: T) => T)) => void];
    useEffect: (effect: () => void | (() => void), deps?: any[]) => void;
    useRef: <T>(initial: T) => {
        current: T;
    };
    useMemo: <T>(factory: () => T, deps?: any[]) => T;
    useCallback: <T extends (...a: any[]) => any>(fn: T, deps?: any[]) => T;
};
/** 设置表单 scope 的最小契约（DSH configForms / settingsScope 共有）。 */
export interface SettingsScope {
    getSnapshot: () => {
        value?: Record<string, unknown>;
        status?: string;
        writable?: boolean;
    };
    subscribe: (fn: () => void) => () => void;
    set: (field: string, value: unknown) => Promise<boolean | void>;
    unset?: (field: string) => Promise<boolean | void>;
}
export interface PanelDeps {
    React: ReactLike;
    scope: SettingsScope;
    /** 同源路由前缀（由 client entry 注入）。 */
    routes: {
        health: string;
        status: string;
        probePython: string;
        probeBrowser: string;
        testVl: string;
        export: string;
    };
    /** 语言：'zh' | 'en'（面板文案按中文设计，保留切换点）。 */
    lang?: 'zh' | 'en';
}
export declare function createSettingsPanel(deps: PanelDeps): any;
export {};
