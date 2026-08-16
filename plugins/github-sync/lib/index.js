// dsh-github-sync — host half
// 每个会话可选择一个 GitHub 仓库 + 分支，把会话导出同步（提交）到该仓库。
// 仓库选择是「按工作区」记忆的：同一个工作区（cwd）下的所有会话复用同一
// 仓库+分支；不选就不同步（可选）。
// 配置：环境变量 GHP（GitHub Personal Token）/ GH_USER（账号）/ GH_EMAIL（邮箱）优先；
// 也可在会话底部一行里保存（持久化到 $DSH_HOME/github-sync.json）。
//
// API：
//   GET  /api/github-sync/config                配置状态（GHP/账号/邮箱）
//   GET  /api/github-sync/session?sessionId=    会话所在工作区 + 该工作区的仓库选择
//   GET  /api/github-sync/repos                 当前账号仓库列表
//   GET  /api/github-sync/branches?repo=owner/name   分支列表
//   POST /api/github-sync/save                  {ghp,user,email} 保存账号配置
//   POST /api/github-sync/ws-save               {cwd,repo,branch} 保存工作区仓库选择
//   POST /api/github-sync/sync                  {sessionId,repo,branch} 同步会话到仓库
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

export const name = 'github-sync-host';
export const inject = ['webServer'];

const log = (...a) => console.log('[github-sync]', ...a);

function home() { return process.env.DSH_HOME || join(homedir(), '.dsh'); }
function cfgPath() { return join(home(), 'github-sync.json'); }
function loadCfg() {
	let file = {};
	try { file = JSON.parse(readFileSync(cfgPath(), 'utf8')); } catch { /* ignore */ }
	return {
		// OAuth App 授权后的 token（存文件）或环境变量 GHP 手动令牌
		token: file.token || process.env.GHP || '',
		user: process.env.GH_USER || file.user || '',
		email: process.env.GH_EMAIL || file.email || '',
		workspaces: file.workspaces || {},
		clientId: process.env.GITHUB_CLIENT_ID || file.clientId || '',
		clientSecret: process.env.GITHUB_CLIENT_SECRET || file.clientSecret || '',
	};
}
function saveCfg(cfg) {
	writeFileSync(cfgPath(), JSON.stringify({
		token: cfg.token, user: cfg.user, email: cfg.email,
		clientId: cfg.clientId, clientSecret: cfg.clientSecret,
		workspaces: cfg.workspaces,
	}, null, 2));
}

// 对外可访问 origin（OAuth 回调用）：PUBLIC_URL 优先，否则按请求实际域名（反代透传）
let publicOrigin = String(process.env.PUBLIC_URL || process.env.DSH_PUBLIC_URL || '').replace(/\/+$/, '');
if (!publicOrigin) publicOrigin = 'http://127.0.0.1:' + (process.env.PORT || '3081');
function requestOrigin(req) {
	if (req && req.headers) {
		const proto = req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http');
		const host = req.headers['x-forwarded-host'] || req.headers.host;
		if (host) return proto + '://' + host;
	}
	return publicOrigin;
}
// 回调地址必须与 GitHub OAuth App 注册的完全一致；用用户实际访问的域名生成
function oauthCallbackUrl(req) {
	return requestOrigin(req).replace(/\/+$/, '') + '/api/github-sync/oauth/callback';
}
function resolveToken(cfg) { return cfg.token || process.env.GHP || ''; }

// 会话文件按 <encoded-cwd>/<sessionId>/session.jsonl.zstd 存放；编码是路径逐字符转义，
// 这里扫描所有目录找到 sessionId 并返回其真实 cwd（由 dsh 的编码规则反推不可靠，
// 改为在会话 header 里读 cwd——header 是 zstd 解码后的第一条 session 记录）。
function locateSession(sessionId) {
	const root = join(home(), 'sessions');
	if (!existsSync(root)) throw new Error('没有会话目录');
	for (const dir of readdirSync(root)) {
		const p = join(root, dir, sessionId, 'session.jsonl.zstd');
		if (existsSync(p)) return { dir, p };
	}
	throw new Error('未找到会话 ' + sessionId);
}
function sessionHeader(sessionId) {
	const { p } = locateSession(sessionId);
	const raw = zstdDecompressSync(readFileSync(p));
	let header = {};
	let firstUser = '';
	for (const l of raw.toString('utf8').split('\n')) {
		if (!l.trim()) continue;
		try {
			const j = JSON.parse(l);
			if (j && j.type === 'session' && !header.id) { header = j; continue; }
			// 无标题时用首条 user 消息做匹配（dsh 侧栏标题常取自首条消息）
			if (!firstUser && (j.type === 'user/message' || j.type === 'message' && j.message?.role === 'user')) {
				const c = j.type === 'user/message' ? j.data : j.message?.content;
				firstUser = extractText(c).trim().slice(0, 60);
			}
		} catch { /* ignore */ }
	}
	return { ...header, firstUser };
}

