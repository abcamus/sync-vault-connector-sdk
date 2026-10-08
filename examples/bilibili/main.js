/**
 * Bilibili connector —— 用 @sync-vault/connector-sdk 重写 Sync Vault 内置的 B站解析。
 *
 * 覆盖 /video/BV… 、/video/av… 与 b23.tv 短链；取的是 html5 平台的合并流。
 * 合并流需要 Referer 防盗链头，经宿主本地代理转发，因此仅桌面端可用。
 * 多分P 视频会一并返回分集列表（parts），宿主播放器侧栏可直接切换分集。
 *
 * 可选配置（settings.json，与 main.js 同目录）：
 *   { "cookie": "SESSDATA=...; bili_jct=..." }
 * 不带 cookie 时也能解析公开视频，带 cookie 可拿到更高清晰度 / 会员内容。
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com';
const API_BASE = 'https://api.bilibili.com';

/** 取流时优先尝试的清晰度（由高到低），命中 durl 即止；实际清晰度以响应 quality 为准 */
const QN_PREFERENCE = [116, 80, 64];

const QUALITY_LABEL = {
    127: '8K',
    126: '杜比视界',
    125: 'HDR',
    120: '4K',
    116: '1080P60',
    112: '1080P+',
    80: '1080P',
    74: '720P60',
    64: '720P',
    32: '480P',
    16: '360P',
};

