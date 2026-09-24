#!/usr/bin/env node
/**
 * 冒烟跑一个 connector：加载 → match → resolve，打印解析结果。
 *
 *   npx sync-vault-connector-mock ./my-connector "https://example.com/video/1"
 *   node mock/cli.js ../my-connector "https://example.com/video/1"
 */
'use strict';

const { loadConnector } = require('./index');

const [dir, url] = process.argv.slice(2);
if (!dir || !url) {
    console.error('用法: sync-vault-connector-mock <connector目录> <视频地址>');
    process.exit(2);
}

loadConnector(dir)
    .then(async ({ manifest, instance }) => {
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
