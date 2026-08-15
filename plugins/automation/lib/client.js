// dsh-automation — client half
// 主页侧栏「⏰ 自动化」入口（类 TRAE 的任务栏）：点击打开右侧抽屉面板，
// 管理定时任务（CRUD + AI 优化 + 立即运行 + 运行历史）。UI 使用 DeepSeek
// 原生设计语言（--dsw-alias-* 变量、圆角分层、hover 动效、滑入动画）。
window.__ModuleLoader__.load({
	id: 'dsh-automation',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const ReactDOM = require('react-dom');
		const { useState, useEffect, useCallback } = react;

		const NS = 'automation';
		const inject = ['slots', 'locale'];

		const zh = {
			title: '自动化',
			subtitle: '定时让 AI 执行任务（对齐 Trae Work）',
			listTitle: '定时任务',
			empty: '还没有任务，创建一个吧：定时让 AI 干活。',
			newTask: '新建任务',
			name: '任务名称',
			namePlaceholder: '例如：每日代码审查',
			prompt: '任务描述',
			promptPlaceholder: '描述要让 AI 执行的任务，例如：审查工作区代码改动并输出报告。',
			aiOptimize: '✨ AI 优化',
			optimizing: 'AI 优化中…',
			schedule: '调度',
			interval: '间隔（分钟）',
			daily: '每天',
			weekly: '每周',
			dow: '周几',
			dow0: '周日', dow1: '周一', dow2: '周二', dow3: '周三', dow4: '周四', dow5: '周五', dow6: '周六',
			hour: '时', minute: '分',
			enabled: '启用',
			save: '保存',
			cancel: '取消',
			delete: '删除',
			runNow: '立即运行',
			running: '运行中…',
			lastRun: '上次运行',
			never: '从未',
			ok: '成功', fail: '失败',
			history: '最近运行',
			nextRun: '下次运行',
			err: '操作失败：',
			done: '已保存',
			close: '关闭'
		};
		const en = {
			title: 'Automation',
			subtitle: 'Scheduled AI tasks (like Trae Work)',
			listTitle: 'Scheduled tasks',
			empty: 'No tasks yet. Create one to have AI work on a schedule.',
			newTask: 'New task',
			name: 'Name',
			namePlaceholder: 'e.g. Daily code review',
			prompt: 'Task prompt',
			promptPlaceholder: 'What should the AI do, e.g. review workspace changes and write a report.',
			aiOptimize: '✨ AI optimize',
			optimizing: 'Optimizing…',
			schedule: 'Schedule',
			interval: 'Interval (minutes)',
			daily: 'Daily',
			weekly: 'Weekly',
			dow: 'Weekday',
			dow0: 'Sun', dow1: 'Mon', dow2: 'Tue', dow3: 'Wed', dow4: 'Thu', dow5: 'Fri', dow6: 'Sat',
			hour: 'h', minute: 'm',
			enabled: 'Enabled',
			save: 'Save',
			cancel: 'Cancel',
			delete: 'Delete',
			runNow: 'Run now',
			running: 'Running…',
			lastRun: 'Last run',
			never: 'never',
			ok: 'OK', fail: 'failed',
			history: 'Recent runs',
			nextRun: 'Next run',
			err: 'Failed: ',
			done: 'Saved',
			close: 'Close'
		};

		// DeepSeek 原生设计语言 tokens
		const S = {
			wrap: { display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' },
			btn: { height: 30, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 13, cursor: 'pointer', font: 'inherit', transition: 'background .12s ease, border-color .12s ease', whiteSpace: 'nowrap' },
			btnPrimary: { height: 30, borderRadius: 8, border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary)', color: '#fff', padding: '0 16px', fontSize: 13, cursor: 'pointer', font: 'inherit', transition: 'filter .12s ease', whiteSpace: 'nowrap' },
			btnGhost: { height: 26, borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '0 12px', fontSize: 12, cursor: 'pointer', font: 'inherit', transition: 'all .12s ease' },
			disabled: { opacity: .55, cursor: 'not-allowed' },
			input: { height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, font: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s ease' },
			textarea: { borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '8px 10px', fontSize: 13, font: 'inherit', outline: 'none', minHeight: 76, resize: 'vertical', boxSizing: 'border-box' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .18s ease' },
			note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: 0 },
			ok: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, margin: 0 },
			err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, margin: 0 },
			row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 60 }
		};

		function scheduleText(t, sc) {
			if (sc.type === 'interval') return t('interval') + '：' + (sc.minutes || 60);
			const pad = (n) => String(n).padStart(2, '0');
			if (sc.type === 'daily') return t('daily') + ' ' + pad(sc.hour || 9) + ':' + pad(sc.minute || 0);
			return t('weekly') + ' · ' + t('dow' + (Number(sc.dow) || 1)) + ' ' + pad(sc.hour || 9) + ':' + pad(sc.minute || 0);
		}
		function fmtTime(ts) {
			if (!ts) return '—';
			const d = new Date(ts);
			return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
		}

		function AutomationTab({ t }) {
			const [tasks, setTasks] = useState([]);
			const [runs, setRuns] = useState([]);
			const [editing, setEditing] = useState(null);
			const [form, setForm] = useState({ name: '', prompt: '', type: 'interval', minutes: 60, hour: 9, minute: 0, dow: 1, enabled: true });
			const [busy, setBusy] = useState(false);
			const [optimizing, setOptimizing] = useState(false);
			const [runningId, setRunningId] = useState(null);
			const [msg, setMsg] = useState(null);

			const refresh = useCallback(() => {
				fetch('/api/automation/list').then((r) => r.json()).then((d) => { if (d.ok) { setTasks(d.tasks); setRuns(d.runs); } });
			}, []);
			useEffect(() => { refresh(); }, [refresh]);
			useEffect(() => {
				const timer = setInterval(() => { if (runningId) refresh(); }, 5000);
				return () => clearInterval(timer);
			}, [runningId, refresh]);

			const toast = (text) => { setMsg(text); setTimeout(() => setMsg(null), 3500); };
			const api = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

			const submit = () => {
				if (!form.prompt.trim()) { toast(t('err') + t('prompt')); return; }
				setBusy(true);
				const payload = {
					name: form.name, prompt: form.prompt, enabled: form.enabled,
					schedule: { type: form.type, minutes: Number(form.minutes) || 60, hour: Number(form.hour) || 9, minute: Number(form.minute) || 0, dow: Number(form.dow) || 1 }
				};
				const url = editing === 'new' ? '/api/automation/create' : '/api/automation/update';
				const body = editing === 'new' ? payload : Object.assign({ id: editing }, payload);
				api(url, body).then((d) => { if (!d.ok) { toast(t('err') + (d.error || '')); return; } toast(t('done')); setEditing(null); refresh(); }).finally(() => setBusy(false));
			};
			const del = (task) => { if (!window.confirm('删除任务「' + task.name + '」？')) return; api('/api/automation/delete', { id: task.id }).then((d) => { if (d.ok) refresh(); }); };
			const runNow = (task) => {
				setRunningId(task.id);
				api('/api/automation/run', { id: task.id }).then((d) => { if (!d.ok) toast(t('err') + (d.error || '')); setTimeout(() => { setRunningId(null); refresh(); }, 8000); });
			};
			const toggle = (task) => api('/api/automation/update', { id: task.id, enabled: !task.enabled }).then((d) => { if (d.ok) refresh(); });
			const optimize = () => {
				if (!form.prompt.trim()) return;
				setOptimizing(true);
				api('/api/automation/optimize', { prompt: form.prompt }).then((d) => { if (d.ok && d.prompt) setForm((f) => ({ ...f, prompt: d.prompt })); else toast(t('err') + (d.error || '优化失败')); }).finally(() => setOptimizing(false));
			};
			const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
			const mkBtn = (label, onClick, style, disabled, hoverBg) => react.createElement('button', {
				type: 'button', style: Object.assign({}, style || S.btn, disabled ? S.disabled : {}), disabled,
				onMouseEnter: (e) => { if (!disabled) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; },
				onMouseLeave: (e) => { if (!disabled) e.currentTarget.style.background = (style || S.btn).background || 'var(--dsw-alias-bg-layer-1)'; },
				onClick
			}, label);

			const formEl = react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 12 } }, [
				react.createElement('div', { key: 'n', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('name')),
					react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('namePlaceholder'), value: form.name, onChange: set('name') })
				]),
				react.createElement('div', { key: 'p', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('prompt')),
					react.createElement('textarea', { key: 'i', style: Object.assign({}, S.textarea, { flex: 1 }), placeholder: t('promptPlaceholder'), value: form.prompt, onChange: set('prompt') }),
					react.createElement('button', { key: 'b', type: 'button', style: Object.assign({}, S.btn, optimizing ? S.disabled : {}), disabled: optimizing, onMouseEnter: (e) => { if (!optimizing) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; }, onMouseLeave: (e) => { e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1)'; }, onClick: optimize }, optimizing ? t('optimizing') : t('aiOptimize'))
				]),
				react.createElement('div', { key: 's', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('schedule')),
					['interval', 'daily', 'weekly'].map((v) =>
						react.createElement('button', {
							key: v, type: 'button',
							style: Object.assign({}, S.btnGhost, { borderColor: form.type === v ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)', color: form.type === v ? 'var(--dsw-alias-state-business-primary)' : undefined }),
							onClick: () => setForm((f) => ({ ...f, type: v }))
						}, t(v === 'interval' ? 'interval' : v === 'daily' ? 'daily' : 'weekly'))
					),
					form.type === 'interval' ? [
						react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { width: 90 }), type: 'number', min: 1, value: form.minutes, onChange: set('minutes') }),
						react.createElement('span', { key: 'u', style: S.note }, t('interval'))
					] : null,
					form.type === 'daily' || form.type === 'weekly' ? [
						form.type === 'weekly' ? react.createElement('select', { key: 'd', style: S.input, value: form.dow, onChange: set('dow') }, [0, 1, 2, 3, 4, 5, 6].map((d) => react.createElement('option', { key: d, value: d }, t('dow' + d)))) : null,
						react.createElement('input', { key: 'h', style: Object.assign({}, S.input, { width: 70 }), type: 'number', min: 0, max: 23, value: form.hour, onChange: set('hour') }),
						react.createElement('span', { key: 'hu', style: S.note }, t('hour')),
						react.createElement('input', { key: 'm', style: Object.assign({}, S.input, { width: 70 }), type: 'number', min: 0, max: 59, value: form.minute, onChange: set('minute') }),
						react.createElement('span', { key: 'mu', style: S.note }, t('minute'))
					] : null
				]),
				react.createElement('div', { key: 'f', style: S.row }, [
					react.createElement('label', { key: 'e', style: Object.assign({}, S.note, { display: 'flex', gap: 6, alignItems: 'center' }) }, [
						react.createElement('input', { key: 'c', type: 'checkbox', checked: form.enabled, onChange: (e) => setForm((f) => ({ ...f, enabled: e.target.checked })) }),
						t('enabled')
					]),
					react.createElement('div', { key: 'sp', style: { flex: 1 } }),
					mkBtn(t('save'), submit, S.btnPrimary, busy),
					mkBtn(t('cancel'), () => setEditing(null), S.btn, false)
				])
			]);

			const listEl = react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, [
				react.createElement('div', { key: 'head', style: S.row }, [
					react.createElement('p', { key: 't', style: Object.assign({}, S.note, { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, t('listTitle')),
					react.createElement('div', { key: 'sp', style: { flex: 1 } }),
					mkBtn('＋ ' + t('newTask'), () => setEditing('new'), S.btnPrimary)
				]),
				tasks.length === 0 ? react.createElement('p', { key: 'e', style: S.note }, t('empty')) : null,
				tasks.map((task) =>
					react.createElement('div', { key: task.id, style: S.card }, [
						react.createElement('div', { key: 'r1', style: S.row }, [
							react.createElement('p', { key: 'n', style: { margin: 0, fontSize: 14, fontWeight: 600, flex: 1, overflowWrap: 'anywhere' } }, task.name),
							mkBtn(task.enabled ? '🟢 ' + t('enabled') : '⚪ ' + t('enabled'), () => toggle(task), Object.assign({}, S.btnGhost)),
							mkBtn(runningId === task.id ? t('running') : '▶ ' + t('runNow'), () => runNow(task), Object.assign({}, S.btnGhost), runningId === task.id),
							mkBtn('✎', () => { setEditing(task.id); setForm({ name: task.name, prompt: task.prompt, type: task.schedule?.type || 'interval', minutes: task.schedule?.minutes || 60, hour: task.schedule?.hour || 9, minute: task.schedule?.minute || 0, dow: task.schedule?.dow || 1, enabled: !!task.enabled }); }, Object.assign({}, S.btnGhost)),
							mkBtn(t('delete'), () => del(task), Object.assign({}, S.btnGhost, { color: 'var(--dsw-alias-state-error-primary)' }))
						]),
						react.createElement('p', { key: 'p', style: Object.assign({}, S.note, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }) }, task.prompt),
						react.createElement('div', { key: 'r2', style: S.row }, [
							react.createElement('span', { key: 'sc', style: S.note }, '🕐 ' + scheduleText(t, task.schedule)),
							react.createElement('span', { key: 'nx', style: S.note }, t('nextRun') + '：' + fmtTime(task.nextRunAt)),
							react.createElement('div', { key: 'sp', style: { flex: 1 } }),
							react.createElement('span', { key: 'lr', style: task.lastRunOk == null ? S.note : (task.lastRunOk ? S.ok : S.err) }, t('lastRun') + '：' + fmtTime(task.lastRunAt) + (task.lastRunOk == null ? '（' + t('never') + '）' : ' · ' + (task.lastRunOk ? t('ok') : t('fail'))))
						])
					])
				)
			]);

			const historyEl = react.createElement('div', { key: 'h', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
				react.createElement('p', { key: 't', style: Object.assign({}, S.note, { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, t('history')),
				runs.length === 0 ? react.createElement('p', { key: 'e', style: S.note }, t('never')) : null,
				runs.slice(0, 8).map((r) =>
					react.createElement('div', { key: r.id, style: Object.assign({}, S.card, { padding: '8px 12px', gap: 4 }) }, [
						react.createElement('div', { key: 'r', style: S.row }, [
							react.createElement('span', { key: 'n', style: Object.assign({}, S.note, { fontWeight: 600 }) }, r.taskName),
							react.createElement('span', { key: 't', style: S.note }, fmtTime(r.finishedAt)),
							react.createElement('div', { key: 'sp', style: { flex: 1 } }),
							react.createElement('span', { key: 's', style: r.ok ? S.ok : S.err }, r.ok ? t('ok') : t('fail'))
						]),
						r.output ? react.createElement('pre', { key: 'o', style: { fontSize: 11, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 6, padding: '6px 8px', margin: 0, maxHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, r.output.slice(0, 400)) : null
					])
				)
			]);

			return react.createElement('div', { style: S.wrap }, [
				msg ? react.createElement('p', { key: 'msg', style: S.note }, msg) : null,
				editing === null ? [listEl, historyEl] : formEl
			]);
		}

		// ── 侧边栏入口 + 抽屉面板（DOM 注入 sidebarCol；面板用 ReactDOM 渲染）──
		function mountSidebar(ctx, t) {
			const root = document.getElementById('root');
			if (!root) return () => {};
			let panel = null;
			let reactRoot = null;
			let btn = null;
			let observer = null;

			const closePanel = () => {
				if (!panel) return;
				panel.style.transform = 'translateX(100%)';
				panel.style.opacity = '0';
				setTimeout(() => {
					if (reactRoot && reactRoot.unmount) try { reactRoot.unmount(); } catch { /* ignore */ }
					else if (reactRoot && reactRoot.render === ReactDOM.render && ReactDOM.unmountComponentAtNode) { try { ReactDOM.unmountComponentAtNode(reactRoot.host); } catch { /* ignore */ } }
					if (panel) panel.remove();
					panel = null; reactRoot = null;
				}, 220);
			};
			const openPanel = () => {
				if (panel) return;
				panel = document.createElement('div');
				panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(600px,94vw);background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);z-index:9998;box-shadow:-20px 0 56px rgba(0,0,0,.25);transform:translateX(100%);opacity:0;transition:transform .24s cubic-bezier(.4,0,.2,1),opacity .2s ease;display:flex;flex-direction:column;';
				const head = document.createElement('div');
				head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);';
				const title = document.createElement('div');
				title.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
				const t1 = document.createElement('span');
				t1.textContent = '⏰ ' + t('title');
				t1.style.cssText = 'font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);';
				const t2 = document.createElement('span');
				t2.textContent = t('subtitle');
				t2.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary);';
				title.append(t1, t2);
				const spacer = document.createElement('div');
				spacer.style.cssText = 'flex:1;';
				const closeBtn = document.createElement('button');
				closeBtn.textContent = '✕';
				closeBtn.title = t('close');
				closeBtn.style.cssText = 'height:28px;width:28px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;transition:background .12s ease,color .12s ease;';
				closeBtn.onmouseenter = () => { closeBtn.style.background = 'var(--dsw-alias-interactive-bg-hover)'; };
				closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
				closeBtn.onclick = closePanel;
				head.append(title, spacer, closeBtn);
				const host = document.createElement('div');
				host.style.cssText = 'flex:1;overflow-y:auto;padding:16px 18px 28px;';
				panel.append(head, host);
				document.body.appendChild(panel);
				// 动画
				requestAnimationFrame(() => { panel.style.transform = 'translateX(0)'; panel.style.opacity = '1'; });
				// Esc 关闭
				const esc = (e) => { if (e.key === 'Escape') closePanel(); };
				document.addEventListener('keydown', esc);
				// React 渲染
				try {
					if (ReactDOM.createRoot) {
						reactRoot = ReactDOM.createRoot(host);
						reactRoot.render(react.createElement(AutomationTab, { t }));
					} else {
						reactRoot = { render: ReactDOM.render, host };
						ReactDOM.render(react.createElement(AutomationTab, { t }), host);
					}
				} catch (e) {
					host.textContent = '渲染失败：' + String(e);
				}
				const onPanelEsc = () => document.removeEventListener('keydown', esc);
				panel._escCleanup = onPanelEsc;
			};

			// 注入侧栏按钮（sidebarCol 出现后挂到其底部）
			const injectBtn = () => {
				const col = root.querySelector('[class*="_sidebarCol"]');
				if (!col || btn || col.querySelector('[data-dsh-auto-entry]')) return;
				btn = document.createElement('button');
				btn.setAttribute('data-dsh-auto-entry', '1');
				btn.textContent = '⏰ ' + t('title');
				btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:calc(100% - 12px);margin:6px;padding:8px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;font:inherit;transition:background .12s ease,color .12s ease;text-align:left;box-sizing:border-box;';
				btn.onmouseenter = () => { btn.style.background = 'var(--dsw-alias-interactive-bg-hover)'; };
				btn.onmouseleave = () => { btn.style.background = 'transparent'; };
				btn.onclick = openPanel;
				col.appendChild(btn);
			};
			observer = new MutationObserver(injectBtn);
			observer.observe(root, { childList: true, subtree: true });
			injectBtn();

			return () => {
				if (observer) observer.disconnect();
				if (btn) btn.remove();
				if (panel) { panel._escCleanup && panel._escCleanup(); panel.remove(); }
			};
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'automation: dictionaries');
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
