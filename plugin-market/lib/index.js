// dsh-plugin-market — host half
// 提供 HTTP API：
//   GET  /api/plugin-market/search?q=<kw>    代理 GitHub API 搜索 topic:dsh-plugin 的仓库
//   POST /api/plugin-market/install {spec}   执行 `dsh plugin --profile <p> add <spec>` 安装
//   POST /api/plugin-market/restart          优雅重启服务（插件安装后生效；容器自动拉起）
//   GET  /api/plugin-market/list             当前 loader 插件清单（含启用状态）
//   POST /api/plugin-market/toggle {entryId} 启用/停用插件：写入 $DSH_HOME/cordis.patch.yml，
//                                            由 dsh 的 HMR 用户补丁热更新机制即时生效，重启后保持
//   GET  /preview/file/<relpath>             预览工作区里的 HTML/Markdown 等文件
//   GET  /preview/port/<port>/<path>         HTTP 反代到容器内 127.0.0.1:<port>（WebSocket 走 nginx）
// 并通过 tapIndex 注入脚本隐藏官方「打开配置文件」按钮（容器环境没有本地编辑器）。
// 挂载方式：在 cordis patch 中 insert 一行，name 指向本文件。
import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export const name = 'plugin-market-host';
export const inject = ['webServer', 'loader'];

const GH_SEARCH = 'https://api.github.com/search/repositories';

// ── dsh 数据目录解析（与 @deepseek-ai/dsh-home-paths 的 resolveDshHome 一致）──
// 用户补丁层 $DSH_HOME/cordis.patch.yml 是所有 profile 共享的「机器级偏好」，
// 优先级高于 bundle 补丁层；dsh 运行时会热监听它（watchUserPatches + HMR）。
function dshHome() {
	const env = process.env.DSH_HOME;
	if (env !== void 0 && String(env).trim().length > 0) {
		const value = String(env).trim();
		return resolve(value.startsWith('~/') ? homedir() + value.slice(1) : value);
	}
	return resolve(homedir(), '.dsh');
}
const HOME_PATCH = process.env.DSH_HOME_PATCH ?? resolve(dshHome(), 'cordis.patch.yml');

/** 读取请求体（限制 1MB）。 */
function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
			if (data.length > 1e6) {
				reject(new Error('request body too large'));
				req.destroy();
			}
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

function sendJson(res, status, obj) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(obj));
}

/** 把 GitHub 仓库项收敛为市场卡片所需字段。 */
function toItem(repo) {
	return {
		fullName: repo.full_name,
		url: repo.html_url,
		description: repo.description ?? '',
		stars: repo.stargazers_count ?? 0,
		language: repo.language ?? '',
		updated: repo.pushed_at ?? '',
		topics: Array.isArray(repo.topics) ? repo.topics : []
	};
}

/**
* 归一化 pnpm 安装 spec：
*   - `owner/repo` GitHub 简写 → `github:owner/repo`（pnpm 不认 npm 的简写语法）
*   - `@scope/pkg` npm 包名 / git URL / 其它形式原样透传
*/
function normalizeSpec(spec) {
	const s = String(spec ?? '').trim();
	if (!s) return s;
	if (/^@[^/]+\/[^/]+$/.test(s)) return s;
	if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `github:${s}`;
	return s;
}

