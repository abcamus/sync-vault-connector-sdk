/**
 * 本地冒烟：在 Node 里加载 ./main.js 并跑一遍 match + resolve。
 *
 *   npm install
 *   npm run smoke -- "https://demo.example.com/video/1"
 */
import { fileURLToPath } from 'node:url';

import { loadConnector } from 'sync-vault-connector-sdk/mock';

const url = process.argv[2];
if (!url) {
    console.error('用法: npm run smoke -- <视频地址>');
    process.exit(2);
}

const dir = fileURLToPath(new URL('.', import.meta.url));
const { manifest, instance } = await loadConnector(dir);

console.log(`[${manifest.id}] match() = ${instance.match(url)}`);
if (!instance.match(url)) {
    console.error('match() 为 false：宿主不会把该地址交给这个 connector。');
    process.exit(1);
}

const info = await instance.resolve(url, (message) => console.log(`  · ${message}`));
console.log(JSON.stringify(info, null, 2));
