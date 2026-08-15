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

export const name = 'mcp-skill-host';
export const inject = ['webServer'];

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
function profilePatchPath() {
	return join(dshHome(), 'profiles', 'web', 'cordis.patch.yml');
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

// ── 同步 MCP 服务器到 profile/cordis.patch.yml ──────────────────────────
const MANAGED_MARK = '# managed-by: dsh-mcp-skill (do not edit; saved from 技能与 MCP)';
function yamlQuote(s) {
	return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}
function buildServerYaml(server) {
	const lines = [];
	lines.push('    - id: mcp-' + server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-srv');
	lines.push("      name: '@deepseek-ai/dsh-mcp-client'");
	lines.push('      config:');
	lines.push('        transport: ' + server.transport);
	lines.push('        serverName: ' + yamlQuote(server.name));
	if (server.transport === 'streamable-http') {
		lines.push('        url: ' + yamlQuote(server.url || ''));
		if (server.headers && Object.keys(server.headers).length) {
			lines.push('        headers:');
			for (const [k, v] of Object.entries(server.headers)) lines.push('          ' + yamlQuote(k) + ': ' + yamlQuote(v));
		}
	} else {
		lines.push('        command: ' + yamlQuote(server.command || ''));
		if (Array.isArray(server.args) && server.args.length) {
			lines.push('        args:');
			for (const a of server.args) lines.push('          - ' + yamlQuote(a));
		}
		if (server.env && Object.keys(server.env).length) {
			lines.push('        env:');
			for (const [k, v] of Object.entries(server.env)) lines.push('          ' + yamlQuote(k) + ': ' + yamlQuote(v));
		}
		lines.push('        cwd: /workspace');
		lines.push('        failOnStartupError: false');
	}
	return lines.join('\n');
}
function syncProfilePatch(servers) {
	const file = profilePatchPath();
	let content = '';
	if (existsSync(file)) content = readFileSync(file, 'utf8');
	// 移除旧的 managed 段（从标记到下一个顶层 `- insert:` 或文件尾）
	const markerIdx = content.indexOf(MANAGED_MARK);
	if (markerIdx >= 0) {
		let start = content.lastIndexOf('\n', markerIdx - 1) + 1;
		const rest = content.slice(markerIdx);
		const nextTop = rest.indexOf('\n- insert:');
		content = content.slice(0, start) + (nextTop >= 0 ? rest.slice(nextTop + 1) : '');
	}
	const enabled = servers.filter((s) => s.enabled);
	if (enabled.length) {
		const block = '\n' + MANAGED_MARK + '\n- insert:\n' + enabled.map(buildServerYaml).join('\n') + '\n';
		// 追加到文件末尾（若文件有内容且不以换行结尾先补换行）
		if (content.length && !content.endsWith('\n')) content += '\n';
		content += block;
	}
	mkdirSync(join(dshHome(), 'profiles', 'web'), { recursive: true });
	const tmp = file + '.tmp';
	writeFileSync(tmp, content, 'utf8');
	renameSync(tmp, file);
	log('sync: 已写入 ' + enabled.length + ' 个启用 MCP 服务器到 profile/cordis.patch.yml（重启生效）');
}

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

export function apply(ctx) {
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
				sendJson(res, 200, { ok: true, servers: store.servers, skills: scanSkills(), imports: store.imports, patchPath: profilePatchPath() });
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
				syncProfilePatch(store.servers);
				log('server: 已保存「' + server.name + '」');
				sendJson(res, 200, { ok: true, server, note: '已保存，重启服务后生效' });
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
				syncProfilePatch(store.servers);
				log('server: 已删除');
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
				syncProfilePatch(store.servers);
				log('server: 「' + s.name + '」' + (s.enabled ? '启用' : '停用'));
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
				syncProfilePatch(store.servers);
				log('import-cursor: 导入 ' + added + ' 个（跳过 ' + skipped + '）');
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
}
