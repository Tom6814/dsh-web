// 构建期脚本：把 dsh browse directory picker 的默认目录对齐持久化卷（/data）。
// 文件浏览器的初始路径取 homedir()（容器里是 /root，非持久），会引导用户把
// 工作区建到易丢的临时目录；这里改为 DSH_HOME 的父目录（/data）。
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'const home = homedir();';
if (!s.includes(anchor)) {
  console.error('[patch-picker] 锚点未找到，跳过');
  process.exit(0);
}
s = s.replace(anchor, "const home = (process.env.DSH_HOME ? require('node:path').dirname(process.env.DSH_HOME) : '') || homedir();");
fs.writeFileSync(p, s);
console.log('[patch-picker] 默认目录已对齐持久化卷 (/data)');
