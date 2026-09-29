import type { CloudVideoConnector, ConnectorContext, MediaStreamInfo } from '@sync-vault/connector-sdk';

interface Settings {
    /** 目标站需要防盗链头时填写，例如 https://demo.example.com/ */
    referer?: string;
}

/** main.js 导出的工厂：宿主加载时调用一次，返回值即 connector 实例 */
export function create(ctx: ConnectorContext): CloudVideoConnector {
    return {
        match(url) {
            // 保持同步且廉价：只做字符串判断，不要在这里发请求
            return url.includes('demo.example.com');
        },

        async resolve(url, onProgress): Promise<MediaStreamInfo> {
            const settings = (await ctx.getSettings<Settings>()) ?? {};
            onProgress?.('读取配置…');

            const headers = settings.referer ? { Referer: settings.referer } : undefined;
            if (headers && ctx.platform.isMobile) {
                // 移动端没有本地代理，headers 不会生效，这里明确失败
                throw new Error('该地址需要 Referer 头，暂仅支持桌面端播放');
            }

            ctx.log.info('resolve:', url);
            return {
                url,
                urlType: 'direct',
                mediaType: 'raw',
                headers,
                proxy: Boolean(headers),
                mediaInfo: [{ url, resolution: '原画', width: 0, height: 0 }],
            };
        },

        dispose() {
            // 有定时器 / 连接时在这里清理
            ctx.log.debug('dispose');
        },
    };
}
