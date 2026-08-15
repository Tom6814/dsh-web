// dsh-model-extras — client half
// 「设置 → 插件」新增「模型增强」tab：配置 OpenAI Responses API（Codex/gpt-5）
// 端点 + Key，自动获取模型列表。
window.__ModuleLoader__.load({
	id: 'dsh-model-extras',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const { useState, useEffect } = react;

		const NS = 'model-extras';
		const inject = ['slots', 'locale'];

		const zh = {
			tab: '模型增强',
			title: 'OpenAI Responses API / 自定义模型',
			desc: '接入 OpenAI Responses API（Codex、gpt-5 等走 /v1/responses 的模型）。填 API 地址与 Key 后点「自动获取模型」拉取模型列表，保存后即可在会话的模型选择器中使用（选择 openai-responses 提供方）。',
			baseURL: 'API 地址',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			apiKey: 'API Key',
			reasoning: '推理等级',
			maxTokens: '最大输出 Token',
			models: '可用模型（勾选启用的）',
			fetchModels: '自动获取模型',
			fetching: '获取中…',
			save: '保存',
			saved: '已保存：对话模型已热生效，模型选择器中的提供方列表下次启动刷新',
			err: '操作失败：',
			hint: 'Key 仅保存在容器配置中。端点需支持 GET /models 与 POST /responses。',
			all: '全选',
			none: '清空'
		};
		const en = {
			tab: 'Model extras',
			title: 'OpenAI Responses API / custom models',
			desc: 'Connect an OpenAI Responses API endpoint (Codex, gpt-5…). Fill the base URL and key, fetch the model list, save — then pick the openai-responses provider in the conversation model picker.',
			baseURL: 'API base URL',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			apiKey: 'API Key',
			reasoning: 'Reasoning effort',
			maxTokens: 'Max output tokens',
			models: 'Available models (check to enable)',
			fetchModels: 'Fetch models',
			fetching: 'Fetching…',
			save: 'Save',
			saved: 'Saved: chat model is live; the provider list refreshes on next boot',
			err: 'Failed: ',
			hint: 'The key stays in the container config. Endpoint must support GET /models and POST /responses.',
			all: 'Select all',
			none: 'Clear'
		};

		const S = {
			section: { width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' },
			button: { height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 13, cursor: 'pointer', font: 'inherit' },
			input: { height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, font: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' },
			row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 96 },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, margin: 0 },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, margin: 0 },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }
		};

		function ModelExtrasTab({ t }) {
			const [cfg, setCfg] = useState({ baseURL: '', apiKey: '', models: [], reasoningEffort: 'medium', maxTokens: 16384 });
			const [available, setAvailable] = useState([]);
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [msgOk, setMsgOk] = useState(false);

			useEffect(() => {
				fetch('/api/model-extras/config').then((r) => r.json()).then((d) => { if (d.ok) setCfg((c) => ({ ...c, ...d.config })); });
			}, []);
			const toast = (text, ok) => { setMsg(text); setMsgOk(!!ok); setTimeout(() => { setMsg(null); setMsgOk(false); }, 5000); };
			const api = (url, body) => fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

			const save = () => {
				setBusy(true);
				api('/api/model-extras/config', { baseURL: cfg.baseURL, apiKey: cfg.apiKey, models: cfg.models, reasoningEffort: cfg.reasoningEffort, maxTokens: Number(cfg.maxTokens) })
					.then((d) => { toast(d.ok ? (d.note || t('saved')) : t('err') + (d.error || ''), d.ok); })
					.finally(() => setBusy(false));
			};
			const discover = () => {
				if (!cfg.baseURL) { toast(t('err') + t('baseURL'), false); return; }
				setBusy(true);
				api('/api/model-extras/discover', { baseURL: cfg.baseURL, apiKey: cfg.apiKey.startsWith('****') ? '' : cfg.apiKey })
					.then((d) => {
						if (!d.ok) { toast(t('err') + (d.error || ''), false); return; }
						setAvailable(d.models || []);
						toast(`${d.models.length} 个模型已获取，勾选后保存`, true);
					})
					.finally(() => setBusy(false));
			};
			const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value }));
			const toggleModel = (id) => {
				setCfg((c) => ({
					...c,
					models: c.models.includes(id) ? c.models.filter((m) => m !== id) : [...c.models, id]
				}));
			};

			return react.createElement('div', { style: S.section }, [
				react.createElement('p', { key: 't', style: Object.assign({}, S.note, { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, t('title')),
				react.createElement('p', { key: 'd', style: S.note }, t('desc')),
				react.createElement('div', { key: 'c', style: S.card }, [
					react.createElement('div', { key: 'r1', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('baseURL')),
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('baseURLPlaceholder'), value: cfg.baseURL, onChange: set('baseURL') })
					]),
					react.createElement('div', { key: 'r2', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('apiKey')),
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), type: 'password', placeholder: 'sk-…', value: cfg.apiKey, onChange: set('apiKey') })
					]),
					react.createElement('div', { key: 'r3', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('reasoning')),
						react.createElement('select', { key: 's', style: Object.assign({}, S.input, { width: 140 }), value: cfg.reasoningEffort, onChange: set('reasoningEffort') }, ['off', 'minimal', 'low', 'medium', 'high'].map((e) => react.createElement('option', { key: e, value: e }, e))),
						react.createElement('span', { key: 'l2', style: S.label }, t('maxTokens')),
						react.createElement('input', { key: 'm', style: Object.assign({}, S.input, { width: 100 }), type: 'number', value: cfg.maxTokens, onChange: set('maxTokens') })
					]),
					react.createElement('div', { key: 'r4', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('models')),
						react.createElement('div', { key: 'sp', style: { flex: 1 } }),
						react.createElement('button', { key: 'all', style: Object.assign({}, S.button, { height: 26, fontSize: 12, borderRadius: 999, padding: '0 10px' }), onClick: () => setCfg((c) => ({ ...c, models: available.map((m) => m.id) })) }, t('all')),
						react.createElement('button', { key: 'none', style: Object.assign({}, S.button, { height: 26, fontSize: 12, borderRadius: 999, padding: '0 10px' }), onClick: () => setCfg((c) => ({ ...c, models: [] })) }, t('none')),
						react.createElement('button', { key: 'b', style: Object.assign({}, S.button, busy ? { opacity: .6 } : {}), disabled: busy, onClick: discover }, busy ? t('fetching') : '🔍 ' + t('fetchModels'))
					]),
					available.length > 0 ? react.createElement('div', { key: 'ml', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6, maxHeight: 180, overflowY: 'auto' } }, available.map((m) =>
						react.createElement('label', { key: m.id, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, [
							react.createElement('input', { key: 'c', type: 'checkbox', checked: cfg.models.includes(m.id), onChange: () => toggleModel(m.id) }),
							m.name || m.id
						])
					)) : null,
					react.createElement('div', { key: 'f', style: S.row }, [
						react.createElement('button', { key: 'save', style: Object.assign({}, S.button, busy ? { opacity: .6 } : {}), disabled: busy, onClick: save }, t('save')),
						react.createElement('div', { key: 'sp', style: { flex: 1 } }),
						msg ? react.createElement('p', { key: 'm', style: msgOk ? S.ok : S.err }, msg) : null
					])
				]),
				react.createElement('p', { key: 'h', style: S.note }, t('hint'))
			]);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-extras: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
				name: 'settings.plugins.tab',
				id: 'model-extras',
				order: 50,
				label: () => t('tab'),
				locale: NS
			}, (props) => react.createElement(ModelExtrasTab, Object.assign({ t }, props))));
		}

		module.exports = { NS, apply, inject };
		return module.exports;
	}
});
