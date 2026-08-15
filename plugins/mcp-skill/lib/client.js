// dsh-mcp-skill — client half
// 左侧栏「技能与 MCP」入口 → 右侧抽屉面板：
//   MCP 服务器管理（CRUD / 启停 / Cursor 格式导入）+ Skills 管理（SKILL.md）
// UI 采用 DeepSeek 原生设计语言（--dsw-alias-*、圆角分层、hover 动效、线条图标）。
window.__ModuleLoader__.load({
	id: 'dsh-mcp-skill',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const ReactDOM = require('react-dom');
		const { useState, useEffect } = react;

		const NS = 'mcp-skill';
		const inject = ['slots', 'locale'];

		const zh = {
			title: '技能与 MCP',
			subtitle: '管理 MCP 服务器与 Skills（保存后重启生效）',
			secMcp: 'MCP 服务器',
			addServer: '添加服务器',
			name: '名称',
			type: '类型',
			command: '命令',
			args: '参数（逗号分隔）',
			env: '环境变量（KEY=VAL, 逗号分隔）',
			url: 'URL',
			enabled: '启用',
			save: '保存',
			delete: '删除',
			edit: '编辑',
			emptyServers: '还没有 MCP 服务器，添加一个或从 Cursor 导入。',
			savedNote: '已保存：写入 profile/cordis.patch.yml，重启服务后生效',
			secCursor: '导入 Cursor 配置',
			cursorDesc: '粘贴 .cursor/mcp.json 内容，或填写工作区内路径（如 .cursor/mcp.json）。',
			paste: '粘贴 mcp.json',
			path: '工作区路径',
			importBtn: '导入',
			importing: '导入中…',
			importOk: '导入 {n} 个服务器（跳过 {s} 个）',
			secSkill: 'Skills',
			newSkill: '新建技能',
			skillName: '技能名',
			skillDesc: '描述',
			skillContent: '内容（Markdown）',
			emptySkills: '还没有技能。技能放在 ~/.dsh/skills/<name>/SKILL.md。',
			err: '操作失败：',
			close: '关闭',
			serverNamePlaceholder: '例如：filesystem',
			cmdPlaceholder: '例如：npx'
		};
		const en = {
			title: 'Skills & MCP',
			subtitle: 'Manage MCP servers and Skills (restart to apply)',
			secMcp: 'MCP servers',
			addServer: 'Add server',
			name: 'Name',
			type: 'Type',
			command: 'Command',
			args: 'Args (comma-separated)',
			env: 'Env (KEY=VAL, comma-separated)',
			url: 'URL',
			enabled: 'Enabled',
			save: 'Save',
			delete: 'Delete',
			edit: 'Edit',
			emptyServers: 'No MCP servers yet. Add one or import from Cursor.',
			savedNote: 'Saved: written to profile/cordis.patch.yml, restart to apply',
			secCursor: 'Import Cursor config',
			cursorDesc: 'Paste .cursor/mcp.json content, or a workspace-relative path (e.g. .cursor/mcp.json).',
			paste: 'Paste mcp.json',
			path: 'Workspace path',
			importBtn: 'Import',
			importing: 'Importing…',
			importOk: 'Imported {n} servers (skipped {s})',
			secSkill: 'Skills',
			newSkill: 'New skill',
			skillName: 'Skill name',
			skillDesc: 'Description',
			skillContent: 'Content (Markdown)',
			emptySkills: 'No skills yet. Skills live in ~/.dsh/skills/<name>/SKILL.md.',
			err: 'Failed: ',
			close: 'Close',
			serverNamePlaceholder: 'e.g. filesystem',
			cmdPlaceholder: 'e.g. npx'
		};

		// 原版线条风格内联 SVG 图标
		const ICONS = {
			plugin: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2.8"/><path d="M2.5 6h11M2.5 10h11M6 2.5v11M10 2.5v11"/></svg>',
			server: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="2.8" width="11" height="4.4" rx="2"/><rect x="2.5" y="8.8" width="11" height="4.4" rx="2"/><path d="M5.2 5h.01M5.2 11h.01"/></svg>',
			skill: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.8h7a2 2 0 0 1 2 2v8.4"/><path d="M3 2.8a1.5 1.5 0 0 0-1.5 1.5v8.9A1.8 1.8 0 0 1 3.3 11.4H12"/><path d="M10.5 5.5h1.8"/></svg>',
			plus: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
			importArrow: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v8M4.5 7.5L8 11l3.5-3.5"/><path d="M3 13h10"/></svg>'
		};

		const S = {
			wrap: { display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' },
			btn: { height: 30, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s ease, border-color .12s ease', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 },
			btnPrimary: { height: 30, borderRadius: 10, border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary)', color: '#fff', padding: '0 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'filter .12s ease', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 },
			btnGhost: { height: 26, borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '0 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s ease' },
			disabled: { opacity: .55, cursor: 'not-allowed' },
			input: { height: 34, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%', transition: 'border-color .15s ease' },
			textarea: { borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', minHeight: 72, resize: 'vertical', boxSizing: 'border-box', width: '100%' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .18s ease' },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, margin: 0 },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, margin: 0 },
			row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 72 },
			dot: { width: 8, height: 8, borderRadius: '50%', flex: 'none', display: 'inline-block' },
			secTitle: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', display: 'flex', alignItems: 'center', gap: 8 },
			icon: { display: 'inline-flex', alignItems: 'center', flex: 'none', color: 'var(--dsw-alias-label-secondary)' }
		};

		const svgIcon = (html, size) => react.createElement('span', { style: Object.assign({}, S.icon, { width: size || 14, height: size || 14 }), dangerouslySetInnerHTML: { __html: html } });
		function Section({ icon, title, children, action }) {
			return react.createElement('div', { style: S.card }, [
				react.createElement('div', { key: 'h', style: S.row }, [
					react.createElement('p', { key: 't', style: S.secTitle }, [svgIcon(icon, 14), title]),
					react.createElement('div', { key: 'sp', style: { flex: 1 } }),
					action || null
				]),
				children
			]);
		}
		function Btn({ primary, ghost, children, onClick, disabled }) {
			const base = primary ? S.btnPrimary : ghost ? S.btnGhost : S.btn;
			return react.createElement('button', {
				type: 'button',
				style: Object.assign({}, base, disabled ? S.disabled : {}),
				disabled,
				onMouseEnter: (e) => { if (!disabled && !primary) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; if (!disabled && primary) e.currentTarget.style.filter = 'brightness(1.08)'; },
				onMouseLeave: (e) => { if (!disabled && !primary) e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1)'; if (!disabled && primary) e.currentTarget.style.filter = 'none'; },
				onClick
			}, children);
		}

		function McpSkillTab({ t }) {
			const [servers, setServers] = useState([]);
			const [skills, setSkills] = useState([]);
			const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', enabled: true });
			const [editingId, setEditingId] = useState(null);
			const [cursorJson, setCursorJson] = useState('');
			const [cursorPath, setCursorPath] = useState('');
			const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '' });
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const [msgOk, setMsgOk] = useState(false);

			const refresh = () => fetch('/api/mcp-skill/list').then((r) => r.json()).then((d) => { if (d.ok) { setServers(d.servers || []); setSkills(d.skills || []); } });
			useEffect(() => { refresh(); }, []);
			const toast = (text, ok) => { setMsg(text); setMsgOk(!!ok); setTimeout(() => { setMsg(null); setMsgOk(false); }, 5000); };
			const api = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

			const parseList = (str) => String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
			const parseEnv = (str) => { const out = {}; for (const kv of parseList(str)) { const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } return out; };

			const saveServer = () => {
				if (!form.name.trim()) { toast(t('err') + t('name'), false); return; }
				setBusy(true);
				api('/api/mcp-skill/server', {
					id: editingId || undefined,
					name: form.name,
					transport: form.transport,
					command: form.command,
					args: parseList(form.args),
					env: parseEnv(form.env),
					url: form.url,
					enabled: form.enabled
				}).then((d) => { if (!d.ok) { toast(t('err') + (d.error || ''), false); return; } toast(t('savedNote'), true); setEditingId(null); setForm({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', enabled: true }); refresh(); }).finally(() => setBusy(false));
			};
			const delServer = (s) => { if (!window.confirm('删除 MCP 服务器「' + s.name + '」？')) return; api('/api/mcp-skill/server/delete', { id: s.id }).then((d) => { if (d.ok) refresh(); }); };
			const toggleServer = (s) => api('/api/mcp-skill/server/toggle', { id: s.id }).then((d) => { if (d.ok) refresh(); });
			const editServer = (s) => { setEditingId(s.id); setForm({ name: s.name, transport: s.transport, command: s.command || '', args: (s.args || []).join(', '), env: Object.entries(s.env || {}).map(([k, v]) => k + '=' + v).join(', '), url: s.url || '', enabled: !!s.enabled }); };

			const importCursor = () => {
				if (!cursorJson.trim() && !cursorPath.trim()) { toast(t('err') + t('secCursor'), false); return; }
				setBusy(true);
				api('/api/mcp-skill/import-cursor', { json: cursorJson, path: cursorPath })
					.then((d) => { if (!d.ok) { toast(t('err') + (d.error || ''), false); return; } toast(t('importOk').replace('{n}', d.added).replace('{s}', d.skipped), true); setCursorJson(''); setCursorPath(''); refresh(); })
					.finally(() => setBusy(false));
			};

			const addSkill = () => {
				if (!skillForm.name.trim()) { toast(t('err') + t('skillName'), false); return; }
				setBusy(true);
				api('/api/mcp-skill/skill/add', { name: skillForm.name, displayName: skillForm.name, description: skillForm.description, content: skillForm.content })
					.then((d) => { if (!d.ok) { toast(t('err') + (d.error || ''), false); return; } toast(t('savedNote'), true); setSkillForm({ name: '', description: '', content: '' }); refresh(); })
					.finally(() => setBusy(false));
			};
			const delSkill = (s) => { if (!window.confirm('删除技能「' + s.displayName + '」？')) return; api('/api/mcp-skill/skill/delete', { name: s.name }).then((d) => { if (d.ok) refresh(); }); };
			const toggleSkill = (s) => api('/api/mcp-skill/skill/toggle', { name: s.name }).then((d) => { if (d.ok) refresh(); });

			const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
			const setSkill = (k) => (e) => setSkillForm((f) => ({ ...f, [k]: e.target.value }));

			const serverRows = servers.map((s) =>
				react.createElement('div', { key: s.id, style: Object.assign({}, S.card, { padding: '9px 12px', gap: 6 }) }, [
					react.createElement('div', { key: 'r1', style: S.row }, [
						react.createElement('span', { key: 'ic', style: S.icon }, svgIcon(ICONS.server, 13)),
						react.createElement('span', { key: 'n', style: { fontSize: 13, fontWeight: 600, flex: 1, overflowWrap: 'anywhere' } }, s.name),
						react.createElement('span', { key: 'ty', style: Object.assign({}, S.note, { background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 999, padding: '1px 8px' }) }, s.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
						react.createElement('button', { key: 'tg', type: 'button', style: Object.assign({}, S.btnGhost, { display: 'inline-flex', alignItems: 'center', gap: 6, color: s.enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }), onClick: () => toggleServer(s) }, [
							react.createElement('span', { key: 'd', style: Object.assign({}, S.dot, { background: s.enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }) }),
							t('enabled')
						]),
						react.createElement(Btn, { key: 'e', t, ghost: true, onClick: () => editServer(s) }, t('edit')),
						react.createElement(Btn, { key: 'd', t, ghost: true, onClick: () => delServer(s) }, t('delete'))
					]),
					react.createElement('p', { key: 'cmd', style: Object.assign({}, S.note, { overflowWrap: 'anywhere' }) }, s.transport === 'streamable-http' ? (s.url || '') : (s.command || '') + ' ' + (s.args || []).join(' ')),
					editingId === s.id ? react.createElement('p', { key: 'e', style: S.ok }, '✎ ' + t('savedNote')) : null
				])
			);

			return react.createElement('div', { style: S.wrap }, [
				msg ? react.createElement('p', { key: 'msg', style: msgOk ? S.ok : S.err }, msg) : null,

				// MCP 服务器
				react.createElement(Section, { key: 'm', icon: ICONS.server, title: t('secMcp'), action: react.createElement(Btn, { t, primary: true, onClick: () => { setEditingId(null); setForm({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', enabled: true }); } }, [svgIcon(ICONS.plus, 12), t('addServer')]) }, [
					servers.length === 0 ? react.createElement('p', { key: 'e', style: S.note }, t('emptyServers')) : serverRows,
					react.createElement('div', { key: 'form', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } }, [
						react.createElement('div', { key: 'r1', style: S.row }, [
							react.createElement('span', { key: 'l', style: S.label }, t('name')),
							react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('serverNamePlaceholder'), value: form.name, onChange: set('name') })
						]),
						react.createElement('div', { key: 'r2', style: S.row }, [
							react.createElement('span', { key: 'l', style: S.label }, t('type')),
							['stdio', 'streamable-http'].map((v) => react.createElement('button', { key: v, type: 'button', style: Object.assign({}, S.btnGhost, { borderColor: form.transport === v ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)', color: form.transport === v ? 'var(--dsw-alias-state-business-primary)' : undefined }), onClick: () => setForm((f) => ({ ...f, transport: v })) }, v === 'streamable-http' ? 'HTTP' : 'stdio')),
							react.createElement('label', { key: 'en', style: Object.assign({}, S.note, { display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }) }, [
								react.createElement('input', { key: 'c', type: 'checkbox', checked: form.enabled, onChange: (e) => setForm((f) => ({ ...f, enabled: e.target.checked })) }),
								t('enabled')
							])
						]),
						form.transport === 'streamable-http' ? react.createElement('div', { key: 'r3', style: S.row }, [
							react.createElement('span', { key: 'l', style: S.label }, t('url')),
							react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: 'https://mcp.example.com/sse', value: form.url, onChange: set('url') })
						]) : [
							react.createElement('div', { key: 'r3', style: S.row }, [
								react.createElement('span', { key: 'l', style: S.label }, t('command')),
								react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('cmdPlaceholder'), value: form.command, onChange: set('command') })
							]),
							react.createElement('div', { key: 'r4', style: S.row }, [
								react.createElement('span', { key: 'l', style: S.label }, t('args')),
								react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: '-y, @modelcontextprotocol/server-filesystem, /workspace', value: form.args, onChange: set('args') })
							]),
							react.createElement('div', { key: 'r5', style: S.row }, [
								react.createElement('span', { key: 'l', style: S.label }, t('env')),
								react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: 'KEY=VALUE, FOO=bar', value: form.env, onChange: set('env') })
							])
						],
						react.createElement('div', { key: 'f', style: S.row }, [
							react.createElement(Btn, { key: 's', t, primary: true, disabled: busy, onClick: saveServer }, t('save')),
							editingId ? react.createElement(Btn, { key: 'c', t, onClick: () => { setEditingId(null); setForm({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', enabled: true }); } }, '✕') : null
						])
					])
				]),

				// Cursor 导入
				react.createElement(Section, { key: 'c', icon: ICONS.importArrow, title: t('secCursor') }, [
					react.createElement('p', { key: 'd', style: S.note }, t('cursorDesc')),
					react.createElement('textarea', { key: 'j', style: Object.assign({}, S.textarea, { minHeight: 96 }), placeholder: '{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] } } }', value: cursorJson, onChange: (e) => setCursorJson(e.target.value) }),
					react.createElement('div', { key: 'r', style: S.row }, [
						react.createElement('span', { key: 'l', style: S.label }, t('path')),
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: '.cursor/mcp.json', value: cursorPath, onChange: (e) => setCursorPath(e.target.value) }),
						react.createElement(Btn, { key: 'b', t, primary: true, disabled: busy, onClick: importCursor }, busy ? t('importing') : [svgIcon(ICONS.importArrow, 12), t('importBtn')])
					])
				]),

				// Skills
				react.createElement(Section, { key: 's', icon: ICONS.skill, title: t('secSkill'), action: react.createElement(Btn, { t, primary: true, onClick: () => setSkillForm({ name: '', description: '', content: '' }) }, [svgIcon(ICONS.plus, 12), t('newSkill')]) }, [
					skills.length === 0 ? react.createElement('p', { key: 'e', style: S.note }, t('emptySkills')) : null,
					skills.map((sk) =>
						react.createElement('div', { key: sk.name, style: Object.assign({}, S.card, { padding: '9px 12px', gap: 6 }) }, [
							react.createElement('div', { key: 'r1', style: S.row }, [
								react.createElement('span', { key: 'ic', style: S.icon }, svgIcon(ICONS.skill, 13)),
								react.createElement('span', { key: 'n', style: { fontSize: 13, fontWeight: 600, flex: 1, overflowWrap: 'anywhere' } }, sk.displayName),
								react.createElement('button', { key: 'tg', type: 'button', style: Object.assign({}, S.btnGhost, { display: 'inline-flex', alignItems: 'center', gap: 6, color: sk.enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }), onClick: () => toggleSkill(sk) }, [
									react.createElement('span', { key: 'd', style: Object.assign({}, S.dot, { background: sk.enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' }) }),
									t('enabled')
								]),
								react.createElement(Btn, { key: 'd', t, ghost: true, onClick: () => delSkill(sk) }, t('delete'))
							]),
							sk.description ? react.createElement('p', { key: 'd', style: S.note }, sk.description) : null
						])
					),
					react.createElement('div', { key: 'form', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } }, [
						react.createElement('div', { key: 'r1', style: S.row }, [
							react.createElement('span', { key: 'l', style: S.label }, t('skillName')),
							react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: 'my-skill', value: skillForm.name, onChange: setSkill('name') })
						]),
						react.createElement('div', { key: 'r2', style: S.row }, [
							react.createElement('span', { key: 'l', style: S.label }, t('skillDesc')),
							react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('skillDesc'), value: skillForm.description, onChange: setSkill('description') })
						]),
						react.createElement('textarea', { key: 'c', style: S.textarea, placeholder: t('skillContent'), value: skillForm.content, onChange: setSkill('content') }),
						react.createElement('div', { key: 'f', style: S.row }, [
							react.createElement(Btn, { key: 'b', t, primary: true, disabled: busy, onClick: addSkill }, t('save'))
						])
					])
				])
			]);
		}

		// ── 侧栏入口 + 抽屉面板（与自动化插件同模式）────────────────────────
		function mountSidebar(ctx, t) {
			let panel = null;
			let reactRoot = null;
			let btn = null;
			let observer = null;
			let started = false;
			let injectTimer = null;

			const makeIcon = (html, size) => {
				const host = document.createElement('span');
				host.style.cssText = `display:inline-flex;align-items:center;flex:none;width:${size}px;height:${size}px;color:var(--dsw-alias-label-secondary);`;
				host.innerHTML = html;
				return host;
			};
			const closePanel = () => {
				if (!panel) return;
				panel.style.transform = 'translateX(100%)';
				panel.style.opacity = '0';
				setTimeout(() => {
					if (reactRoot && reactRoot.unmount) try { reactRoot.unmount(); } catch { /* ignore */ }
					if (panel) panel.remove();
					panel = null; reactRoot = null;
				}, 220);
			};
			const openPanel = () => {
				if (panel) return;
				panel = document.createElement('div');
				panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(620px,94vw);background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);z-index:9997;box-shadow:-20px 0 56px rgba(0,0,0,.25);transform:translateX(100%);opacity:0;transition:transform .24s cubic-bezier(.4,0,.2,1),opacity .2s ease;display:flex;flex-direction:column;';
				const head = document.createElement('div');
				head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);';
				const t1Row = document.createElement('div');
				t1Row.style.cssText = 'display:flex;align-items:center;gap:8px;';
				t1Row.appendChild(makeIcon(ICONS.plugin, 16));
				const t1 = document.createElement('span');
				t1.textContent = t('title');
				t1.style.cssText = 'font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);';
				t1Row.appendChild(t1);
				const t2 = document.createElement('span');
				t2.textContent = t('subtitle');
				t2.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary);';
				const titleCol = document.createElement('div');
				titleCol.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
				titleCol.append(t1Row, t2);
				const spacer = document.createElement('div');
				spacer.style.cssText = 'flex:1;';
				const closeBtn = document.createElement('button');
				closeBtn.textContent = '✕';
				closeBtn.title = t('close');
				closeBtn.style.cssText = 'height:28px;width:28px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;transition:background .12s ease,color .12s ease;';
				closeBtn.onmouseenter = () => { closeBtn.style.background = 'var(--dsw-alias-interactive-bg-hover)'; };
				closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
				closeBtn.onclick = closePanel;
				head.append(titleCol, spacer, closeBtn);
				const host = document.createElement('div');
				host.style.cssText = 'flex:1;overflow-y:auto;padding:16px 18px 28px;';
				panel.append(head, host);
				document.body.appendChild(panel);
				requestAnimationFrame(() => { panel.style.transform = 'translateX(0)'; panel.style.opacity = '1'; });
				const esc = (e) => { if (e.key === 'Escape') closePanel(); };
				document.addEventListener('keydown', esc);
				panel._escCleanup = () => document.removeEventListener('keydown', esc);
				try {
					if (ReactDOM.createRoot) { reactRoot = ReactDOM.createRoot(host); reactRoot.render(react.createElement(McpSkillTab, { t })); }
					else { ReactDOM.render(react.createElement(McpSkillTab, { t }), host); }
				} catch (e) { host.textContent = '渲染失败：' + String(e); }
			};

			// 注入侧栏按钮：放在「自动化」入口之后
			const injectBtn = () => {
				if (injectTimer) return;
				injectTimer = setTimeout(() => {
					injectTimer = null;
					const root = document.getElementById('root');
					if (!root) return;
					if (btn && !btn.isConnected) btn = null;
					const stale = root.querySelector('[data-dsh-ms-entry]');
					if (stale && stale !== btn) stale.remove();
					if (btn || root.querySelector('[data-dsh-ms-entry]')) return;
					const col = root.querySelector('[class*="_sidebarCol"]');
					if (!col) return;
					// 锚点：自动化入口（data-dsh-auto-entry）或「新会话」按钮
					const anchor = col.querySelector('[data-dsh-auto-entry]');
					const newBtn = anchor || [...col.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '新会话' || (b.textContent || '').trim() === 'New session');
					const parent = newBtn && newBtn.parentElement ? newBtn.parentElement : col;
					btn = document.createElement('button');
					btn.setAttribute('data-dsh-ms-entry', '1');
					btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:calc(100% - 4px);height:38px;padding:6px 10px;margin:0 2px 2px;border-radius:12px;border:none;background:transparent;color:var(--dsw-alias-label-primary,#f9fafb);font-size:14px;font-weight:400;cursor:pointer;font:inherit;transition:background .12s ease,color .12s ease;text-align:left;box-sizing:border-box;';
					btn.onmouseenter = () => { btn.style.background = 'var(--dsw-alias-interactive-bg-hover)'; };
					btn.onmouseleave = () => { btn.style.background = 'transparent'; };
					btn.onclick = openPanel;
					btn.appendChild(makeIcon(ICONS.plugin, 15));
					const textSpan = document.createElement('span');
					textSpan.textContent = t('title');
					btn.appendChild(textSpan);
					if (anchor) {
						// 插到自动化按钮后面
						if (anchor.nextSibling) parent.insertBefore(btn, anchor.nextSibling);
						else parent.appendChild(btn);
					} else if (newBtn && newBtn.nextSibling) parent.insertBefore(btn, newBtn.nextSibling);
					else parent.appendChild(btn);
				}, 80);
			};

			const doMount = () => {
				const root = document.getElementById('root');
				if (!root) { setTimeout(doMount, 300); return; }
				if (started) return;
				started = true;
				observer = new MutationObserver(injectBtn);
				observer.observe(root, { childList: true, subtree: true });
				injectBtn();
			};
			doMount();

			return () => {
				if (observer) observer.disconnect();
				if (btn) btn.remove();
				if (panel) { panel._escCleanup && panel._escCleanup(); panel.remove(); }
			};
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcp-skill: dictionaries');
			const t = ctx.locale.bind(NS);
			let cleanup = () => {};
			const boot = () => { cleanup = mountSidebar(ctx, t); };
			if (document.body) boot();
			else document.addEventListener('DOMContentLoaded', boot, { once: true });
			return () => { cleanup(); document.removeEventListener('DOMContentLoaded', boot); };
		}

		module.exports = { NS, apply, inject };
		return module.exports;
	}
});
