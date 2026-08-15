// dsh-mcp-skill — host half
// 技能与 MCP 管理：
//   - MCP 服务器 CRUD / 启停；支持导入 Cursor 格式（.cursor/mcp.json 的 mcpServers）
//   - Skills 管理：$DSH_HOME/skills/<name>/SKILL.md（Claude 风格技能根）
//   - 保存时把启用的 MCP 服务器同步写入 profile 的 cordis.patch.yml
//     （`# managed-by: dsh-mcp-skill` 段），重启后生效
// 配置存 $DSH_HOME/mcp-skill.json（持久化）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { unzipSync } from 'fflate';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';

export const name = 'mcp-skill-host';
export const inject = ['webServer', 'tools', 'llm'];

function log(...args) {
	console.log('[mcp-skill]', ...args);
}
function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function configPath() {
	return join(dshHome(), 'mcp-skill.json');
}
function loadStore() {
	try {
		const j = JSON.parse(readFileSync(configPath(), 'utf8'));
		return { servers: Array.isArray(j.servers) ? j.servers : [], imports: Array.isArray(j.imports) ? j.imports : [] };
	} catch {
		return { servers: [], imports: [] };
	}
}
function saveStore(store) {
	mkdirSync(dshHome(), { recursive: true });
	const tmp = configPath() + '.tmp';
	writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
	renameSync(tmp, configPath());
}
function skillsRoot() {
	return join(dshHome(), 'skills');
}

