/**
 * 本地调试 harness：在 Node 里加载并运行 connector，不需要 Obsidian。
 *
 * 校验规则与宿主 loader 对齐（manifest 字段、id 与目录名、apiVersion 主版本、能力方法），
 * main.js 的求值方式也一致（`new Function('module', 'exports', source)`，不注入 require）。
 * 与宿主的差异只有两处：request 走 Node 的 fetch（无 CORS、无 Obsidian 代理），
 * ctx.dir 是本地绝对路径。
 */
'use strict';

const { existsSync, readFileSync, writeFileSync } = require('fs');
const { basename, join, resolve } = require('path');

const API_VERSION = (() => {
    const source = readFileSync(join(__dirname, '..', 'index.d.ts'), 'utf8');
    const version = /CONNECTOR_API_VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1];
    if (!version) {
        throw new Error('index.d.ts 里找不到 CONNECTOR_API_VERSION，请从 sync-vault 主仓库重新生成 SDK');
    }
    return version;
})();

const CONNECTOR_TYPES = ['cloud-video'];

function makeLogger(id) {
    const prefix = `[connector.${id}]`;
    return {
        debug: (...args) => console.debug(prefix, ...args),
        info: (...args) => console.info(prefix, ...args),
        warn: (...args) => console.warn(prefix, ...args),
        error: (...args) => console.error(prefix, ...args),
    };
}

async function request(options) {
    if (!options || typeof options.url !== 'string') {
        throw new Error('ctx.request(options) 需要 options.url');
    }
    const resp = await fetch(options.url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
    });
    // 宿主与非宿主一致：非 2xx 不抛错，交给 connector 判断 status
    const headers = Object.fromEntries(resp.headers.entries());
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    return {
        status: resp.status,
        headers,
        get text() { return text; },
        get json() { return JSON.parse(text); },
        get arrayBuffer() { return buffer; },
    };
}

/** 构造与宿主同形状的 ConnectorContext（settings 落盘到 <dir>/settings.json） */
function createMockContext(options = {}) {
    const id = options.id ?? 'local';
    const dir = options.dir ? resolve(options.dir) : process.cwd();
    const settingsPath = join(dir, 'settings.json');
    return {
        id,
        dir,
        platform: options.platform ?? { isDesktop: true, isMobile: false },
        log: makeLogger(id),
        request,
        async getSettings() {
            if (!existsSync(settingsPath)) return null;
            return JSON.parse(readFileSync(settingsPath, 'utf8'));
        },
        async saveSettings(settings) {
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        },
    };
}

function parseManifest(dirName, raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`manifest.json 不是合法 JSON: ${e.message}`);
    }
    for (const key of ['id', 'name', 'version', 'apiVersion', 'type']) {
        if (typeof parsed?.[key] !== 'string' || parsed[key].trim() === '') {
            throw new Error(`manifest.json 缺少必填字段 ${key}`);
        }
    }
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(parsed.id)) {
        throw new Error(`manifest.id 非法（只允许小写字母、数字、-、_）: ${parsed.id}`);
    }
    if (parsed.id !== dirName) {
        throw new Error(`manifest.id(${parsed.id}) 必须与目录名(${dirName})一致`);
    }
    if (!CONNECTOR_TYPES.includes(parsed.type)) {
        throw new Error(`不支持的 connector 类型: ${parsed.type}（支持: ${CONNECTOR_TYPES.join(', ')}）`);
    }
    if (parsed.apiVersion.split('.')[0] !== API_VERSION.split('.')[0]) {
        throw new Error(`apiVersion(${parsed.apiVersion}) 与当前契约版本(${API_VERSION})不兼容`);
    }
    return parsed;
}

function evaluateMain(source) {
    const module = { exports: {} };
    try {
        new Function('module', 'exports', source)(module, module.exports);
    } catch (e) {
        const hint = /^\s*(import|export)\s/m.test(source)
            ? 'main.js 必须是 CJS 单文件（module.exports 导出），不能使用 ESM 的 import/export'
            : 'main.js 执行失败';
        throw new Error(`${hint}: ${e.message}`);
    }
    return module.exports?.default ?? module.exports;
}

function assertCapability(manifest, instance) {
    if (!instance || typeof instance !== 'object') {
        throw new Error('create(ctx) 必须返回 connector 实例对象');
    }
    if (manifest.type === 'cloud-video') {
        if (typeof instance.match !== 'function') {
            throw new Error('cloud-video 类型必须实现 match(url)');
        }
        if (typeof instance.resolve !== 'function') {
            throw new Error('cloud-video 类型必须实现 resolve(url, onProgress)');
        }
    }
}

/** 按宿主 loader 的规则加载一个 connector 目录，返回 { manifest, instance, ctx } */
async function loadConnector(dir, options = {}) {
    const dirPath = resolve(dir);
    const dirName = basename(dirPath);

    const manifestPath = join(dirPath, 'manifest.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`缺少 manifest.json（${manifestPath}）`);
    }
    const manifest = parseManifest(dirName, readFileSync(manifestPath, 'utf8'));

    const entryPath = join(dirPath, 'main.js');
    if (!existsSync(entryPath)) {
        throw new Error(`缺少 main.js（${entryPath}）`);
    }
    const module = evaluateMain(readFileSync(entryPath, 'utf8'));
    if (typeof module.create !== 'function') {
        throw new Error('main.js 必须导出 create(ctx) 工厂函数：module.exports = { create(ctx) { ... } }');
    }

    const ctx = createMockContext({ id: manifest.id, dir: dirPath, ...options });
    const instance = await module.create(ctx);
    assertCapability(manifest, instance);

    return { manifest, instance, ctx };
}

module.exports = { API_VERSION, createMockContext, loadConnector };
