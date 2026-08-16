// dsh-automation — host half
// 定时触发 AI 执行任务（对齐 Trae Work 的自动化）：
//   GET  /api/automation/list                任务 + 最近运行历史
//   POST /api/automation/create {…}         新建任务（间隔/每天/每周）
//   POST /api/automation/update {id, …}     更新任务（含启用/停用）
//   POST /api/automation/delete {id}        删除任务
//   POST /api/automation/run {id}           立即执行一次
//   POST /api/automation/optimize {prompt}  AI 辅助优化任务描述
//
// 执行方式：`dsh --profile headless --patch <HEADLESS_PATCH> "<任务>"`，
// headless 是 dsh 自带的无服务器单次运行器（复用 $DSH_HOME 的模型配置）。
// 任务/历史存 $DSH_HOME/automation.json（持久化目录，任务配置应持久保存）。
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const name = 'automation-host';
export const inject = ['webServer'];

function log(...args) {
	console.log('[automation]', ...args);
}

function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}

// ── 存储：$DSH_HOME/automation.json（原子写）─────────────────────────────
function storePath() {
	return join(dshHome(), 'automation.json');
}
function loadStore() {
	try {
		return JSON.parse(readFileSync(storePath(), 'utf8'));
	} catch {
		return { tasks: [], runs: [] };
	}
}
function saveStore(store) {
	mkdirSync(dirname(storePath()), { recursive: true });
	const tmp = storePath() + '.tmp';
	writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
	renameSync(tmp, storePath());
}

// ── 调度时间计算 ────────────────────────────────────────────────────────
// schedule: { type:'interval', minutes } | { type:'daily', hour, minute }
//           | { type:'weekly', dow(0-6 周日=0), hour, minute }
function nextRunAt(task, now = Date.now()) {
	const s = task.schedule || {};
	if (s.type === 'interval') {
		const minutes = Math.max(1, Number(s.minutes) || 60);
		const base = task.lastRunAt || task.createdAt || now;
		let t = base + minutes * 60_000;
		while (t <= now) t += minutes * 60_000;
		return t;
	}
	if (s.type === 'daily') {
		const t = new Date(now);
		t.setHours(Number(s.hour) || 9, Number(s.minute) || 0, 0, 0);
		if (t.getTime() <= now) t.setDate(t.getDate() + 1);
		return t.getTime();
	}
	if (s.type === 'weekly') {
		const t = new Date(now);
		t.setHours(Number(s.hour) || 9, Number(s.minute) || 0, 0, 0);
		const dow = Number(s.dow) || 1; // 默认周一
		let diff = (dow - t.getDay() + 7) % 7;
		if (diff === 0 && t.getTime() <= now) diff = 7;
		t.setDate(t.getDate() + diff);
		return t.getTime();
	}
	return null;
}

