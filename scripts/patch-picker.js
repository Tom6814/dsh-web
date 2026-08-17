// 构建期脚本：把 dsh browse directory picker 的默认目录对齐持久化卷（/data）。
// 文件浏览器的初始路径取 homedir()（容器里是 /root，非持久），会引导用户把
// 工作区建到易丢的临时目录；这里改为 DSH_HOME 的父目录（/data）。
//
// ⚠️ 目标文件 dsh-host-directory-picker-browse/lib/index.js 是 ESM
//   （package.json "type":"module"），运行时没有 require。注入代码必须复用
//   该文件顶部已 import 的 { dirname } from "node:path"，绝不能写 require——
//   否则每次 list()（打开目录选择器）都会抛 "require is not defined"，经 RPC
//   回传后渲染进对话框列表区（浏览器控制台不报错，极难排查）。
//
// 本脚本自身由 `node patch-picker.js` 以 CJS 执行，脚本内用 require 无妨。
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'const home = homedir();';
if (!s.includes(anchor)) {
  console.error('[patch-picker] 锚点未找到，跳过');
  process.exit(0);
}
s = s.replace(anchor, "const home = (process.env.DSH_HOME ? dirname(process.env.DSH_HOME) : '') || homedir();");
fs.writeFileSync(p, s);
console.log('[patch-picker] 默认目录已对齐持久化卷 (/data)，复用 ESM import 的 dirname');
