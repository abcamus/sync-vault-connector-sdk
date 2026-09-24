# 模板

两个起点，按习惯选一个：

- [js](js) —— 零构建：`manifest.json` + `main.js`，改完直接拷进 vault。
- [ts](ts) —— TypeScript：`src/index.ts` 写代码，`npm run build` 用 esbuild 打包成单个 CJS `main.js`。

## 用起来

1. 把模板目录复制出来，改成你的 connector 名，例如 `my-connector`。
2. **把 `manifest.json` 里的 `id` 改成目录名同名**（宿主会校验两者一致），顺手改 `name` / `version` / `description` / `author` / `homepage`。
3. 改 `main.js`（或 TS 的 `src/index.ts`）里的 `match` / `resolve`。
4. 本地跑一遍：

```bash
# JS 模板：一条命令，不需要装依赖
npx sync-vault-connector-mock . "https://demo.example.com/video/1"

# TS 模板
npm install
npm run smoke -- "https://demo.example.com/video/1"
```

5. 把整个目录拷到 `<vault>/.obsidian/plugins/sync-vault-ce/connectors/my-connector/`，
   在 Obsidian 里执行命令“重新加载用户 Connectors”。

TS 模板里 `main.js` 是构建产物，已被 `.gitignore` 忽略；拷贝进 vault 前记得先 `npm run build`。
