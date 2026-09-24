/**
 * 纯 JS 模板：不用构建，改完直接放进 vault 的 connectors/ 目录。
 *
 * 这是一个「直链透传」示例：把匹配到的地址原样交给播放器；
 * 如果目标站需要防盗链头，在 settings.json 里填 referer 即可。
 */
module.exports = {
    create(ctx) {
        return {
            match(url) {
                // 保持同步且廉价：只做字符串判断，不要在这里发请求
                return url.includes('demo.example.com');
            },

            async resolve(url, onProgress) {
                const settings = (await ctx.getSettings()) ?? {};
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
    },
};
