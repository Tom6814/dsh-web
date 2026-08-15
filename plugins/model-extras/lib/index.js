// dsh-model-extras — host half
// 模型增强：
//   1. OpenAI Responses API 适配器（provider: openai-responses）——兼容 Codex /
//      gpt-5 等走 /v1/responses 端点的模型（原生 chat/completions 之外的协议）。
//   2. 自定义模型：任意 OpenAI 兼容端点（API 地址 + Key），模型列表通过
//      GET {baseURL}/models 自动获取（registerModelDiscovery），配置热生效。
// 配置存 $DSH_HOME/model-extras.json（持久化；provider 目录在下次启动时刷新）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm';

export const name = 'model-extras-host';
export const inject = ['webServer', 'llm'];

function log(...args) {
	console.log('[model-extras]', ...args);
}
function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}
function configPath() {
	return join(dshHome(), 'model-extras.json');
}
function loadConfig() {
	try {
		return JSON.parse(readFileSync(configPath(), 'utf8'));
	} catch {
		return {};
	}
}
function saveConfig(cfg) {
	mkdirSync(dshHome(), { recursive: true });
	const tmp = configPath() + '.tmp';
	writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
	renameSync(tmp, configPath());
}
function maskKey(key) {
	return key ? '****' + String(key).slice(-4) : '';
}

// ── Responses API 适配器 ────────────────────────────────────────────────
// 把 harness 消息流转换为 OpenAI Responses API（POST {baseURL}/responses，
// stream:true + SSE events），并把 events 映射回 harness StreamChunks。
const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high'];

function flattenText(blocks) {
	return (blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function serializeInput(messages) {
	const input = [];
	for (const m of messages || []) {
		if (m.role === 'system') {
			input.push({ role: 'system', content: flattenText(m.content) });
			continue;
		}
		if (m.role === 'user') {
			const content = [];
			for (const b of m.content || []) {
				if (b.type === 'text') content.push({ type: 'input_text', text: b.text });
				else if (b.type === 'image' || b.type === 'image-url' || b.type === 'image_url') {
					content.push({ type: 'input_image', image_url: b.url || b.image_url || b.src });
				} else if (b.type === 'tool-result') {
					content.push({ type: 'function_call_output', call_id: b.id, output: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '') });
				} else {
					content.push({ type: 'input_text', text: JSON.stringify(b) });
				}
			}
			if (content.length) input.push({ role: 'user', content });
			continue;
		}
		if (m.role === 'assistant') {
			const content = [];
			for (const b of m.content || []) {
				if (b.type === 'text') content.push({ type: 'output_text', text: b.text });
				else if (b.type === 'tool-call') content.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: b.arguments || '{}' });
				// reasoning 不回传（Responses 会自行推理）
			}
			if (content.length) input.push({ role: 'assistant', content });
		}
	}
	return input;
}

function serializeTools(tools) {
	return (tools || []).map((t) => ({
		type: 'function',
		name: t.name,
		description: t.description || '',
		parameters: t.parameters || {}
	}));
}

