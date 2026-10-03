/**
 * sync-vault connector SDK —— 契约类型（自动生成，请勿手改）
 */

/** 宿主当前实现的契约版本；manifest.apiVersion 的主版本必须与之相同 */
export declare const CONNECTOR_API_VERSION = "0.2";
/** 已支持的 connector 类型；新增类型需在此登记并补充对应能力接口 */
export declare const CONNECTOR_TYPES: readonly ["video-source"];
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export interface ConnectorManifest {
    /** 唯一标识，必须与所在目录名一致，允许 [a-z0-9-_] */
    id: string;
    name: string;
    /** connector 自己的版本号 */
    version: string;
    /** 目标契约版本，如 "0.2" */
    apiVersion: string;
    type: ConnectorType;
    description?: string;
    author?: string;
    /** 仓库/主页地址，便于溯源与更新 */
    homepage?: string;
}
export interface ConnectorRequestOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
}
export interface ConnectorResponse {
    status: number;
    headers: Record<string, string>;
    /** 响应体均为惰性读取 */
    text: string;
    json: any;
    arrayBuffer: ArrayBuffer;
}
export interface ConnectorLogger {
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}
/** 宿主注入的运行上下文；connector 的网络/配置/日志能力都从这里获取 */
export interface ConnectorContext {
    readonly id: string;
    /** 当前 connector 所在目录 */
    readonly dir: string;
    readonly platform: {
        isDesktop: boolean;
        isMobile: boolean;
    };
    /** 网络请求，走宿主通道（天然绕开 CORS）；非 2xx 不抛错，由 connector 判断 status */
    request(options: ConnectorRequestOptions): Promise<ConnectorResponse>;
    log: ConnectorLogger;
    /** 读取本 connector 的 settings.json；不存在返回 null */
    getSettings<T = Record<string, any>>(): Promise<T | null>;
    /** 写入本 connector 的 settings.json */
    saveSettings(settings: Record<string, any>): Promise<void>;
}
/** 单个媒体流的元信息 */
export interface MediaInfo {
    width: number;
    height: number;
    resolution: string;
    url: string;
    duration?: number;
    codec?: string;
    frameRate?: number;
    audioCodec?: string;
    sampleRate?: number;
    fileSize?: number;
}
/**
 * 解析出的媒体流信息，宿主会直接交给播放器。
 * 与宿主内部同名类型结构一致，宿主构建期类型检查会保证两者不漂移。
 */
export interface MediaStreamInfo {
    url: string;
    urlType: 'm3u8-list' | 'direct';
    mediaType: 'hls' | 'raw';
    cursor?: number;
    headers?: Record<string, string>;
    coverUrl?: string;
    mediaInfo: MediaInfo[];
    proxy?: boolean;
    /**
     * 清理回调：这份流信息被宿主替换（过期重取/切换）或播放器销毁时调用，
     * 用于释放 resolve 期间创建的资源（定时器、本地服务等）。
     */
    cleanup?: () => void;
}
/** 所有 connector 的公共形状 */
export interface Connector {
    /** 卸载时调用（reload / 插件停用），用于清理定时器、连接等资源 */
    dispose?(): void | Promise<void>;
}
/** 视频源 connector：把外部视频地址解析为可播放流 */
export interface VideoSourceConnector extends Connector {
    /** 是否能处理该地址；宿主按注册顺序询问 */
    match(url: string): boolean;
    /**
     * 解析为可播放流；失败必须抛出明确错误。
     * 播放地址有有效期时，宿主会在过期后以同一 URL 再次调用本方法，
     * 因此实现必须可重复调用（无累积副作用；一次性资源挂到返回值的 cleanup 上）。
     */
    resolve(url: string, onProgress?: (message: string) => void): Promise<MediaStreamInfo>;
}
/** main.js 必须导出的模块形状 */
export interface ConnectorModule<T extends Connector = VideoSourceConnector> {
    create(ctx: ConnectorContext): T | Promise<T>;
}
