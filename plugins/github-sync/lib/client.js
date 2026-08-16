// dsh-github-sync — client half
// 每个会话底部一行：选择/复用「工作区级」的 GitHub 仓库+分支，同步会话到仓库。
// 仓库可选；同一工作区下所有会话复用同一仓库选择。
// DOM 注入（不依赖 React 内部），MutationObserver 等待渲染并跟随会话切换。
(function () {
	if (window.__dsh_github_sync_started) return;
	window.__dsh_github_sync_started = true;

	let host = null;
	let timer = null;
	let lastKey = '';

	const TEXT = {
		cn: {
			setup: '🔐 用 GitHub 登录（OAuth 绑定）',
			manual: '或手动填 GHP（高级）',
			optional: '☁️ 同步到 GitHub（可选）',
			repo: '仓库', branch: '分支', save: '保存', cancel: '取消',
			sync: '同步', change: '更换', stop: '取消同步', syncing: '同步中…',
			synced: '已同步', failed: '失败', ghpHint: 'GHP（留空则用环境变量）',
			placeholder: 'owner/name', noRepos: '（加载失败或无仓库）',
			bound: '已绑定', logout: '解绑', oauthMissing: '未配置 GITHUB_CLIENT_ID，无法 OAuth',
		},
		en: {
			setup: '🔐 Sign in with GitHub (OAuth)',
			manual: 'or manual GHP (advanced)',
			optional: '☁️ Sync to GitHub (optional)',
			repo: 'Repo', branch: 'Branch', save: 'Save', cancel: 'Cancel',
			sync: 'Sync', change: 'Change', stop: 'Disable', syncing: 'Syncing…',
			synced: 'Synced', failed: 'Failed', ghpHint: 'GHP (empty = env)',
			placeholder: 'owner/name', noRepos: '(no repos or failed)',
			bound: 'Bound as', logout: 'Sign out', oauthMissing: 'GITHUB_CLIENT_ID not configured',
		},
	};
	function t() { return document.documentElement.lang === 'en' ? TEXT.en : TEXT.cn; }

	function extractSessionId() {
		const u = window.location.href;
		const pats = [
			/session\/([a-zA-Z0-9-]{8,})/,
			/[?&](?:id|session)=([a-zA-Z0-9-]{8,})/,
			/#\/?[^/]*\/([a-zA-Z0-9-]{8,})/,
		];
		for (const p of pats) { const m = u.match(p); if (m) return m[1]; }
		return null;
	}

	function mk(styles) { const d = document.createElement('div'); d.style.cssText = styles; return d; }
	function selectEl(styles) {
		const s = document.createElement('select');
		s.style.cssText = 'height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;padding:0 6px;outline:none;max-width:220px;';
		if (styles) s.style.cssText = styles;
		return s;
	}
	function btnEl(label, primary) {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = label;
		b.style.cssText = 'height:26px;border-radius:8px;border:1px solid ' + (primary ? 'transparent' : 'var(--dsw-alias-border-l2)') + ';background:' + (primary ? 'var(--dsw-alias-state-business-primary)' : 'transparent') + ';color:' + (primary ? '#fff' : 'var(--dsw-alias-label-secondary)') + ';font-size:12px;font-family:inherit;cursor:pointer;padding:0 10px;white-space:nowrap;';
		return b;
	}

	async function api(url, body) {
		try {
			const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
			return await r.json();
		} catch (e) { return { ok: false, error: String(e?.message || e) }; }
	}

	function buildRow(holder) {
		const sessionId = extractSessionId();
		if (!sessionId) return;
		holder.textContent = '';
		const t_ = t();
		const row = mk('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-tertiary);box-sizing:border-box;');
		row.setAttribute('data-dsh-ghsync', '1');
		holder.appendChild(row);

		api('/api/github-sync/session?sessionId=' + encodeURIComponent(sessionId)).then(async (info) => {
			if (!info.ok) { const p = mk(''); p.textContent = t_.failed + ': ' + (info.error || ''); row.appendChild(p); return; }
			const cwd = info.cwd || '';
			const cfg = await api('/api/github-sync/config');
			const conf = cfg.ok && cfg.configured;

			if (!conf) {
				// 未绑定：OAuth 登录主按钮（优先），手动 GHP 折叠（高级）
				const b = btnEl(cfg.oauthAvailable ? t_.setup : t_.oauthMissing, true);
				row.appendChild(b);
				b.onclick = () => { if (cfg.oauthAvailable) window.location.href = '/api/github-sync/oauth/start'; };
				const manualLink = mk(''); manualLink.textContent = t_.manual; manualLink.style.cssText = 'cursor:pointer;text-decoration:underline;opacity:.8;font-size:11px;';
				row.appendChild(manualLink);
				const panel = mk('display:none;flex:1;min-width:240px;gap:6px;align-items:center;flex-wrap:wrap;');
				row.appendChild(panel);
				const ghp = document.createElement('input'); ghp.placeholder = 'GHP'; ghp.type = 'password'; ghp.style.cssText = 'height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px;flex:1;min-width:120px;outline:none;';
				const hint = mk(''); hint.textContent = t_.ghpHint; hint.style.cssText = 'font-size:11px;opacity:.7;flex-basis:100%;';
				const ok = btnEl(t_.save, true);
				ok.onclick = async () => {
					const r = await api('/api/github-sync/save', { ghp: ghp.value.trim() });
					if (r.ok) { row.textContent = ''; buildRow(holder); } else { hint.textContent = r.error || t_.failed; }
				};
				manualLink.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
				panel.append(ghp, hint, ok);
				return;
			}

			// 已绑定：显示账号 + 仓库选择
			const who = mk('display:inline-flex;align-items:center;gap:6px;');
			who.innerHTML = '🔗 <strong style="color:var(--dsw-alias-label-primary)">' + (cfg.user ? '@' + cfg.user : t_.bound) + '</strong>' + (cfg.email ? ' <span style="opacity:.6">' + cfg.email + '</span>' : '');
			const logoutBtn = btnEl(t_.logout);
			logoutBtn.onclick = async () => { const r = await api('/api/github-sync/logout'); if (r.ok) { row.textContent = ''; buildRow(holder); } };
			row.appendChild(who); row.appendChild(logoutBtn);
			const ws = info.wsConfig || null;
			const repoSel = selectEl();
			const branchSel = selectEl();
			const loadBranches = (repo) => {
				branchSel.textContent = '';
				branchSel.appendChild(new Option(t_.branch + '…', ''));
				if (!repo) return;
				api('/api/github-sync/branches?repo=' + encodeURIComponent(repo)).then((d) => {
					if (!d.ok || !d.branches) { branchSel.appendChild(new Option(t_.noRepos, '')); return; }
					for (const b of d.branches) { const o = new Option(b, b); if (ws && ws.branch === b) o.selected = true; branchSel.appendChild(o); }
				});
			};
			const saveWs = async () => {
				const repo = repoSel.value, branch = branchSel.value;
				if (!repo || !branch) return;
				const r = await api('/api/github-sync/ws-save', { cwd, repo, branch });
				if (r.ok) { row.textContent = ''; buildRow(holder); } else { status(r.error || t_.failed); }
			};

			if (!ws) {
				// 可选：未选择 → 「同步到 GitHub（可选）」→ 展开选择
				const b = btnEl(t_.optional);
				row.appendChild(b);
				const panel = mk('display:none;flex:1;min-width:260px;gap:6px;align-items:center;flex-wrap:wrap;');
				row.appendChild(panel);
				repoSel.appendChild(new Option(t_.repo + '…', ''));
				api('/api/github-sync/repos').then((d) => { if (d.ok && d.repos) for (const r of d.repos) repoSel.appendChild(new Option(r, r)); else repoSel.appendChild(new Option(t_.noRepos, '')); });
				repoSel.onchange = () => loadBranches(repoSel.value);
				const ok = btnEl(t_.save, true);
				ok.onclick = saveWs;
				b.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
				panel.append(repoSel, branchSel, ok);
				return;
			}

			// 已有工作区仓库选择：显示 + 同步按钮
			const tag = mk('display:inline-flex;align-items:center;gap:6px;');
			tag.innerHTML = '📦 <strong style="color:var(--dsw-alias-label-primary)">' + ws.repo + '</strong> <span style="opacity:.7">#' + ws.branch + '</span>';
			const syncBtn = btnEl(t_.sync, true);
			const status = mk(''); status.style.cssText = 'font-size:12px;';
			const changeBtn = btnEl(t_.change);
			const stopBtn = btnEl(t_.stop);
			row.append(tag, syncBtn, changeBtn, stopBtn, status);

			syncBtn.onclick = async () => {
				syncBtn.disabled = true; syncBtn.textContent = t_.syncing;
				const r = await api('/api/github-sync/sync', { sessionId, repo: ws.repo, branch: ws.branch });
				syncBtn.disabled = false; syncBtn.textContent = t_.sync;
				if (r.ok) { status.style.color = 'var(--dsw-alias-state-success-primary)'; status.textContent = '✓ ' + t_.synced + ' → ' + (r.url || r.file); }
				else { status.style.color = 'var(--dsw-alias-state-error-primary)'; status.textContent = '✗ ' + t_.failed + ': ' + (r.error || ''); }
			};
			changeBtn.onclick = () => {
				row.textContent = '';
				row.appendChild(btnEl(t_.repo + '…', false));
				const panel = mk('display:flex;flex:1;min-width:260px;gap:6px;align-items:center;flex-wrap:wrap;');
				row.appendChild(panel);
				repoSel.appendChild(new Option(ws.repo, ws.repo, false, true));
				api('/api/github-sync/repos').then((d) => { if (d.ok && d.repos) for (const r of d.repos) if (r !== ws.repo) repoSel.appendChild(new Option(r, r)); });
				loadBranches(ws.repo);
				repoSel.onchange = () => loadBranches(repoSel.value);
				const ok = btnEl(t_.save, true); ok.onclick = saveWs;
				panel.append(repoSel, branchSel, ok);
			};
			stopBtn.onclick = async () => {
				const r = await api('/api/github-sync/ws-save', { cwd });
				if (r.ok) { row.textContent = ''; buildRow(holder); }
			};
		});
	}

	function findComposer() {
		// 特征：会话页底部的编辑器容器（contenteditable / textarea 附近）
		const ed = document.querySelector('[contenteditable="true"][data-dsh-ghsync-ed]') || document.querySelector('[contenteditable="true"]');
		const ta = document.querySelector('textarea[data-dsh-ghsync-ed]');
		const any = ed || ta;
		if (!any) return null;
		// 向上找底部容器（含编辑器的会话区）
		let el = any.parentElement;
		for (let i = 0; el && i < 6; i++) {
			const s = getComputedStyle(el);
			if (el.clientWidth > 400 && (el.scrollHeight - el.clientHeight > 40 || s.position === 'fixed' || s.position === 'sticky')) return el;
			el = el.parentElement;
		}
		return any.parentElement;
	}

	function ensureRow() {
		const container = findComposer();
		if (!container) return false;
		// 已注入且会话未变 → 跳过
		const id = extractSessionId() || '';
		if (id && id === lastKey && container.querySelector('[data-dsh-ghsync]')) return true;
		lastKey = id;
		const old = container.querySelector('[data-dsh-ghsync]');
		if (old) old.remove();
		const holder = mk(''); holder.style.cssText = 'flex:none;';
		container.appendChild(holder);
		buildRow(holder);
		return true;
	}

	const mo = new MutationObserver(() => {
		if (timer) return;
		timer = setTimeout(() => { timer = null; try { ensureRow(); } catch { /* ignore */ } }, 600);
	});
	function start() {
		const root = document.getElementById('root');
		if (!root) { setTimeout(start, 400); return; }
		mo.observe(document.body, { childList: true, subtree: true });
		try { ensureRow(); } catch { /* ignore */ }
		setInterval(() => { try { ensureRow(); } catch { /* ignore */ } }, 3000);
	}
	start();
})();
