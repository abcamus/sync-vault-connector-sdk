# Connector API 0.1

Sync Vault connector 的契约说明。类型定义见 [index.d.ts](index.d.ts)（自动生成，权威来源是插件的 `src/connector/def.ts`）。

契约版本 `CONNECTOR_API_VERSION = "0.1"`，SDK 版本主次号跟随契约版本：`0.1.x` 的 SDK 对应契约 `0.1`。
判定兼容只看**主版本**：`manifest.apiVersion = "0.2.1"` 与宿主 `0.1` 不兼容；`"0.1.9"` 兼容。

## 1. 交付物与加载

一个 connector 就是一个目录：

```
<vault>/.obsidian/plugins/<plugin id>/connectors/<connector id>/
├── manifest.json     必填
├── main.js           必填
└── settings.json     可选，由 ctx.getSettings / saveSettings 读写
```

当前发行版插件 id 是 `sync-vault-ce`。加载失败的报错信息里会带上完整路径，以日志为准。

加载时机：

- 插件启动时扫描一次；之后可用命令 **“重新加载用户 Connectors”** 重新扫描（改完 `main.js` 不必重启 Obsidian）。
- 扫描按**目录名升序**，即注册顺序。
- 单个 connector 加载失败只影响它自己：其他 connector 照常加载，插件正常启动；失败原因写入日志，命令执行后会弹出“已加载 N 个，失败 M 个”汇总。
- 重新加载会先调用旧实例的 `dispose()`，再重新 `create()`。
- 插件停用时会 `dispose()` 所有 connector。

## 2. manifest.json

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一标识，**必须与目录名一致**，只允许小写字母、数字、`-`、`_` |
| `name` | 是 | 展示名 |
| `version` | 是 | connector 自己的版本号 |
| `apiVersion` | 是 | 目标契约版本，主版本必须与宿主一致 |
| `type` | 是 | connector 类型，当前只支持 `cloud-video` |
| `description` | 否 | 一句话说明 |
| `author` | 否 | 作者 |
| `homepage` | 否 | 仓库/主页地址 |

以上任何一项不合法，该 connector 都会被拒绝加载并给出明确原因。

## 3. main.js

单文件 CommonJS：

```js
module.exports = {
    create(ctx) {
        return {
            match(url) { /* ... */ },
            async resolve(url, onProgress) { /* ... */ },
            dispose() { /* 可选 */ },
        };
    },
};
```

约束及原因：

- **不能用 ESM 的 `import` / `export`**，必须是 `module.exports`（宿主按 CJS 单文件求值，用到 ESM 语法会直接报错并提示）。
- **运行时拿不到 `require`**：宿主只注入 `module` 与 `exports`，`node_modules`、Node 内置模块都不可用；需要的能力从 `ctx` 取。
- 顶层代码在加载时执行一次；`create(ctx)` 可以返回 Promise（`async create`）。
- 打包成单文件时，把依赖一起打进 `main.js`（见 `templates/ts`），不要留下运行时 `require`。

## 4. ctx —— 宿主注入的能力

| 成员 | 说明 |
| --- | --- |
| `id` | 本 connector 的 id（等于 manifest.id） |
| `dir` | 本 connector 在 vault 内的目录路径 |
| `platform` | `{ isDesktop, isMobile }`，用于按端降级 |
| `request(options)` | 网络请求，走宿主通道，**不受浏览器 CORS 限制** |
| `log` | `debug` / `info` / `warn` / `error`，写入 Sync Vault 日志 |
| `getSettings<T>()` | 读取本 connector 的 `settings.json`，文件不存在返回 `null` |
| `saveSettings(obj)` | 写入 `settings.json`（缩进 2 的 JSON） |

`request` 语义：

```js
const resp = await ctx.request({
    url: 'https://api.example.com/x',
    method: 'GET',                                  // 可选，默认 GET
    headers: { 'Referer': 'https://example.com' },  // 可选
    body: JSON.stringify(payload),                  // 可选，string | ArrayBuffer
});
resp.status;        // number
resp.headers;       // Record<string, string>，键名小写
resp.text;          // string
resp.json;          // any：访问时才解析，非 JSON 响应会抛错
resp.arrayBuffer;   // ArrayBuffer
```

- **非 2xx 不抛错**，返回 `status` 由你判断；网络层失败（断网、DNS 等）会抛错。
- 响应体是惰性读取的，不要假设可以重复读取大文件。

`settings.json` 适合放 cookie、token 这类配置：它是 vault 里的普通文件，**明文存储**，注意同步与分享场景下的泄露风险。不要把密钥硬编码在 `main.js` 里。

## 5. cloud-video 契约

```ts
interface CloudVideoConnector {
    match(url: string): boolean;
    resolve(url: string, onProgress?: (message: string) => void): Promise<MediaStreamInfo>;
    dispose?(): void | Promise<void>;
}
```

- `match(url)`：这个地址是否交由本 connector 处理。**不要在里面做耗时请求**：宿主在笔记/播放器解析地址时会同步调用它。
- 多个 connector 都 `match` 时，**目录名升序的第一个生效**，命中的那个完全负责该地址。
- `resolve(url, onProgress)`：解析为可播放流。`onProgress` 用于在播放器加载层显示当前进度文案（如“解析中…”）。地址过期时宿主会再次调用（见“播放地址过期与资源清理”）。
- **失败必须抛出明确错误**：宿主不会回落到内置解析、不会静默换直连，也不会再问其它 connector，而是直接把失败暴露给用户并记日志。请不要用“返回空流”之类的方式掩盖错误。