// ── Skills 扫描：$DSH_HOME/skills/<name>/SKILL.md ───────────────────────
function parseFrontmatter(text) {
	const out = {};
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (m) {
		for (const line of m[1].split('\n')) {
			const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
			if (kv) out[kv[1]] = kv[2].trim().replace(/^['"](.*)['"]$/, '$1');
		}
	}
	return out;
}
function scanSkills() {
	const root = skillsRoot();
	if (!existsSync(root)) return [];
	const out = [];
	for (const dir of readdirSync(root)) {
		if (dir.startsWith('.')) continue;
		const dirPath = join(root, dir);
		if (!statSync(dirPath).isDirectory()) continue;
		const skillDir = dir.endsWith('.disabled') ? dir.slice(0, -'.disabled'.length) : dir;
		const mdPath = join(dirPath, 'SKILL.md');
		if (!existsSync(mdPath)) continue;
		const raw = readFileSync(mdPath, 'utf8');
		const fm = parseFrontmatter(raw);
		out.push({
			name: dir,
			displayName: fm.name || skillDir,
			description: fm.description || '',
			enabled: !dir.endsWith('.disabled'),
			body: raw.slice(0, 300)
		});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── MCP 持久化：热插拔已覆盖重启场景（启动时 applyHot 自动重连）─────────
// 不再写入 profile/cordis.patch.yml：运行时动态连接由本插件管理，
// 重启后由 applyHot(loadStore().servers) 恢复，无需修改 profile 配置。

// ── Cursor 格式导入 ─────────────────────────────────────────────────────
// Cursor: { "mcpServers": { "<name>": { command, args, env } | { url, headers } } }
function parseCursorJson(text) {
	let j;
	try { j = JSON.parse(text); } catch { throw new Error('不是合法的 JSON'); }
	const map = j.mcpServers || j.servers || j;
	if (!map || typeof map !== 'object') throw new Error('未找到 mcpServers 字段');
	const servers = [];
	for (const [name, cfg] of Object.entries(map)) {
		if (!cfg || typeof cfg !== 'object') continue;
		if (cfg.url) {
			servers.push({ name, transport: 'streamable-http', url: cfg.url, headers: cfg.headers || {}, command: '', args: [], env: {} });
		} else if (cfg.command) {
			servers.push({ name, transport: 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {}, url: '', headers: {} });
		} else {
			servers.push({ name, transport: 'stdio', command: '', args: [], env: {}, url: '' });
		}
	}
	return servers;
}

// ── 热插拔：动态 MCP 客户端（保存/启停立即生效，无需重启）──────────────
// 用官方 MCP SDK 在运行时连接服务器，把工具注册到 ctx.tools（命名与官方
// mcp-client 一致：mcp__<server>__<tool>），停止时调用 register 返回的
// disposer 注销并断开连接。同时保留 cordis.patch.yml 持久化（重启后仍生效）。

function normalizeToolName(s) {
	return String(s || '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}
/** MCP JSON Schema 参数 → dsh defineTool 的 parameters spec 格式。 */
function mcpSchemaToSpec(inputSchema) {
	const spec = {};
	const props = (inputSchema && inputSchema.properties) || {};
	const required = new Set((inputSchema && inputSchema.required) || []);
	for (const [name, ps] of Object.entries(props)) {
		if (!ps || typeof ps !== 'object') continue;
		let type = ps.type;
		if (type === 'array') type = 'array';
		else if (type === 'object') type = 'object';
		else if (!['string', 'number', 'integer', 'boolean'].includes(type)) type = 'string';
		const entry = { type, description: ps.description || '' };
		if (required.has(name)) entry.required = true;
		spec[name] = entry;
	}
	return spec;
}
function mcpResultToText(result) {
	const content = (result && result.content) || [];
	const parts = content.map((c) => {
		if (c.type === 'text') return c.text;
		if (c.type === 'image') return `[image ${c.mimeType || 'image/png'} ${(c.data || '').length ? (c.data.length * 0.75 | 0) + 'B' : ''}]`;
		return JSON.stringify(c).slice(0, 2000);
	}).filter(Boolean);
	const text = parts.join('\n');
	return text || JSON.stringify(result).slice(0, 4000);
}

export function apply(ctx) {
	// 活动连接：serverName -> { client, transport, disposers[], snapshot, authRequired }
	const connections = new Map();
	// OAuth 浏览器授权：pendingAuth.state -> { server, provider, url }
	const authPendings = new Map();
	// 对外可访问 origin（OAuth 回跳用）：PUBLIC_URL 优先，否则取最近一次浏览器请求的 host，最后兜底本地地址
	let publicOrigin = String(process.env.PUBLIC_URL || process.env.DSH_PUBLIC_URL || '').replace(/\/+$/, '');
	const localPort = process.env.PORT || '3081';
	if (!publicOrigin) publicOrigin = 'http://127.0.0.1:' + localPort;
	// 最近一次主模型路由（AI 创建/安装技能时复用当前模型）
	let lastLlmRoute = null;

	function makeOAuthProvider(server) {
		const memory = { clientInfo: undefined, discovery: undefined, codeVerifier: undefined, state: undefined, tokens: undefined };
		const redirectUrl = () => publicOrigin + '/api/mcp-skill/oauth/callback';
		// 箭头函数没有自己的 this——用闭包引用 provider 本身，供 SDK 回调使用
		let provider;
		const pendingTarget = () => provider;
		provider = {
			get redirectUrl() { return redirectUrl(); },
			clientMetadata: { client_name: 'dsh-mcp-skill (' + server.name + ')', redirect_uris: [redirectUrl()] },
			state: () => { memory.state = 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); return memory.state; },
			clientInformation: () => memory.clientInfo,
			saveClientInformation: (info) => { memory.clientInfo = info; },
			discoveryState: () => memory.discovery,
			saveDiscoveryState: (d) => { memory.discovery = d; },
			tokens: () => memory.tokens,
			saveTokens: (t) => { memory.tokens = t; },
			saveCodeVerifier: (v) => { memory.codeVerifier = v; },
			codeVerifier: () => memory.codeVerifier,
			invalidateCredentials: (scope) => { if (scope === 'tokens' || scope === 'all') memory.tokens = undefined; if (scope === 'all') memory.clientInfo = undefined; },
			// SDK 需要用户打开浏览器授权时回调这里：把授权 URL 挂到 pending
			redirectToAuthorization: (url) => {
				authPendings.set(memory.state, { server, provider: pendingTarget(), url: String(url), at: Date.now() });
				log(`OAuth: 「${server.name}」需要浏览器授权 → ${String(url).slice(0, 90)}…`);
			},
		};
		return provider;
	}

	async function startServer(server) {
		let client;
		let transport;
		try {
			if (server.transport === 'streamable-http') {
				const authProvider = makeOAuthProvider(server);
				transport = new StreamableHTTPClientTransport(new URL(server.url), { authProvider, requestInit: { headers: server.headers || {} } });
			} else {
				const env = server.env && Object.keys(server.env).length ? { ...process.env, ...server.env } : undefined;
				const cwd = process.env.PREVIEW_ROOT || '/workspace';
				transport = new StdioClientTransport({ command: server.command, args: server.args || [], env, cwd });
			}
			client = new Client({ name: 'dsh-mcp-skill', version: '0.1.0' });
			try {
				await client.connect(transport);
			} catch (e) {
				// 需要 OAuth 浏览器授权：保持「等待授权」状态，由回调端点完成后再连接
				if (server.transport === 'streamable-http' && (e instanceof UnauthorizedError || /Unauthorized|401/i.test(String(e?.message)))) {
					const pending = [...authPendings.values()].find((p) => p.server.name === server.name) || { server, url: null };
					connections.set(server.name, { client: null, transport: null, disposers: [], snapshot: JSON.stringify(server), authRequired: { state: pending.state || null, url: pending.url } });
					log(`OAuth: 「${server.name}」等待浏览器授权`);
					return; // 不抛错——授权完成后自动连接
				}
				throw e;
			}
			const listed = await client.listTools();
			const disposers = [];
			for (const tool of listed.tools || []) {
				const publicName = 'mcp__' + normalizeToolName(server.name) + '__' + normalizeToolName(tool.name);
				const def = defineTool({
					name: publicName,
					description: (tool.description || '').slice(0, 500) || `MCP 工具 ${tool.name}（服务器 ${server.name}）`,
					parameters: mcpSchemaToSpec(tool.inputSchema),
					output: {
						schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string' } } },
						render: (_a, v) => [{ type: 'text', text: String(v.content || '') }],
						presentationMeta: () => ({ badge: '🔌 ' + server.name })
					},
					timeoutMs: 120_000,
					isConcurrencySafe: () => true,
					async execute(args) {
						const out = await client.callTool({ name: tool.name, arguments: args || {} });
						return { content: mcpResultToText(out) };
					}
				});
				try { disposers.push(ctx.tools.register(def)); } catch (e) { log('工具注册失败 ' + publicName + ': ' + e.message); }
			}
			connections.set(server.name, { client, transport, disposers, snapshot: JSON.stringify(server), authRequired: null });
			log(`热插拔: 「${server.name}」已连接，注册 ${disposers.length} 个工具（无需重启）`);
		} catch (e) {
			if (client && transport) { try { await client.close(); } catch { /* ignore */ } try { await transport.close(); } catch { /* ignore */ } }
			connections.delete(server.name);
			log(`连接「${server.name}」失败：${e?.message ?? e}`);
		}
	}
	async function stopServer(name) {
		const conn = connections.get(name);
		if (!conn) return;
		for (const d of conn.disposers) { try { d(); } catch { /* ignore */ } }
		if (conn.client) { try { await conn.client.close(); } catch { /* ignore */ } }
		if (conn.transport) { try { await conn.transport.close(); } catch { /* ignore */ } }
		connections.delete(name);
		// 清理该服务器的 pending 授权
		for (const [st, p] of authPendings) { if (p.server.name === name) authPendings.delete(st); }
		log(`热插拔: 「${name}」已断开，工具已注销`);
	}
	/** 增量应用：启动新增/变更，断开移除/停用。 */
	async function applyHot(servers) {
		const wanted = new Map(servers.filter((s) => s.enabled).map((s) => [s.name, s]));
		for (const name of [...connections.keys()]) {
			const server = wanted.get(name);
			if (!server) { await stopServer(name); continue; }
			const cur = connections.get(name);
			if (cur.authRequired) continue; // 等待授权中，不打断
			if (cur.snapshot !== JSON.stringify(server)) { await stopServer(name); await startServer(server); }
		}
		for (const [name, server] of wanted) {
			if (!connections.has(name)) { await startServer(server); }
		}
	}

	/** LLM 文本生成（AI 创建/安装技能用；复用最近一次对话的模型路由）。 */
	async function llmAsk(system, user) {
		if (!lastLlmRoute) return { ok: false, error: '还没有可用的模型路由：请先在对话里发一条消息，再使用 AI 创建/安装。' };
		try {
			let text = '';
			const stream = ctx.llm.stream({
				provider: lastLlmRoute.provider,
				model: lastLlmRoute.model,
				system,
				messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })],
				temperature: 0.4,
				reasoningEffort: ReasoningEffortId('off'),
				maxTokens: 1500,
			});
			for await (const chunk of stream) { if (chunk.type === 'text-delta') text += chunk.text; }
			return { ok: true, text: text.trim() };
		} catch (e) {
			return { ok: false, error: 'LLM 调用失败：' + String(e?.message ?? e).slice(0, 120) };
		}
	}

	/** 解析 SKILL.md frontmatter 里的 name（用于上传 md/zip 时定目录名）。 */
	function frontmatterName(text, fallback) {
		const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (m) {
			const nm = m[1].match(/^name\s*:\s*(.+)$/m);
			if (nm) return nm[1].trim().replace(/^['"](.*)['"]$/, '$1').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
		}
		return fallback;
	}

	/** 安装一份 SKILL.md 内容到 ~/.dsh/skills/<name>/SKILL.md。 */
	function installSkillMarkdown(content, dirName) {
		const name = frontmatterName(content, dirName) || 'skill-' + Date.now().toString(36);
		const dir = join(skillsRoot(), name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
		return name;
	}

	const readBody = (req) => new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
	const sendJson = (res, status, obj) => {
		res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify(obj));
	};
	const bodyOf = async (req) => { try { return JSON.parse((await readBody(req)) || '{}'); } catch { return {}; } };
	const genId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

	// 捕获主模型路由（AI 创建/安装技能复用当前模型）
	ctx.on('llm/stream', (options, next) => {
		if (options && options.provider) lastLlmRoute = { provider: options.provider, model: options.model };
		return next();
	});

	// 防止 SDK/MCP 连接内部的异步/同步错误把整个进程带崩（仅记录）
	const onUnhandled = (reason) => { log('未捕获的异步错误（已忽略）: ' + String(reason?.message ?? reason).slice(0, 200)); };
	process.on('unhandledRejection', onUnhandled);
	const onUncaught = (err) => { log('未捕获异常（已隔离）: ' + String(err?.message ?? err).slice(0, 200)); };
	process.on('uncaughtException', onUncaught);

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/list',
		handler: async (req, res) => {
			try {
				const store = loadStore();
				// 记录用户浏览器可达的 origin（OAuth 回跳用；PUBLIC_URL 未设置时）
				if (req.headers && req.headers.host && !publicOrigin) publicOrigin = 'http://' + req.headers.host;
				sendJson(res, 200, {
					ok: true,
					servers: store.servers,
					skills: scanSkills(),
					imports: store.imports,
					connected: [...connections.entries()].map(([name, c]) => ({
						name,
						tools: c.disposers.length,
						authRequired: c.authRequired ? { url: c.authRequired.url } : null
					}))
				});
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// upsert 服务器
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/server',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const store = loadStore();
				if (!String(b.name || '').trim()) return sendJson(res, 400, { ok: false, error: '缺少服务器名称' });
				const existing = b.id ? store.servers.find((s) => s.id === b.id) : store.servers.find((s) => s.name === b.name);
				const server = existing || { id: genId(), name: String(b.name).trim(), transport: 'stdio', command: '', args: [], env: {}, url: '', headers: {}, enabled: true, createdAt: Date.now() };
				server.name = String(b.name).trim();
				server.transport = b.transport === 'streamable-http' ? 'streamable-http' : 'stdio';
				server.command = String(b.command || '').trim();
				server.args = Array.isArray(b.args) ? b.args.map(String) : [];
				server.env = b.env && typeof b.env === 'object' ? b.env : {};
				server.url = String(b.url || '').trim();
				server.headers = b.headers && typeof b.headers === 'object' ? b.headers : {};
				if (b.enabled !== void 0) server.enabled = !!b.enabled;
				if (!existing) store.servers.push(server);
				saveStore(store);
				await applyHot(store.servers);
				log('server: 已保存「' + server.name + '」（热插拔已生效）');
				sendJson(res, 200, { ok: true, server, note: '已保存并热插拔：当前会话立即可用' });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/server/delete',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const store = loadStore();
				store.servers = store.servers.filter((s) => s.id !== b.id);
				saveStore(store);
				await applyHot(store.servers);
				log('server: 已删除（热插拔已生效）');
				sendJson(res, 200, { ok: true });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/server/toggle',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const store = loadStore();
				const s = store.servers.find((x) => x.id === b.id);
				if (!s) return sendJson(res, 404, { ok: false, error: '服务器不存在' });
				s.enabled = !s.enabled;
				saveStore(store);
				await applyHot(store.servers);
				log('server: 「' + s.name + '」' + (s.enabled ? '启用' : '停用') + '（热插拔已生效）');
				sendJson(res, 200, { ok: true, enabled: s.enabled });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// Cursor 格式导入：粘贴 JSON 或从工作区文件读
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/import-cursor',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				let text = String(b.json || '').trim();
				if (!text && b.path) {
					const fs2 = await import('node:fs');
					const { resolve, sep } = await import('node:path');
					const root = process.env.PREVIEW_ROOT || '/workspace';
					const abs = resolve(root, String(b.path).replace(/^\.?\//, ''));
					if (abs !== root && !abs.startsWith(root + sep)) return sendJson(res, 400, { ok: false, error: '路径越界' });
					if (!fs2.existsSync(abs)) return sendJson(res, 404, { ok: false, error: '文件不存在：' + b.path });
					text = fs2.readFileSync(abs, 'utf8');
				}
				if (!text) return sendJson(res, 400, { ok: false, error: '缺少配置内容或路径' });
				const imported = parseCursorJson(text);
				const store = loadStore();
				let added = 0, skipped = 0;
				for (const sv of imported) {
					if (!sv.name) continue;
					if (store.servers.some((s) => s.name === sv.name)) { skipped++; continue; }
					store.servers.push({ id: genId(), ...sv, enabled: true, createdAt: Date.now() });
					added++;
				}
				if (b.label) store.imports.unshift({ at: Date.now(), label: b.label, count: imported.length });
				store.imports = store.imports.slice(0, 20);
				saveStore(store);
				await applyHot(store.servers);
				log('import-cursor: 导入 ' + added + ' 个（跳过 ' + skipped + '）（热插拔已生效）');
				sendJson(res, 200, { ok: true, added, skipped, total: imported.length });
			} catch (e) {
				sendJson(res, 200, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// 技能：新建 / 删除 / 启停
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/add',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const dirName = String(b.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
				if (!dirName) return sendJson(res, 400, { ok: false, error: '技能名不合法' });
				const dir = join(skillsRoot(), dirName);
				if (existsSync(join(dir, 'SKILL.md'))) return sendJson(res, 400, { ok: false, error: '技能已存在：' + dirName });
				mkdirSync(dir, { recursive: true });
				const description = String(b.description || '').trim();
				const body = String(b.content || '').trim();
				const md = '---\nname: ' + JSON.stringify(String(b.displayName || dirName)).replace(/"/g, '') + '\n' +
					(description ? 'description: ' + JSON.stringify(description).replace(/"/g, '') + '\n' : '') +
					'---\n\n' + (body || '# ' + dirName + '\n\n技能说明…');
				writeFileSync(join(dir, 'SKILL.md'), md, 'utf8');
				log('skill: 已创建「' + dirName + '」');
				sendJson(res, 200, { ok: true, skill: { name: dirName, enabled: true } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/delete',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const target = String(b.name || '');
				const dirs = [target, target.endsWith('.disabled') ? target : target + '.disabled'];
				let removed = false;
				for (const d of dirs) {
					const p = join(skillsRoot(), d);
					if (existsSync(p) && p.startsWith(skillsRoot() + '/')) { rmSync(p, { recursive: true, force: true }); removed = true; }
				}
				sendJson(res, 200, { ok: removed, error: removed ? undefined : '技能不存在' });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/toggle',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const name = String(b.name || '');
				const base = name.endsWith('.disabled') ? name.slice(0, -'.disabled'.length) : name;
				const src = join(skillsRoot(), name);
				const dst = join(skillsRoot(), name.endsWith('.disabled') ? base : base + '.disabled');
				if (!existsSync(src)) return sendJson(res, 404, { ok: false, error: '技能不存在' });
				renameSync(src, dst);
				sendJson(res, 200, { ok: true, enabled: !name.endsWith('.disabled') });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	/** 用已授权的 provider 建立连接并注册工具（OAuth 回调完成后调用）。 */
	async function connectAuthorized(server, authProvider) {
		const transport = new StreamableHTTPClientTransport(new URL(server.url), { authProvider, requestInit: { headers: server.headers || {} } });
		const client = new Client({ name: 'dsh-mcp-skill', version: '0.1.0' });
		await client.connect(transport); // provider.tokens() 已有 token → 直接通过
		const listed = await client.listTools();
		const disposers = [];
		for (const tool of listed.tools || []) {
			const publicName = 'mcp__' + normalizeToolName(server.name) + '__' + normalizeToolName(tool.name);
			const def = defineTool({
				name: publicName,
				description: (tool.description || '').slice(0, 500) || `MCP 工具 ${tool.name}（服务器 ${server.name}）`,
				parameters: mcpSchemaToSpec(tool.inputSchema),
				output: {
					schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string' } } },
					render: (_a, v) => [{ type: 'text', text: String(v.content || '') }],
					presentationMeta: () => ({ badge: '🔌 ' + server.name })
				},
				timeoutMs: 120_000,
				isConcurrencySafe: () => true,
				async execute(args) {
					const out = await client.callTool({ name: tool.name, arguments: args || {} });
					return { content: mcpResultToText(out) };
				}
			});
			try { disposers.push(ctx.tools.register(def)); } catch (e) { log('工具注册失败 ' + publicName + ': ' + e.message); }
		}
		connections.set(server.name, { client, transport, disposers, snapshot: JSON.stringify(server), authRequired: null });
		log(`热插拔: 「${server.name}」已连接，注册 ${disposers.length} 个工具（OAuth 授权）`);
	}

	// ── OAuth 浏览器授权回调：用户在浏览器完成授权后跳回这里 ─────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/oauth/callback',
		handler: async (req, res) => {
			try {
				const u = new URL(req.url, 'http://local');
				const code = u.searchParams.get('code');
				const state = u.searchParams.get('state');
				const pending = state ? authPendings.get(state) : undefined;
				if (!pending || !code) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('invalid state or code'); return; }
				authPendings.delete(state);
				const { server, provider } = pending;
				const result = await auth(provider, { serverUrl: server.url, authorizationCode: code });
				if (result !== 'AUTHORIZED') { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('authorization failed'); return; }
				// token 已保存到同一个 provider → 用它直接连接并注册工具
				await connectAuthorized(server, provider);
				log(`OAuth: 「${server.name}」授权成功，已连接`);
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end('<!doctype html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f7f9"><div style="text-align:center;padding:32px;border-radius:16px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.08)"><div style="font-size:40px">✅</div><h2 style="margin:8px 0;color:#111">授权成功</h2><p style="color:#666">「' + server.name + '」已连接，可以关闭此页面返回 DSH。</p></div></body></html>');
			} catch (e) {
				log('OAuth 回调失败：' + String(e?.message ?? e));
				res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('error: ' + String(e?.message ?? e));
			}
		}
	});

	// ── 以 Cursor 格式导出已配置的 MCP 服务器（mcpServers）───────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/cursor-export',
		handler: async (req, res) => {
			try {
				const store = loadStore();
				const mcpServers = {};
				for (const s of store.servers.filter((x) => x.enabled)) {
					if (s.transport === 'streamable-http') mcpServers[s.name] = { url: s.url, headers: s.headers && Object.keys(s.headers).length ? s.headers : undefined };
					else mcpServers[s.name] = { command: s.command, args: (s.args || []).length ? s.args : undefined, env: s.env && Object.keys(s.env).length ? s.env : undefined };
				}
				sendJson(res, 200, { ok: true, cursor: { mcpServers } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── Skill 上传：SKILL.md 文本 或 zip（自动解压并定位 SKILL.md）────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/upload',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const filename = String(b.filename || 'skill.md').toLowerCase();
				let name = null;
				if (filename.endsWith('.zip')) {
					const buf = Buffer.from(String(b.content || ''), 'base64');
					const files = unzipSync(new Uint8Array(buf));
					// 定位 SKILL.md（支持任意目录深度）
					let skillEntry = null;
					for (const [fn, data] of Object.entries(files)) {
						if (/skill\.md$/i.test(fn) && (!skillEntry || fn.split('/').length > skillEntry.split('/').length)) skillEntry = fn;
					}
					if (!skillEntry) return sendJson(res, 400, { ok: false, error: 'zip 里没有找到 SKILL.md' });
					const md = new TextDecoder().decode(files[skillEntry]);
					const dirName = frontmatterName(md, basename(dirname(skillEntry))) || 'skill-' + Date.now().toString(36);
					const dir = join(skillsRoot(), dirName);
					mkdirSync(dir, { recursive: true });
					const prefix = dirname(skillEntry).replace(/^\.\//, '');
					for (const [fn, data] of Object.entries(files)) {
						const rel = prefix && fn.startsWith(prefix + '/') ? fn.slice(prefix.length + 1) : (fn.includes('/') ? fn.split('/').pop() : fn);
						const target = join(dir, rel);
						if (!target.startsWith(dir + '/')) continue;
						mkdirSync(dirname(target), { recursive: true });
						writeFileSync(target, Buffer.from(data));
					}
					name = dirName;
					log('skill: 已从 zip 安装「' + name + '」');
				} else {
					const md = String(b.content || '');
					name = installSkillMarkdown(md, b.filename ? basename(String(b.filename), '.md') : undefined);
					log('skill: 已上传安装「' + name + '」');
				}
				sendJson(res, 200, { ok: true, skill: { name, enabled: true } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── AI 帮我创建：描述 → LLM 生成完整 SKILL.md → 安装 ─────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/ai-create',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const desc = String(b.description || '').trim();
				if (!desc) return sendJson(res, 400, { ok: false, error: '请描述你想创建的技能' });
				const r = await llmAsk(
					'你是一名 DSH/Claude 风格的技能包作者。根据用户描述编写一个标准 SKILL.md：必须包含 YAML frontmatter（name 用 kebab-case、description 一句话说明用途），正文是结构化 Markdown（## 用途 / ## 使用场景 / ## 步骤 或 ## 指令），简洁实用。只输出 SKILL.md 文件内容本身，不要任何解释。',
					desc
				);
				if (!r.ok) return sendJson(res, 200, { ok: false, error: r.error });
				const name = installSkillMarkdown(r.text, undefined);
				log('skill: AI 创建「' + name + '」');
				sendJson(res, 200, { ok: true, skill: { name, enabled: true } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── AI 帮我安装：粘贴任意内容 → LLM 整理成标准 SKILL.md → 安装 ───────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/skill/ai-install',
		handler: async (req, res) => {
			try {
				const b = await bodyOf(req);
				const content = String(b.content || '').trim();
				if (!content) return sendJson(res, 400, { ok: false, error: '请粘贴技能内容' });
				const r = await llmAsk(
					'把用户提供的内容整理成一份标准的 SKILL.md 技能文件：补充/规范 YAML frontmatter（name kebab-case、description），正文为结构化 Markdown（## 用途 / ## 使用场景 / ## 步骤），保留原有要点，缺失部分按内容合理补齐。只输出 SKILL.md 文件内容本身，不要任何解释。',
					content.slice(0, 6000)
				);
				if (!r.ok) return sendJson(res, 200, { ok: false, error: r.error });
				const name = installSkillMarkdown(r.text, undefined);
				log('skill: AI 安装「' + name + '」');
				sendJson(res, 200, { ok: true, skill: { name, enabled: true } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// 启动时热连接所有已启用的 MCP 服务器（无需重启）
	applyHot(loadStore().servers);

	// 插件卸载时断开所有连接、注销全部工具
	return () => {
		for (const name of [...connections.keys()]) stopServer(name);
		authPendings.clear();
		process.removeListener('unhandledRejection', onUnhandled);
		process.removeListener('uncaughtException', onUncaught);
	};
}
