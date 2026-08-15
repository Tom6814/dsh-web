// dsh-automation — client half
// 「设置 → 插件」里新增「自动化」tab：任务 CRUD + AI 辅助优化 + 运行历史。
window.__ModuleLoader__.load({
	id: 'dsh-automation',
	factory: (require) => {
		var module = { exports: {} };
		const react = require('react');
		const { useState, useEffect, useCallback } = react;

		const NS = 'automation';
		const inject = ['slots', 'locale'];

		const zh = {
			tab: '自动化',
			listTitle: '定时任务',
			empty: '还没有任务，创建一个吧：定时让 AI 干活（对齐 Trae Work 的自动化）。',
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
			done: '已保存'
		};
		const en = {
			tab: 'Automation',
			listTitle: 'Scheduled tasks',
			empty: 'No tasks yet. Create one to have AI work on a schedule (like Trae Work).',
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
			done: 'Saved'
		};

		const S = {
			section: { width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--dsw-alias-label-primary)' },
			button: { height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', fontSize: 13, cursor: 'pointer', font: 'inherit' },
			buttonDisabled: { opacity: .6, cursor: 'not-allowed' },
			input: { height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, font: 'inherit', outline: 'none', boxSizing: 'border-box' },
			textarea: { borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '8px 10px', fontSize: 13, font: 'inherit', outline: 'none', minHeight: 72, resize: 'vertical', boxSizing: 'border-box' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
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
				fetch('/api/automation/list')
					.then((r) => r.json())
					.then((d) => { if (d.ok) { setTasks(d.tasks); setRuns(d.runs); } });
			}, []);
			useEffect(() => { refresh(); }, [refresh]);
			useEffect(() => {
				const timer = setInterval(() => { if (runningId) refresh(); }, 5000);
				return () => clearInterval(timer);
			}, [runningId, refresh]);

			const toast = (text) => { setMsg(text); setTimeout(() => setMsg(null), 3000); };
			const api = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

			const submit = () => {
				if (!form.prompt.trim()) { toast(t('err') + t('prompt')); return; }
				setBusy(true);
				const payload = {
					name: form.name,
					prompt: form.prompt,
					enabled: form.enabled,
					schedule: {
						type: form.type,
						minutes: Number(form.minutes) || 60,
						hour: Number(form.hour) || 9,
						minute: Number(form.minute) || 0,
						dow: Number(form.dow) || 1
					}
				};
				const url = editing === 'new' ? '/api/automation/create' : '/api/automation/update';
				const body = editing === 'new' ? payload : Object.assign({ id: editing }, payload);
				api(url, body)
					.then((d) => {
						if (!d.ok) { toast(t('err') + (d.error || '')); return; }
						toast(t('done'));
						setEditing(null);
						refresh();
					})
					.finally(() => setBusy(false));
			};
			const del = (task) => {
				if (!window.confirm('删除任务「' + task.name + '」？')) return;
				api('/api/automation/delete', { id: task.id }).then((d) => { if (d.ok) refresh(); });
			};
			const runNow = (task) => {
				setRunningId(task.id);
				api('/api/automation/run', { id: task.id }).then((d) => { if (!d.ok) toast(t('err') + (d.error || '')); setTimeout(() => { setRunningId(null); refresh(); }, 8000); });
			};
			const toggle = (task) => {
				api('/api/automation/update', { id: task.id, enabled: !task.enabled }).then((d) => { if (d.ok) refresh(); });
			};
			const optimize = () => {
				if (!form.prompt.trim()) return;
				setOptimizing(true);
				api('/api/automation/optimize', { prompt: form.prompt })
					.then((d) => { if (d.ok && d.prompt) setForm((f) => ({ ...f, prompt: d.prompt })); else toast(t('err') + (d.error || '优化失败')); })
					.finally(() => setOptimizing(false));
			};

			const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
			const formEl = react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: 12 } }, [
				react.createElement('div', { key: 'n', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('name')),
					react.createElement('input', { key: 'i', style: Object.assign({}, S.input, { flex: 1 }), placeholder: t('namePlaceholder'), value: form.name, onChange: set('name') })
				]),
				react.createElement('div', { key: 'p', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('prompt')),
					react.createElement('textarea', { key: 'i', style: Object.assign({}, S.textarea, { flex: 1 }), placeholder: t('promptPlaceholder'), value: form.prompt, onChange: set('prompt') }),
					react.createElement('button', { key: 'b', style: Object.assign({}, S.button, optimizing ? S.buttonDisabled : {}), disabled: optimizing, onClick: optimize }, optimizing ? t('optimizing') : t('aiOptimize'))
				]),
				react.createElement('div', { key: 's', style: S.row }, [
					react.createElement('span', { key: 'l', style: S.label }, t('schedule')),
					['interval', 'daily', 'weekly'].map((v) =>
						react.createElement('button', {
							key: v,
							style: Object.assign({}, S.button, { borderRadius: 999, height: 28, padding: '0 12px', borderColor: form.type === v ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)', color: form.type === v ? 'var(--dsw-alias-state-business-primary)' : undefined }),
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
					react.createElement('button', { key: 'save', style: Object.assign({}, S.button, busy ? S.buttonDisabled : {}), disabled: busy, onClick: submit }, t('save')),
					react.createElement('button', { key: 'cancel', style: S.button, onClick: () => setEditing(null) }, t('cancel'))
				])
			]);

			const listEl = react.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, [
				react.createElement('div', { key: 'head', style: S.row }, [
					react.createElement('p', { key: 't', style: Object.assign({}, S.note, { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }) }, t('listTitle')),
					react.createElement('div', { key: 'sp', style: { flex: 1 } }),
					react.createElement('button', { key: 'new', style: S.button, onClick: () => setEditing('new') }, '＋ ' + t('newTask'))
				]),
				tasks.length === 0 ? react.createElement('p', { key: 'e', style: S.note }, t('empty')) : null,
				tasks.map((task) =>
					react.createElement('div', { key: task.id, style: S.card }, [
						react.createElement('div', { key: 'r1', style: S.row }, [
							react.createElement('p', { key: 'n', style: { margin: 0, fontSize: 14, fontWeight: 600, flex: 1, overflowWrap: 'anywhere' } }, task.name),
							react.createElement('button', {
								key: 'tg',
								style: Object.assign({}, S.button, { height: 26, borderRadius: 999, padding: '0 10px', fontSize: 12 }),
								onClick: () => toggle(task)
							}, task.enabled ? '🟢 ' + t('enabled') : '⚪ ' + t('enabled')),
							react.createElement('button', {
								key: 'rn',
								style: Object.assign({}, S.button, { height: 26, borderRadius: 999, padding: '0 10px', fontSize: 12 }, runningId === task.id ? S.buttonDisabled : {}),
								disabled: runningId === task.id,
								onClick: () => runNow(task)
							}, runningId === task.id ? t('running') : '▶ ' + t('runNow')),
							react.createElement('button', { key: 'ed', style: Object.assign({}, S.button, { height: 26, borderRadius: 999, padding: '0 10px', fontSize: 12 }), onClick: () => { setEditing(task.id); setForm({ name: task.name, prompt: task.prompt, type: task.schedule?.type || 'interval', minutes: task.schedule?.minutes || 60, hour: task.schedule?.hour || 9, minute: task.schedule?.minute || 0, dow: task.schedule?.dow || 1, enabled: !!task.enabled }); } }, '✎'),
							react.createElement('button', { key: 'del', style: Object.assign({}, S.button, { height: 26, borderRadius: 999, padding: '0 10px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => del(task) }, t('delete'))
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
				runs.slice(0, 10).map((r) =>
					react.createElement('div', { key: r.id, style: Object.assign({}, S.card, { padding: '8px 12px', gap: 4 }) }, [
						react.createElement('div', { key: 'r', style: S.row }, [
							react.createElement('span', { key: 'n', style: Object.assign({}, S.note, { fontWeight: 600 }) }, r.taskName),
							react.createElement('span', { key: 't', style: S.note }, fmtTime(r.finishedAt)),
							react.createElement('div', { key: 'sp', style: { flex: 1 } }),
							react.createElement('span', { key: 's', style: r.ok ? S.ok : S.err }, r.ok ? t('ok') : t('fail'))
						]),
						r.output ? react.createElement('pre', { key: 'o', style: { fontSize: 11, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 6, padding: '6px 8px', margin: 0, maxHeight: 90, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, r.output.slice(0, 500)) : null
					])
				)
			]);

			return react.createElement('div', { style: S.section }, [
				msg ? react.createElement('p', { key: 'msg', style: S.note }, msg) : null,
				editing === null ? [listEl, historyEl] : formEl
			]);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'automation: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
				name: 'settings.plugins.tab',
				id: 'automation',
				order: 30,
				label: () => t('tab'),
				locale: NS
			}, (props) => react.createElement(AutomationTab, Object.assign({ t }, props))));
		}

		module.exports = { NS, apply, inject };
		return module.exports;
	}
});
