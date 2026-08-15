// dsh-image-gen — host half
// 对话内生成图片：
//   - Agent 工具 `generate_image`：调用 OpenAI 兼容图片端点（gpt-image-1 / gpt-image-2 等），
//     图片保存到工作区 images/ 目录，返回路径供预览
//   - GET  /api/image-gen/config               读取当前配置（脱敏）
//   - POST /api/image-gen/config               保存配置（baseURL / apiKey / model / size）
//   - GET  /api/image-gen/models               用当前配置调 {baseURL}/models 自动获取模型列表
//   - POST /api/image-gen/test                 用当前配置生成一张测试图
// 配置存 $DSH_HOME/image-gen.json（持久化；apiKey 落盘前做简单混淆，仅本机回读）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'image-gen-host';
export const inject = ['webServer', 'tools'];

function log(...args) {
	console.log('[image-gen]', ...args);
}
function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function configPath() {
	return join(dshHome(), 'image-gen.json');
}
const DEFAULT_CONFIG = { baseURL: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-image-1', size: '1024x1024' };
function loadConfig() {
	try {
		const j = JSON.parse(readFileSync(configPath(), 'utf8'));
		return Object.assign({}, DEFAULT_CONFIG, j);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}
function saveConfig(cfg) {
	mkdirSync(dshHome(), { recursive: true });
	const tmp = configPath() + '.tmp';
	writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
	renameSync(tmp, configPath());
}
/** 脱敏展示配置（key 只显示尾 4 位）。 */
function maskKey(key) {
	if (!key) return '';
	return '****' + String(key).slice(-4);
}
/** 工作区（预览根）用于保存图片。 */
function workspaceRoot() {
	return process.env.PREVIEW_ROOT || '/workspace';
}

/** 调 OpenAI 兼容图片端点生成图片，返回保存路径。 */
async function generateImage({ prompt, size, output, cfg }) {
	const base = String(cfg.baseURL || '').trim().replace(/\/+$/, '');
	if (!base || !cfg.apiKey) throw new Error('未配置图片生成服务（设置 → 图片生成），需要 API 地址与 Key');
	const body = {
		model: cfg.model,
		prompt: String(prompt || '').slice(0, 4000),
		n: 1,
		size: size || cfg.size || '1024x1024',
		response_format: 'b64_json'
	};
	const started = Date.now();
	const r = await fetch(`${base}/images/generations`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(180_000)
	});
	if (!r.ok) {
		let detail = '';
		try { detail = (await r.json())?.error?.message || ''; } catch { /* ignore */ }
		throw new Error(`图片端点返回 ${r.status}${detail ? '：' + detail : ''}`);
	}
	const j = await r.json();
	const item = j.data?.[0];
	if (!item) throw new Error('图片端点未返回数据');
	const b64 = item.b64_json || item.b64 || (item.image ? item.image.b64_json : null);
	const url = item.url;
	let buf;
	if (b64) buf = Buffer.from(b64, 'base64');
	else if (url) buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).arrayBuffer());
	else throw new Error('图片端点未返回图片数据');
	// 保存到工作区 images/
	const root = workspaceRoot();
	const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const rel = String(output || '').trim().replace(/^\.?\//, '');
	const filePath = rel ? rel : `images/gen-${ts}.png`;
	const abs = resolve(root, filePath);
	if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`输出路径越界：${filePath}`);
	mkdirSync(dirname0(abs), { recursive: true });
	writeFileSync(abs, buf);
	log(`generate: 完成 prompt="${String(prompt).slice(0, 40)}…" → ${abs} ${buf.length}B 用时=${Date.now() - started}ms`);
	return { path: filePath, abs, size: buf.length };
}
function dirname0(p) {
	const i = p.lastIndexOf(sep);
	return i > 0 ? p.slice(0, i) : p;
}

