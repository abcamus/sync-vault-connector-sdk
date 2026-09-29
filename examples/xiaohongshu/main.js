/**
 * Xiaohongshu（小红书）connector —— 用 @sync-vault/connector-sdk 解析小红书视频笔记。
 *
 * 支持 /explore/<id>、/discovery/item/<id>、/user/profile/<uid>/<noteid> 与 xhslink.com / xhslink.cn 短链。
 * 解析路径：取笔记页 HTML → 解析 window.__INITIAL_STATE__ → note.video.media.stream 取流。
 *
 * 两个实测要点（改这个文件前先看）：
 *   1. 必须带浏览器式 Accept 头。缺了它（哪怕有正常 UA）小红书会把请求 302 到登录页，
 *      页面里没有任何笔记数据。
 *   2. 视频直链来自 xhscdn CDN，响应带 `access-control-allow-origin: *`、支持 Range，
 *      所以返回里不设 proxy：宿主播放器直连即可，桌面端与移动端都能播。
 *
 * 可选配置（settings.json，与本文件同目录）：
 *   { "cookie": "a1=...; web_session=..." }
 * 实测不带 Cookie 也能解析公开视频（一般 720P HD）；带 Cookie 可拿到更高清晰度。
 * Cookie 取自浏览器打开 xiaohongshu.com 后任意请求的 Cookie 请求头，无需登录账号。
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9';

/** 笔记站域名；短链域名（服务端可能只给 JS 跳转壳，需要从页面里再找一次目标地址） */
const SITE_HOSTS = ['xiaohongshu.com'];
const SHORT_HOSTS = ['xhslink.com', 'xhslink.cn'];

