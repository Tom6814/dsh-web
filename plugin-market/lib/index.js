// dsh-plugin-market — host half
// 提供 HTTP API：
//   GET  /api/plugin-market/search?q=<kw>   代理 GitHub API 搜索 topic:dsh-plugin 的仓库
//   POST /api/plugin-market/install {spec}  执行 `dsh plugin --profile <p> add <spec>` 安装
//   POST /api/plugin-market/restart         优雅重启服务（插件安装后生效；容器自动拉起）
//   GET  /preview/file/<relpath>            预览工作区里的 HTML 等文件
//   GET  /preview/port/<port>/<path>        HTTP 反代到容器内 127.0.0.1:<port>（WebSocket 走 nginx）
// 并通过 tapIndex 注入脚本隐藏官方「打开配置文件」按钮（容器环境没有本地编辑器）。
// 挂载方式：在 cordis patch 中 insert 一行，name 指向本文件。
import { execFile } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export const name = 'plugin-market-host';
export const inject = ['webServer'];

const GH_SEARCH = 'https://api.github.com/search/repositories';

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

	// ── 安装：执行 dsh plugin add ──────────────────────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/plugin-market/install',
		handler: async (req, res) => {
			try {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' });
				const body = JSON.parse((await readBody(req)) || '{}');
				const spec = String(body.spec ?? '').trim();
				if (!spec) return sendJson(res, 400, { ok: false, error: '缺少 spec 参数' });
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
					return sendJson(res, 200, { ok: false, error: done.error.message, output });
				}
				sendJson(res, 200, { ok: true, output, note: '插件已安装，重启服务后生效' });
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	});

	// ── 预览：工作区文件（HTML 等）────────────────────────────────────────
	// 根目录用 PREVIEW_ROOT 覆盖（本地测试时可指向任意目录；部署默认 /workspace）。
	const PREVIEW_ROOT = String(process.env.PREVIEW_ROOT ?? '/workspace');

	const PREVIEW_MIME = {
		'.html': 'text/html; charset=utf-8',
		'.htm': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.mjs': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.map': 'application/json',
		'.md': 'text/markdown; charset=utf-8',
		'.txt': 'text/plain; charset=utf-8',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.ico': 'image/x-icon',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.wasm': 'application/wasm',
		'.xml': 'application/xml; charset=utf-8',
		'.yml': 'text/plain; charset=utf-8',
		'.yaml': 'text/plain; charset=utf-8'
	};

	/** 把相对路径安全地解析到 PREVIEW_ROOT 内，越界返回 null。 */
	function previewPath(rel) {
		const root = resolve(PREVIEW_ROOT);
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
				out += n <= 2 ? `<h${n}>${inline(m[2])}</h${n}>` : `<h${n}>${inline(m[2])}</h${n}>`;
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
				if (ext === '.md') {
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
					process.exit(0);
				}
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
