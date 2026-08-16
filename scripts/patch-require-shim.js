// 构建期脚本：在 dsh 页面 <head> 的最早位置注入 require polyfill。
// 根因：云端"选择工作区"对话框的组件在生命周期钩子里裸 require('fs'/'path'/
// 'electron')，浏览器没有 require；错误被 try/catch 后渲染进目录列表区。
// 插件层的兜底（github-sync factory）晚于组件早期执行，必须注入到页面最先
// 加载的 __DSH_BOOT__ script 之前。
//
// 实现：整行替换 dsh-client-modules/lib/index.js 的 injectBootManifest 里的
// `const script = ...;`，在 window.__DSH_BOOT__ script 前插入 shim script。
// 注意转义链：shim 源码用单反斜杠 `</script>`（JS 字符串里 \/ 即 /）；
// JSON.stringify 会把 / 转义为 \/，index.js 运行时再还原为 /，最终 HTML 中
// 是真实闭合标签 `</script>`（否则浏览器不闭合、吞掉 __DSH_BOOT__）。
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js';
let s = fs.readFileSync(p, 'utf8');
if (!/const script = .*__DSH_BOOT__/.test(s)) {
  console.error('[patch-require-shim] 锚点未找到，跳过');
  process.exit(0);
}
const shim = `<script>(function(){var S={existsSync:function(){return false},readdirSync:function(){return[]},statSync:function(){var e=new Error("ENOENT");e.code="ENOENT";throw e},mkdirSync:function(){},readFileSync:function(){var e=new Error("ENOENT");e.code="ENOENT";throw e},writeFileSync:function(){},promises:{}},P={join:function(){var a=[].slice.call(arguments);return a.filter(Boolean).join("/").replace(/\\/{2,}/g,"/")},dirname:function(p){var s=String(p||"");var i=s.lastIndexOf("/");return i>0?s.slice(0,i):"."},basename:function(p){return String(p||"").split("/").pop()},normalize:function(p){return String(p||"")},resolve:function(){return[].slice.call(arguments).filter(Boolean).join("/")},relative:function(){return""},isAbsolute:function(p){return String(p||"").charAt(0)==="/"},extname:function(p){var m=String(p||"").match(/\\.[^./\\\\]+$/);return m?m[0]:""},sep:"/"};window.require=window.require||function(id){var k=String(id);if(k==="fs"||k==="node:fs")return S;if(k==="path"||k==="node:path")return P;if(k==="electron")return{};if(k==="os")return{homedir:function(){return"/"},tmpdir:function(){return"/tmp"},platform:"browser",EOL:"\\n"};if(k==="child_process")return{};return{}}})();</script>`;
const replacement = 'const script = ' + JSON.stringify(shim) + ' + `<script>window.__DSH_BOOT__ = ${JSON.stringify(graph).replaceAll("<", "\\\\u003c")}</script>`;';
s = s.replace(/const script = .*;/, replacement);
fs.writeFileSync(p, s);
console.log('[patch-require-shim] 已在 __DSH_BOOT__ 前注入 require polyfill');
