# Bilibili 示例 connector

用本 SDK 写的 B站解析 connector —— Sync Vault 的 B站 播放由 connector 承担，宿主不内置 B站 解析：

- 支持 `/video/BV…`、`/video/av…`、`?p=N` 分 P、`b23.tv` 短链
- 多分P 视频返回分集列表（`parts`），播放器侧栏可切换分集，播完自动续播下一集
- 取 `html5` 平台的合并流（mp4），清晰度按 `1080P60 → 1080P → 720P` 逐级回退
- 合并流需要 `Referer` 防盗链头，经宿主本地代理转发，**仅桌面端可用**（移动端会明确报错）

## 安装

把整个 `bilibili/` 目录拷到：

```
<vault>/.obsidian/plugins/sync-vault-ce/connectors/bilibili/
```

然后在 Obsidian 里执行命令“重新加载用户 Connectors”。

B站地址由这个 connector 解析；不想要时把目录删掉（或在 Connector 列表中禁用）、重新加载即可。

## 可选配置：Cookie

在 `bilibili/settings.json` 里填 Cookie 可以解锁更高清晰度 / 会员内容：

```json
{
  "cookie": "SESSDATA=xxxxxx; bili_jct=xxxxxx"
}
```

取法：浏览器登录 B站 → 打开任意视频页 → 开发者工具 → Network → 任意 `api.bilibili.com` 请求 →
复制请求头里的 `Cookie` 整行粘进来。不配置也能解析公开视频（一般是 1080P 以下）。

`settings.json` 是 vault 里的明文文件，注意别把它同步到不该去的地方。

## 本地调试

```bash
npx sync-vault-connector-mock . "https://www.bilibili.com/video/BV1xx411c7mD"
```
