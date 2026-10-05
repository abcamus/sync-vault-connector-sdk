# qoder 示例 connector（agent-session 类型）

把本机 **Qoder CLI** 的会话导出到 Sync Vault 受管仓库，经过云盘（或 P2P）到达另一台设备后，
落位回 Qoder 的目录结构，并给出 `qoder -r <session-id>` 恢复指引。
对应宿主工作流：探测 → 发现 → 导出纳管 → 对端只读可见 → 落位恢复 → 回流检测。

本 connector 只负责 **Qoder 的存储布局与恢复方式**；受管仓库、版本游标、
跨设备分发与冲突可见性都由宿主完成。

## 契约映射

| 方法 | 作用 | 关键事实 |
| --- | --- | --- |
| `probe()` | 探测本机是否具备 Qoder | 只看会话根目录是否存在，不校验 CLI |
| `discover()` | 列出本机会话 | `<configDir>/projects/<项目>/<session-id>.jsonl` |
| `export(ref)` | 读数据包 | `<id>.jsonl` + `<id>/state.json`（存在时），游标 = 较新 mtime + 合计大小 |
| `stage(bundle, env)` | 写回本机并给出恢复指引 | 同构路径下复用源设备观察到的项目目录名 |

宿主侧的受管仓库布局（本 connector 不感知）：

```
.sync-vault/agent-sessions/qoder/<session-id>/
├── payload/<session-id>.jsonl
├── payload/<session-id>/state.json
└── meta.json       # 来源设备、导出时间、原生游标
```

## 安装

1. 把整个 `qoder/` 目录拷到 `<vault>/.obsidian/plugins/sync-vault-ce/connectors/qoder/`
   （或用「Connector 管理」小组件的**本地文件安装**：同时选中 `manifest.json` 与 `main.js`）。
2. 执行命令“重新加载用户 Connectors”。
3. 在「Agent 会话」小组件里即可看到本机会话与已纳管会话。

不装 Obsidian 也可以先在本地冒烟（加载校验 + `probe` + `discover`）：`node <SDK 目录>/mock/cli.js <本目录>`。

## 配置（可选）

`settings.json` 放在 connector 目录下；两个模拟设备时用它指向不同的会话根：

```json
{ "configDir": "/tmp/qoder-device-b/.qoder" }
```

默认 `configDir` 为 `~/.qoder`（亦可用官方环境变量 `QODER_CONFIG_DIR` 直接重定向 Qoder 自身）。

## 单机双目录试跑（当前验证口径）

同机验“公司导出 → 回家落位”的最省事路径：

1. 复制一份会话根作为“设备 B”：`cp -R ~/.qoder /tmp/qoder-device-b`
2. 在组件里导出任意本机会话（写入 `.sync-vault/agent-sessions/qoder/…`）。
3. 给 connector 的 `settings.json` 写入上面的 `configDir`，重新加载 Connectors。
4. 对已纳管条目点「落位」——数据会被写进 `/tmp/qoder-device-b/.qoder/projects/…`，
   并复制 `qoder -r <session-id>` 恢复命令；把设备 B 的会话根换给 Qoder
   （`QODER_CONFIG_DIR=/tmp/qoder-device-b/.qoder`）执行该命令即可续接。

## 已知缺口（骨架阶段的显式边界）

- **项目目录名 ↔ cwd 编码规则未查实**：`discover()` 暂不产出 `ref.cwd`，跨设备路径差异的拒绝逻辑要等侦察落地后才会实际触发；在此之前 `stage()` 只覆盖**同构路径**场景（同机双目录验证、或两端 cwd 相同），不猜编码。
- `state.json` 是否含 cwd、`jsonl` 首行是否可作标题：待侦察，确认后补 `ref.cwd` / `ref.title`。
- 会话的外置大对象附件暂未纳入数据包（契约的附件同步属后续阶段）。
- 恢复前的单写者约束靠人工保证（SessionLease 排他交接属宿主后续阶段）。

## 注意

- **仅桌面端**：vault 之外的文件访问走 `ctx.desktop`（宿主受管通道），移动端组件只读展示。
- **不做自动执行**：`stage()` 只落位并返回恢复命令；是否恢复、何时恢复由你决定。
