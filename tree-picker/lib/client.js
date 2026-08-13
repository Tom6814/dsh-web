// dsh-tree-picker — client half
// 单列树形工作区目录选择器：注册到官方 directoryFlow 插槽（conversation.hero /
// sidebar.workspaces），替换双栏浏览界面。同一列点击展开/折叠，懒加载子目录。
window.__ModuleLoader__.load({
	id: 'dsh-tree-picker',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require('react');
		let { useState, useEffect, useCallback, useRef } = react;

		const NS = 'treePicker';
		const inject = ['slots', 'workspaces', 'locale'];

		const zh = {
			'title': '选择工作区目录',
			'loading': '加载中…',
			'loadFailed': '无法读取目录',
			'home': '主目录',
			'root': '根目录',
			'select': '选择',
			'cancel': '取消',
			'path': '当前目录',
			'newFolder': '新建文件夹',
			'folderName': '文件夹名称',
			'create': '创建',
			'untitled': '未命名文件夹',
			'createIn': '在“{name}”中新建文件夹',
			'createError': '创建失败：',
			'showHidden': '显示隐藏文件夹',
			'currentPath': '当前目录：{path}'
		};
		const en = {
			'title': 'Select Workspace Directory',
			'loading': 'Loading…',
			'loadFailed': 'Cannot read directory',
			'home': 'Home',
			'root': 'Root',
			'select': 'Select',
			'cancel': 'Cancel',
			'path': 'Current directory',
			'newFolder': 'New folder',
			'folderName': 'Folder name',
			'create': 'Create',
			'untitled': 'Untitled folder',
			'createIn': 'New folder in “{name}”',
			'createError': 'Create failed: ',
			'showHidden': 'Show hidden folders',
			'currentPath': 'Current: {path}'
		};

		const S = {
			wrap: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 },
			header: { display: 'flex', gap: 8, alignItems: 'center' },
			homeBtn: { flex: 'none', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer', font: 'inherit' },
			tree: { listStyle: 'none', margin: 0, padding: '6px 0', maxHeight: 300, overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)' },
			row: { display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px', fontSize: 13, minWidth: 0 },
			rowHover: { background: 'var(--dsw-alias-interactive-bg-hover)' },
			caret: { width: 16, flex: 'none', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', textAlign: 'center', userSelect: 'none' },
			name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)' },
			pick: { flex: 'none', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', borderRadius: 6, padding: '1px 10px', fontSize: 12, cursor: 'pointer', font: 'inherit', opacity: 0.85 },
			status: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, padding: '4px 12px', margin: 0 },
			fail: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, padding: '4px 12px', margin: 0 },
			pathLine: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
			newRow: { display: 'flex', gap: 6, alignItems: 'center' },
			input: { flex: 1, minWidth: 0, height: 30, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 8px', fontSize: 13, font: 'inherit' },
			btn: { height: 30, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', padding: '0 12px', fontSize: 13, cursor: 'pointer', font: 'inherit' },
			primary: { background: 'var(--dsw-alias-state-business-primary)', borderColor: 'transparent', color: '#fff' },
			foot: { display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' },
			check: { accentColor: 'var(--dsw-alias-state-business-primary)', marginRight: 4 },
			label: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '18px', margin: 0 }
		};

		/** 单列树形目录选择器（directoryFlow 插槽占用者）。 */
		function TreeDirectoryFlow(props) {
			// 官方 BrowseDirectoryFlow 同款开关：open 为假（选择器未打开）时不渲染，
			// 否则树形会常驻在 hero / sidebar 两个插槽位置（即"散布到网页各处"）。
			return props.open ? react.createElement(TreeDialog, props) : null;
		}

		/** 树形对话框主体（所有 hooks 都留在这里，wrapper 上方直接 return）。 */
		function TreeDialog(props) {
			const { listDirectory, createDirectory, t, onPicked, onCancel } = props;
			const [home, setHome] = useState(null);
			const [expanded, setExpanded] = useState(() => new Set());
			const [children, setChildren] = useState(() => new Map());
			const [loading, setLoading] = useState(() => new Set());
			const [failed, setFailed] = useState(() => new Set());
			const [active, setActive] = useState(null);
			const [showHidden, setShowHidden] = useState(false);
			const [draft, setDraft] = useState(null);
			const [creating, setCreating] = useState(false);
			const [createError, setCreateError] = useState(null);
			const [hovered, setHovered] = useState(null);
			const seqRef = useRef(0);

			// 初始加载主目录
			useEffect(() => {
				let cancelled = false;
				const seq = ++seqRef.current;
				listDirectory(undefined, undefined).then((result) => {
					if (cancelled || seq !== seqRef.current) return;
					setHome(result.path);
					setActive(result.path);
					setChildren((map) => new Map(map).set(result.path, result.entries));
				}).catch(() => {
					if (!cancelled) setFailed((set) => new Set(set).add('__root__'));
				});
				return () => { cancelled = true; };
			}, [listDirectory]);

			/** 展开/折叠一个目录；首次展开时懒加载子目录。 */
			const toggle = useCallback((path) => {
				setActive(path);
				setCreateError(null);
				setExpanded((prev) => {
					const next = new Set(prev);
					if (next.has(path)) {
						next.delete(path);
						return next;
					}
					next.add(path);
					return next;
				});
				if (children.has(path) || failed.has(path)) return;
				setLoading((set) => new Set(set).add(path));
				listDirectory(path, undefined).then((result) => {
					setChildren((map) => new Map(map).set(path, result.entries));
					setFailed((set) => { const n = new Set(set); n.delete(path); return n; });
				}).catch(() => {
					setFailed((set) => new Set(set).add(path));
				}).finally(() => {
					setLoading((set) => { const n = new Set(set); n.delete(path); return n; });
				});
			}, [children, failed, listDirectory]);

			/** 回到主目录。 */
			const goHome = useCallback(() => {
				if (home === null) return;
				setActive(home);
				setCreateError(null);
			}, [home]);

			/** 在当前聚焦目录下新建文件夹。 */
			const confirmCreate = useCallback(() => {
				if (active === null || draft === null || draft.trim() === '' || creating) return;
				setCreating(true);
				setCreateError(null);
				createDirectory(active, draft.trim()).then(() => {
					setDraft(null);
					setCreating(false);
					return listDirectory(active, undefined).then((result) => {
						setChildren((map) => new Map(map).set(active, result.entries));
					});
				}).catch((error) => {
					setCreating(false);
					setCreateError(String(error?.message ?? error));
				});
			}, [active, draft, creating, createDirectory, listDirectory]);

			// 平铺树行（DFS）
			const rows = [];
			const walk = (path, depth) => {
				const entries = children.get(path);
				if (!entries) return;
				for (const entry of entries) {
					if (!showHidden && entry.hidden) continue;
					const key = entry.path;
					const isOpen = expanded.has(key);
					rows.push({ key, entry, depth, isOpen });
					if (isOpen) walk(key, depth + 1);
				}
			};
			if (home !== null) walk(home, 0);

			const loadingRoot = loading.has('__root__') || (home === null && !failed.has('__root__'));

			return react.createElement('div', { style: S.wrap }, [
				// 头部：标题 + 主目录快捷入口
				react.createElement('div', { key: 'header', style: S.header }, [
					react.createElement('button', { key: 'home', style: S.homeBtn, onClick: goHome, disabled: home === null }, t('home')),
					react.createElement('span', { key: 'path', style: S.pathLine, title: active ?? '' }, t('currentPath', { path: active ?? '…' }))
				]),

				// 树
				loadingRoot
					? react.createElement('p', { key: 'loading', style: S.status }, t('loading'))
					: react.createElement('div', { key: 'tree', style: S.tree }, rows.length === 0
						? react.createElement('p', { key: 'empty', style: S.status }, t('loading'))
						: rows.map(({ key, entry, depth, isOpen }) => react.createElement('div', {
							key,
							style: { ...S.row, paddingLeft: 8 + depth * 18, ...(hovered === key ? S.rowHover : {}) },
							onMouseEnter: () => setHovered(key),
							onMouseLeave: () => setHovered(null)
						}, [
							react.createElement('span', { key: 'caret', style: S.caret, onClick: () => toggle(entry.path) }, isOpen ? '▾' : '▸'),
							react.createElement('span', { key: 'name', style: S.name, title: entry.path, onClick: () => toggle(entry.path) }, entry.name),
							react.createElement('button', { key: 'pick', style: S.pick, onClick: () => onPicked(entry.path) }, t('select'))
						]))),

				// 子目录加载/失败状态（附加到树下方）
				...rows.filter((r) => r.isOpen).map((r) => loading.has(r.entry.path)
					? react.createElement('p', { key: `st-${r.key}`, style: { ...S.status, paddingLeft: 12 + (r.depth + 1) * 18 } }, t('loading'))
					: null),
				...rows.filter((r) => r.isOpen && failed.has(r.entry.path)).map((r) => (
					react.createElement('p', { key: `err-${r.key}`, style: { ...S.fail, paddingLeft: 12 + (r.depth + 1) * 18 } }, t('loadFailed'))
				)),
				(home !== null && failed.has('__root__')) ? react.createElement('p', { key: 'root-fail', style: S.fail }, t('loadFailed')) : null,

				// 新建文件夹（当前聚焦目录下）
				react.createElement('div', { key: 'create', style: S.newRow }, [
					react.createElement('input', {
						key: 'input',
						style: S.input,
						placeholder: active === null ? t('untitled') : t('createIn', { name: active }),
						value: draft ?? '',
						disabled: active === null || creating,
						onChange: (e) => setDraft(e.target.value),
						onKeyDown: (e) => { if (e.key === 'Enter') confirmCreate(); }
					}),
					react.createElement('button', { key: 'btn', style: { ...S.btn, ...S.primary }, disabled: active === null || creating || !draft || draft.trim() === '', onClick: confirmCreate }, t('create'))
				]),
				createError !== null ? react.createElement('p', { key: 'cerr', style: S.err }, t('createError') + createError) : null,

				// 显示隐藏文件夹开关
				react.createElement('label', { key: 'hidden', style: S.label }, [
					react.createElement('input', { key: 'c', type: 'checkbox', style: S.check, checked: showHidden, onChange: (e) => setShowHidden(e.target.checked) }),
					t('showHidden')
				]),

				// 底部：取消
				react.createElement('div', { key: 'foot', style: S.foot }, [
					react.createElement('button', { key: 'cancel', style: S.btn, onClick: onCancel }, t('cancel'))
				])
			]);
		}

		/** 注册到两个 directoryFlow 插槽（官方同款方式）。 */
		function apply(ctx) {
			ctx.effect(() => {
				const disposers = [];
				for (const [locale, dict] of [['zh', zh], ['en', en]]) disposers.push(ctx.locale.register(NS, locale, dict));
				return () => { for (const dispose of disposers) dispose(); };
			}, 'tree-picker: dictionaries');
			const injected = () => ({
				listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
				createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
				t: ctx.locale.bind(NS)
			});
			ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
				yield ctx.slots.register({
					name: 'conversation.hero.workspace.directoryFlow',
					inject: injected
				}, TreeDirectoryFlow);
				yield ctx.slots.register({
					name: 'sidebar.workspaces.directoryFlow',
					inject: injected
				}, TreeDirectoryFlow);
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