// ── headless 执行（AI 跑任务）───────────────────────────────────────────
// HEADLESS_PATCH 环境变量指向 headless 专用 patch（默认镜像内置路径）。
function headlessPatchPath() {
	return process.env.HEADLESS_PATCH || '/opt/dsh-zeabur/patches/headless.cordis.patch.yml';
}
/** 任务工作区：任务指定 cwd 则使用（自动创建）；否则在 $DSH_HOME/automation-workspaces/<id> 自动创建。 */
function taskWorkspace(task) {
	const home = process.env.DSH_HOME || join(homedir(), '.dsh');
	if (task.cwd && typeof task.cwd === 'string' && task.cwd.trim()) {
		try { mkdirSync(task.cwd.trim(), { recursive: true }); } catch { /* 创建失败则回退自动目录 */ }
		if (existsSync(task.cwd.trim())) return task.cwd.trim();
	}
	const dir = join(home, 'automation-workspaces', String(task.id || 'task'));
	try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
	return dir;
}
function runHeadless(prompt, task) {
	const taskName = task.name || task.id;
	return new Promise((resolve) => {
		const args = ['--profile', 'headless'];
		if (existsSync(headlessPatchPath())) args.push('--patch', headlessPatchPath());
		args.push(prompt);
		const env = { ...process.env };
		if (task.model && task.model.trim()) env.DSH_AGENT_MODEL = task.model.trim();
		const cwd = taskWorkspace(task);
		log(`run: 开始任务「${taskName}」 cwd=${cwd}${task.model ? ' model=' + task.model : ''}`);
		const child = execFile(
			'dsh',
			args,
			{ cwd, env, detached: true, maxBuffer: 32 * 1024 * 1024 },
			(error, stdout, stderr) => {
				const out = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
				log(`run: 完成任务「${taskName}」 code=${error?.code ?? 0} 输出=${out.length}B`);
				resolve({ ok: !error, output: out.slice(-6000), error: error ? String(error.message ?? error) : null });
			}
		);
		const killer = setTimeout(() => {
			try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ }
		}, 600_000); // 10 分钟上限
		child.on('exit', () => clearTimeout(killer));
	});
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

	// 单例调度器：每分钟检查一次，到点触发（防重入）
	let tickTimer = null;
	let running = new Set(); // 正在执行的任务 id
	const scheduleTick = () => {
		const store = loadStore();
		const now = Date.now();
		for (const task of store.tasks) {
			if (!task.enabled || running.has(task.id)) continue;
			if (task.nextRunAt != null && task.nextRunAt > now) continue;
			if (task.nextRunAt == null) {
				task.nextRunAt = nextRunAt(task, now);
				saveStore(store);
				continue;
			}
			running.add(task.id);
			runHeadless(task.prompt, task)
				.then((result) => {
					const s2 = loadStore();
					const t = s2.tasks.find((x) => x.id === task.id);
					if (t) {
						t.lastRunAt = now;
						t.lastRunOk = result.ok;
						t.nextRunAt = nextRunAt(t, Date.now());
					}
					s2.runs.unshift({ id: `${task.id}-${now}`, taskId: task.id, taskName: task.name, startedAt: now, finishedAt: Date.now(), ok: result.ok, output: result.output, error: result.error });
					s2.runs = s2.runs.slice(0, 50); // 只留最近 50 条
					saveStore(s2);
					running.delete(task.id);
				})
				.catch(() => running.delete(task.id));
		}
	};
	// 注册 API 后启动调度
	ctx.on('ready', () => {
		if (tickTimer) return;
		// 启动时补齐 nextRunAt 并立即跑一次 tick
		const store = loadStore();
		for (const t of store.tasks) {
			if (t.enabled && t.nextRunAt == null) t.nextRunAt = nextRunAt(t, Date.now());
		}
		saveStore(store);
		scheduleTick();
		tickTimer = setInterval(scheduleTick, 60_000);
		log(`调度器已启动（${store.tasks.filter((t) => t.enabled).length} 个启用任务）`);
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/models',
		handler: async (req, res) => {
			try {
				const home = process.env.DSH_HOME || join(homedir(), '.dsh');
				const models = [];
				const defaults = ['deepseek-chat', 'deepseek-reasoner'];
				const mePath = join(home, 'model-extras.json');
				if (existsSync(mePath)) {
					let cfg = {};
					try { cfg = JSON.parse(readFileSync(mePath, 'utf8')); } catch { /* ignore */ }
					for (const m of cfg.models || []) if (m && m.id) models.push(m.id);
					if (cfg.baseURL && cfg.apiKey) {
						try {
							const r = await fetch(cfg.baseURL.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
							if (r.ok) { const j = await r.json(); for (const m of j.data || []) if (m && m.id && !models.includes(m.id)) models.push(m.id); }
						} catch { /* 动态获取失败则用配置/默认 */ }
					}
				}
				sendJson(res, 200, { ok: true, models: [...new Set([...models, ...defaults])] });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/list',
		handler: async (req, res) => {
			const store = loadStore();
			const now = Date.now();
			sendJson(res, 200, {
				ok: true,
				tasks: store.tasks.map((t) => ({ ...t, nextRunAt: t.enabled ? nextRunAt(t, now) : null })),
				runs: store.runs
			});
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/create',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const prompt = String(body.prompt ?? '').trim();
				if (!prompt) return sendJson(res, 400, { ok: false, error: '缺少任务描述' });
				const store = loadStore();
				const task = {
					id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
					name: String(body.name ?? '').trim() || prompt.slice(0, 24),
					prompt,
					schedule: {
						type: body.schedule?.type === 'daily' || body.schedule?.type === 'weekly' ? body.schedule.type : 'interval',
						minutes: Math.max(1, Math.min(10080, Number(body.schedule?.minutes) || 60)),
						hour: Number(body.schedule?.hour) || 9,
						minute: Number(body.schedule?.minute) || 0,
						dow: Number(body.schedule?.dow) || 1
					},
					enabled: body.enabled !== false,
					createdAt: Date.now(),
					lastRunAt: null,
					lastRunOk: null,
					nextRunAt: null
				};
				task.nextRunAt = nextRunAt(task, Date.now());
				store.tasks.push(task);
				saveStore(store);
				log(`create: 「${task.name}」${task.schedule.type} next=${new Date(task.nextRunAt).toISOString()}`);
				sendJson(res, 200, { ok: true, task });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/update',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const store = loadStore();
				const task = store.tasks.find((t) => t.id === body.id);
				if (!task) return sendJson(res, 404, { ok: false, error: '任务不存在' });
				if (body.prompt !== void 0) task.prompt = String(body.prompt).trim();
				if (body.model !== void 0) task.model = String(body.model).trim() ? String(body.model).trim() : undefined;
				if (body.cwd !== void 0) task.cwd = String(body.cwd).trim() ? String(body.cwd).trim() : undefined;
				if (body.name !== void 0) task.name = String(body.name).trim();
				if (body.schedule) {
					task.schedule = {
						type: body.schedule.type === 'daily' || body.schedule.type === 'weekly' ? body.schedule.type : 'interval',
						minutes: Math.max(1, Math.min(10080, Number(body.schedule.minutes) || 60)),
						hour: Number(body.schedule.hour) || 9,
						minute: Number(body.schedule.minute) || 0,
						dow: Number(body.schedule.dow) || 1
					};
				}
				if (body.enabled !== void 0) task.enabled = !!body.enabled;
				if (body.enabled === false) task.nextRunAt = null;
				else task.nextRunAt = nextRunAt(task, Date.now());
				saveStore(store);
				sendJson(res, 200, { ok: true, task });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/delete',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const store = loadStore();
				store.tasks = store.tasks.filter((t) => t.id !== body.id);
				saveStore(store);
				sendJson(res, 200, { ok: true });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// 立即执行一次
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/run',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const store = loadStore();
				const task = store.tasks.find((t) => t.id === body.id);
				if (!task) return sendJson(res, 404, { ok: false, error: '任务不存在' });
				if (running.has(task.id)) return sendJson(res, 409, { ok: false, error: '该任务正在执行中' });
				running.add(task.id);
				// 不阻塞响应：后台执行，完成后写历史
				sendJson(res, 200, { ok: true, note: '已触发执行（headless）' });
				const now = Date.now();
				const result = await runHeadless(task.prompt, task);
				const s2 = loadStore();
				const t = s2.tasks.find((x) => x.id === task.id);
				if (t) { t.lastRunAt = now; t.lastRunOk = result.ok; t.nextRunAt = nextRunAt(t, Date.now()); }
				s2.runs.unshift({ id: `${task.id}-${now}`, taskId: task.id, taskName: task.name, startedAt: now, finishedAt: Date.now(), ok: result.ok, output: result.output, error: result.error });
				s2.runs = s2.runs.slice(0, 50);
				saveStore(s2);
				running.delete(task.id);
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// AI 辅助优化任务描述：headless 跑一次"优化"指令
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/automation/optimize',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const prompt = String(body.prompt ?? '').trim();
				if (!prompt) return sendJson(res, 400, { ok: false, error: '缺少任务描述' });
				const optimizePrompt = `请把下面的自动化任务描述优化为清晰、可执行、面向 AI Agent 的任务指令（保留用户意图，补充必要的约束、输出格式与验收标准），直接输出优化后的指令文本，不要解释：\n\n${prompt}`;
				const result = await runHeadless(optimizePrompt, 'AI 辅助优化');
				if (!result.ok) return sendJson(res, 200, { ok: false, error: result.error || '优化失败', output: result.output });
				sendJson(res, 200, { ok: true, prompt: result.output.trim() });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});
}
