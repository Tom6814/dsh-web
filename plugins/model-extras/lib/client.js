// dsh-model-extras — client half
// 「设置 → 插件 → 模型与 API」统一设置：
//   1. DeepSeek API Key（写入官方 .credentials.yaml，与原生 Models 页同源）
//   2. 自定义模型（OpenAI Responses API：任意地址+Key，/models 自动获取）
//   3. 图片生成（OpenAI 兼容 /images/generations，gpt-image-1/2 等）
// UI 采用 DeepSeek 原生设计语言：--dsw-alias-* 变量、圆角分层、hover 动效。
window.__ModuleLoader__.load({
	id: 'dsh-model-extras',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const { useState, useEffect } = react;

		const NS = 'model-extras';
		const inject = ['slots', 'locale'];

		const zh = {
			tab: '模型与 API',
			secDeepseek: 'DeepSeek（原生模型）',
			secDeepseekDesc: '配置 DeepSeek 官方 API Key（写入 .credentials.yaml，官方「设置 → 模型」页同源生效）。',
			secCustom: '自定义模型（OpenAI Responses / Codex）',
			secCustomDesc: '任意 OpenAI 兼容端点（走 /v1/responses 的 Codex、gpt-5 等）。填地址与 Key 后「自动获取模型」，保存后在会话模型选择器选 openai-responses。',
			secImage: '图片生成（GPT Image 1/2 等）',
			secImageDesc: '对话内生成图片：配置 OpenAI 兼容图片端点，Agent 通过 generate_image 工具出图到工作区 images/。',
			apiKey: 'API Key',
			apiKeyPlaceholder: 'sk-…',
			saveKey: '保存 Key',
			keySaved: '已保存（官方模型选择器即可使用 DeepSeek）',
			keyConfigured: '已配置',
			keyMissing: '未配置',
			baseURL: 'API 地址',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			reasoning: '推理等级',
			maxTokens: '最大输出 Token',
			models: '可用模型',
			fetchModels: '自动获取模型',
			fetching: '获取中…',
			all: '全选',
			none: '清空',
			save: '保存',
			saved: '已保存：对话模型热生效，提供方列表下次启动刷新',
			modelPlaceholder: 'gpt-5-codex / gpt-5…',
			imageModel: '图片模型',
			imageModelPlaceholder: 'gpt-image-1 / gpt-image-2 / dall-e-3',
			size: '默认尺寸',
			test: '测试生成',
			testing: '测试中…',
			testOk: '测试图已保存：',
			err: '操作失败：',
			note: 'Key 仅保存在容器内（.credentials.yaml / 配置文件），不会写入工作区。'
		};
		const en = {
			tab: 'Models & API',
			secDeepseek: 'DeepSeek (native)',
			secDeepseekDesc: 'DeepSeek API key, stored in .credentials.yaml (shared with the native Models page).',
			secCustom: 'Custom model (OpenAI Responses / Codex)',
			secCustomDesc: 'Any OpenAI-compatible /v1/responses endpoint (Codex, gpt-5…). Fill base URL + key, fetch models, save, then pick the openai-responses provider.',
			secImage: 'Image generation (GPT Image 1/2…)',
			secImageDesc: 'Generate images in chat: configure an OpenAI-compatible images endpoint; the agent uses the generate_image tool.',
			apiKey: 'API Key',
			apiKeyPlaceholder: 'sk-…',
			saveKey: 'Save key',
			keySaved: 'Saved — DeepSeek is ready in the model picker',
			keyConfigured: 'Configured',
			keyMissing: 'Not configured',
			baseURL: 'API base URL',
			baseURLPlaceholder: 'https://api.openai.com/v1',
			reasoning: 'Reasoning effort',
			maxTokens: 'Max output tokens',
			models: 'Available models',
			fetchModels: 'Fetch models',
			fetching: 'Fetching…',
			all: 'Select all',
			none: 'Clear',
			save: 'Save',
			saved: 'Saved — chat model live; provider list refreshes on next boot',
			modelPlaceholder: 'gpt-5-codex / gpt-5…',
			imageModel: 'Image model',
			imageModelPlaceholder: 'gpt-image-1 / gpt-image-2 / dall-e-3',
			size: 'Default size',
			test: 'Test generate',
			testing: 'Testing…',
			testOk: 'Test image saved: ',
			err: 'Failed: ',
			note: 'Keys stay in the container config only, never written to the workspace.'
		};

		// DeepSeek 原生设计语言：层次/圆角/主色/hover 动效
		const S = {
			wrap: { width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--dsw-alias-label-primary)' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color .18s ease, box-shadow .18s ease' },
			secTitle: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
			secDesc: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' },
			row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 84, flex: 'none' },
			input: { height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, font: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s ease, box-shadow .15s ease' },
			btn: { height: 30, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 13, cursor: 'pointer', font: 'inherit', transition: 'background .12s ease, border-color .12s ease, color .12s ease', whiteSpace: 'nowrap' },
			btnPrimary: { height: 30, borderRadius: 8, border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary)', color: '#fff', padding: '0 16px', fontSize: 13, cursor: 'pointer', font: 'inherit', transition: 'opacity .12s ease, filter .12s ease', whiteSpace: 'nowrap' },
			btnGhost: { height: 26, borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '0 12px', fontSize: 12, cursor: 'pointer', font: 'inherit', transition: 'all .12s ease' },
			disabled: { opacity: .55, cursor: 'not-allowed' },
			chip: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 },
			chipOk: { background: 'var(--dsw-alias-state-success-alpha, rgba(46,160,67,.14))', color: 'var(--dsw-alias-state-success-primary)' },
			chipNo: { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-tertiary)' },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, margin: 0 },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, margin: 0 },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			divider: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '2px 0' },
			modelGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6, maxHeight: 170, overflowY: 'auto', padding: '6px 2px' },
			modelItem: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere', cursor: 'pointer', padding: '3px 4px', borderRadius: 6, transition: 'background .12s ease' }
		};

		function Section({ title, desc, children }) {
			return react.createElement('div', { style: S.card }, [
				react.createElement('p', { key: 't', style: S.secTitle }, title),
				desc ? react.createElement('p', { key: 'd', style: S.secDesc }, desc) : null,
				react.createElement('div', { key: 'c', style: { display: 'flex', flexDirection: 'column', gap: 10 } }, children)
			]);
		}
		function Field({ label, children, width }) {
			return react.createElement('div', { style: Object.assign({}, S.row, width ? { maxWidth: width } : {}) }, [
				react.createElement('span', { key: 'l', style: S.label }, label),
				children
			]);
		}
		function Btn({ t, primary, ghost, children, onClick, disabled, title }) {
			const base = primary ? S.btnPrimary : ghost ? S.btnGhost : S.btn;
			return react.createElement('button', {
				type: 'button',
				title,
				style: Object.assign({}, base, disabled ? S.disabled : {}),
				disabled,
				onMouseEnter: (e) => { if (!primary && !disabled) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; if (primary && !disabled) e.currentTarget.style.filter = 'brightness(1.08)'; },
				onMouseLeave: (e) => { if (!primary && !disabled) e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1)'; if (primary && !disabled) e.currentTarget.style.filter = 'none'; },
				onClick
			}, children);
		}

		function ModelsApiTab({ t }) {
			// DeepSeek
			const [dsKey, setDsKey] = useState('');
			const [dsConfigured, setDsConfigured] = useState(false);
			// 自定义模型
			const [cfg, setCfg] = useState({ baseURL: '', apiKey: '', models: [], reasoningEffort: 'medium', maxTokens: 16384 });
			const [available, setAvailable] = useState([]);
			// 图片生成
			const [img, setImg] = useState({ baseURL: '', apiKey: '', model: '', size: '1024x1024' });
			const [imgModels, setImgModels] = useState([]);
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [msgOk, setMsgOk] = useState(false);

			useEffect(() => {
				fetch('/api/model-extras/deepseek-key').then((r) => r.json()).then((d) => { if (d.ok) { setDsConfigured(!!d.configured); setDsKey(d.apiKey || ''); } });
				fetch('/api/model-extras/config').then((r) => r.json()).then((d) => { if (d.ok) setCfg((c) => ({ ...c, ...d.config })); });
				fetch('/api/image-gen/config').then((r) => r.json()).then((d) => { if (d.ok) setImg((c) => ({ ...c, ...d.config })); });
			}, []);

			const toast = (text, ok) => { setMsg(text); setMsgOk(!!ok); setTimeout(() => { setMsg(null); setMsgOk(false); }, 5000); };
			const api = (url, body) => fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
			const set = (k, group) => (e) => { if (group === 'cfg') setCfg((c) => ({ ...c, [k]: e.target.value })); else setImg((c) => ({ ...c, [k]: e.target.value })); };

			const saveDsKey = () => {
				if (!dsKey || dsKey.startsWith('****')) return;
				setBusy(true);
				api('/api/model-extras/deepseek-key', { apiKey: dsKey })
					.then((d) => { if (d.ok) { setDsConfigured(!!d.configured); setDsKey(d.apiKey || ''); toast(t('keySaved'), true); } else toast(t('err') + (d.error || ''), false); })
					.finally(() => setBusy(false));
			};
			const saveCfg = () => {
				setBusy(true);
				api('/api/model-extras/config', { baseURL: cfg.baseURL, apiKey: cfg.apiKey, models: cfg.models, reasoningEffort: cfg.reasoningEffort, maxTokens: Number(cfg.maxTokens) })
					.then((d) => { toast(d.ok ? (d.note || t('saved')) : t('err') + (d.error || ''), d.ok); if (d.ok) setCfg((c) => ({ ...c, ...d.config })); })
					.finally(() => setBusy(false));
			};
			const discover = () => {
				if (!cfg.baseURL) { toast(t('err') + t('baseURL'), false); return; }
				setBusy(true);
				api('/api/model-extras/discover', { baseURL: cfg.baseURL, apiKey: cfg.apiKey.startsWith('****') ? '' : cfg.apiKey })
					.then((d) => { if (!d.ok) { toast(t('err') + (d.error || ''), false); return; } setAvailable(d.models || []); toast(`${d.models.length} 个模型已获取`, true); })
					.finally(() => setBusy(false));
			};
			const toggleModel = (id) => setCfg((c) => ({ ...c, models: c.models.includes(id) ? c.models.filter((m) => m !== id) : [...c.models, id] }));
			const saveImg = () => {
				setBusy(true);
				api('/api/image-gen/config', { baseURL: img.baseURL, apiKey: img.apiKey, model: img.model, size: img.size })
					.then((d) => { toast(d.ok ? t('saved') : t('err') + (d.error || ''), d.ok); if (d.ok) setImg((c) => ({ ...c, ...d.config })); })
					.finally(() => setBusy(false));
			};
			const discoverImg = () => {
				if (!img.baseURL) { toast(t('err') + t('baseURL'), false); return; }
				setBusy(true);
				api('/api/image-gen/models', { baseURL: img.baseURL, apiKey: img.apiKey.startsWith('****') ? '' : img.apiKey })
					.then((d) => { if (!d.ok) { toast(t('err') + (d.error || ''), false); return; } setImgModels(d.models || []); if (d.images && d.images.length && !img.model) setImg((c) => ({ ...c, model: d.images[0] })); toast(`${d.models.length} 个模型（图片 ${d.images.length}）`, true); })
					.finally(() => setBusy(false));
			};
			const testImg = () => {
				setBusy(true);
				api('/api/image-gen/test', { baseURL: img.baseURL, apiKey: img.apiKey, model: img.model, size: img.size })
					.then((d) => { if (d.ok) toast(t('testOk') + d.path, true); else toast(t('err') + (d.error || ''), false); })
					.finally(() => setBusy(false));
			};

			return react.createElement('div', { style: S.wrap }, [
				msg ? react.createElement('p', { key: 'msg', style: msgOk ? S.ok : S.err }, msg) : null,

				// 1. DeepSeek
				react.createElement(Section, { key: 'ds', title: t('secDeepseek'), desc: t('secDeepseekDesc') }, [
					react.createElement(Field, { key: 'f', label: t('apiKey') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), type: 'password', placeholder: t('apiKeyPlaceholder'), value: dsKey, onChange: (e) => setDsKey(e.target.value) }),
						react.createElement('span', { key: 's', style: Object.assign({}, S.chip, dsConfigured ? S.chipOk : S.chipNo) }, dsConfigured ? '✓ ' + t('keyConfigured') : t('keyMissing')),
						react.createElement(Btn, { key: 'b', t, primary: true, disabled: busy || !dsKey || dsKey.startsWith('****'), onClick: saveDsKey }, t('saveKey'))
					])
				]),

				react.createElement('div', { key: 'd1', style: S.divider }),

				// 2. 自定义模型（Responses）
				react.createElement(Section, { key: 'custom', title: t('secCustom'), desc: t('secCustomDesc') }, [
					react.createElement(Field, { key: 'u', label: t('baseURL') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), placeholder: t('baseURLPlaceholder'), value: cfg.baseURL, onChange: set('baseURL', 'cfg') })
					]),
					react.createElement(Field, { key: 'k', label: t('apiKey') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), type: 'password', placeholder: t('apiKeyPlaceholder'), value: cfg.apiKey, onChange: set('apiKey', 'cfg') })
					]),
					react.createElement(Field, { key: 'r', label: t('reasoning') }, [
						react.createElement('select', { key: 's', style: Object.assign({}, S.input, { width: 130 }), value: cfg.reasoningEffort, onChange: set('reasoningEffort', 'cfg') }, ['off', 'minimal', 'low', 'medium', 'high'].map((e) => react.createElement('option', { key: e, value: e }, e))),
						react.createElement('span', { key: 'l2', style: S.label }, t('maxTokens')),
						react.createElement('input', { key: 'm', style: Object.assign({}, S.input, { width: 100 }), type: 'number', value: cfg.maxTokens, onChange: set('maxTokens', 'cfg') })
					]),
					react.createElement(Field, { key: 'm', label: t('models') }, [
						react.createElement('div', { key: 'sp', style: { flex: 1 } }),
						react.createElement(Btn, { key: 'all', t, ghost: true, onClick: () => setCfg((c) => ({ ...c, models: available.map((m) => m.id) })) }, t('all')),
						react.createElement(Btn, { key: 'none', t, ghost: true, onClick: () => setCfg((c) => ({ ...c, models: [] })) }, t('none')),
						react.createElement(Btn, { key: 'b', t, disabled: busy, onClick: discover }, busy ? t('fetching') : '🔍 ' + t('fetchModels'))
					]),
					available.length > 0 ? react.createElement('div', { key: 'grid', style: S.modelGrid }, available.map((m) =>
						react.createElement('label', { key: m.id, style: S.modelItem, onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; }, onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; } }, [
							react.createElement('input', { key: 'c', type: 'checkbox', checked: cfg.models.includes(m.id), onChange: () => toggleModel(m.id) }),
							react.createElement('span', { key: 'n' }, m.name || m.id)
						])
					)) : null,
					react.createElement('div', { key: 'f', style: S.row }, [
						react.createElement(Btn, { key: 'b', t, primary: true, disabled: busy, onClick: saveCfg }, t('save')),
						react.createElement('span', { key: 'n', style: S.note }, (cfg.models || []).length + ' 个模型已启用')
					])
				]),

				react.createElement('div', { key: 'd2', style: S.divider }),

				// 3. 图片生成
				react.createElement(Section, { key: 'img', title: t('secImage'), desc: t('secImageDesc') }, [
					react.createElement(Field, { key: 'u', label: t('baseURL') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), placeholder: t('baseURLPlaceholder'), value: img.baseURL, onChange: set('baseURL', 'img') })
					]),
					react.createElement(Field, { key: 'k', label: t('apiKey') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), type: 'password', placeholder: t('apiKeyPlaceholder'), value: img.apiKey, onChange: set('apiKey', 'img') })
					]),
					react.createElement(Field, { key: 'm', label: t('imageModel') }, [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1, minWidth: 220 }), placeholder: t('imageModelPlaceholder'), value: img.model, onChange: set('model', 'img'), list: 'imgGenModels2' }),
						react.createElement('datalist', { key: 'dl', id: 'imgGenModels2' }, imgModels.map((m) => react.createElement('option', { key: m, value: m }))),
						react.createElement(Btn, { key: 'b', t, disabled: busy, onClick: discoverImg }, busy ? t('fetching') : '🔍 ' + t('fetchModels'))
					]),
					react.createElement(Field, { key: 's', label: t('size') }, [
						react.createElement('select', { key: 'sel', style: Object.assign({}, S.input, { width: 180 }), value: img.size, onChange: set('size', 'img') }, ['1024x1024', '1536x1024', '1024x1536', '512x512', '1024x1792', '1792x1024'].map((s) => react.createElement('option', { key: s, value: s }, s))),
						react.createElement('div', { key: 'sp', style: { flex: 1 } }),
						react.createElement(Btn, { key: 'save', t, primary: true, disabled: busy, onClick: saveImg }, t('save')),
						react.createElement(Btn, { key: 'test', t, disabled: busy, onClick: testImg }, busy ? t('testing') : '🧪 ' + t('test'))
					])
				]),

				react.createElement('p', { key: 'note', style: S.note }, t('note'))
			]);
		}

		function apply(ctx) {
			// 模型与 API 配置：官方原生「设置 → 模型」已覆盖（DeepSeek Key /
			// 自定义 OpenAI 兼容提供方），不再注册重复 tab。
			// host 端（dsh-model-extras）保留：openai-responses 适配器（Codex/gpt-5
			// 的 /v1/responses 协议）、/models 自动获取；其配置存 $DSH_HOME/model-extras.json，
			// 与官方 Models 页选中的 openai-responses 提供方配合使用。
			void ctx;
		}

		module.exports = { NS, apply, inject };
		return module.exports;
	}
});
