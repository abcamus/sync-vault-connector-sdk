/**
 * sync-vault connector SDK —— 契约类型（自动生成，请勿手改）
 */

/** 宿主当前实现的契约版本；manifest.apiVersion 的主版本必须与之相同 */
export declare const CONNECTOR_API_VERSION = "0.2";
/** 已支持的 connector 类型；新增类型需在此登记并补充对应能力接口 */
export declare const CONNECTOR_TYPES: readonly ["video-source", "agent-session"];
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
    /**
     * 桌面专属的宿主受管文件通道：vault 之外的本机路径（如 ~/.qoder）一律经此读写，
     * connector 不得直接使用 Node API。移动端为 undefined（先判断 ctx.platform.isDesktop）。
     */
    readonly desktop?: DesktopFileAccess;
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
/**
 * 桌面专属的 vault 外文件通道（宿主受控能力）。
 * 仅桌面端注入；实现内部对 vault 之外的绝对路径做归一化与操作。
 */
export interface DesktopFileAccess {
    /** 当前用户家目录（绝对路径） */
    homeDir(): string;
    /** Node process.platform 语义 */
    platform(): 'darwin' | 'win32' | 'linux';
    exists(path: string): Promise<boolean>;
    /** 返回的均为绝对路径 */
    list(path: string): Promise<{
        files: string[];
        folders: string[];
    }>;
    /** 不存在时抛错（显式失败） */
    stat(path: string): Promise<{
        mtime: number;
        size: number;
        isDir: boolean;
    }>;
    readText(path: string): Promise<string>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeText(path: string, data: string): Promise<void>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    mkdir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
}
/** 本机某一 Agent 的一条会话引用（discover 的返回值） */
export interface AgentSessionRef {
    sessionId: string;
    /** 人类可读标题（如首条消息摘要）；获取不到时缺省 */
    title?: string;
    /** 会话所属项目标识（各 Agent 自己的编码，如 Qoder 的项目目录名） */
    project: string;
    /** 会话记录中的工作目录（导出设备上的绝对路径） */
    cwd?: string;
    /** 最近更新时刻（epoch ms） */
    updatedAt: number;
    /** 游标：原生文件的 mtime（epoch ms）；宿主用于回流检测 */
    nativeMtime: number;
    /** 游标：原生文件合计字节数；宿主用于回流检测 */
    nativeSize: number;
}
/** 会话数据包中的一个文件 */
export interface AgentSessionFile {
    /** 会话目录内的相对路径（如 "<session-id>.jsonl"、"<session-id>/state.json"），禁止绝对路径与 ".." */
    path: string;
    data: ArrayBuffer;
}
/** 一次会话导出的完整数据（export 的返回值，宿主原样存入受管仓库） */
export interface AgentSessionBundle {
    sessionId: string;
    project: string;
    cwd?: string;
    title?: string;
    files: AgentSessionFile[];
    /** 导出时刻的原生游标（冗余一份进数据包，仓库 meta.json 为准） */
    nativeMtime: number;
    nativeSize: number;
}
/** 落位目标设备的环境快照（宿主注入；移动端 homeDir/platform 为 null） */
export interface DeviceEnv {
    isDesktop: boolean;
    homeDir: string | null;
    platform: 'darwin' | 'win32' | 'linux' | null;
    /** 源设备 cwd → 本设备 cwd 映射（跨设备时由用户确认；同构路径可缺省） */
    cwdMap?: Record<string, string>;
}
/** 落位完成后返回的恢复指引：宿主展示/复制，激活保持人工（不自动执行） */
export interface ResumePlan {
    /** 恢复会话的命令，如 "qoder -r <session-id>" */
    command: string;
    /** 建议执行命令的工作目录（映射后的项目目录） */
    cwd?: string;
    /** 展示给用户的注意事项（单写者、独占运行等） */
    notes?: string[];
}
/** probe 的返回值：本机是否具备该 Agent */
export interface AgentSessionProbeResult {
    /** 本机是否具备（配置目录 / CLI 存在） */
    present: boolean;
    /** Agent 版本（可探测时） */
    version?: string;
    /** 会话根目录（探测结果，展示用） */
    configDir?: string;
    /** 补充说明（如"CLI 未安装，仅可落位不可导出"） */
    note?: string;
}
/**
 * Agent 会话 connector：probe/discover/export/stage 为四段式核心能力，
 * 对应宿主工作流：探测 → 发现 → 导出纳管 → 落位恢复。
 * 播放/监视属于可选增强；回流检测在未实现 watch 时由宿主按游标对比完成。
 */
export interface AgentSessionConnector extends Connector {
    probe(): Promise<AgentSessionProbeResult>;
    discover(): Promise<AgentSessionRef[]>;
    /** 读取某条会话的全部文件；失败必须抛出明确错误 */
    export(ref: AgentSessionRef): Promise<AgentSessionBundle>;
    /** 把数据包写入本机对应位置，返回恢复指引；不做任何自动执行 */
    stage(bundle: AgentSessionBundle, env: DeviceEnv): Promise<ResumePlan>;
    /** 可选：监听某条本机会话的变化；返回取消函数 */
    watch?(ref: AgentSessionRef, onChange: () => void): () => void;
}