function normalizeUrl(rawUrl) {
    const url = rawUrl.trim();
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function hostOf(url) {
    try {
        return new URL(normalizeUrl(url)).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function isBilibiliUrl(url) {
    const host = hostOf(url);
    return host === 'bilibili.com' || host.endsWith('.bilibili.com');
}

function isShortLink(url) {
    const host = hostOf(url);
    return host === 'b23.tv' || host.endsWith('.b23.tv');
}

/** 解析 /video/(BV…|av…) 与 ?p=N 分 P */
function parseRef(url) {
    let u;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    const match = u.pathname.match(/\/video\/(BV[0-9A-Za-z]+|av(\d+))/i);
    if (!match) return null;

    const pageRaw = Number(u.searchParams.get('p') ?? '1');
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

    return match[2] ? { aid: match[2], page } : { bvid: match[1], page };
}

module.exports = {
    create(ctx) {
        async function apiHeaders() {
            const settings = (await ctx.getSettings()) ?? {};
            const headers = { 'User-Agent': UA, 'Referer': REFERER };
            const cookie = typeof settings.cookie === 'string' ? settings.cookie.trim() : '';
            if (cookie) headers['Cookie'] = cookie;
            return headers;
        }

        /** 带状态检查的 GET，返回惰性响应体里已经解析好的 JSON */
        async function fetchJson(url, what) {
            let resp;
            try {
                resp = await ctx.request({ url, headers: await apiHeaders() });
            } catch (e) {
                throw new Error(`${what}请求失败: ${e.message ?? e}`);
            }
            if (resp.status >= 400) {
                throw new Error(`${what}失败: HTTP ${resp.status}`);
            }
            return resp.json;
        }

        /** b23.tv 短链 → 从跳转后的页面里抓 BV/av */
        async function resolveShortLink(url) {
            let resp;
            try {
                resp = await ctx.request({ url, headers: { 'User-Agent': UA, 'Referer': REFERER } });
            } catch (e) {
                throw new Error(`B站短链请求失败: ${e.message ?? e}`);
            }
            if (resp.status >= 400) {
                throw new Error(`B站短链解析失败: HTTP ${resp.status}`);
            }
            const text = resp.text ?? '';
            const match = text.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i)
                ?? text.match(/"bvid"\s*:\s*"(BV[0-9A-Za-z]+)"/i);
            if (!match) {
                throw new Error('无法解析 B站短链，请改用完整的视频地址');
            }
            return `https://www.bilibili.com/video/${match[1] ?? match[0]}`;
        }

        async function fetchView(ref) {
            const query = ref.bvid ? `bvid=${encodeURIComponent(ref.bvid)}` : `aid=${encodeURIComponent(ref.aid)}`;
            const body = await fetchJson(`${API_BASE}/x/web-interface/view?${query}`, 'B站视频信息');
            const data = body?.data;
            if (body?.code !== 0 || !data?.pages?.length) {
                throw new Error(`B站视频信息解析失败: ${body?.message ?? '响应缺少 pages'}`);
            }
            return data;
        }

        async function fetchPlayurl(ref, cid, qn) {
            const params = new URLSearchParams();
            if (ref.bvid) params.set('bvid', ref.bvid);
            else params.set('aid', ref.aid);
            params.set('cid', String(cid));
            params.set('qn', String(qn));
            params.set('fnval', '1');
            params.set('fnver', '0');
            params.set('fourk', '1');
            params.set('platform', 'html5');
            params.set('high_quality', '1');

            const body = await fetchJson(`${API_BASE}/x/player/playurl?${params.toString()}`, 'B站取流');
            if (body?.code !== 0) {
                throw new Error(`B站取流失败: ${body?.message ?? '未知错误'}`);
            }
            return body.data;
        }

        return {
            match(url) {
                return isBilibiliUrl(url) || isShortLink(url);
            },

            async resolve(rawUrl, onProgress) {
                if (ctx.platform.isMobile) {
                    // 合并流要带 Referer，移动端没有本地代理，头不会生效
                    throw new Error('B站视频暂仅支持桌面端播放');
                }

                let url = normalizeUrl(rawUrl);
                if (isShortLink(url)) {
                    onProgress?.('解析 B站短链...');
                    url = await resolveShortLink(url);
                }

                const ref = parseRef(url);
                if (!ref) {
                    throw new Error('暂不支持该 B站地址（仅支持 UGC 视频 /video/BV… 或 /video/av…）');
                }

                onProgress?.('获取 B站视频信息...');
                const view = await fetchView(ref);
                // pages 里没有 ?p= 指定的分P 时回退到第一集（下标即分集序号-1）
                const pageIndex = Math.max(0, view.pages.findIndex(p => p.page === ref.page));
                const page = view.pages[pageIndex];

                onProgress?.('获取 B站播放地址...');
                let playurl = null;
                for (const qn of QN_PREFERENCE) {
                    const data = await fetchPlayurl(ref, page.cid, qn);
                    if (data?.durl?.length && data.durl[0]?.url) {
                        playurl = data;
                        break;
                    }
                    ctx.log.warn(`B站 playurl 无合并流(qn=${qn})，尝试更低清晰度`);
                }
                if (!playurl?.durl?.[0]?.url) {
                    throw new Error('B站未返回可播放的合并流（该视频可能仅提供 DASH 音视频分离流）');
                }

                const streamUrl = playurl.durl[0].url;
                const label = QUALITY_LABEL[playurl.quality] ?? `${playurl.quality}P`;
                ctx.log.debug(`B站解析成功: ${view.bvid} cid=${page.cid} qn=${playurl.quality}(${label})`);

                // 多分P：使用 view 里已有的 pages 枚举分集，不额外请求；
                // 分集 url 为规范地址（BV 号 + ?p=N），宿主切换分集时按它再次走本 resolve
                const parts = view.pages.length > 1
                    ? view.pages.map(p => ({
                        name: `P${p.page}${p.part ? ` ${String(p.part).trim()}` : ''}`,
                        url: `https://www.bilibili.com/video/${view.bvid}?p=${p.page}`,
                    }))
                    : undefined;

                return {
                    url: streamUrl,
                    urlType: 'direct',
                    mediaType: 'raw',
                    coverUrl: view.pic,
                    proxy: true,
                    headers: { 'Referer': REFERER, 'User-Agent': UA },
                    mediaInfo: [{ width: 0, height: 0, resolution: label, url: streamUrl }],
                    ...(parts ? { parts, currentPartIndex: pageIndex } : {}),
                };
            },
        };
    },
};