const NOTE_PATH_RE = /\/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/;
const PROFILE_NOTE_PATH_RE = /\/user\/profile\/[0-9a-zA-Z]+\/([0-9a-zA-Z]+)/;
/** 从页面正文里发现的笔记地址（JS 跳转壳 / 分享页里带的完整链接，含 xsec_token） */
const NOTE_URL_RE = /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[0-9a-zA-Z]+[^"'\s<>\\]*/;
/** 视频编码优先级：h264 兼容性最好，其余作为兜底 */
const CODEC_ORDER = ['h264', 'h265', 'h266', 'av1'];

function normalizeUrl(rawUrl) {
    const url = String(rawUrl).trim();
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function hostOf(url) {
    try {
        return new URL(normalizeUrl(url)).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function hostMatches(host, domains) {
    return domains.some(d => host === d || host.endsWith(`.${d}`));
}

function isShortLink(url) {
    return hostMatches(hostOf(url), SHORT_HOSTS);
}

/** 笔记页与 CDN 都只提供 http 地址，统一升到 https（实测两个 CDN 域名 https 均可用） */
function toHttps(url) {
    return String(url).replace(/^http:\/\//i, 'https://');
}

function headerSet(cookie) {
    const headers = { 'User-Agent': UA, 'Accept': ACCEPT, 'Accept-Language': ACCEPT_LANGUAGE };
    if (cookie) headers['Cookie'] = cookie;
    return headers;
}

/** 扫描出 window.__INITIAL_STATE__ 的 JSON 对象文本；字符串外的 undefined（小红书会用它当空值）就地换成 null */
function sliceStateObject(html, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let out = '';
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (inString) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            continue;
        }
        if (c === '{' || c === '[') {
            depth++;
            out += c;
            continue;
        }
        if (c === '}' || c === ']') {
            depth--;
            out += c;
            if (depth === 0) return out;
            continue;
        }
        if (html.startsWith('undefined', i)) {
            let p = i - 1;
            while (p >= 0 && /\s/.test(html[p])) p--;
            const prev = p >= 0 ? html[p] : '';
            const nextIsBoundary = /^\s*[,}\]]/.test(html.slice(i + 'undefined'.length));
            if (':,[{'.includes(prev) && nextIsBoundary) {
                out += 'null';
                i += 'undefined'.length - 1;
                continue;
            }
        }
        out += c;
    }
    return null;
}

function extractState(html) {
    const marker = 'window.__INITIAL_STATE__';
    let from = 0;
    while (true) {
        const at = html.indexOf(marker, from);
        if (at < 0) return null;
        from = at + marker.length;
        const start = html.indexOf('{', from);
        if (start < 0) return null;
        const text = sliceStateObject(html, start);
        if (!text) continue;
        const json = text.replace(/new Map\(\[\]\)/g, '[]');
        try {
            return JSON.parse(json);
        } catch {
            // 这一段不是完整对象（页面里另有同名变量等），继续往后找
        }
    }
}

/** 页面正文里出现的笔记地址：短链的 JS 跳转壳、失效页的 redirectPath 都靠它兜住 */
function findNoteUrl(html) {
    const variants = [html];
    try {
        variants.push(decodeURIComponent(html));
    } catch {
        // 百分号转义不完整时保持原样
    }
    for (const text of variants) {
        const normalized = text.replace(/\\u002[fF]/g, '/').replace(/\\u003[aA]/g, ':').replace(/\\\//g, '/');
        const match = normalized.match(NOTE_URL_RE);
        if (match) return match[0];
    }
    return null;
}

function pickNoteFromMap(map, wantedId) {
    if (!map || typeof map !== 'object') return null;
    const entries = Array.isArray(map) ? map : Object.values(map);
    const preferred = !Array.isArray(map) && wantedId ? map[wantedId] : null;
    for (const entry of [preferred, ...entries.slice().reverse()]) {
        const note = entry && typeof entry === 'object' ? (entry.note ?? entry) : null;
        if (note && typeof note === 'object' && note.noteId) return note;
    }
    return null;
}

/** 兼容两种页面形态：PC 的 note.noteDetailMap 与移动分享页的 noteData.data.noteData */
function pickNote(state, wantedId) {
    if (!state) return null;
    return pickNoteFromMap(state?.note?.noteDetailMap, wantedId) ?? state?.noteData?.data?.noteData ?? null;
}

/** 在 video.media.stream 里挑一路可播的流：优先编码兼容性，其次取分辨率最高的一路 */
function pickVideoStream(note) {
    const stream = note?.video?.media?.stream;
    if (!stream || typeof stream !== 'object') return null;
    const codecs = [...CODEC_ORDER.filter(c => c in stream), ...Object.keys(stream).filter(c => !CODEC_ORDER.includes(c))];
    for (const codec of codecs) {
        const items = Array.isArray(stream[codec]) ? stream[codec] : [];
        let best = null;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (!best || (Number(item.height) || 0) > (Number(best.height) || 0)) best = item;
        }
        if (!best) continue;
        const backups = Array.isArray(best.backupUrls) ? best.backupUrls.filter(u => typeof u === 'string' && u) : [];
        // 实测：backupUrls 直链不带签名、长期可用；masterUrl 的 sign 参数约 2 天后过期
        const url = backups[0] || best.masterUrl;
        if (typeof url !== 'string' || !url) continue;
        return { codec, media: best, url: toHttps(url) };
    }
    return null;
}

function coverOf(note) {
    const first = Array.isArray(note?.imageList) ? note.imageList[0] : null;
    const url = first?.urlDefault || first?.urlPre || first?.url;
    return typeof url === 'string' && url ? toHttps(url) : undefined;
}

function resolutionLabel(media) {
    const height = Number(media?.height) || 0;
    if (height) return `${height}P`;
    return typeof media?.qualityType === 'string' && media.qualityType ? media.qualityType : '原画';
}

/** 失败时给出能直接照做的原因：链接失效 / 需要 Cookie / 页面结构变化 / 短链未跳转 */
function describeFailure(html, state, noteUrl, hasCookie, isShort) {
    if (html.includes('error_code=300031') || html.includes('当前笔记暂时无法浏览')) {
        return '小红书提示该笔记暂时无法浏览：分享链接可能已失效，或该笔记需要登录态（可在 settings.json 配置 Cookie 后重试）';
    }
    if (!state) {
        return '未能从小红书页面中解析出数据：页面结构可能已变化，或请求被风控拦截';
    }
    if (isShort && !noteUrl) {
        return '短链未指向笔记页（小红书短链已改为客户端跳转）：请在浏览器中打开该短链，复制地址栏里的完整笔记地址';
    }
    if (noteUrl) {
        return '未能取到小红书笔记数据：链接可能已失效，或该笔记需要登录态（可在 settings.json 配置 Cookie 后重试）';
    }
    return hasCookie
        ? '未能取到小红书笔记数据：链接可能已失效，或笔记已被作者删除'
        : '未能取到小红书笔记数据：链接可能已失效，或需要配置 Cookie（见 README）';
}

module.exports = {
    create(ctx) {
        async function fetchPage(url) {
            const settings = (await ctx.getSettings()) ?? {};
            const cookie = typeof settings.cookie === 'string' ? settings.cookie.trim() : '';
            let resp;
            try {
                resp = await ctx.request({ url, headers: headerSet(cookie) });
            } catch (e) {
                throw new Error(`小红书页面请求失败: ${e.message ?? e}`);
            }
            if (resp.status >= 400) {
                throw new Error(`小红书页面请求失败: HTTP ${resp.status}`);
            }
            const html = resp.text ?? '';
            return { html, noteUrl: findNoteUrl(html), hasCookie: !!cookie };
        }

        return {
            match(url) {
                const host = hostOf(url);
                if (hostMatches(host, SHORT_HOSTS)) return true;
                if (!hostMatches(host, SITE_HOSTS)) return false;
                try {
                    const path = new URL(normalizeUrl(url)).pathname;
                    return NOTE_PATH_RE.test(path) || PROFILE_NOTE_PATH_RE.test(path);
                } catch {
                    return false;
                }
            },

            async resolve(rawUrl, onProgress) {
                const url = normalizeUrl(rawUrl);
                const short = isShortLink(url);

                onProgress?.(short ? '解析小红书短链...' : '获取小红书笔记页面...');
                let page = await fetchPage(url);
                let state = extractState(page.html);
                let note = pickNote(state);

                // 短链落地页是 JS 跳转壳时，页面里没有笔记数据，但有目标地址
                if (!note && page.noteUrl && page.noteUrl !== url) {
                    onProgress?.('打开发布笔记页面...');
                    page = await fetchPage(page.noteUrl);
                    state = extractState(page.html);
                    note = pickNote(state);
                }

                if (!note) {
                    throw new Error(describeFailure(page.html, state, page.noteUrl, page.hasCookie, short));
                }
                if (note.type !== 'video') {
                    throw new Error(`该笔记不是视频笔记（type=${note.type ?? '未知'}），暂不支持播放`);
                }

                const picked = pickVideoStream(note);
                if (!picked) {
                    throw new Error('小红书笔记数据里没有可播放的视频流（可尝试在 settings.json 配置 Cookie 后重试）');
                }

                const media = picked.media;
                const width = Number(media.width) || 0;
                const height = Number(media.height) || 0;
                const label = resolutionLabel(media);
                ctx.log.debug(`小红书解析成功: ${note.noteId} ${picked.codec} ${width}x${height} ${label}`);

                return {
                    url: picked.url,
                    urlType: 'direct',
                    mediaType: 'raw',
                    coverUrl: coverOf(note),
                    // 不设 proxy：xhscdn 直链带 ACAO *，直连即可（这样移动端也能播）
                    mediaInfo: [{
                        width,
                        height,
                        resolution: label,
                        url: picked.url,
                        ...(Number(media.size) > 0 ? { fileSize: Number(media.size) } : {}),
                        ...(typeof media.videoCodec === 'string' && media.videoCodec ? { codec: media.videoCodec } : {}),
                    }],
                };
            },
        };
    },
};