function gh(url, token, opts = {}) {
	return fetch('https://api.github.com' + url, {
		method: opts.method || 'GET',
		headers: {
			Authorization: 'Bearer ' + token,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
			'User-Agent': 'dsh-github-sync',
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
}

// 提取消息文本（content 可能是字符串或 block 数组）
function extractText(content) {
	if (content == null) return '';
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map(extractText).filter(Boolean).join('\n');
	if (typeof content === 'object') {
		if (content.text) return String(content.text);
		if (content.content) return extractText(content.content);
		if (content.input) return extractText(content.input);
		if (content.parts) return extractText(content.parts);
		return '';
	}
	return String(content);
}

// 导出会话为 Markdown（zstd 解码 session.jsonl.zstd，Node 22.23+/26 内置支持）
function exportSession(sessionId) {
	const { p } = locateSession(sessionId);
	const raw = zstdDecompressSync(readFileSync(p));
	const lines = raw.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const header = lines.find((l) => l.type === 'session');
	const title = (header && header.title) || sessionId;
	const md = [
		'# 会话 ' + title,
		'',
		'- 会话 ID: `' + sessionId + '`',
		'- 创建时间: ' + new Date(Number(header?.createdAt || Date.now())).toISOString(),
		'',
	];
	for (const line of lines) {
		if (line.type === 'session') continue;
		// 消息行是 dsh event 格式：user/message(data) / assistant/message(message) /
		// tool/result(message)；也兼容 type:'message' 等形态——宽容解析
		let role, content;
		if (line.type === 'user/message') { role = 'user'; content = line.data; }
		else if (line.type === 'assistant/message') { role = 'assistant'; content = line.message; }
		else if (line.type === 'tool/result') { role = 'tool'; content = line.message; }
		else if (line.type === 'message') { role = line.message?.role || 'message'; content = line.message?.content; }
		else if (line.message) { role = line.message.role || line.type; content = line.message.content; }
		else if (line.data) { role = line.type; content = line.data; }
		if (role === undefined || content === undefined) continue;
		const text = extractText(content).trim();
		if (!text) continue;
		md.push('## ' + role, '', text, '');
	}
	return { title, content: md.join('\n') };
}

async function pushToRepo(cfg, repoFull, branch, filePath, content) {
	const [owner, repo] = String(repoFull).split('/');
	if (!owner || !repo) throw new Error('仓库格式应为 owner/name');
	// 已有文件则携带 sha 走更新
	let sha;
	try {
		const existing = await gh(`/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`, tok);
		if (existing.ok) { const j = await existing.json(); sha = j.sha; }
	} catch { /* 404 = 新文件 */ }
	const r = await gh(`/repos/${owner}/${repo}/contents/${filePath}`, cfg.ghp, {
		method: 'PUT',
		body: {
			message: 'sync dsh session ' + new Date().toISOString(),
			content: Buffer.from(content).toString('base64'),
			branch,
			...(sha ? { sha } : {}),
		},
	});
	if (!r.ok) {
		const err = await r.text();
		throw new Error('GitHub 提交失败 (' + r.status + '): ' + err.slice(0, 300));
	}
	const j = await r.json();
	return { path: filePath, url: j.content?.html_url || `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}` };
}

export function apply(ctx) {
	const readBody = (req) => new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
	const sendJson = (res, status, obj) => {
		res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify(obj));
	};
	const bodyOf = async (req) => { try { return JSON.parse((await readBody(req)) || '{}'); } catch { return {}; } };

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/config', handler: async (req, res) => {
		const cfg = loadCfg();
		sendJson(res, 200, { ok: true, configured: !!resolveToken(cfg), user: cfg.user, email: cfg.email, oauthAvailable: !!cfg.clientId, oauthCallback: oauthCallbackUrl(req) });
	} });

	// ── GitHub OAuth App 授权（绑定账号；GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）──
	const oauthStates = new Map();
	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/oauth/start', handler: async (req, res) => {
		const cfg = loadCfg();
		if (!cfg.clientId) {
			res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET（环境变量或 github-sync.json）');
			return;
		}
		const state = 'gs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		oauthStates.set(state, Date.now());
		const url = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
			client_id: cfg.clientId,
			redirect_uri: oauthCallbackUrl(req),
			scope: 'repo user:email',
			state,
		}).toString();
		res.writeHead(302, { Location: url });
		res.end();
	} });

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/oauth/callback', handler: async (req, res) => {
		try {
			const u = new URL(req.url, 'http://local');
			const code = u.searchParams.get('code');
			const state = u.searchParams.get('state');
			const cfg = loadCfg();
			if (!state || !oauthStates.has(state)) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h3>state 无效或已过期</h3>'); return; }
			oauthStates.delete(state);
			if (!code || !cfg.clientId) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h3>缺少 code 或客户端配置</h3>'); return; }
			const tr = await fetch('https://github.com/login/oauth/access_token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: oauthCallbackUrl(req) }),
			});
			const tj = await tr.json();
			const token = tj.access_token;
			if (!token) {
				res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end('<h3>授权失败：' + (tj.error_description || tj.error || 'no token') + '</h3><p style="font-size:13px;color:#666">本次请求使用的回调地址：<code>' + oauthCallbackUrl(req) + '</code><br>请在 GitHub OAuth App 设置里确认已注册该地址（多个访问域名需逐个添加）。</p>');
				return;
			}
			cfg.token = token;
			// 自动获取账号与邮箱（OAuth 授权范围内直接读取）
			try {
				const ur = await gh('/user', token);
				if (ur.ok) { const me = await ur.json(); cfg.user = cfg.user || me.login || ''; cfg.email = cfg.email || me.email || ''; }
				if (!cfg.email) {
					const er = await gh('/user/emails', token);
					if (er.ok) { const em = await er.json(); const primary = (em || []).find((e) => e.primary && e.verified); if (primary) cfg.email = primary.email; }
				}
			} catch { /* 拿不到用户信息不阻塞 */ }
			saveCfg(cfg);
			log(`OAuth 绑定成功：@${cfg.user || '?'} ${cfg.email ? '(' + cfg.email + ')' : ''}`);
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<!doctype html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f7f9"><div style="text-align:center;padding:32px;border-radius:16px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.08)"><div style="font-size:40px">✅</div><h2 style="margin:8px 0;color:#111">GitHub 绑定成功</h2><p style="color:#666">@' + (cfg.user || '') + (cfg.email ? ' · ' + cfg.email : '') + '</p><p style="color:#999">可以关闭此页面回到 DSH，刷新后在会话底部选择仓库。</p></div></body></html>');
		} catch (e) {
			log('OAuth 回调失败：' + String(e?.message ?? e));
			res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<h3>回调失败：' + String(e?.message ?? e) + '</h3>');
		}
	} });

	// 解绑：清除 token（保留 clientId 配置）
	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/logout', handler: async (req, res) => {
		const cfg = loadCfg();
		cfg.token = '';
		saveCfg(cfg);
		sendJson(res, 200, { ok: true });
	} });

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/save', handler: async (req, res) => {
		const b = await bodyOf(req);
		const cfg = loadCfg();
		if (b.ghp !== undefined) cfg.token = String(b.ghp).trim();
		if (b.user !== undefined) cfg.user = String(b.user).trim();
		if (b.email !== undefined) cfg.email = String(b.email).trim();
		if (!tok) { sendJson(res, 400, { ok: false, error: 'GHP 不能为空' }); return; }
		try { saveCfg(cfg); } catch (e) { sendJson(res, 500, { ok: false, error: String(e?.message ?? e) }); return; }
		sendJson(res, 200, { ok: true });
	} });

	// 会话所在工作区 + 该工作区已选择的仓库（同工作区所有会话复用）
	// 支持 ?sessionId= 或 ?title=（dsh 无 URL 路由，client 从选中会话行取标题查）
	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/session', handler: async (req, res) => {
		try {
			const u = new URL(req.url, 'http://local');
			let sessionId = u.searchParams.get('sessionId') || '';
			const title = u.searchParams.get('title') || '';
			if (!sessionId && title) {
				// 按标题找最近匹配的会话
				const root = join(home(), 'sessions');
				if (existsSync(root)) {
					let best = null;
					for (const dir of readdirSync(root)) {
						const sdir = join(root, dir);
						for (const sid of readdirSync(sdir)) {
							if (!existsSync(join(sdir, sid, 'session.jsonl.zstd'))) continue;
							try {
								const h = sessionHeader(sid);
								const ht = h.title || '';
								const fu = h.firstUser || '';
								const matched = ht === title || (ht && ht.includes(title)) || (title && ht && title.includes(ht))
									|| (fu && (fu.includes(title) || title.includes(fu)));
								if (matched) {
									if (!best || Number(h.createdAt || 0) > Number(best.createdAt || 0)) best = { id: sid, ...h };
								}
							} catch { /* ignore */ }
						}
					}
					if (best) sessionId = best.id;
				}
			}
			if (!sessionId) { sendJson(res, 404, { ok: false, error: '未找到会话' }); return; }
			const h = sessionHeader(sessionId);
			const cwd = h.cwd || '';
			const cfg = loadCfg();
			const wsConfig = cwd && cfg.workspaces[cwd] ? cfg.workspaces[cwd] : null;
			sendJson(res, 200, { ok: true, sessionId, cwd, wsConfig });
		} catch (e) {
			sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
		}
	} });

	// 保存工作区 → 仓库选择（同工作区所有会话复用）
	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/ws-save', handler: async (req, res) => {
		const b = await bodyOf(req);
		const cwd = String(b.cwd || '').trim();
		const repo = String(b.repo || '').trim();
		const branch = String(b.branch || '').trim();
		if (!cwd) { sendJson(res, 400, { ok: false, error: '缺少 cwd' }); return; }
		const cfg = loadCfg();
		if (repo && branch) cfg.workspaces[cwd] = { repo, branch };
		else delete cfg.workspaces[cwd]; // 传空 = 取消同步
		try { saveCfg(cfg); } catch (e) { sendJson(res, 500, { ok: false, error: String(e?.message ?? e) }); return; }
		sendJson(res, 200, { ok: true });
	} });

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/repos', handler: async (req, res) => {
		const cfg = loadCfg();
		const tok = resolveToken(cfg);
		if (!tok) { sendJson(res, 200, { ok: false, error: '未配置 GHP', repos: [] }); return; }
		try {
			const r = await gh('/user/repos?per_page=100&sort=updated', tok);
			if (!r.ok) { const e = await r.text(); sendJson(res, 200, { ok: false, error: 'GitHub (' + r.status + '): ' + e.slice(0, 200), repos: [] }); return; }
			const j = await r.json();
			sendJson(res, 200, { ok: true, repos: (j || []).map((x) => x.full_name) });
		} catch (e) {
			sendJson(res, 200, { ok: false, error: String(e?.message ?? e), repos: [] });
		}
	} });

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/branches', handler: async (req, res) => {
		const cfg = loadCfg();
		const u = new URL(req.url, 'http://local');
		const repo = u.searchParams.get('repo') || '';
		if (!cfg.ghp || !repo) { sendJson(res, 200, { ok: false, error: '缺少 GHP 或 repo', branches: [] }); return; }
		try {
			const r = await gh(`/repos/${repo}/branches?per_page=100`, tok);
			if (!r.ok) { const e = await r.text(); sendJson(res, 200, { ok: false, error: 'GitHub (' + r.status + '): ' + e.slice(0, 200), branches: [] }); return; }
			const j = await r.json();
			sendJson(res, 200, { ok: true, branches: (j || []).map((x) => x.name) });
		} catch (e) {
			sendJson(res, 200, { ok: false, error: String(e?.message ?? e), branches: [] });
		}
	} });

	ctx.webServer.register({ kind: 'exact', path: '/api/github-sync/sync', handler: async (req, res) => {
		try {
			const b = await bodyOf(req);
			const sessionId = String(b.sessionId || '').trim();
			const repo = String(b.repo || '').trim();
			const branch = String(b.branch || '').trim();
			if (!sessionId || !repo || !branch) { sendJson(res, 400, { ok: false, error: '缺少 sessionId/repo/branch' }); return; }
			const cfg = loadCfg();
			if (!tok) { sendJson(res, 400, { ok: false, error: '未配置 GHP' }); return; }
			const { title, content } = exportSession(sessionId);
			const filePath = 'dsh-sessions/' + sessionId + '.md';
			const out = await pushToRepo(cfg, repo, branch, filePath, content);
			log(`同步完成：${repo}#${branch} ${filePath}（${title}）`);
			sendJson(res, 200, { ok: true, file: out.path, url: out.url, title });
		} catch (e) {
			log('同步失败：' + String(e?.message ?? e));
			sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
		}
	} });

	log('github-sync 已加载（' + (loadCfg().ghp ? 'GHP 已配置' : '等待配置 GHP') + '）');
}
