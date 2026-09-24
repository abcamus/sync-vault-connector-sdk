/**
 * 本包只在编译期提供类型，不提供任何运行时代码。
 *
 * connector 的 main.js 必须是自包含单文件：运行时只能使用宿主注入的 ctx 能力，
 * 不能 require 本包或任何第三方模块。
 */
throw new Error(
    'sync-vault-connector-sdk 不提供运行时代码：类型请用 `import type` 引入；' +
    '本地调试请使用 sync-vault-connector-sdk/mock。'
);
