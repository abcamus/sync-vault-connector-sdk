/**
 * web-video connector —— SDK 最小示例：播放公开网络可访问的视频。
 *
 * 「公开网络可访问」= 拿到地址就能直接取到，不需要页面解析、Cookie 或平台 API：
 *   1. 直链视频文件（.mp4 / .m4v / .mov / .webm / .ogv）→ mediaType 'raw'，播放器直接播放
 *   2. HLS 播放列表（.m3u8）→ mediaType 'hls'，桌面端由 hls.js 播放（iOS 走原生 HLS）
 *
 * 代码只做两件事，正好对应 cloud-video 契约的两个方法：
 *   match()   —— 按扩展名判断「这像不像一个视频地址」。宿主对它同步调用，必须廉价；
 *                且命中即接管，所以宁可保守：绝不能匹配所有 http(s) 地址（会把普通网页条目也劫持成视频）
 *   resolve() —— 先探测源站，把「链接已失效、返回的其实是网页」提前变成明确报错；再按 HLS / 直链分流
 *
 * 有意保持最小的部分（需要时参考 examples/bilibili、examples/xiaohongshu 的写法）：
 *   - 不解析 m3u8 里的多档清晰度，统一给一档「自动」
 *   - 不发送 UA / Referer 等自定义头，也不设 proxy：要求源站允许跨域（见 README 的自测命令）
 */
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'ogv'];
const HLS_EXTENSIONS = ['m3u8'];

/** HLS 的 content-type 各源站写法不一，全部收下 */
const HLS_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];

/** 探测到这两种 content-type，说明拿到的是网页/接口响应，不是视频流 */
const NOT_VIDEO_CONTENT_TYPES = ['text/html', 'application/json'];

function normalizeUrl(rawUrl) {
    const url = String(rawUrl).trim();
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function extensionOf(url) {
    try {
        const path = new URL(normalizeUrl(url)).pathname.toLowerCase();
        const dot = path.lastIndexOf('.');
        return dot < 0 ? '' : path.slice(dot + 1);
    } catch {
        return '';
    }
}

module.exports = {
    create(ctx) {
        async function request(url, options = {}) {
            try {
                return await ctx.request({ url, ...options });
            } catch (e) {
                throw new Error(`视频源请求失败: ${e.message ?? e}`);
            }
        }

        /**
         * HEAD 探测源站；部分源站不支持 HEAD（405/501），退回只取 1 字节的 Range 请求。
         * 探测走 ctx.request（宿主通道，天然绕开 CORS），与播放时的跨域限制无关。
         */
        async function probe(url) {
            let resp = await request(url, { method: 'HEAD' });
            if (resp.status >= 400) {
                resp = await request(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
            }
            if (resp.status >= 400) {
                throw new Error(`视频源不可访问: HTTP ${resp.status}`);
            }
            const contentType = (resp.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
            const fileSize = Number(resp.headers['content-range']?.split('/')[1])
                || Number(resp.headers['content-length'])
                || 0;
            return { contentType, fileSize };
        }

        return {
            match(url) {
                const ext = extensionOf(url);
                return VIDEO_EXTENSIONS.includes(ext) || HLS_EXTENSIONS.includes(ext);
            },

            async resolve(rawUrl, onProgress) {
                // 宿主可能传入省略协议头的地址（如 web:// 引用），返回给播放器的必须是完整地址
                const url = normalizeUrl(rawUrl);

                onProgress?.('探测视频源...');
                const { contentType, fileSize } = await probe(url);

                if (NOT_VIDEO_CONTENT_TYPES.includes(contentType)) {
                    throw new Error(`该地址返回的不是视频（Content-Type: ${contentType}）：链接可能已失效，或需要登录后才能访问`);
                }

                const isHls = HLS_EXTENSIONS.includes(extensionOf(url)) || HLS_CONTENT_TYPES.includes(contentType);
                ctx.log.debug(`web-video: ${url} → ${isHls ? 'HLS' : '直链'}（${contentType || 'content-type 缺失'}${fileSize ? `, ${fileSize}B` : ''}）`);

                return {
                    url,
                    urlType: isHls ? 'm3u8-list' : 'direct',
                    mediaType: isHls ? 'hls' : 'raw',
                    mediaInfo: [{
                        url,
                        width: 0,
                        height: 0,
                        // 「原画」在播放器里等价于直链路径（video.src = url），HLS 流不能用它
                        resolution: isHls ? '自动' : '原画',
                        ...(fileSize ? { fileSize } : {}),
                    }],
                };
            },
        };
    },
};
