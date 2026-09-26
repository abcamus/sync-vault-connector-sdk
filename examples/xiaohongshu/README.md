# 小红书示例 connector

用本 SDK 写的小红书（Xiaohongshu）视频笔记解析 connector：

- 支持 `/explore/<id>`、`/discovery/item/<id>`、`/user/profile/<uid>/<noteid>` 与 `xhslink.com` / `xhslink.cn` 短链
- 解析路径：取笔记页 HTML → `window.__INITIAL_STATE__` → `note.video.media.stream`，编码按 h264 优先
- 视频直链来自 xhscdn CDN（响应带 `access-control-allow-origin: *`、支持 Range），**不设 proxy、不经宿主代理**，桌面端与移动端都能播

## 安装

把整个 `xiaohongshu/` 目录拷到：

```
<vault>/.obsidian/plugins/sync-vault-ce/connectors/xiaohongshu/
```

然后在 Obsidian 里执行命令“重新加载用户 Connectors”。

## 可选配置：Cookie

在 `xiaohongshu/settings.json` 里填 Cookie（无需登录账号，游客态即可）：

```json
{
  "cookie": "a1=xxxxxx; web_session=xxxxxx"
}
```

取法：浏览器打开 xiaohongshu.com → 开发者工具 → Network → 任意请求 → 复制 `Cookie` 请求头整行粘进来。
不配置也能解析公开视频（实测 720P HD）；部分笔记有登录门槛，解析失败可配置 Cookie 后重试。

`settings.json` 是 vault 里的明文文件，注意别把它同步到不该去的地方。

## 改 main.js 前先看的两个实测约束

1. 请求笔记页必须带浏览器式 `Accept` 头（`text/html,application/xhtml+xml,...`）。缺了它（哪怕有正常 UA）小红书会把请求 302 到登录页，页面里没有任何笔记数据。
2. 取流优先 `backupUrls[0]`：无签名、长期有效、https 可用；`masterUrl` 带 `sign` 参数约 2 天过期，仅作兜底。

## 本地调试

```bash
npx sync-vault-connector-mock . "https://www.xiaohongshu.com/explore/<id>"
```

注意：小红书对非浏览器 TLS 指纹有拦截，Node 环境的 mock 工具大概率拿不到笔记页（会停在登录跳转页）。
这属于环境限制、不代表 connector 有问题；验证解析请把目录拷进测试 vault，用真实宿主跑。

## 实测记录

在真实 vault（Obsidian 桌面端）用 `/explore/<id>`（带 `xsec_token`）实测：解析出 720×1280 h264 直链并正常播放，
封面、分辨率（720P）显示正确。短链自 2025-06 起服务端可能只返回 JS 跳转壳，
connector 会再从页面里找一次带 token 的完整笔记地址；找不到时提示改用完整地址。
