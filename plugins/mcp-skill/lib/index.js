// dsh-mcp-skill — host half
// 技能与 MCP 管理：
//   - MCP 服务器 CRUD / 启停；支持导入 Cursor 格式（.cursor/mcp.json 的 mcpServers）
//   - Skills 管理：$DSH_HOME/skills/<name>/SKILL.md（Claude 风格技能根）
//   - 保存时把启用的 MCP 服务器同步写入 profile 的 cordis.patch.yml
//     （`# managed-by: dsh-mcp-skill` 段），重启后生效
// 配置存 $DSH_HOME/mcp-skill.json（持久化）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'mcp-skill-host';
export const inject = ['webServer', 'tools'];

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
	// 活动连接：serverName -> { client, transport, disposers[], snapshot }
	const connections = new Map();

	async function startServer(server) {
		let client;
		let transport;
		try {
			if (server.transport === 'streamable-http') {
				transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers || {} } });
			} else {
				const env = server.env && Object.keys(server.env).length ? { ...process.env, ...server.env } : undefined;
				const cwd = process.env.PREVIEW_ROOT || '/workspace';
				transport = new StdioClientTransport({ command: server.command, args: server.args || [], env, cwd });
			}
			client = new Client({ name: 'dsh-mcp-skill', version: '0.1.0' });
			await client.connect(transport);
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
			connections.set(server.name, { client, transport, disposers, snapshot: JSON.stringify(server) });
			log(`热插拔: 「${server.name}」已连接，注册 ${disposers.length} 个工具（无需重启）`);
		} catch (e) {
			if (client && transport) { try { await client.close(); } catch { /* ignore */ } try { await transport.close(); } catch { /* ignore */ } }
			throw new Error(`连接「${server.name}」失败：${e?.message ?? e}`);
		}
	}
	async function stopServer(name) {
		const conn = connections.get(name);
		if (!conn) return;
		for (const d of conn.disposers) { try { d(); } catch { /* ignore */ } }
		try { await conn.client.close(); } catch { /* ignore */ }
		try { await conn.transport.close(); } catch { /* ignore */ }
		connections.delete(name);
		log(`热插拔: 「${name}」已断开，工具已注销`);
	}
	/** 增量应用：启动新增/变更，断开移除/停用。 */
	async function applyHot(servers) {
		const wanted = new Map(servers.filter((s) => s.enabled).map((s) => [s.name, s]));
		for (const name of [...connections.keys()]) {
			const server = wanted.get(name);
			if (!server) { await stopServer(name); continue; }
			if (connections.get(name).snapshot !== JSON.stringify(server)) { await stopServer(name); await startServer(server).catch((e) => log(e.message)); }
		}
		for (const [name, server] of wanted) {
			if (!connections.has(name)) { await startServer(server).catch((e) => log(e.message)); }
		}
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

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/mcp-skill/list',
		handler: async (req, res) => {
			try {
				const store = loadStore();
				sendJson(res, 200, {
					ok: true,
					servers: store.servers,
					skills: scanSkills(),
					imports: store.imports,
					connected: [...connections.entries()].map(([name, c]) => ({ name, tools: c.disposers.length }))
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

	// 启动时热连接所有已启用的 MCP 服务器（无需重启）
	applyHot(loadStore().servers);

	// 插件卸载时断开所有连接、注销全部工具
	return () => { for (const name of [...connections.keys()]) stopServer(name); };
}
