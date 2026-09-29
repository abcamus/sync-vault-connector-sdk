# web-video 示例 connector

SDK 的**最小示例**：把公开网络可访问的视频地址解析为可播放流 —— 拿到地址就能直接取到，
不需要页面解析、Cookie 或平台 API。

| 地址类型 | 支持的扩展名 | 解析结果 | 播放方式 |
| --- | --- | --- | --- |
| 直链视频文件 | `.mp4` `.m4v` `.mov` `.webm` `.ogv` | `mediaType: 'raw'` | 播放器直接播放 |
| HLS 播放列表 | `.m3u8` | `mediaType: 'hls'` | 桌面端 hls.js；iOS 走原生 HLS |

`resolve` 会先探测源站（HEAD，源站不支持时退回只取 1 字节的 Range 请求），
把「链接已失效、返回的其实是网页」提前变成明确报错，而不是让播放器挂在一个打不开的地址上。

需要发送防盗链头、解析多档清晰度等更复杂的例子，见 [examples/bilibili](../bilibili) 与 [examples/xiaohongshu](../xiaohongshu)。

## 安装

把整个 `web-video/` 目录拷到：

```
<vault>/.obsidian/plugins/sync-vault-ce/connectors/web-video/
```

然后在 Obsidian 里执行命令“重新加载用户 Connectors”。

## 上手测试

把下面这段放进任意笔记，点开代码块即可播放：

````markdown
```cloudvideo
https://mdn.github.io/shared-assets/videos/flower.mp4 | Flower
```
````

公开测试源（已实测两个地址都带 `access-control-allow-origin: *`，桌面端与移动端均可播放）：

- 直链 mp4：`https://mdn.github.io/shared-assets/videos/flower.mp4`
- HLS：`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`

## 本地调试（不需要 Obsidian）

```bash
npx sync-vault-connector-mock . "https://mdn.github.io/shared-assets/videos/flower.mp4"
npx sync-vault-connector-mock . "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
```

## 与内置能力的关系

- **直链文件**：宿主本来就能按直链播放（内置兜底）；这个 connector 的增益是播放前探测、明确报错、记录文件大小。
- **HLS（.m3u8）**：内置不认识 `.m3u8`（会判为不支持的类型）；装上后由这个 connector 接管，
  桌面端经 hls.js 播放，是真正新增的能力。

## 为什么要求源站允许跨域

播放器以 `<video crossorigin="anonymous">` 加载，本 connector 不设 `proxy`，源站必须返回
`Access-Control-Allow-Origin`；移动端没有本地代理，源站不允许跨域就无法播放。自测：

```bash
curl -H 'Origin: app://obsidian.md' -I <视频地址>
```

响应里有 `access-control-allow-origin` 即可直连播放；没有的话，桌面端可以改为 `proxy: true`
（设 `proxy` 时 `headers` 才会随请求发送），移动端只能换源或在 `resolve` 里明确报错。

## 扩展方向

- **更多地址形态**：改 `match()` 的扩展名列表即可；注意保持克制，命中即接管，不要匹配所有 http(s) 地址。
- **m3u8 多档清晰度**：解析播放列表里的 `#EXT-X-STREAM-INF`，把各档写进 `mediaInfo`（播放器支持多档切换）。
- **需要防盗链头的地址**：在返回值里给 `headers` + `proxy: true`，并按移动端无代理的约束处理（参考 examples/bilibili）。
