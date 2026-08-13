// dsh-plugin-market — host half
// 提供 HTTP API：
//   GET  /api/plugin-market/search?q=<kw>   代理 GitHub API 搜索 topic:dsh-plugin 的仓库
//   POST /api/plugin-market/install {spec}  执行 `dsh plugin --profile <p> add <spec>` 安装
//   POST /api/plugin-market/restart         优雅重启服务（插件安装后生效；容器自动拉起）
// 并通过 tapIndex 注入脚本隐藏官方「打开配置文件」按钮（容器环境没有本地编辑器）。
// 挂载方式：在 cordis patch 中 insert 一行，name 指向本文件。
import { execFile } from 'node:child_process';

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
