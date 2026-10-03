import type {
    VideoSourceConnector,
    ConnectorContext,
    ConnectorManifest,
} from '..';

export interface MockContextOptions {
    /** 默认 'local'；loadConnector 会传 manifest.id */
    id?: string;
    /** connector 目录（绝对路径），settings.json 读写在此目录；默认 process.cwd() */
    dir?: string;
    /** 默认 { isDesktop: true, isMobile: false } */
    platform?: { isDesktop: boolean; isMobile: boolean };
}

export interface LoadedConnector {
    manifest: ConnectorManifest;
    instance: VideoSourceConnector;
    ctx: ConnectorContext;
}

/** 当前契约版本，与宿主 CONNECTOR_API_VERSION 同源（读自 index.d.ts） */
export declare const API_VERSION: string;

export declare function createMockContext(options?: MockContextOptions): ConnectorContext;

/** 按宿主 loader 的规则加载 <dir>/manifest.json + main.js，求值并 create(ctx) */
export declare function loadConnector(dir: string, options?: MockContextOptions): Promise<LoadedConnector>;
