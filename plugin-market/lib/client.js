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
			restart: '重启服务',
			restarting: '正在重启…',
			restartFailed: '重启失败：',
			restartHint: '重启后插件即可使用；页面断开属正常现象，稍等片刻刷新即可。',
			installFailed: '安装失败：',
			browseAll: '在 GitHub 浏览全部插件',
			preview: '预览',
			previewTitle: '预览',
			previewPlaceholder: '输入路径或 http://localhost:端口/…',
			previewClose: '关闭',
			previewBack: '后退',
			previewForward: '前进',
			previewRefresh: '刷新',
			previewExternal: '在新标签页打开',
			previewGo: '前往',
			previewHint: '对话中的 localhost 链接与本地文件会在此打开',
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
			restart: 'Restart service',
			restarting: 'Restarting…',
			restartFailed: 'Restart failed: ',
			restartHint: 'The plugin activates after restart. The page will disconnect briefly — wait a moment and refresh.',
			installFailed: 'Install failed: ',
			browseAll: 'Browse all on GitHub',
			preview: 'Preview',
			previewTitle: 'Preview',
			previewPlaceholder: 'Type a path or http://localhost:port/…',
			previewClose: 'Close',
			previewBack: 'Back',
			previewForward: 'Forward',
			previewRefresh: 'Refresh',
			previewExternal: 'Open in new tab',
			previewGo: 'Go',
			previewHint: 'localhost links and local files from the chat open here',
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
			const [restarting, setRestarting] = useState(false);
			const [restartError, setRestartError] = useState(null);

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
				setRestartError(null);
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

			/** 重启服务：dsh 进程优雅退出，容器自动重启后新插件生效。 */
			const restart = () => {
				setRestarting(true);
				setRestartError(null);
				fetch('/api/plugin-market/restart', { method: 'POST' })
					.then((r) => r.json())
					.then((data) => {
						if (!data.ok) { setRestartError(data.error || String(data)); setRestarting(false); }
						// 成功时服务即将退出，页面会断开；无需再做任何事
					})
					.catch(() => { /* 连接断开即重启已触发，属预期 */ });
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
				result && result.ok ? react.createElement('div', { key: 'ok', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
					react.createElement('p', { key: 'msg', style: S.ok }, t('installed')),
					react.createElement('div', { key: 'row', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
						react.createElement('button', {
							key: 'btn',
							style: Object.assign({}, S.button, restarting ? S.buttonDisabled : {}),
							disabled: restarting,
							onClick: restart
						}, restarting ? t('restarting') : t('restart')),
						react.createElement('span', { key: 'hint', style: S.note }, t('restartHint'))
					]),
					restartError !== null ? react.createElement('p', { key: 'rerr', style: S.err }, t('restartFailed') + restartError) : null
				]) : null,
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

		/** 把链接解析为预览 URL；非本地链接返回 null（保持默认跳转）。 */
		function toPreviewUrl(href) {
			const h = String(href || '').trim();
			if (!h || h.startsWith('#') || h.startsWith('javascript:') || h.startsWith('data:') || h.startsWith('mailto:') || h.startsWith('tel:')) return null;
			if (h.startsWith('/preview/')) return h;
			// 本地端口服务：http://localhost:PORT/... / http://127.0.0.1:PORT/...
			let m = h.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(\/.*)?$/i);
			if (m) {
				const port = Number(m[1]);
				if (port >= 1 && port <= 65535) return '/preview/port/' + port + (m[2] || '/');
			}
			// 外部 http(s) 链接 → 保持默认（新标签页）
			if (/^https?:\/\//i.test(h)) return null;
			// 内部绝对路径 → 保持默认
			if (h.startsWith('/')) return null;
			// 相对路径（对话里的文件引用）→ 工作区文件预览
			return '/preview/file/' + h;
		}

		/**
		* 预览面板：右下角浮动按钮 + 右侧抽屉（iframe）。
		* 拦截本地链接（localhost:端口 / 相对文件路径）自动在面板内打开。
		* 样式使用 dsh 的 --dsw-* design tokens，与项目前端风格一致。
		* @param t - 词典绑定。
		* @returns 清理函数。
		*/
		function mountPreview(t) {
			const mount = () => {
				const el = (tag, style, ...children) => {
					const node = document.createElement(tag);
					Object.assign(node.style, style);
					for (const child of children) {
						if (child == null) continue;
						node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
					}
					return node;
				};
				const P = {
					fab: { position: 'fixed', right: 18, bottom: 18, zIndex: 9998, padding: '10px 16px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-state-business-primary)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, font: 'inherit', boxShadow: '0 4px 16px rgba(0,0,0,.32)' },
					panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(56vw, 880px)', background: 'var(--dsw-alias-bg-layer-1)', borderLeft: '1px solid var(--dsw-alias-border-l2)', zIndex: 9999, display: 'none', flexDirection: 'column', boxShadow: '-10px 0 28px rgba(0,0,0,.22)', color: 'var(--dsw-alias-label-primary)' },
					head: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
					ctrl: { flex: 'none', height: 28, minWidth: 28, padding: '0 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 13, font: 'inherit' },
					addr: { flex: 1, height: 28, minWidth: 0, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', padding: '0 8px', fontSize: 12, font: 'inherit' },
					iframe: { flex: 1, width: '100%', border: 0, background: '#fff' },
					empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, padding: 24, textAlign: 'center', lineHeight: '22px' }
				};

				const panel = el('div', P.panel);
				const addr = el('input', P.addr, '');
				addr.placeholder = t('previewPlaceholder');
				const frame = el('iframe', P.iframe);
				frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');
				const empty = el('div', P.empty, t('previewHint'));
				panel.appendChild(empty);
				panel.appendChild(frame);

				const mkBtn = (label, title, onClick) => {
					const b = el('button', P.ctrl, label);
					b.title = title;
					b.onclick = onClick;
					return b;
				};
				const head = el('div', P.head);
				head.appendChild(mkBtn('←', t('previewBack'), () => { try { frame.contentWindow.history.back(); } catch {} }));
				head.appendChild(mkBtn('→', t('previewForward'), () => { try { frame.contentWindow.history.forward(); } catch {} }));
				head.appendChild(mkBtn('↻', t('previewRefresh'), () => { frame.src = frame.src; }));
				head.appendChild(addr);
				head.appendChild(mkBtn('⇱', t('previewExternal'), () => {
					if (addr.value.trim()) window.open(addr.value.trim(), '_blank', 'noreferrer');
				}));
				head.appendChild(mkBtn('✕', t('previewClose'), () => { panel.style.display = 'none'; }));
				panel.insertBefore(head, panel.firstChild);

				const fab = el('button', P.fab, '◧ ' + t('preview'));
				fab.title = t('previewTitle');
				fab.onclick = () => {
					if (panel.style.display === 'flex') {
						panel.style.display = 'none';
					} else {
						panel.style.display = 'flex';
						if (!addr.value) { frame.style.display = 'none'; empty.style.display = 'flex'; }
					}
				};
				const openPanel = (url) => {
					panel.style.display = 'flex';
					frame.style.display = 'block';
					empty.style.display = 'none';
					frame.src = url;
					addr.value = url;
				};
				addr.addEventListener('keydown', (e) => {
					if (e.key !== 'Enter') return;
					const v = addr.value.trim();
					openPanel(toPreviewUrl(v) || v);
				});

				// 链接重写（捕获阶段）：对话里的 localhost / 相对文件链接 → 面板内打开
				const onClick = (e) => {
					const a = e.target && e.target.closest ? e.target.closest('a') : null;
					if (!a) return;
					const href = a.getAttribute('href') || '';
					const target = toPreviewUrl(href);
					if (!target) return;
					e.preventDefault();
					e.stopPropagation();
					openPanel(target);
				};
				document.addEventListener('click', onClick, true);

				document.body.appendChild(fab);
				document.body.appendChild(panel);
				return () => {
					document.removeEventListener('click', onClick, true);
					fab.remove();
					panel.remove();
				};
			};
			// body 可能尚未就绪（部分内嵌浏览器环境下插件激活早于 DOM）；等就绪再挂载
			if (document.body) return mount();
			document.addEventListener('DOMContentLoaded', mount, { once: true });
			return () => document.removeEventListener('DOMContentLoaded', mount);
		}

		/** 注册「插件市场」tab 到设置 → 插件板块，并挂载预览面板。 */
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
			// 预览面板：全局挂载一次；版本标记便于诊断缓存问题
			try { window.__DSH_PREVIEW_VERSION = '0.1.1'; } catch {}
			ctx.effect(() => mountPreview(t), 'plugin-market: preview panel');
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
