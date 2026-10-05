#!/usr/bin/env node
/**
 * 冒烟跑一个 connector：加载 → 能力校验 → 运行。
 *
 *   node mock/cli.js ../my-connector "https://example.com/video/1"   # video-source: match → resolve
 *   node mock/cli.js ../my-connector                                 # agent-session: probe → discover
 */
'use strict';

const { loadConnector } = require('./index');

const [dir, url] = process.argv.slice(2);
if (!dir) {
    console.error('用法: sync-vault-connector-mock <connector目录> [视频地址]');
    process.exit(2);
}

loadConnector(dir)
    .then(async ({ manifest, instance }) => {
        if (manifest.type === 'agent-session') {
            console.log(`[${manifest.id}] agent-session 已加载，接口校验通过`);
            const probe = await instance.probe();
            console.log('probe() =', JSON.stringify(probe, null, 2));
            const refs = await instance.discover();
            console.log(`discover() = ${refs.length} 个会话`);
            for (const ref of refs.slice(0, 5)) {
                console.log(`  · ${ref.sessionId}  ${ref.project}  (${new Date(ref.updatedAt).toLocaleString()})`);
            }
            if (refs.length > 5) console.log(`  … 其余 ${refs.length - 5} 个省略`);
            return;
        }
        if (!url) {
            console.error('用法: sync-vault-connector-mock <connector目录> <视频地址>');
            process.exit(2);
        }
        const matched = instance.match(url);
        console.log(`[${manifest.id}] match() = ${matched}`);
        if (!matched) {
            console.error('match() 为 false：宿主不会把该地址交给这个 connector。');
            process.exit(1);
        }
        const info = await instance.resolve(url, (message) => console.log(`  · ${message}`));
        console.log(JSON.stringify(info, null, 2));
    })
    .catch((e) => {
        console.error(`失败: ${e.message}`);
        process.exit(1);
    });
