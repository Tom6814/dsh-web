// dsh-plugin-market — client half
// 在「设置 → 插件」中注册「插件市场」tab：
//   1. 通过 host API /api/plugin-market/search 搜索 GitHub topic:dsh-plugin 的插件
//   2. 展示卡片列表（名称 / 描述 / star / 语言），可一键安装
// 另外提供：
//   - 预览面板（DeepSeek 风格右抽屉）：对话里的 localhost 端口链接、文件提及
//     （MD/HTML/图片/代码等）自动在面板内打开；右上角 Session Log 旁有开关按钮
//   - 插件启停：官方「插件列表」卡片展开详情后注入「启用/停用」按钮（即时生效）
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
			restartDone: '服务已恢复，请刷新页面确认插件是否生效。',
			uninstall: '卸载',
			uninstalling: '卸载中…',
			uninstallOk: '已卸载，重启服务后生效。',
			uninstallErr: '卸载失败：',
			installFailed: '安装失败：',
			browseAll: '在 GitHub 浏览全部插件',
			preview: '预览',
			previewTitle: '预览面板（打开/关闭）',
			previewPlaceholder: '输入路径或 http://localhost:端口/…',
			previewClose: '关闭',
			previewBack: '后退',
			previewForward: '前进',
			previewRefresh: '刷新',
			previewExternal: '在新标签页打开',
			previewGo: '前往',
			previewHint: '对话中的 localhost 链接与本地文件会在此打开',
			previewUnavailable: '无法预览',
			// 插件启停按钮
			enable: '启用',
			disable: '停用',
			toggling: '切换中…',
			toggleEnabled: '已启用（即时生效）',
			toggleDisabled: '已停用（即时生效）',
			toggleErr: '切换失败：',
			enabledTag: '已启用',
			disabledTag: '已停用',
			poweredBy: '数据来源：GitHub topic:dsh-plugin；标注 ✓ npm 的仓库将直接安装对应 npm 包'
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
			restartDone: 'Service is back. Refresh the page to confirm the plugin.',
			uninstall: 'Uninstall',
			uninstalling: 'Uninstalling…',
			uninstallOk: 'Uninstalled. Restart to complete.',
			uninstallErr: 'Uninstall failed: ',
			installFailed: 'Install failed: ',
			browseAll: 'Browse all on GitHub',
			preview: 'Preview',
			previewTitle: 'Preview panel (toggle)',
			previewPlaceholder: 'Type a path or http://localhost:port/…',
			previewClose: 'Close',
			previewBack: 'Back',
			previewForward: 'Forward',
			previewRefresh: 'Refresh',
			previewExternal: 'Open in new tab',
			previewGo: 'Go',
			previewHint: 'localhost links and local files from the chat open here',
			previewUnavailable: 'Preview unavailable',
			enable: 'Enable',
			disable: 'Disable',
			toggling: 'Toggling…',
			toggleEnabled: 'Enabled (live)',
			toggleDisabled: 'Disabled (live)',
			toggleErr: 'Toggle failed: ',
			enabledTag: 'Enabled',
			disabledTag: 'Disabled',
			poweredBy: 'Source: GitHub topic:dsh-plugin; repos marked ✓ npm install their npm package directly'
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
			cardMeta: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 },
			cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
			link: { color: 'var(--dsw-alias-state-business-primary)', textDecoration: 'none', fontSize: 12 },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, lineHeight: '18px', margin: 0, overflowWrap: 'anywhere' },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '18px', margin: 0, overflowWrap: 'anywhere' },
			// 右上角 Session Log 同款胶囊按钮
			headerBtn: { border: '1px solid var(--dsw-alias-border-l2)', minWidth: 76, height: 32, color: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--dsw-font-family)', cursor: 'pointer', background: 'transparent', borderRadius: 18, justifyContent: 'center', alignItems: 'center', gap: 4, padding: '0 12px', fontSize: 13, lineHeight: '20px', display: 'inline-flex', whiteSpace: 'nowrap' }
		};

		function MarketTab({ t }) {
			const [query, setQuery] = useState('');
			const [state, setState] = useState({ status: 'idle', items: [], error: null });
			const [installing, setInstalling] = useState(null);
			const [result, setResult] = useState(null);
			const [restarting, setRestarting] = useState(false);
			const [restartError, setRestartError] = useState(null);
			const [restarted, setRestarted] = useState(false);
			const [uninstalling, setUninstalling] = useState(false);
			const [uninstallMsg, setUninstallMsg] = useState(null);

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

			useEffect(() => { search(''); }, []); // 仅挂载时搜索

			const install = (spec) => {
				setInstalling(spec);
				setResult(null);
				setRestartError(null);
				setUninstallMsg(null);
				window.__DSH_LAST_SPEC__ = spec;
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

			/** 重启服务：dsh 进程以非零码退出 → 容器平台自动拉起新实例。 */
			const restart = () => {
				setRestarting(true);
				setRestartError(null);
				setRestarted(false);
				fetch('/api/plugin-market/restart', { method: 'POST' })
					.then((r) => r.json())
					.then((data) => {
						if (!data.ok) { setRestartError(data.error || String(data)); setRestarting(false); return; }
						// 服务即将退出；轮询直到新实例恢复，然后提示刷新页面
						const started = Date.now();
						const poll = () => {
							fetch('/api/plugin-market/list', { method: 'GET' })
								.then((r) => r.json())
								.then(() => { setRestarting(false); setRestarted(true); })
								.catch(() => {
									if (Date.now() - started < 120000) setTimeout(poll, 3000);
									else { setRestarting(false); setRestartError('等待服务恢复超时，请手动刷新页面后查看'); }
								});
						};
						setTimeout(poll, 4000);
					})
					.catch(() => { /* 连接断开即重启已触发，属预期；继续轮询 */ });
			};

			/** 卸载插件（冲突修复/清理时使用）。 */
			const uninstall = (spec) => {
				setUninstalling(true);
				setUninstallMsg(null);
				fetch('/api/plugin-market/uninstall', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ spec })
				})
					.then((r) => r.json())
					.then((data) => {
						setUninstallMsg(data.ok ? (data.note || t('uninstallOk')) : (t('uninstallErr') + (data.error || '')));
					})
					.catch((e) => setUninstallMsg(t('uninstallErr') + String(e)))
					.finally(() => setUninstalling(false));
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
					result.hint ? react.createElement('p', { key: 'hint', style: S.note }, result.hint) : null,
					react.createElement('div', { key: 'row', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
						react.createElement('button', {
							key: 'btn',
							style: Object.assign({}, S.button, restarting ? S.buttonDisabled : {}),
							disabled: restarting,
							onClick: restart
						}, restarting ? t('restarting') : t('restart')),
						react.createElement('button', {
							key: 'ubtn',
							style: Object.assign({}, S.button, uninstalling ? S.buttonDisabled : {}),
							disabled: uninstalling,
							onClick: () => uninstall(window.__DSH_LAST_SPEC__)
						}, uninstalling ? t('uninstalling') : t('uninstall')),
						react.createElement('span', { key: 'hint', style: S.note }, t('restartHint'))
					]),
					restartError !== null ? react.createElement('p', { key: 'rerr', style: S.err }, t('restartFailed') + restartError) : null,
					restarted ? react.createElement('div', { key: 'rdone', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
						react.createElement('p', { key: 'msg', style: Object.assign({}, S.ok, { margin: 0 }) }, t('restartDone')),
						react.createElement('button', { key: 'btn', style: S.button, onClick: () => location.reload() }, '刷新页面')
					]) : null,
					uninstallMsg ? react.createElement('p', { key: 'umsg', style: S.note }, uninstallMsg) : null
				]) : null,
				result && !result.ok ? react.createElement('div', { key: 'err', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
					react.createElement('p', { key: 'msg', style: S.err }, t('installFailed') + (result.error || '')),
					result.note ? react.createElement('p', { key: 'note', style: S.err }, result.note) : null,
					result.hint ? react.createElement('p', { key: 'hint', style: S.note }, result.hint) : null,
					// 冲突/安装失败后的补救：卸载刚装的包
					(window.__DSH_LAST_SPEC__ && (result.conflict || result.reconciled !== false || !result.error)) ? react.createElement('div', { key: 'ubtnrow', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
						react.createElement('button', {
							key: 'ubtn',
							style: Object.assign({}, S.button, uninstalling ? S.buttonDisabled : {}),
							disabled: uninstalling,
							onClick: () => uninstall(window.__DSH_LAST_SPEC__)
						}, uninstalling ? t('uninstalling') : t('uninstall')),
						uninstallMsg ? react.createElement('span', { key: 'umsg', style: S.note }, uninstallMsg) : null
					]) : null,
					result.output ? react.createElement('pre', { key: 'out', style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8, padding: '8px 10px', overflowX: 'auto', margin: 0, maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, result.output.slice(0, 800)) : null
				]) : null,
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
								item.language ? react.createElement('span', { key: 'l' }, item.language) : null,
								item.npm ? react.createElement('span', {
									key: 'npm',
									style: {
										fontSize: 11,
										lineHeight: '16px',
										padding: '0 6px',
										borderRadius: 4,
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										maxWidth: 150,
										color: item.npm.hasBundle ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warning-primary)',
										border: '1px solid currentColor'
									},
									title: item.npm.hasBundle ? 'npm 包，安装后可直接生效' : 'npm 包但无 dsh.bundle，安装后可能不生效'
								}, (item.npm.hasBundle ? '✓ ' : '⚠ ') + 'npm: ' + item.npm.name) : null
							]),
							react.createElement('button', {
								key: 'i',
								style: Object.assign({}, S.button, { flexShrink: 0 }, installing !== null ? S.buttonDisabled : {}),
								disabled: installing !== null || (item.npm && !item.npm.hasBundle),
								title: item.npm?.hasBundle ? '安装 npm 包 ' + item.npm.name : (item.npm ? '该仓库的 npm 包没有 dsh.bundle 声明，无法一键安装（需在仓库内构建）' : '安装 GitHub 仓库'),
								onClick: () => install(item.npm?.hasBundle ? item.npm.name : item.fullName)
							}, installing === (item.npm?.hasBundle ? item.npm.name : item.fullName) ? t('installing') : t('install'))
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

		// ── 对话文件提及 / 产出文件 chip 的拦截 ────────────────────────────
		// dsh 把会话中的文件渲染为 <button title=路径 aria-label=打开…>，
		// 官方点击会走 workspaces 文件浏览；我们改为在预览面板打开可预览类型。
		const PREVIEW_EXT_RE = /\.(md|markdown|html?|txt|json|js|mjs|css|svg|png|jpe?g|gif|webp|ico|xml|ya?ml|pdf|py|tsx?|jsx|csv|sql|log|toml|ini|sh|go|rs|java|c|h|cpp|woff2?)$/i;

		/** 是否为可预览的文件提及按钮。 */
		function isPreviewableFile(title, ariaLabel) {
			if (!PREVIEW_EXT_RE.test(title)) return false;
			if (/^(打开|open)\b/i.test(ariaLabel)) return true;
			// 兜底：部分语言文案下 aria-label 不可靠，仅对明确的文档类型放行
			return /\.(md|markdown|html?)$/i.test(title);
		}

		/** 把按钮 title 归一化为预览 URL 的相对/绝对路径（保留绝对路径供 host 映射）。 */
		function filePreviewPath(title) {
			let p = String(title).replace(/\\/g, '/').trim();
			p = p.replace(/^\.\//, '');
			// 绝对路径（/tmp/xxx.html 等）保留开头的空段 → /preview/file//tmp/xxx.html
			return p.split('/').map(encodeURIComponent).join('/');
		}

		/**
		* 预览面板 v2（Trae Work 风格分栏预览）：
		* - Dock 分栏：打开时把 #root 往左挤（marginRight = 面板宽度），不遮挡对话
		* - 拖拽分隔条调宽（320~上限），宽度持久化到 localStorage
		* - 缩放控件（50%~200%）、前进/后退/刷新/外开/关闭
		* - 加载指示（spinner）、错误覆盖层（JSON 错误友好提示）
		* - 移动端（≤860px）自动全屏
		* - Esc 关闭；拦截对话里的 localhost 链接与文件提及自动打开
		* 右上角 Session Log 旁的胶囊按钮（slot 注册）负责开关。
		* @param t - 词典绑定。
		* @returns 清理函数。
		*/
		function mountPreview(t) {
			const STORE = 'dshPreviewV2';
			const loadState = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
			const saveState = (patch) => {
				try { localStorage.setItem(STORE, JSON.stringify(Object.assign(loadState(), patch))); } catch {}
			};
			const mount = () => {
				const st = loadState();
				const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
				const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
				const MIN_W = 320;
				const MAX_W = Math.max(MIN_W, Math.min(1100, (window.innerWidth || 1280) - 380));
				const state = {
					width: clamp(Number(st.width) || 520, MIN_W, MAX_W),
					zoom: clamp(Number(st.zoom) || 1, 0.5, 2),
					open: !!st.open
				};
				const el = (tag, style, ...children) => {
					const node = document.createElement(tag);
					for (const [key, value] of Object.entries(style)) {
						// CSS 属性数字值必须带单位（如 borderRadius: 20 → '20px'）；
						// 只有 zIndex 等极少数属性是纯数字语义。
						node.style[key] = typeof value === 'number' && key !== 'zIndex' ? value + 'px' : value;
					}
					for (const child of children) {
						if (child == null) continue;
						node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
					}
					return node;
				};
				// Trae Work 同款质感：圆角浮层、胶囊控件、灰调层叠、柔和阴影
				const P = {
					panel: { position: 'fixed', top: 14, right: 14, bottom: 14, width: state.width + 'px', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 16, zIndex: 9999, display: 'none', flexDirection: 'column', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 16px 48px rgba(0,0,0,.22)', overflow: 'hidden' },
					divider: { position: 'fixed', top: 14, bottom: 14, width: 8, cursor: 'col-resize', zIndex: 10000, display: 'none', marginLeft: -4 },
					dividerLine: { position: 'absolute', top: '50%', left: 3, width: 2, height: 56, borderRadius: 1, background: 'var(--dsw-alias-border-l2)', transform: 'translateY(-50%)' },
					head: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 8px', background: 'var(--dsw-alias-bg-layer-1)', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
					ctrl: { flex: 'none', height: 30, minWidth: 30, padding: '0 9px', borderRadius: 999, border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 13, font: 'inherit', transition: 'background .12s ease' },
					addr: { flex: 1, height: 30, minWidth: 0, borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 12, font: 'inherit', outline: 'none' },
					frameWrap: { flex: 1, position: 'relative', background: '#fff', overflow: 'hidden' },
					iframe: { width: '100%', height: '100%', border: 0, background: '#fff', display: 'block' },
					overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, padding: 24, textAlign: 'center', lineHeight: '22px', background: 'var(--dsw-alias-bg-layer-1)' },
					overlayTitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: 14, fontWeight: 600 },
					spinner: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'none', alignItems: 'center', justifyContent: 'center', background: 'var(--dsw-alias-bg-layer-1)', zIndex: 2 },
					spinDot: { width: 26, height: 26, borderRadius: '50%', border: '3px solid var(--dsw-alias-border-l2)', borderTopColor: 'var(--dsw-alias-state-business-primary)', animation: 'dshPreviewSpin .7s linear infinite' },
					zoomBadge: { flex: 'none', minWidth: 44, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: '30px' }
				};
				const spinKeyframes = document.createElement('style');
				spinKeyframes.textContent = '@keyframes dshPreviewSpin{to{transform:rotate(360deg)}}';
				document.head.appendChild(spinKeyframes);

				const panel = el('div', P.panel);
				const addr = el('input', P.addr, '');
				addr.placeholder = t('previewPlaceholder');
				addr.spellcheck = false;
				const frameWrap = el('div', P.frameWrap);
				const frame = el('iframe', P.iframe);
				frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads allow-same-origin');
				const overlay = el('div', P.overlay);
				const spinner = el('div', P.spinner, el('div', P.spinDot));
				const divider = el('div', P.divider, el('div', P.dividerLine));
				const zoomLabel = el('span', P.zoomBadge, Math.round(state.zoom * 100) + '%');
				frameWrap.appendChild(spinner);
				frameWrap.appendChild(overlay);
				frameWrap.appendChild(frame);
				panel.appendChild(frameWrap);

				// iframe 加载后：隐藏 spinner；同源可读时若是 JSON 错误则显示友好覆盖层
				frame.onload = () => {
					spinner.style.display = 'none';
					try {
						const doc = frame.contentDocument;
						const text = doc && doc.body ? doc.body.innerText.trim() : '';
						const m = text.match(/"error"\s*:\s*"([^"]+)"/);
						if (m) {
							overlay.style.display = 'flex';
							overlay.replaceChildren(
								el('span', P.overlayTitle, t('previewUnavailable')),
								el('span', null, m[1])
							);
						} else {
							overlay.style.display = 'none';
						}
					} catch { /* 跨源时保持 iframe 原样 */ }
				};
				const showSpinner = () => { overlay.style.display = 'none'; spinner.style.display = 'flex'; };

				const mkBtn = (label, title, onClick) => {
					const b = el('button', P.ctrl, label);
					b.title = title;
					b.onmouseenter = () => { b.style.background = 'var(--dsw-alias-interactive-bg-hover)'; };
					b.onmouseleave = () => { b.style.background = 'transparent'; };
					b.onclick = onClick;
					return b;
				};
				const setZoom = (z) => {
					state.zoom = clamp(z, 0.5, 2);
					frame.style.zoom = String(state.zoom);
					zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
					saveState({ zoom: state.zoom });
				};
				const head = el('div', P.head);
				head.appendChild(mkBtn('←', t('previewBack'), () => { try { frame.contentWindow.history.back(); } catch {} }));
				head.appendChild(mkBtn('→', t('previewForward'), () => { try { frame.contentWindow.history.forward(); } catch {} }));
				head.appendChild(mkBtn('↻', t('previewRefresh'), () => { showSpinner(); frame.src = frame.src; }));
				head.appendChild(addr);
				head.appendChild(mkBtn('−', '缩小（50%~200%）', () => setZoom(state.zoom - 0.25)));
				head.appendChild(zoomLabel);
				head.appendChild(mkBtn('＋', '放大', () => setZoom(state.zoom + 0.25)));
				head.appendChild(mkBtn('⇱', t('previewExternal'), () => {
					if (addr.value.trim()) window.open(addr.value.trim(), '_blank', 'noreferrer');
				}));
				head.appendChild(mkBtn('✕', t('previewClose'), () => { setOpen(false); }));
				panel.insertBefore(head, panel.firstChild);
				document.body.appendChild(divider);
				document.body.appendChild(panel);

				// 布局：打开时把 #root 往左挤（不遮挡对话），关闭时复位
				const root = document.getElementById('root');
				const effWidth = () => (isMobile() ? window.innerWidth : state.width);
				const applyLayout = (animate) => {
					if (!root) return;
					if (animate === false) root.style.transition = 'none';
					else root.style.transition = 'margin-right .28s cubic-bezier(.4,0,.2,1)';
					root.style.marginRight = state.open && !isMobile() ? effWidth() + 14 + 'px' : '0px';
				};
				const posDivider = () => {
					if (isMobile()) { divider.style.display = 'none'; return; }
					divider.style.display = state.open ? 'block' : 'none';
					divider.style.left = (window.innerWidth - effWidth() - 14 - 4) + 'px';
				};
				const setOpen = (open) => {
					state.open = open;
					panel.style.display = open ? 'flex' : 'none';
					panel.style.width = effWidth() + 'px';
					applyLayout(true);
					posDivider();
					saveState({ open });
					if (open && !addr.value) {
						frame.style.display = 'none';
						spinner.style.display = 'none';
						overlay.style.display = 'flex';
						overlay.replaceChildren(el('span', P.overlayTitle, t('previewTitle')), el('span', null, t('previewHint')));
					} else if (open) {
						frame.style.display = 'block';
					}
				};
				const openPanel = (url) => {
					state.open = true;
					panel.style.display = 'flex';
					panel.style.width = effWidth() + 'px';
					frame.style.display = 'block';
					overlay.style.display = 'none';
					showSpinner();
					frame.src = url;
					addr.value = url;
					applyLayout(true);
					posDivider();
					saveState({ open: true });
				};

				// 拖拽分隔条调宽（持久化）
				divider.addEventListener('mousedown', (e) => {
					e.preventDefault();
					applyLayout(false);
					const startX = e.clientX;
					const startW = effWidth();
					const onMove = (ev) => {
						const w = clamp(startW + (startX - ev.clientX), MIN_W, MAX_W);
						state.width = w;
						panel.style.width = w + 'px';
						if (root) root.style.marginRight = w + 14 + 'px';
						posDivider();
					};
					const onUp = () => {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						applyLayout(true);
						saveState({ width: state.width });
					};
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
				addr.addEventListener('keydown', (e) => {
					if (e.key !== 'Enter') return;
					const v = addr.value.trim();
					openPanel(toPreviewUrl(v) || v);
				});

				// 链接/文件拦截（捕获阶段）：
				//   1) 文件提及 / 产出文件 chip（button[title]）
				//   2) localhost 端口 / 相对路径链接
				// 外部链接不拦，保持默认新标签页打开。
				const onClick = (e) => {
					const btn = e.target && e.target.closest ? e.target.closest('button[title]') : null;
					if (btn) {
						const title = (btn.getAttribute('title') || '').trim();
						if (title && isPreviewableFile(title, btn.getAttribute('aria-label') || '')) {
							e.preventDefault();
							e.stopPropagation();
							openPanel('/preview/file/' + filePreviewPath(title));
							return;
						}
					}
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

				// Esc 关闭预览
				const onKey = (e) => { if (e.key === 'Escape' && state.open) setOpen(false); };
				document.addEventListener('keydown', onKey);

				// 移动端切换（窄屏全屏 ↔ 宽屏分栏）
				const mq = window.matchMedia('(max-width: 860px)');
				const onMq = () => {
					if (!state.open) return;
					panel.style.width = effWidth() + 'px';
					applyLayout(false);
					posDivider();
					setTimeout(() => applyLayout(true), 60);
				};
				if (mq.addEventListener) mq.addEventListener('change', onMq);
				else if (mq.addListener) mq.addListener(onMq);

				// 初始缩放与状态恢复（上次打开过则恢复）
				frame.style.zoom = String(state.zoom);
				if (state.open) {
					panel.style.display = 'flex';
					panel.style.width = effWidth() + 'px';
					applyLayout(false);
					posDivider();
				}

				// 全局开关：右上角 header 胶囊按钮调用
				const api = {
					toggle: () => setOpen(panel.style.display !== 'flex'),
					open: (url) => openPanel(url),
					isOpen: () => panel.style.display === 'flex',
					version: '0.2.0'
				};
				try { window.__DSH_PREVIEW__ = api; } catch {}

				return () => {
					document.removeEventListener('click', onClick, true);
					document.removeEventListener('keydown', onKey);
					if (mq.removeEventListener) mq.removeEventListener('change', onMq);
					else if (mq.removeListener) mq.removeListener(onMq);
					panel.remove();
					divider.remove();
					spinKeyframes.remove();
					applyLayout(false);
					if (root) root.style.transition = '';
					try { delete window.__DSH_PREVIEW__; } catch {}
				};
			};
			// body 可能尚未就绪（部分内嵌浏览器环境下插件激活早于 DOM）；等就绪再挂载
			if (document.body) return mount();
			document.addEventListener('DOMContentLoaded', mount, { once: true });
			return () => document.removeEventListener('DOMContentLoaded', mount);
		}

		/** 右上角 Session Log 旁的预览开关胶囊按钮（注入 header.utilities 槽位）。 */
		function PreviewHeaderButton({ t }) {
			return react.createElement('button', {
				type: 'button',
				style: S.headerBtn,
				title: t('previewTitle'),
				onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; },
				onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
				onClick: () => {
					try {
						if (window.__DSH_PREVIEW__) window.__DSH_PREVIEW__.toggle();
					} catch { /* 面板尚未就绪时忽略 */ }
				}
			}, '◧ ' + t('preview'));
		}

		/**
		* 官方「插件列表」卡片增强：卡片展开的详情区注入「启用/停用」按钮。
		* 通过 MutationObserver 跟随 React 渲染注入；状态以卡片右侧
		* [data-enabled] 标签为准（避免依赖 hashed class 名）。
		* @param t - 词典绑定。
		* @returns 清理函数。
		*/
		function mountPluginToggles(t) {
			if (typeof MutationObserver === 'undefined') return () => {};
			let timer = null;

			const sync = () => {
				timer = null;
				const cards = document.querySelectorAll('li[data-plugin-entry]');
				for (const card of cards) {
					const entryId = card.getAttribute('data-plugin-entry');
					if (!entryId) continue;
					// 详情区：以 [data-loader-entry] 代码块定位其父容器
					const code = card.querySelector('[data-loader-entry]');
					if (!code) continue;
					const details = code.parentElement;
					if (!details || details.querySelector('[data-dsh-toggle]')) continue;
					const tag = card.querySelector('[data-enabled]');
					const enabled = tag ? tag.getAttribute('data-enabled') === 'true' : true;

					const row = document.createElement('div');
					row.setAttribute('data-dsh-toggle-row', entryId);
					row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap';

					const btn = document.createElement('button');
					btn.type = 'button';
					btn.setAttribute('data-dsh-toggle', entryId);
					const paint = (label, disabled) => {
						btn.textContent = label;
						btn.disabled = !!disabled;
						btn.style.cssText = 'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;border-radius:999px;padding:3px 12px;cursor:pointer';
						if (disabled) btn.style.opacity = '.6';
						else btn.style.opacity = '1';
					};
					paint(enabled ? t('disable') : t('enable'), false);

					const status = document.createElement('span');
					status.style.cssText = 'color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px';

					btn.onclick = () => {
						if (btn.getAttribute('data-dsh-busy') === '1') return;
						btn.setAttribute('data-dsh-busy', '1');
						paint(t('toggling'), true);
						status.textContent = '';
						fetch('/api/plugin-market/toggle', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ entryId })
						})
							.then((r) => r.json())
							.then((data) => {
								btn.removeAttribute('data-dsh-busy');
								if (data.ok) {
									paint(data.enabled ? t('disable') : t('enable'), false);
									status.textContent = data.enabled ? t('toggleEnabled') : t('toggleDisabled');
									if (tag) {
										tag.textContent = data.enabled ? t('enabledTag') : t('disabledTag');
										tag.setAttribute('data-enabled', data.enabled ? 'true' : 'false');
									}
								} else {
									paint(enabled ? t('disable') : t('enable'), false);
									status.textContent = t('toggleErr') + (data.error || '');
								}
							})
							.catch((error) => {
								btn.removeAttribute('data-dsh-busy');
								paint(enabled ? t('disable') : t('enable'), false);
								status.textContent = t('toggleErr') + String(error);
							});
					};

					row.appendChild(btn);
					row.appendChild(status);
					details.appendChild(row);
				}
			};

			const observer = new MutationObserver(() => {
				if (timer !== null) return;
				timer = setTimeout(sync, 150);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			sync();
			return () => {
				observer.disconnect();
				if (timer !== null) clearTimeout(timer);
			};
		}

		/** 注册「插件市场」tab、右上角预览开关与插件启停增强。 */
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
			// 预览开关：与官方「Session log」并排（同槽位、更靠前）
			ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
				name: 'conversation.session.header.utilities',
				id: 'preview-toggle',
				order: -10,
				locale: NS
			}, PreviewHeaderButton));
			// 版本标记便于诊断缓存问题
			try { window.__DSH_PREVIEW_VERSION = '0.1.2'; } catch {}
			ctx.effect(() => mountPreview(t), 'plugin-market: preview panel');
			ctx.effect(() => mountPluginToggles(t), 'plugin-market: plugin toggle buttons');
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
