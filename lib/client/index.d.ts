export declare const name = "dsh-vision-nexus";
/**
 * 运行期必需服务。设置表单读取器故意不静态声明（不同 DSH 版本服务名不同），
 * 在 apply 里探测；静态 inject 会在缺该服务的版本上把 fiber 永久挂起。
 */
export declare const inject: string[];
export declare function apply(ctx: any): void;