class ResponsesAdapter extends LlmAdapter {
	constructor(config) {
		super();
		this.config = config;
	}
	providerInfo(provider) {
		return { id: provider, name: 'OpenAI Responses' };
	}
	providerRetryPolicy() {
		return this.config.options().retryPolicy || null;
	}
	listModels(provider) {
		return this.config.options().models.map((m) => modelInfo(provider, m));
	}
	resolveModel(provider, model, _signal) {
		const connection = this.config.options();
		const configured = (connection.models || []).find((m) => m.id === model);
		return Promise.resolve(configured ? modelInfo(provider, configured) : {
			provider,
			id: model,
			name: model,
			inputModalities: ['text'],
			context: { contextWindow: connection.defaultContextWindow || 128000 },
			defaultMaxTokens: connection.maxTokens || 16384,
			reasoning: { efforts: REASONING_EFFORTS, defaultEffort: connection.reasoningEffort || 'medium' }
		});
	}
	async *stream(options) {
		const connection = this.config.options();
		const apiKey = await this.config.resolveApiKey(connection);
		const body = {
			model: options.model,
			input: serializeInput(options.messages),
			instructions: options.system || undefined,
			tools: serializeTools(options.tools),
			stream: true
		};
		if (connection.reasoningEffort) body.reasoning = { effort: connection.reasoningEffort };
		if (options.maxTokens) body.max_output_tokens = options.maxTokens;
		if (connection.extraBody) Object.assign(body, connection.extraBody);
		let response;
		try {
			response = await fetch(`${connection.baseURL}/responses`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: options.signal
			});
		} catch (e) {
			if (options.signal?.aborted) throw e;
			throw new LlmError(`Responses request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: e });
		}
		if (!response.ok) {
			let detail = '';
			try { detail = (await response.json())?.error?.message || ''; } catch { /* ignore */ }
			throw new LlmError(`Responses API error ${response.status}${detail ? '：' + detail : ''}`, response.status >= 500 ? 'SERVER' : 'INVALID_REQUEST');
		}
		// SSE 事件 → harness StreamChunks
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let call = null;
		const started = new Set();
		const endBlock = (key, block) => { if (started.has(key)) { started.delete(key); return { type: 'block-end', block }; } return null; };
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop();
			for (const line of lines) {
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (!data || data === '[DONE]') continue;
				let ev;
				try { ev = JSON.parse(data); } catch { continue; }
				const t = ev.type;
				if (t === 'response.output_text.delta') {
					if (!started.has('text')) { started.add('text'); yield { type: 'block-start', block: { type: 'text' } }; }
					yield { type: 'text-delta', delta: ev.delta };
				} else if (t === 'response.reasoning_text.delta' || t === 'response.reasoning_summary_text.delta') {
					if (!started.has('reasoning')) { started.add('reasoning'); yield { type: 'block-start', block: { type: 'reasoning' } }; }
					yield { type: 'reasoning-delta', delta: ev.delta };
				} else if (t === 'response.output_item.added' && ev.item && ev.item.type === 'function_call') {
					call = { id: ev.item.id || ev.item.call_id, name: ev.item.name || ev.item.call_id || '', args: '' };
				} else if (t === 'response.function_call_arguments.delta') {
					if (!call) continue;
					if (!started.has('call:' + call.id)) {
						started.add('call:' + call.id);
						yield { type: 'block-start', block: { type: 'tool-call', id: call.id, name: call.name, index: 0 } };
					}
					call.args += ev.delta;
					yield { type: 'tool-call-delta', id: call.id, index: 0, delta: ev.delta };
				} else if (t === 'response.output_item.done' && ev.item && ev.item.type === 'function_call') {
					if (started.has('call:' + (ev.item.id || ev.item.call_id))) {
						started.delete('call:' + (ev.item.id || ev.item.call_id));
						yield { type: 'block-end', block: { type: 'tool-call', id: ev.item.id || ev.item.call_id, name: ev.item.name || '', index: 0 } };
					}
					call = null;
				} else if (t === 'response.completed' || t === 'response.incomplete') {
					const ends = [endBlock('text', { type: 'text' }), endBlock('reasoning', { type: 'reasoning' })].filter(Boolean);
					for (const e of ends) yield e;
					yield { type: 'usage', usage: { inputTokens: ev.usage?.input_tokens ?? ev.usage?.inputTokens ?? 0, outputTokens: ev.usage?.output_tokens ?? ev.usage?.outputTokens ?? 0 } };
					yield { type: 'finish', finish: { reason: t === 'response.completed' ? 'stop' : 'length', message: ev.incomplete_details?.reason || '' } };
				}
			}
		}
	}
}

function modelInfo(provider, m) {
	return {
		provider,
		id: m.id,
		name: m.name || m.id,
		inputModalities: ['text'],
		context: { contextWindow: m.contextWindow || 128000 },
		defaultMaxTokens: m.maxTokens || 16384,
		reasoning: { efforts: REASONING_EFFORTS, defaultEffort: m.reasoningEffort || 'medium' }
	};
}

export { ResponsesAdapter, modelInfo };
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

	// 当前配置（thunk：每次请求读最新，保存后热生效）
	const current = () => loadConfig();
	const PROVIDER = 'openai-responses';

	// 注册 provider 目录 + 适配器（provider 目录在下次启动时刷新，adapter 逻辑热生效）
	ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER,
		displayName: 'OpenAI Responses (Codex/gpt-5)',
		settingsNs: 'model-extras',
		settingsPath: []
	}]);
	const adapter = new ResponsesAdapter({
		options: () => ({
			baseURL: String(current().baseURL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
			models: current().models || [],
			apiKey: current().apiKey || '',
			reasoningEffort: current().reasoningEffort || undefined,
			defaultContextWindow: 128000,
			maxTokens: Number(current().maxTokens) || 16384,
			extraBody: current().extraBody || undefined
		}),
		resolveApiKey: async () => current().apiKey || ''
	});
	ctx.llm.registerAdapter([PROVIDER], adapter);

	// 模型自动获取：GET {baseURL}/models（供 UI 与 discoverModels 使用）
	ctx.llm.registerModelDiscovery('model-extras', async (request) => {
		const base = (request.baseURL || current().baseURL || '').replace(/\/+$/, '');
		const key = request.apiKey || request.headers?.authorization?.replace(/^Bearer /, '') || current().apiKey || '';
		const r = await fetch(`${base}/models`, {
			headers: key ? { Authorization: `Bearer ${key}` } : {},
			signal: request.signal || AbortSignal.timeout(15_000)
		});
		if (!r.ok) throw new LlmError(`模型端点返回 ${r.status}`, 'SERVER');
		const j = await r.json();
		return (j.data || []).filter((m) => m && m.id).map((m) => ({ id: m.id, name: m.name || m.id }));
	});
	log('provider 已注册：openai-responses（Responses API + /models 自动获取）');

	// ── 配置 API ────────────────────────────────────────────────────────
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/model-extras/config',
		handler: async (req, res) => {
			try {
				if (req.method === 'GET') {
					const c = current();
					return sendJson(res, 200, { ok: true, config: { baseURL: c.baseURL || '', apiKey: c.apiKey ? maskKey(c.apiKey) : '', models: c.models || [], reasoningEffort: c.reasoningEffort || 'medium', maxTokens: c.maxTokens || 16384, enabled: !!c.baseURL } });
				}
				const body = await bodyOf(req);
				const c = loadConfig();
				if (body.baseURL !== void 0) c.baseURL = String(body.baseURL).trim();
				if (body.apiKey !== void 0 && !String(body.apiKey).startsWith('****')) c.apiKey = String(body.apiKey).trim();
				if (body.models !== void 0) c.models = Array.isArray(body.models) ? body.models : c.models;
				if (body.reasoningEffort !== void 0) c.reasoningEffort = String(body.reasoningEffort);
				if (body.maxTokens !== void 0) c.maxTokens = Number(body.maxTokens) || 16384;
				saveConfig(c);
				log('config: 已保存（adapter 热生效；provider 目录下次启动刷新）');
				return sendJson(res, 200, { ok: true, note: '已保存：对话模型已热生效，模型选择器中的 provider 列表下次启动更新' });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// ── DeepSeek API Key（写入 $DSH_HOME/.credentials.yaml，官方 Models 页同源）──
	const credentialsPath = () => join(dshHome(), '.credentials.yaml');
	function readCredentials() {
		try {
			const raw = readFileSync(credentialsPath(), 'utf8');
			const out = {};
			for (const line of raw.split('\n')) {
				const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
				if (m) out[m[1]] = m[2].trim();
			}
			return out;
		} catch { return {}; }
	}
	function writeCredentials(creds) {
		mkdirSync(dshHome(), { recursive: true });
		const lines = Object.entries(creds).map(([k, v]) => `${k}: ${v}`);
		const tmp = credentialsPath() + '.tmp';
		writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
		renameSync(tmp, credentialsPath());
	}
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/model-extras/deepseek-key',
		handler: async (req, res) => {
			try {
				if (req.method === 'GET') {
					const v = readCredentials().DEEPSEEK_API_KEY || '';
					return sendJson(res, 200, { ok: true, configured: v.length > 0, apiKey: v ? maskKey(v) : '' });
				}
				const body = await bodyOf(req);
				const creds = readCredentials();
				if (body.apiKey !== void 0 && !String(body.apiKey).startsWith('****')) {
					creds.DEEPSEEK_API_KEY = String(body.apiKey).trim();
					writeCredentials(creds);
					log('deepseek-key: 已写入 .credentials.yaml');
				}
				const v = creds.DEEPSEEK_API_KEY || '';
				return sendJson(res, 200, { ok: true, configured: v.length > 0, apiKey: v ? maskKey(v) : '' });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});

	// 模型自动获取（UI 用）：探测 {baseURL}/models
	ctx.webServer.register({
		kind: 'exact',
		path: '/api/model-extras/discover',
		handler: async (req, res) => {
			try {
				const body = await bodyOf(req);
				const base = String(body.baseURL || current().baseURL || '').trim().replace(/\/+$/, '');
				const key = String(body.apiKey || current().apiKey || '').trim();
				if (!base) return sendJson(res, 400, { ok: false, error: '缺少 API 地址' });
				const r = await fetch(`${base}/models`, {
					headers: key ? { Authorization: `Bearer ${key}` } : {},
					signal: AbortSignal.timeout(15_000)
				});
				if (!r.ok) return sendJson(res, 502, { ok: false, error: `模型端点返回 ${r.status}` });
				const j = await r.json();
				const models = (j.data || []).filter((m) => m && m.id).map((m) => ({ id: m.id, name: m.name || m.id }));
				sendJson(res, 200, { ok: true, models });
			} catch (e) {
				sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
			}
		}
	});
}
