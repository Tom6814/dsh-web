// 构建期脚本：修复 dsh-terminal-bash 与 dsh-tool-bash-persistent 的 prompt 暗号不匹配
// 导致的每命令 ~3.5 秒延迟问题。
//
// 背景：terminal-bash 的快结算路径 A（pollReadiness）需要 promptSeen && promptTextSeen，
// 其中 promptTextSeen 要求 promptTail === "dsh> "（CONTROLLED_PROMPT）。
// 但 tool-bash-persistent 把 PS1 覆盖为 "__DSH_PERSISTENT_BASH_PROMPT__ "（31字符），
// 导致 promptTextSeen 永远为 false → path A 永远不触发 → 每条命令兜底等 3500ms。
//
// 修复：从 path A 条件中移除 promptTextSeen 门控，仅靠 OSC 133;D 语义标记（promptSeen）
// 触发快结算。OSC 标记由 PROMPT_COMMAND 发射，tool-bash-persistent 不覆盖 PROMPT_COMMAND，
// 所以标记照常触发。条件仍保留 idleFor ≥ 50ms + foreground===shellPgid 双重保险。
//
// 参考：https://x.com/NFT_Chen/status/2089266274362908790
const fs = require('fs');
const p = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js';
let s = fs.readFileSync(p, 'utf8');
const anchor = 'this.promptSeen && this.promptTextSeen && idleFor >= this.config.pollIntervalMs';
if (!s.includes(anchor)) {
  console.error('[patch-terminal-bash-prompt] 锚点未找到，可能已修复或版本不匹配，跳过');
  process.exit(0);
}
s = s.replace(anchor, 'this.promptSeen && idleFor >= this.config.pollIntervalMs');
fs.writeFileSync(p, s);
console.log('[patch-terminal-bash-prompt] 快结算路径 A 已解除 promptTextSeen 门控（OSC-only settle）');
