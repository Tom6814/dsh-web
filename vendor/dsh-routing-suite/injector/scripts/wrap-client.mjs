// 把 tsc 编译的 ESM client 转成 dsh loader 格式（window.__ModuleLoader__.load）
import { readFileSync, writeFileSync } from 'node:fs';

const file = '/Users/sliverwhale/.trae/work/6a7dc3dd5077d310a5c069c2/dsh-routing-suite/injector/lib/client/index.js';
let s = readFileSync(file, 'utf8');
s = s.replace(/^export /gm, '');
// 去掉 sourceMappingURL（路径会失效）
s = s.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '');
const out = `// dsh-super-injector client（由 tsc 产物转换，loader 格式）
window.__ModuleLoader__.load({
\tid: '@dsh-external/dsh-super-injector',
\tfactory: (require) => {
\t\tvar module = { exports: {} };
${s.split('\n').map((l) => '\t\t' + l).join('\n')}
\t\tmodule.exports = { inject, apply };
\t\treturn module.exports;
\t}
});
`;
writeFileSync('/Users/sliverwhale/.trae/work/6a7dc3dd5077d310a5c069c2/dsh-routing-suite/injector/lib/client.js', out);
console.log('lib/client.js 已生成,', out.length, 'bytes');