/** YAML 字符串引号（含冒号的 entryId 必须引起来）。 */
function yamlQuote(value) {
	return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
* 在用户补丁层写入/更新一条 `{ id, disabled }` 覆盖：
* 逐行定位 `- id: <entryId>` 块并保留同块其它键（name/config 等），
* 不存在则追加到文件末尾。写临时文件后原子 rename，避免 watcher 读到半截。
* @param entryId - loader entry id。
* @param disabled - 目标停用状态。
*/
function writeDisabledRow(entryId, disabled) {
	const bool = disabled ? 'true' : 'false';
	const idLine = '- id: ' + yamlQuote(entryId);
	const disabledLine = '  disabled: ' + bool;
	let text = '';
	try {
		text = readFileSync(HOME_PATCH, 'utf8');
	} catch {
		/* 文件不存在 → 新建 */
	}
	const lines = text.split('\n');
	let index = -1;
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^\s*-\s*id\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s#]+))(\s*(?:#.*)?)$/);
		if (!match) continue;
		const id = match[1] !== void 0 ? match[1].replace(/\\(["\\])/g, '$1') : match[2] !== void 0 ? match[2] : match[3];
		if (id === entryId) {
			index = i;
			break;
		}
	}
	if (index >= 0) {
		let end = index + 1;
		const kept = [];
		while (end < lines.length && /^\s+/.test(lines[end]) && !/^\s+-\s/.test(lines[end])) {
			if (!/^\s*disabled\s*:/.test(lines[end])) kept.push(lines[end]);
			end++;
		}
		lines.splice(index, end - index, idLine, disabledLine, ...kept);
	} else {
		while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
		lines.push(idLine, disabledLine);
	}
	mkdirSync(dirname(HOME_PATCH), { recursive: true });
	const tmp = HOME_PATCH + '.tmp';
	writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
	renameSync(tmp, HOME_PATCH);
}

/** Cordis Fiber 状态 → 可读相位（与官方 inventory 一致）。 */
const FIBER_PHASE = {
	0: 'pending',
	1: 'loading',
	2: 'active',
	3: 'failed',
	4: null,
	5: 'unloading'
};

export function apply(ctx) {
	// ── 搜索：代理 GitHub topic:dsh-plugin ──────────────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/search',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url, 'http://localhost');
				const kw = (url.searchParams.get('q') ?? '').trim();
				const query = `topic:dsh-plugin${kw ? ` ${kw}` : ''}`;
				const gh = await fetch(
					`${GH_SEARCH}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`,
					{ headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-market' } }
				);
				if (!gh.ok) return sendJson(res, 502, { ok: false, error: `GitHub API 返回 ${gh.status}` });
				const data = await gh.json();
				sendJson(res, 200, { ok: true, total: data.total_count, items: (data.items ?? []).map(toItem) });
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 安装：执行 dsh plugin add（spec 先归一化）──────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/install',
		handler: async (req, res) => {
			try {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' });
				const body = JSON.parse((await readBody(req)) || '{}');
				const raw = String(body.spec ?? '').trim();
				if (!raw) return sendJson(res, 400, { ok: false, error: '缺少 spec 参数' });
				const spec = normalizeSpec(raw);
				const profile = String(process.env.DSH_PROFILE ?? 'web').trim() || 'web';
				const done = await new Promise((resolve) => {
					execFile(
						'dsh',
						['plugin', '--profile', profile, 'add', spec],
						{ cwd: process.cwd(), env: process.env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
						(error, stdout, stderr) => resolve({ error, stdout, stderr })
					);
				});
				const output = `${done.stdout ?? ''}\n${done.stderr ?? ''}`.trim();
				if (done.error) {
					const hint = done.error.code === 'ENOENT'
						? '找不到 dsh 命令（容器 PATH 问题？）'
						: done.error.code === 'ETIMEDOUT' ? '安装超时（超过 3 分钟）'
							: /pnpm not found/i.test(output) ? '容器缺少 pnpm（需在镜像中安装）'
								: /allowBuilds/i.test(output) ? 'Git 托管的插件需要先在 pnpm-workspace.yaml 配置 allowBuilds 才能执行构建脚本' : '';
					return sendJson(res, 200, { ok: false, error: done.error.message, output, hint });
				}
				const hint = /allowBuilds/i.test(output)
					? 'Git 托管插件需要 allowBuilds 授权：请在 dsh 容器的 pnpm-workspace.yaml 中添加上面提示的包名，然后重新安装。'
					: raw !== spec ? `已把 ${raw} 归一化为 ${spec}（pnpm 需要 github: 前缀）` : '';
				sendJson(res, 200, { ok: true, output, note: '插件已安装，重启服务后生效', hint });
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 插件清单：当前 loader 非分组条目（与官方「插件列表」同源）──────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/list',
		handler: async (req, res) => {
			try {
				const entries = [];
				for (const entry of ctx.loader.entries()) {
					if (entry.options.group) continue;
					entries.push({
						entryId: entry.id,
						moduleName: entry.options.name,
						enabled: !entry.disabled,
						fiberPhase: entry.fiber === void 0 ? null : FIBER_PHASE[entry.fiber.state] ?? null
					});
				}
				sendJson(res, 200, { ok: true, entries });
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 启用/停用：运行期直接应用 + 写用户补丁层供重启保持 ──────────────
	// 写 $DSH_HOME/cordis.patch.yml（dsh 用户补丁层，优先级高于 bundle 层，
	// boot 时必读；运行时的 HMR 用户补丁热更新若有则自动再应用，幂等）。
	// 同时直接调用 loader entry.update() 让本次运行立即生效（不依赖 watcher）。
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/toggle',
		handler: async (req, res) => {
			try {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' });
				const body = JSON.parse((await readBody(req)) || '{}');
				const entryId = String(body.entryId ?? '').trim();
				if (!entryId) return sendJson(res, 400, { ok: false, error: '缺少 entryId' });
				let entry = null;
				for (const candidate of ctx.loader.entries()) {
					if (candidate.id === entryId) {
						entry = candidate;
						break;
					}
				}
				if (entry === null) return sendJson(res, 404, { ok: false, error: `未找到插件 ${entryId}` });
				const enabled = !entry.disabled;
				const nextEnabled = !enabled;
				const nextDisabled = !nextEnabled;
				// 补丁行 id 必须用原始 options.id（loader 的 applyEntryPatches 按
				// 原始 id 建索引；带前缀的计算 id 如 include:xxx 匹配不上会被跳过）
				const patchId = entry.options.id || entryId;
				// 1) 写补丁文件（重启后保持）
				writeDisabledRow(patchId, nextDisabled);
				// 2) 运行期立即应用（禁用→卸载 fiber；启用→初始化）
				try {
					await entry.update({ disabled: nextDisabled }, false, true);
				} catch (error) {
					// 应用失败（如插件初始化报错）：回滚补丁文件，避免重启后状态错位
					writeDisabledRow(patchId, !nextDisabled);
					return sendJson(res, 200, { ok: false, error: `应用失败（已回滚）：${error?.message ?? error}` });
				}
				sendJson(res, 200, {
					ok: true,
					entryId,
					enabled: nextEnabled,
					note: nextEnabled ? '已启用（即时生效，重启后保持）' : '已停用（即时生效，重启后保持）'
				});
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 预览：工作区文件（HTML / Markdown / 图片 / 代码等）────────────────
	// 根目录用 PREVIEW_ROOT 覆盖（本地测试时可指向任意目录；部署默认 /workspace）。
	// 会话里的文件提及常带绝对路径（如 /tmp/xxx.html），用 PREVIEW_EXTRA_ROOTS
	// 追加可读根（逗号分隔，默认容器临时目录），越界一律 403。
	const PREVIEW_ROOT = String(process.env.PREVIEW_ROOT ?? '/workspace');
	/** 解析目录并归一化符号链接（macOS 的 /tmp → /private/tmp 等）。 */
	function resolveRoot(p) {
		try {
			return realpathSync(p);
		} catch {
			return resolve(p);
		}
	}
	const extraRootsEnv = (process.env.PREVIEW_EXTRA_ROOTS ?? '').trim();
	const PREVIEW_ROOTS = [
		resolveRoot(PREVIEW_ROOT),
		...(extraRootsEnv === '' ? [] : extraRootsEnv.split(',').map((s) => s.trim()).filter(Boolean).map(resolveRoot))
	];
	if (extraRootsEnv === '') PREVIEW_ROOTS.push(resolveRoot(tmpdir()), resolveRoot('/tmp'));

	const PREVIEW_MIME = {
		'.html': 'text/html; charset=utf-8',
		'.htm': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.mjs': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.map': 'application/json',
		'.md': 'text/markdown; charset=utf-8',
		'.markdown': 'text/markdown; charset=utf-8',
		'.txt': 'text/plain; charset=utf-8',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.ico': 'image/x-icon',
		'.pdf': 'application/pdf',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.wasm': 'application/wasm',
		'.xml': 'application/xml; charset=utf-8',
		'.yml': 'text/plain; charset=utf-8',
		'.yaml': 'text/plain; charset=utf-8',
		// 代码文件按纯文本渲染，iframe 内可直接阅读
		'.py': 'text/plain; charset=utf-8',
		'.ts': 'text/plain; charset=utf-8',
		'.tsx': 'text/plain; charset=utf-8',
		'.jsx': 'text/plain; charset=utf-8',
		'.c': 'text/plain; charset=utf-8',
		'.h': 'text/plain; charset=utf-8',
		'.cpp': 'text/plain; charset=utf-8',
		'.java': 'text/plain; charset=utf-8',
		'.go': 'text/plain; charset=utf-8',
		'.rs': 'text/plain; charset=utf-8',
		'.sh': 'text/plain; charset=utf-8',
		'.sql': 'text/plain; charset=utf-8',
		'.csv': 'text/plain; charset=utf-8',
		'.log': 'text/plain; charset=utf-8',
		'.toml': 'text/plain; charset=utf-8',
		'.ini': 'text/plain; charset=utf-8',
		'.conf': 'text/plain; charset=utf-8'
	};

	/** 把相对/绝对路径安全地解析到允许根内，越界返回 null。 */
	function previewPath(rel) {
		// 绝对路径（/tmp/xxx.html、/workspace/foo.md 等）：必须落在某个允许根内
		if (rel.startsWith('/')) {
			const candidate = resolve(rel);
			let real = candidate;
			try {
				real = realpathSync(candidate);
			} catch {
				/* 文件不存在：按未归一化路径做前缀判断 */
			}
			for (const root of PREVIEW_ROOTS) {
				if (real === root || real.startsWith(root + sep)) return candidate;
			}
			return null;
		}
		// 相对路径：以第一个根（工作区）为基准
		const root = PREVIEW_ROOTS[0];
		const target = resolve(root, '.' + sep + rel);
		if (target !== root && !target.startsWith(root + sep)) return null;
		return target;
	}

	/** 简易 Markdown → HTML（标题/粗斜体/行内代码/代码块/列表/链接/段落）。 */
	function renderMarkdown(src) {
		const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const inline = (s) => esc(s)
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>')
			.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
		const blocks = [];
		let body = String(src).replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => {
			blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
			return '\u0000' + (blocks.length - 1) + '\u0000';
		});
		const lines = body.split('\n');
		let out = '';
		let list = false;
		const closeList = () => { if (list) { out += '</ul>'; list = false; } };
		for (const line of lines) {
			let m = line.match(/^(#{1,6})\s+(.*)/);
			if (m) {
				closeList();
				const n = m[1].length;
				out += `<h${n}>${inline(m[2])}</h${n}>`;
				continue;
			}
			if (line.trim() === '') { closeList(); continue; }
			m = line.match(/^[-*+]\s+(.*)/);
			if (m) {
				if (!list) { list = true; out += '<ul>'; }
				out += `<li>${inline(m[1])}</li>`;
				continue;
			}
			closeList();
			out += `<p>${inline(line)}</p>`;
		}
		closeList();
		body = out.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)] ?? '');
		return body;
	}

	/** Markdown 预览页外壳：白底、阅读宽度、代码样式。 */
	const MD_SHELL = (body) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
		:root { color-scheme: light; }
		body { margin: 0; padding: 32px 40px; font: 15px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; max-width: 860px; }
		h1, h2, h3, h4, h5, h6 { line-height: 1.4; margin: 1.2em 0 .5em; font-weight: 600; }
		h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.2em; }
		p { margin: .6em 0; }
		ul { padding-left: 1.6em; margin: .6em 0; }
		li { margin: .25em 0; }
		code { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f3f4f6; border-radius: 6px; padding: 2px 6px; }
		pre { background: #0d1117; color: #e6edf3; border-radius: 10px; padding: 16px 18px; overflow-x: auto; }
		pre code { background: none; color: inherit; padding: 0; border-radius: 0; }
		a { color: #4d6bfe; text-decoration: none; } a:hover { text-decoration: underline; }
		hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
	</style></head><body>${body}</body></html>`;

	ctx.webServer.register({
		kind: 'prefix',
		path: '/preview/file',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url, 'http://localhost');
				const rel = decodeURIComponent(url.pathname.slice('/preview/file/'.length));
				const target = previewPath(rel);
				if (target === null) return sendJson(res, 403, { ok: false, error: '路径越界' });
				const body = await readFile(target);
				const ext = extname(target).toLowerCase();
				if (ext === '.md' || ext === '.markdown') {
					const html = Buffer.from(MD_SHELL(renderMarkdown(body.toString('utf8'))), 'utf8');
					res.writeHead(200, {
						'Content-Type': 'text/html; charset=utf-8',
						'Content-Length': html.length,
						'X-Content-Type-Options': 'nosniff'
					});
					return res.end(html);
				}
				const type = PREVIEW_MIME[ext] ?? 'application/octet-stream';
				res.writeHead(200, {
					'Content-Type': type,
					'Content-Length': body.length,
					'X-Content-Type-Options': 'nosniff'
				});
				res.end(body);
			} catch (error) {
				sendJson(res, 404, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 预览：容器内端口 HTTP 反代（WebSocket 由 nginx 的 /preview/port 处理）──
	ctx.webServer.register({
		kind: 'prefix',
		path: '/preview/port',
		handler: async (req, res) => {
			try {
				const url = new URL(req.url, 'http://localhost');
				const rest = decodeURIComponent(url.pathname.slice('/preview/port/'.length));
				const slash = rest.indexOf('/');
				const portText = slash < 0 ? rest : rest.slice(0, slash);
				const port = Number(portText);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					return sendJson(res, 400, { ok: false, error: '端口无效' });
				}
				const targetPath = slash < 0 ? '/' : rest.slice(slash);
				const headers = { ...req.headers };
				delete headers.host;
				delete headers['accept-encoding'];
				delete headers['connection'];
				const proxy = http.request({
					host: '127.0.0.1',
					port,
					path: targetPath + (url.search || ''),
					method: req.method,
					headers
				}, (upstream) => {
					res.writeHead(upstream.statusCode, upstream.headers);
					upstream.pipe(res);
				});
				proxy.on('error', () => {
					if (!res.headersSent) {
						sendJson(res, 502, { ok: false, error: `无法连接 127.0.0.1:${port}（服务未启动？）` });
					} else {
						res.destroy();
					}
				});
				req.pipe(proxy);
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 重启服务：插件安装后一键生效（SIGTERM 优雅退出 → 容器自动重启）──
	// SIGTERM 若被吞掉（进程未退），3 秒后以非零码强制退出，平台必重启。
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/restart',
		handler: async (req, res) => {
			if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' });
			sendJson(res, 200, { ok: true, note: '正在重启服务…' });
			setTimeout(() => {
				try {
					process.kill(process.pid, 'SIGTERM');
				} catch {
					/* 进程已退出或信号不支持 */
				}
				setTimeout(() => {
					try {
						process.exit(1);
					} catch {
						/* 忽略 */
					}
				}, 2500);
			}, 600);
		}
	});

	// ── 隐藏官方「打开配置文件」按钮（容器环境无本地编辑器，按钮点了必失败）──
	// 通过 index.html 注入一个小脚本：用 MutationObserver 在按钮出现时按文案
	// 找到它并连同外层一起隐藏。中文/英文文案都覆盖。
	ctx.webServer.tapIndex((html) => html.replace(
		'</body>',
		`<script>(function(){var H=function(){document.querySelectorAll('button').forEach(function(b){var t=(b.textContent||'').replace(/\\s+/g,'');if(t==='打开配置文件'||t==='Openconfigurationfile'){var w=b.closest('div');if(w){w.style.display='none';}else{b.style.display='none';}}})};if(document.body){new MutationObserver(H).observe(document.body,{childList:true,subtree:true});}H();})();<\/script></body>`
	), 'plugin-market: hide open-document button');
}
