# @sync-vault/connector-sdk

为 [Sync Vault](https://obsidian-sync-vault.com) 编写 **connector** 所需的类型定义与本地调试工具。

Connector 是一段你自己写的 JS：把 Sync Vault 还不支持的外部视频地址，解析成播放器能直接播放的流。
它和 Sync Vault 内置的云盘 provider 是两套东西 —— connector 由用户开发、运行时加载，不需要重新编译插件。

- 契约版本：**0.2**
- 支持的 connector 类型：`video-source`
- 运行环境：插件内的 connector 同时运行在**桌面端与移动端**（iOS/Android）

## 安装

```bash
npm install --save-dev @sync-vault/connector-sdk
```

本包不提供运行时代码：类型用 `import type` 引入，编译后不会残留任何依赖。
Connector 的 `main.js` 必须是**自包含单文件**，运行时只能使用宿主注入的 `ctx` 能力。

## 最小例子

一个 connector 就是一个目录，两个文件：

```
my-connector/
├── manifest.json
└── main.js
```

`manifest.json`：

```json
{
  "id": "my-connector",
  "name": "My Connector",
  "version": "1.0.0",
  "apiVersion": "0.2",
  "type": "video-source",
  "author": "your-name",
  "homepage": "https://github.com/you/my-connector"
}
```

`id` 必须与目录名一致。

`main.js`：

```js
module.exports = {
    create(ctx) {
        return {
            match(url) {
                return url.includes('media.example.com');
            },
            async resolve(url, onProgress) {
                onProgress?.('解析中…');
                const resp = await ctx.request({ url: `https://media.example.com/api/resolve?u=${encodeURIComponent(url)}` });
                if (resp.status !== 200) {
                    throw new Error(`接口返回 ${resp.status}`);
                }
                const data = resp.json;
                if (data.code !== 0) {
                    throw new Error(`解析失败：${data.message}`);
                }
                return {
                    url: data.playUrl,
                    urlType: 'direct',
                    mediaType: 'raw',
                    mediaInfo: [{ width: data.width, height: data.height, resolution: data.quality, url: data.playUrl }],
                };
            },
            dispose() {
                // 可选：清理定时器、连接等
            },
        };
    },
};
```

把目录整个拷进 vault：

```
<vault>/.obsidian/plugins/sync-vault-ce/connectors/my-connector/
```

然后在 Obsidian 里执行命令 **“重新加载用户 Connectors”**（Reload user connectors）。
在笔记里粘贴 `https://media.example.com/...` 即可播放。

## 本地调试

不用开 Obsidian，直接在 Node（>= 18）里跑：

```bash
# 冒烟：加载 → match → resolve，打印解析结果
npx sync-vault-connector-mock ./my-connector "https://media.example.com/video/1"

# agent-session 类型：加载 → probe → discover（不带地址）
npx sync-vault-connector-mock ./my-connector
```

或者在脚本里用 mock 能力：

```js
const { loadConnector, createMockContext } = require('@sync-vault/connector-sdk/mock');

const { manifest, instance } = await loadConnector('./my-connector');
console.log(manifest.id, instance.match('https://media.example.com/video/1'));
console.log(await instance.resolve('https://media.example.com/video/1'));
```

mock 的校验规则、`main.js` 求值方式与宿主一致；差异只有两处：`ctx.request` 走 Node 的 `fetch`（无 CORS 限制），`ctx.dir` 是本地绝对路径（宿主里是 vault 内相对路径）。

## TypeScript

- [templates/ts](templates/ts) —— TypeScript 工程模板：源码 + esbuild 打包成单个 CJS `main.js`，带类型检查与本地冒烟脚本
- [templates/js](templates/js) —— 零构建模板：一个 `manifest.json` + 一个 `main.js`，拷进 vault 即可

## 文档

- [CONNECTOR_API.md](CONNECTOR_API.md) —— 契约细节：manifest 字段、ctx 能力、`MediaStreamInfo`、生命周期、约束
- [examples/web-video](examples/web-video) —— 最小示例，建议从这里入手：解析公开网络可访问的直链 / HLS 视频地址
- [examples/bilibili](examples/bilibili) —— 用本 SDK 写的 B 站解析 connector（与插件内置实现同一套解析逻辑）
- [examples/xiaohongshu](examples/xiaohongshu) —— 用本 SDK 写的小红书视频笔记解析 connector（CDN 直连，桌面端与移动端均可播放）
- [examples/qoder](examples/qoder) —— agent-session 类型：把 Qoder CLI 本机会话导出到受管仓库，在其他设备落位后用 `qoder -r` 恢复（仅桌面端）

## 许可

[MIT](LICENSE)
