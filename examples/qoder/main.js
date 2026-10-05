/**
 * qoder connector —— 把 Qoder CLI 的本机会话搬运到其他设备并落位恢复。
 *
 * 形态：agent-session 类型。宿主负责受管仓库（.sync-vault/agent-sessions/）、
 * 版本游标与跨设备分发；本 connector 只负责 Qoder 的存储布局与恢复方式：
 *
 *   probe()    —— 本机是否具备 Qoder（会话根目录是否存在）
 *   discover() —— 列出 <configDir>/projects/<项目>/<session-id>.jsonl 会话
 *   export()   —— 读出会话的 <id>.jsonl 与 <id>/state.json 数据包
 *   stage()    —— 把数据包写回 <configDir>/projects/<项目>/…，返回 `qoder -r <id>` 恢复指引
 *
 * 硬性约定（与宿主契约一致）：
 *   - 不使用 Node API：vault 之外的文件读写一律走 ctx.desktop（宿主受管，仅桌面端）
 *   - 移动端不可用：ctx.desktop 缺失时各方法显式报错，宿主会在移动端隐藏操作入口
 *   - 不自动执行恢复命令：stage 只落位并返回 ResumePlan，是否继续跑由人决定
 *   - 同一会话保持单写者：恢复前请确认没有其他设备/实例在写这条会话
 *
 * 已知缺口（骨架阶段的显式边界，见 README）：
 *   - 项目目录名与 cwd 的编码规则待侦察：跨设备且路径不同时 stage 显式拒绝，不猜编码
 *   - state.json 是否含 cwd / jsonl 首行是否可作标题待侦察：ref.cwd / ref.title 暂缺省
 *   - 会话的大对象外置附件暂未纳入数据包
 */

/** 默认会话根目录（相对家目录）；可用 settings.json 的 configDir 覆盖 */
const DEFAULT_CONFIG_DIRNAME = '.qoder';

module.exports = {
    create(ctx) {
        function requireDesktop() {
            if (!ctx.desktop) {
                throw new Error('Qoder 会话的同步与恢复仅支持桌面端');
            }
            return ctx.desktop;
        }

        async function configDir() {
            const desktop = requireDesktop();
            const settings = (await ctx.getSettings()) || {};
            return settings.configDir || `${desktop.homeDir()}/${DEFAULT_CONFIG_DIRNAME}`;
        }

        async function projectsDir() {
            return `${await configDir()}/projects`;
        }

        function sessionIdOf(filePath) {
            const name = filePath.slice(filePath.lastIndexOf('/') + 1);
            return name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : null;
        }

        /**
         * 会话数据 = <id>.jsonl + <id>/state.json（存在时）。
         * 游标取两者的较新 mtime 与合计大小；discover 与 export 共用本函数，
         * 保证宿主回流检测的对比口径一致。
         */
        async function statSession(desktop, projectDir, sessionId) {
            const jsonlStat = await desktop.stat(`${projectDir}/${sessionId}.jsonl`);
            let mtime = jsonlStat.mtime;
            let size = jsonlStat.size;
            const statePath = `${projectDir}/${sessionId}/state.json`;
            if (await desktop.exists(statePath)) {
                const stateStat = await desktop.stat(statePath);
                mtime = Math.max(mtime, stateStat.mtime);
                size += stateStat.size;
            }
            return { mtime, size };
        }

        async function probe() {
            const desktop = requireDesktop();
            const dir = await configDir();
            const present = await desktop.exists(dir);
            return {
                present,
                configDir: dir,
                note: present
                    ? '已找到 Qoder 的会话目录；未验证 Qoder 命令是否可用'
                    : '没有找到 Qoder 的会话目录；装在自定义位置时，可在本 Connector 的 settings.json 里设置 configDir',
            };
        }

        async function discover() {
            const desktop = requireDesktop();
            const root = await projectsDir();
            if (!await desktop.exists(root)) {
                return [];
            }
            const refs = [];
            for (const projectDir of (await desktop.list(root)).folders) {
                const project = projectDir.slice(projectDir.lastIndexOf('/') + 1);
                for (const filePath of (await desktop.list(projectDir)).files) {
                    const sessionId = sessionIdOf(filePath);
                    if (!sessionId) continue;
                    const cursor = await statSession(desktop, projectDir, sessionId);
                    refs.push({
                        sessionId,
                        project,
                        updatedAt: cursor.mtime,
                        nativeMtime: cursor.mtime,
                        nativeSize: cursor.size,
                        // TODO(侦察)：state.json 若含工作目录则补 cwd；jsonl 首行若可解析则补 title
                    });
                }
            }
            refs.sort((a, b) => b.updatedAt - a.updatedAt);
            return refs;
        }

        async function exportSession(ref) {
            const desktop = requireDesktop();
            const projectDir = `${await projectsDir()}/${ref.project}`;
            // 重新探测游标：以写包时刻为准，避免调用方传入过期的 ref
            const cursor = await statSession(desktop, projectDir, ref.sessionId);

            const files = [];
            files.push({
                path: `${ref.sessionId}.jsonl`,
                data: await desktop.readBinary(`${projectDir}/${ref.sessionId}.jsonl`),
            });
            const statePath = `${projectDir}/${ref.sessionId}/state.json`;
            if (await desktop.exists(statePath)) {
                files.push({
                    path: `${ref.sessionId}/state.json`,
                    data: await desktop.readBinary(statePath),
                });
            }

            return {
                sessionId: ref.sessionId,
                project: ref.project,
                title: ref.title,
                cwd: ref.cwd,
                files,
                nativeMtime: cursor.mtime,
                nativeSize: cursor.size,
            };
        }

        async function stage(bundle, env) {
            const desktop = requireDesktop();
            const targetCwd = (env.cwdMap && bundle.cwd && env.cwdMap[bundle.cwd]) || bundle.cwd;

            if (targetCwd !== bundle.cwd) {
                throw new Error(
                    '两台设备上的工作目录不一样，暂时无法自动换算；'
                    + '请让两台设备使用相同的工作目录后再试',
                );
            }

            // 同构路径下目录名与源设备一致，可直接复用导出端观察到的 project 名
            const projectDir = `${await projectsDir()}/${bundle.project}`;
            for (const file of bundle.files) {
                const target = `${projectDir}/${file.path}`;
                await desktop.mkdir(target.slice(0, target.lastIndexOf('/')));
                await desktop.writeBinary(target, file.data);
            }

            return {
                command: `qoder -r ${bundle.sessionId}`,
                cwd: targetCwd,
                notes: [
                    '恢复前请确认这条会话没有在其他设备上打开，避免两边同时修改',
                    '本机需已安装 Qoder；在终端运行上面的命令即可继续',
                ],
            };
        }

        return { probe, discover, export: exportSession, stage };
    },
};
