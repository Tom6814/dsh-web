// dsh-plugin-market — client half
// 在「设置 → 插件」中注册一个「插件市场」tab：
//   1. 通过 host API /api/plugin-market/search 搜索 GitHub topic:dsh-plugin 的插件
//   2. 展示卡片列表（名称 / 描述 / star / 语言），可一键安装
//   3. 安装由 host 执行 `dsh plugin --profile web add <spec>`，完成后提示重启生效
window.__ModuleLoader__.load({
	id: 'dsh-plugin-market',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require('react');
		let { useState, useEffect, useCallback } = react;

		const NS = 'pluginMarket';
		const inject = ['slots', 'locale'];

		const zh = {
			tab: '插件市场',
			searchPlaceholder: '搜索 GitHub topic:dsh-plugin 的插件…',
			search: '搜索',
			loading: '正在搜索…',
			empty: '没有找到插件。',
			error: '搜索失败：',
			stars: 'star',
			install: '安装',
			installing: '安装中…',
			installed: '安装成功，重启服务后生效。',
			installFailed: '安装失败：',
			browseAll: '在 GitHub 浏览全部插件',
			poweredBy: '数据来源：GitHub topic:dsh-plugin（官方推荐插件话题）'
		};
		const en = {
			tab: 'Plugin market',
			searchPlaceholder: 'Search GitHub topic:dsh-plugin…',
			search: 'Search',
			loading: 'Searching…',
			empty: 'No plugins found.',
			error: 'Search failed: ',
			stars: 'stars',
			install: 'Install',
			installing: 'Installing…',
			installed: 'Installed. Restart the service to activate.',
			installFailed: 'Install failed: ',
			browseAll: 'Browse all on GitHub',
			poweredBy: 'Source: GitHub topic:dsh-plugin (official plugin topic)'
		};

		// ── 轻量样式（跟随 dsh 的 CSS 变量，自动适配明暗主题）──
		const S = {
			section: { width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--dsw-alias-label-primary)' },
			searchRow: { display: 'flex', gap: 8 },
			input: { flex: 1, height: 36, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 12px', fontSize: 13, font: 'inherit', outline: 'none' },
			button: { height: 36, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', padding: '0 16px', fontSize: 13, cursor: 'pointer', font: 'inherit' },
			buttonDisabled: { opacity: 0.6, cursor: 'not-allowed' },
			status: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px', margin: 0 },
			cards: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: 0, margin: 0, listStyle: 'none' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
			cardTitle: { fontSize: 14, fontWeight: 600, lineHeight: '20px', margin: 0, overflowWrap: 'anywhere' },
			cardDesc: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
			cardMeta: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', display: 'flex', gap: 8, alignItems: 'center' },
			cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
			link: { color: 'var(--dsw-alias-state-business-primary)', textDecoration: 'none', fontSize: 12 },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, lineHeight: '18px', margin: 0, overflowWrap: 'anywhere' },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '18px', margin: 0, overflowWrap: 'anywhere' }
		};

		function MarketTab({ t }) {
			const [query, setQuery] = useState('');
			const [state, setState] = useState({ status: 'idle', items: [], error: null });
			const [installing, setInstalling] = useState(null);
			const [result, setResult] = useState(null);

			const search = useCallback((kw) => {
				setState({ status: 'loading', items: [], error: null });
				fetch('/api/plugin-market/search?q=' + encodeURIComponent(kw))
					.then((r) => r.json())
					.then((data) => {
						if (data.ok) setState({ status: 'ready', items: data.items, error: null });
						else setState({ status: 'error', items: [], error: data.error });
					})
					.catch((e) => setState({ status: 'error', items: [], error: String(e) }));
			}, []);

			useEffect(() => { search(''); }, [search]);

			const install = (spec) => {
				setInstalling(spec);
				setResult(null);
				fetch('/api/plugin-market/install', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ spec })
				})
					.then((r) => r.json())
					.then((data) => setResult(data))
					.catch((e) => setResult({ ok: false, error: String(e) }))
					.finally(() => setInstalling(null));
			};

			const submit = () => { setResult(null); search(query); };
			const busy = state.status === 'loading' || installing !== null;

			return react.createElement('div', { style: S.section }, [
				react.createElement('div', { key: 'search', style: S.searchRow }, [
					react.createElement('input', {
						key: 'input',
						style: S.input,
						placeholder: t('searchPlaceholder'),
						value: query,
						onChange: (e) => setQuery(e.target.value),
						onKeyDown: (e) => { if (e.key === 'Enter') submit(); }
					}),
					react.createElement('button', {
						key: 'btn',
						style: Object.assign({}, S.button, busy ? S.buttonDisabled : {}),
						disabled: busy,
						onClick: submit
					}, t('search'))
				]),
				result && result.ok ? react.createElement('p', { key: 'ok', style: S.ok }, t('installed')) : null,
				result && !result.ok ? react.createElement('p', { key: 'err', style: S.err }, t('installFailed') + (result.error || '') + (result.output ? ' — ' + result.output.slice(0, 400) : '')) : null,
				state.status === 'loading' ? react.createElement('p', { key: 'st', style: S.status }, t('loading')) : null,
				state.status === 'error' ? react.createElement('p', { key: 'st', style: S.status }, t('error') + String(state.error)) : null,
				state.status === 'ready' && state.items.length === 0 ? react.createElement('p', { key: 'st', style: S.status }, t('empty')) : null,
				state.status === 'ready' && state.items.length > 0 ? react.createElement('ul', { key: 'list', style: S.cards }, state.items.map((item) =>
					react.createElement('li', { key: item.fullName, style: S.card }, [
						react.createElement('p', { key: 't', style: S.cardTitle }, item.fullName),
						item.description ? react.createElement('p', { key: 'd', style: S.cardDesc }, item.description) : null,
						react.createElement('div', { key: 'f', style: S.cardFoot }, [
							react.createElement('span', { key: 'm', style: S.cardMeta }, [
								react.createElement('span', { key: 's', style: { whiteSpace: 'nowrap' } }, '★ ' + item.stars + ' ' + t('stars')),
								item.language ? react.createElement('span', { key: 'l' }, item.language) : null
							]),
							react.createElement('button', {
								key: 'i',
								style: Object.assign({}, S.button, installing === item.fullName ? S.buttonDisabled : {}),
								disabled: installing !== null,
								onClick: () => install(item.fullName)
							}, installing === item.fullName ? t('installing') : t('install'))
						])
					])
				)) : null,
				react.createElement('p', { key: 'foot', style: S.note }, [
					react.createElement('a', { key: 'a', style: S.link, href: 'https://github.com/topics/dsh-plugin', target: '_blank', rel: 'noreferrer' }, t('browseAll')),
					' — ' + t('poweredBy')
				])
			]);
		}

		/** 注册「插件市场」tab 到设置 → 插件板块。 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-market: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
				name: 'settings.plugins.tab',
				id: 'market',
				order: 20,
				label: () => t('tab'),
				locale: NS
			}, MarketTab));
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
