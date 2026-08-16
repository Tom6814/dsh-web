// 构建期脚本：给 directory-picker-auto 的 resolve 加环境变量覆盖。
// 背景：云端容器本应解析为 browse（服务器端目录浏览），但某些部署环境下
// auto 会误判 native（浏览器本地文件选择），导致两个症状：
//   1. 目录选择器显示「本机目录 / 路径越界」（浏览器 File System Access 句柄
//      无法映射成服务器路径，服务端 fully-qualified 校验拒绝）
//   2. 部分环境连带出现 require is not defined
// 修复：resolve 开头支持 DSH_DIRECTORY_PICKER=browse|native 显式覆盖；
// 镜像默认 ENV DSH_DIRECTORY_PICKER=browse（云端固定服务端浏览），
// 本地开发不设该变量则维持 auto 原生行为。
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-directory-picker-auto/lib/index.js';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'function resolveDirectoryPickerBackend(facts) {';
if (!s.includes(anchor)) {
  console.error('[patch-picker-auto] 锚点未找到，跳过');
  process.exit(0);
}
const injected = 'function resolveDirectoryPickerBackend(facts) {\n        // (patched) explicit override: DSH_DIRECTORY_PICKER=browse|native pins the backend\n        const forced = process.env.DSH_DIRECTORY_PICKER;\n        if (forced === "browse" || forced === "native") return forced;';
s = s.replace(anchor, injected);
fs.writeFileSync(p, s);
console.log('[patch-picker-auto] resolve 已支持 DSH_DIRECTORY_PICKER 覆盖');