### MediaStreamInfo

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `url` | 是 | 要播放的地址 |
| `urlType` | 是 | `'direct'`：单个地址；`'m3u8-list'`：m3u8 播放列表地址 |
| `mediaType` | 是 | `'raw'`：直链，播放器直接播放（mp4/flv 等）；`'hls'`：交给 hls.js |
| `mediaInfo` | 是 | 可用清晰度列表，至少一项 |
| `headers` | 否 | 播放时随请求发送的头（配合 `proxy` 使用） |
| `proxy` | 否 | `true` 表示视频请求经宿主本地代理转发（见下节） |
| `coverUrl` | 否 | 封面图 |
| `cursor` | 否 | 上次播放位置（秒） |
| `cleanup` | 否 | 这份流被替换/播放器销毁时宿主调用的清理函数（见下） |

`mediaInfo` 每项：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `url` | 是 | 该清晰度的地址 |
| `resolution` | 是 | 清晰度名，仅用于展示（如 `1080P`、`原画`） |
| `width` / `height` | 是 | 像素尺寸，用于播放器初始比例 |
| 其余 | 否 | `duration` / `codec` / `frameRate` / `audioCodec` / `sampleRate` / `fileSize` |

约定：

- `streamInfo.url` 应与 `mediaInfo` 中某一项的 `url` 相同，该项的 `resolution` 会被当作当前清晰度。
- `resolution === '原画'` 有特殊含义：播放器按直链路径处理（不做清晰度切换）。
- 只有一路流时，`mediaInfo` 写一项即可。

### 播放地址过期与资源清理

平台返回的播放地址通常有有效期（带签名的 CDN 链接、取流接口下发的地址）。宿主会兜底：

- 播放中地址失效（HTTP 401/403/404/410）时，宿主会**以同一 URL 再次调用 `resolve`**，拿到新地址后自动跳回原播放位置续播。所以 `resolve` 必须可重复调用：不要把一次性状态累积在实例上，也不要指望它只会被调用一次。
- 一份 `MediaStreamInfo` 被替换（过期重取、切换视频）或播放器销毁时，宿主会调用它的 `cleanup`。请把 `resolve` 期间创建的一次性资源（定时器、本地服务、临时订阅）挂在返回值的 `cleanup` 上；需要跨多份流存活的资源放在实例的 `dispose` 里。
- 自动重取有次数上限（当前 2 次；重取成功后 1 分钟内不再过期即归还额度），超过后播放失败会如实暴露给用户。

## 6. proxy 与 headers：桌面端与移动端不同

防盗链（需要 `Referer` 等头）的地址，把 `proxy: true` 和 `headers` 一起返回：

- **桌面端**：宿主本地代理（`127.0.0.1`）转发请求并带上这些头，同时解决跨域。
- **移动端：不支持本地代理**。`proxy: true` 会退化成直连，**`headers` 不生效**。依赖防盗链头的地址在移动端会 403。

所以对这类 connector，请在 `resolve` 里显式判断：

```js
if (ctx.platform.isMobile) {
    throw new Error('该地址需要防盗链头，暂仅支持桌面端播放');
}
```

明确报错比让用户看到一个莫名其妙的播放失败要好。

### 直连播放要求源站允许跨域

宿主播放 `<video crossorigin="anonymous">`（截图、字幕轨需要读取像素），所以 **`proxy` 不为 `true` 时，源站必须返回 `Access-Control-Allow-Origin`**；只按 Range 返回字节、没有 CORS 头的地址，播放器会以 `MEDIA_ELEMENT_ERROR: Format error` 失败，看起来像编码问题，实则是跨域被拒。

- 桌面端有防盗链头的地址用 `proxy: true`：本地代理会补上 CORS 头，源站不需要支持跨域。
- 移动端没有代理（见上），源站必须自己允许跨域，否则该地址在移动端无法播放。
- 自测时可以先用 `curl -H 'Origin: app://obsidian.md' -I <地址>` 看响应里有没有 `access-control-allow-origin`。

## 7. 硬性约束

- **移动端兼容**：connector 在 iOS/Android 上同样会被加载和执行。不能用 Node 内置模块（`fs`、`path`、`http`…）、不能用 Electron 专属 API。需要随机数/摘要时用 Web 标准的 `crypto.subtle`。
- **文件读写**：只能通过 `ctx.getSettings` / `saveSettings`；不要试图直接访问 vault 里的其它文件。
- **没有沙箱**：connector 的代码以插件同等权限运行，能发起网络请求、读写自己的配置。请只安装你信任的 connector。
- **别阻塞**：`match` 保持同步且廉价；耗时操作放 `resolve`。

## 8. 调试

1. 本地跑（不需要 Obsidian）：

```bash
npx sync-vault-connector-mock ./my-connector "https://example.com/video/1"
```

  或在脚本里用 `require('sync-vault-connector-sdk/mock')` 的 `loadConnector` / `createMockContext`。
  mock 的校验与求值规则和宿主一致，能提前暴露 manifest 字段错误、ESM 语法、`require` 缺失等问题。

2. 装进 vault 后：在 Obsidian 命令面板执行“重新加载用户 Connectors”，看 Notice 汇总与日志。
3. 播放失败时先确认日志里有没有 `[connector.<id>]` 的记录：`resolve` 抛出的错误会记在那里。

## 9. 契约演进

- `def.ts` 是契约的唯一事实来源，SDK 的 `index.d.ts` 由它生成；插件仓库里有 `sdk:check` 校验两者是否漂移。
- 新增能力只加可选字段/可选成员，属于次版本；删改字段、改语义属于主版本，会同步提升 `CONNECTOR_API_VERSION` 主版本号。
- 宿主只按主版本判断兼容，因此主版本不变时，老 connector 不需要改动。