export function apply(ctx) {
	const readBody = (req) => new Promise((resolve2, reject) => {
		let data = '';
		req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
		req.on('end', () => resolve2(data));
		req.on('error', reject);
	});
	const sendJson = (res, status, obj) => {
		res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
		res.end(JSON.stringify(obj));
	};
	const bodyOf = async (req) => { try { return JSON.parse((await readBody(req)) || '{}'); } catch { return {}; } };

	// ── Agent 工具：generate_image ──────────────────────────────────────
	ctx.tools.register(defineTool({
		name: 'generate_image',
		description: 'Generate an image from a text prompt using the configured image-generation model (OpenAI-compatible images endpoint, e.g. gpt-image-1 / gpt-image-2). The image is saved into the workspace images/ directory; return the relative path so the user can open it. Use for any request to create/draw/illustrate an image.',
		parameters: {
			prompt: { type: 'string', required: true, description: 'Detailed English prompt describing the image to generate.' },
			size: { type: 'string', description: 'Output size, e.g. 1024x1024, 1536x1024, 1024x1536.' },
			output: { type: 'string', description: 'Optional relative output path under the workspace, e.g. images/logo.png.' }
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					path: { type: 'string', required: true, description: 'Relative path of the saved image in the workspace.' },
					abs: { type: 'string' },
					size: { type: 'integer' }
				}
			},
			render: (_args, value) => [{ type: 'text', text: `图片已生成：${value.path}（${Math.round((value.size || 0) / 1024)}KB）` }],
			presentationMeta: () => ({ badge: '🖼️ 图片' })
		},
		timeoutMs: 200_000,
		isConcurrencySafe: () => true,
		async execute(args) {
			const cfg = loadConfig();
			if (!cfg.apiKey) throw new Error('图片生成未配置：请先在 设置 → 图片生成 填写 API 地址与 Key');
			return generateImage({ prompt: args.prompt, size: args.size, output: args.output, cfg });
		}
	}));
	log('工具 generate_image 已注册');

	// ── 配置 CRUD ────────────────────────────────────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/image-gen/config',
		handler: async (req, res) => {
			try {
				if (req.method === 'GET') {
					const c = loadConfig();
					return sendJson(res, 200, { ok: true, config: { baseURL: c.baseURL, model: c.model, size: c.size, apiKey: c.apiKey ? maskKey(c.apiKey) : '' } });
				}
				const body = await bodyOf(req);
				const c = loadConfig();
				if (body.baseURL !== void 0) c.baseURL = String(body.baseURL).trim();
				if (body.model !== void 0) c.model = String(body.model).trim();
				if (body.size !== void 0) c.size = String(body.size).trim();
				// 掩码（****xxx）回传表示未修改，不覆盖真实 key
				if (body.apiKey !== void 0 && !String(body.apiKey).startsWith('****')) c.apiKey = String(body.apiKey).trim();
				saveConfig(c);
				log('config: 已保存');
				return sendJson(res, 200, { ok: true, config: { baseURL: c.baseURL, model: c.model, size: c.size, apiKey: c.apiKey ? maskKey(c.apiKey) : '' } });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── 模型自动获取：调 {baseURL}/models，过滤图片模型 ───────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/image-gen/models',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const base = String(body.baseURL || loadConfig().baseURL || '').trim().replace(/\/+$/, '');
				const key = String(body.apiKey || loadConfig().apiKey || '').trim();
				if (!base) return sendJson(res, 400, { ok: false, error: '缺少 API 地址' });
				const r = await fetch(`${base}/models`, {
					headers: key ? { Authorization: `Bearer ${key}` } : {},
					signal: AbortSignal.timeout(15_000)
				});
				if (!r.ok) return sendJson(res, 502, { ok: false, error: `模型端点返回 ${r.status}` });
				const j = await r.json();
				const all = (j.data || []).map((m) => m.id).filter((id) => typeof id === 'string' && id.length > 0);
				const images = all.filter((id) => /image|dall|flux|sdxl|stable|imagen|gemini.*image|gpt-image/i.test(id));
				sendJson(res, 200, { ok: true, models: all, images: images.length ? images : all });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── 测试生成 ─────────────────────────────────────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/image-gen/test',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const cfg = Object.assign(loadConfig(), {});
				if (body.baseURL !== void 0) cfg.baseURL = String(body.baseURL).trim();
				if (body.apiKey !== void 0 && !String(body.apiKey).startsWith('****')) cfg.apiKey = String(body.apiKey).trim();
				if (body.model !== void 0) cfg.model = String(body.model).trim();
				if (body.size !== void 0) cfg.size = String(body.size).trim();
				const out = await generateImage({ prompt: 'A simple test image: a blue circle on a white background.', size: cfg.size, output: 'images/test.png', cfg });
				sendJson(res, 200, { ok: true, path: out.path });
			} catch (e) {
				sendJson(res, 200, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});
}
