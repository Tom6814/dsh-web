// dsh-image-gen — client half
// 「设置 → 插件」新增「图片生成」tab：配置 OpenAI 兼容图片端点 / Key / 模型（自动获取）。
window.__ModuleLoader__.load({
	id: 'dsh-image-gen',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const { useState, useEffect } = react;

		const NS = 'image-gen';
		const inject = ['slots', 'locale'];

		const zh = {
			tab: '图片生成',
			title: '对话内生成图片（Agent 工具 generate_image）',
			baseURL: 'API 地址',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			apiKey: 'API Key',
			model: '图片模型',
			size: '默认尺寸',
			save: '保存',
			saved: '已保存',
			discover: '自动获取模型',
			discovering: '获取中…',
			testing: '测试生成中…',
			test: '测试生成',
			testOk: '测试图已生成：',
			err: '操作失败：',
			hint: '填入任意 OpenAI 兼容的图片端点（支持 /images/generations 与 /models）。模型可手动输入（如 gpt-image-1、gpt-image-2、dall-e-3），或点「自动获取模型」从端点拉取。',
			keyNote: 'Key 仅保存在容器内配置文件中（不落盘到工作区）。'
		};
		const en = {
			tab: 'Image gen',
			title: 'Generate images in chat (Agent tool: generate_image)',
			baseURL: 'API base URL',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			apiKey: 'API Key',
			model: 'Image model',
			size: 'Default size',
			save: 'Save',
			saved: 'Saved',
			discover: 'Fetch models',
			discovering: 'Fetching…',
			testing: 'Testing…',
			test: 'Test generate',
			testOk: 'Test image saved: ',
			err: 'Failed: ',
			hint: 'Any OpenAI-compatible image endpoint (/images/generations and /models). Type a model (gpt-image-1, gpt-image-2, dall-e-3…) or fetch the list.',
			keyNote: 'The key is stored in the container config only (never written to the workspace).'
		};

		const S = {
			section: { width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' },
			button: { height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 13, cursor: 'pointer', font: 'inherit' },
			input: { height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, font: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' },
			row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 88 },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, margin: 0 },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, margin: 0 },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }
		};

		function ImageGenTab({ t }) {
			const [cfg, setCfg] = useState({ baseURL: '', apiKey: '', model: '', size: '1024x1024' });
			const [models, setModels] = useState([]);
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [msgOk, setMsgOk] = useState(false);

			useEffect(() => {
				fetch('/api/image-gen/config').then((r) => r.json()).then((d) => { if (d.ok) setCfg((c) => ({ ...c, ...d.config })); });
			}, []);

			const toast = (text, ok) => { setMsg(text); setMsgOk(!!ok); setTimeout(() => { setMsg(null); setMsgOk(false); }, 4000); };
			const api = (url, body) => fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

			const save = () => {
				setBusy(true);
				api('/api/image-gen/config', { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, size: cfg.size })
					.then((d) => { toast(d.ok ? t('saved') : t('err') + (d.error || ''), d.ok); if (d.ok) setCfg((c) => ({ ...c, ...d.config })); })
					.finally(() => setBusy(false));
			};
			const discover = () => {
				if (!cfg.baseURL) { toast(t('err') + t('baseURL'), false); return; }
				setBusy(true);
				api('/api/image-gen/models', { baseURL: cfg.baseURL, apiKey: cfg.apiKey.startsWith('****') ? '' : cfg.apiKey })
					.then((d) => {
						if (!d.ok) { toast(t('err') + (d.error || ''), false); return; }
						setModels(d.models || []);
						if (d.images && d.images.length && !cfg.model) setCfg((c) => ({ ...c, model: d.images[0] }));
						toast(`${d.models.length} 个模型，图片相关 ${d.images.length} 个`, true);
					})
					.finally(() => setBusy(false));
			};
			const test = () => {
				if (!cfg.baseURL || (!cfg.apiKey || cfg.apiKey.startsWith('****')) && !cfg.model) { toast(t('err') + t('baseURL'), false); return; }
				setBusy(true);
				api('/api/image-gen/test', { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, size: cfg.size })
					.then((d) => { if (d.ok) toast(t('testOk') + d.path + '（可点击预览）', true); else toast(t('err') + (d.error || ''), false); })
					.finally(() => setBusy(false));
			};
			const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value }));

			return react.createElement('div', { style: S.section }, [
				react.createElement('p', { key: 't', style: Object.assign({}, S.note, { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, t('title')),
				react.createElement('p', { key: 'h', style: S.note }, t('hint')),
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
						react.createElement('span', { key: 'l', style: S.label }, t('model')),
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: 'gpt-image-1 / gpt-image-2 / dall-e-3', value: cfg.model, onChange: set('model'), list: 'imgGenModels' }),
						react.createElement('datalist', { key: 'dl', id: 'imgGenModels' }, models.map((m) => react.createElement('option', { key: m, value: m }))),
						react.createElement('button', { key: 'b', style: Object.assign({}, S.button, busy ? { opacity: .6 } : {}), disabled: busy, onClick: discover }, busy ? t('discovering') : '🔍 ' + t('discover'))
					]),
					react.createElement('div', { key: 'r4', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('size')),
						react.createElement('select', { key: 's', style: Object.assign({}, S.input, { width: 180 }), value: cfg.size, onChange: set('size') }, ['1024x1024', '1536x1024', '1024x1536', '512x512', '1024x1792', '1792x1024'].map((s) => react.createElement('option', { key: s, value: s }, s)))
					]),
					react.createElement('div', { key: 'f', style: S.row }, [
						react.createElement('button', { key: 'save', style: Object.assign({}, S.button, busy ? { opacity: .6 } : {}), disabled: busy, onClick: save }, t('save')),
						react.createElement('button', { key: 'test', style: Object.assign({}, S.button, busy ? { opacity: .6 } : {}), disabled: busy, onClick: test }, busy ? t('testing') : '🧪 ' + t('test')),
						react.createElement('div', { key: 'sp', style: { flex: 1 } }),
						msg ? react.createElement('p', { key: 'm', style: msgOk ? S.ok : S.err }, msg) : null
					])
				]),
				react.createElement('p', { key: 'k', style: S.note }, t('keyNote'))
			]);
		}

		function apply(ctx) {
			// 图片生成配置：官方原生设置页没有此能力，保留独立 tab（原生设计语言）。
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'image-gen: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
				name: 'settings.plugins.tab',
				id: 'image-gen',
				order: 40,
				label: () => t('tab'),
				locale: NS
			}, (props) => react.createElement(ImageGenTab, Object.assign({ t }, props))));
		}

		module.exports = { NS, apply, inject };
		return module.exports;
	}
});
