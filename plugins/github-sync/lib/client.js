// dsh-github-sync client（dsh loader 格式：window.__ModuleLoader__.load）
// 会话底部一行：选择/复用「工作区级」的 GitHub 仓库+分支，同步会话到仓库。
// - 会话 id 提取：URL → React fiber（currentId）→ 选中行标题兜底
// - 样式对齐 dsh 原生 token；无 emoji，使用内联 SVG 线条图标
window.__ModuleLoader__.load({
	id: 'dsh-github-sync',
	factory: (require) => {
		// 兜底：dsh 的 require 仅 factory 参数；浏览器里懒加载的组件（如目录选择器）
		// 可能在裸上下文 require('fs'/'path'/'electron'/'os')，浏览器没有这些模块。
		// 提供最小 shim（宿主检测通过）+ dsh loader 回退（react 等真实模块）。
		// 无条件设置：本插件在 patch 末尾加载，保证最终兜底为增强版。
		try {
			const loaderReq = require;
			const pathShim = {
				join: (...a) => a.filter(Boolean).join('/').replace(/\/{2,}/g, '/'),
				dirname: (p) => { const s = String(p || ''); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : '.'; },
				basename: (p) => String(p || '').split('/').pop(),
				normalize: (p) => String(p || ''),
				resolve: (...a) => a.filter(Boolean).join('/'),
				relative: () => '', isAbsolute: (p) => String(p || '').startsWith('/'), extname: (p) => { const m = String(p || '').match(/\.[^./\\]+$/); return m ? m[0] : ''; }, sep: '/',
			};
			const fsShim = {
				existsSync: () => false,
				statSync: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
				readdirSync: () => [], mkdirSync: () => {},
				readFileSync: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
				writeFileSync: () => {}, promises: {},
			};
			window.require = (id) => {
				const key = String(id);
				if (key === 'fs' || key === 'node:fs') return fsShim;
				if (key === 'path' || key === 'node:path') return pathShim;
				if (key === 'electron') return {};
				if (key === 'os') return { homedir: () => '/', tmpdir: () => '/tmp', platform: 'browser', EOL: '\n' };
				if (key === 'child_process') return {};
				try { return loaderReq(id); } catch { return {}; }
			};
		} catch { /* ignore */ }
		var module = { exports: {} };
		(function () {
			if (window.__dsh_github_sync_started) return;
			window.__dsh_github_sync_started = true;

			let timer = null;
			let lastKey = '';

			// DeepSeek 原生线条图标（1.5px 圆角描边、currentColor 跟随主题）
			const ICONS = {
				git: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="4.5" r="1.6"/><circle cx="11" cy="4.5" r="1.6"/><circle cx="5" cy="11.5" r="1.6"/><path d="M5 6.1v3.8M5 11.5h4.5a1.5 1.5 0 0 0 1.5-1.5v-4"/><path d="M11 6.1v1.2"/></svg>',
				cloud: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5a3 3 0 0 1-.4-5.98 4.2 4.2 0 0 1 8.2 1.2 2.4 2.4 0 0 1-.3 4.78z"/></svg>',
				arrowUp: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9"/><path d="M4.5 6.5 8 3l3.5 3.5"/></svg>',
				check: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
				gear: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.1"/><path d="M8 2.6v1.6M8 11.8v1.6M13.4 8h-1.6M4.2 8H2.6M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1M11.8 11.8l-1.1-1.1M5.3 5.3 4.2 4.2"/></svg>',
				chevron: '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
			};
			const icon = (name, size) => {
				const s = document.createElement('span');
				s.style.cssText = 'display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-secondary);width:' + (size || 13) + 'px;height:' + (size || 13) + 'px;';
				s.innerHTML = (ICONS[name] || '').replace(/width="[0-9.]+"/, 'width="' + (size || 13) + '"').replace(/height="[0-9.]+"/, 'height="' + (size || 13) + '"');
				return s;
			};

			const TEXT = {
				cn: {
					setup: '用 GitHub 登录（OAuth 绑定）',
					manual: '手动填 GHP（高级）',
					optional: '同步到 GitHub（可选）',
					repo: '仓库', branch: '分支', save: '保存',
					sync: '同步', change: '更换', stop: '取消同步', syncing: '同步中…',
					synced: '已同步', failed: '失败', ghpHint: 'GHP（留空则用环境变量）',
					bound: '已绑定', logout: '解绑', unrecognized: '同步到 GitHub（当前会话暂未识别）',
				},
				en: {
					setup: 'Sign in with GitHub (OAuth)',
					manual: 'manual GHP (advanced)',
					optional: 'Sync to GitHub (optional)',
					repo: 'Repo', branch: 'Branch', save: 'Save',
					sync: 'Sync', change: 'Change', stop: 'Disable', syncing: 'Syncing…',
					synced: 'Synced', failed: 'Failed', ghpHint: 'GHP (empty = env)',
					bound: 'Bound as', logout: 'Sign out', unrecognized: 'Sync to GitHub (session not yet recognized)',
				},
			};
			function t() { return document.documentElement.lang === 'en' ? TEXT.en : TEXT.cn; }

			// 会话 id：URL → React fiber（currentId）→ 选中行标题（兜底）
			function extractSessionId() {
				const u = window.location.href;
				const pats = [/session\/([a-zA-Z0-9-]{8,})/, /[?&](?:id|session)=([a-zA-Z0-9-]{8,})/, /#\/?[^/]*\/([a-zA-Z0-9-]{8,})/];
				for (const p of pats) { const m = u.match(p); if (m) return m[1]; }
				try {
					const rows = [...document.querySelectorAll('*')].filter((e) => (e.className || '').toString().includes('sessionRow'));
					for (const row of rows) {
						const fk = Object.keys(row).find((k) => k.startsWith('__reactFiber$'));
						if (!fk) continue;
						let cur = row[fk];
						for (let i = 0; i < 80 && cur; i++) {
							const mp = cur.memoizedProps || {};
							if (typeof mp.currentId === 'string' && mp.currentId.startsWith('session-')) return mp.currentId;
							cur = cur.return;
						}
					}
				} catch { /* ignore */ }
				try {
					const sel = [...document.querySelectorAll('*')].filter((e) => {
						const c = (e.className || '').toString();
						return c.includes('sessionRow') && c.includes('select');
					});
					for (const row of sel) {
						const tt = row.querySelector('[class*=title],span');
						const tx = (tt && tt.textContent || row.textContent || '').trim();
						if (tx && tx.length < 60) return 'title:' + tx;
					}
				} catch { /* ignore */ }
				return null;
			}

			function mk(styles) { const d = document.createElement('div'); d.style.cssText = styles; return d; }
			function selectEl(name) {
				const s = document.createElement('select'); s.name = name || '';
				s.name = name; s.id = name;
				s.style.cssText = 'height:24px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;padding:0 6px;outline:none;max-width:150px;min-width:0;flex:0 1 auto;';
				return s;
			}
			function btnEl(label, primary, ghost) {
				const b = document.createElement('button');
				b.type = 'button';
				b.style.cssText = 'height:24px;border-radius:7px;border:1px solid ' + (primary ? 'transparent' : 'var(--dsw-alias-border-l2)') + ';background:' + (primary ? 'var(--dsw-alias-state-business-primary)' : ghost ? 'transparent' : 'var(--dsw-alias-bg-layer-1)') + ';color:' + (primary ? '#fff' : 'var(--dsw-alias-label-secondary)') + ';font-size:12px;font-family:inherit;cursor:pointer;padding:0 9px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;';
				b.textContent = label;
				return b;
			}
			function linkEl(label) {
				const a = document.createElement('button');
				a.type = 'button';
				a.textContent = label;
				a.style.cssText = 'background:none;border:none;padding:0;color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit;';
				return a;
			}

			async function api(url, body) {
				try {
					const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
					return await r.json();
				} catch (e) { return { ok: false, error: String(e?.message || e) }; }
			}

			function buildRow(holder, anchor) {
				const raw = extractSessionId();
				if (!raw) { rowRemoved(holder); return; }
				const isTitle = String(raw).startsWith('title:');
				const sessionId = isTitle ? null : raw;
				const title = isTitle ? String(raw).slice(6) : null;
				holder.textContent = '';
				const t_ = t();
				// 贴对话框：仅上圆角，与 composer 上沿衔接
				const row = mk('display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:4px 12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-bottom:none;border-radius:10px 10px 0 0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:12px;max-width:100%;overflow:hidden;');
				row.setAttribute('data-dsh-ghsync', '1');
				holder.appendChild(row);

				const q = sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '?title=' + encodeURIComponent(title || '');
				api('/api/github-sync/session' + q).then(async (info) => {
					if (!info.ok) {
						const p = mk('display:inline-flex;align-items:center;gap:5px;'); p.appendChild(icon('cloud', 13)); p.appendChild(document.createTextNode(info.error === '未找到会话' ? t_.unrecognized : t_.failed + ': ' + (info.error || '')));
						row.appendChild(p);
						return;
					}
					const realSid = info.sessionId || sessionId;
					const cwd = info.cwd || '';
					const cfg = await api('/api/github-sync/config');
					const conf = cfg.ok && cfg.configured;

					if (!conf) {
						const b = btnEl(t_.setup, true);
						b.prepend(icon('git', 13));
						row.appendChild(b);
						b.onclick = () => { if (cfg.oauthAvailable) window.location.href = '/api/github-sync/oauth/start'; };
						const ml = linkEl(t_.manual);
						row.appendChild(ml);
						const panel = mk('display:none;flex:1;min-width:230px;gap:6px;align-items:center;flex-wrap:wrap;');
						row.appendChild(panel);
						const ghp = document.createElement('input'); ghp.placeholder = 'GHP'; ghp.type = 'password'; ghp.name = 'dsh-github-sync-ghp'; ghp.id = 'dsh-github-sync-ghp';
						ghp.style.cssText = 'height:24px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px;flex:1;min-width:110px;outline:none;';
						const hint = mk(''); hint.textContent = t_.ghpHint; hint.style.cssText = 'font-size:11px;opacity:.7;flex-basis:100%;';
						const ok = btnEl(t_.save, true);
						ok.onclick = async () => {
							const r = await api('/api/github-sync/save', { ghp: ghp.value.trim() });
							if (r.ok) { row.textContent = ''; buildRow(holder); } else { hint.textContent = r.error || t_.failed; }
						};
						ml.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
						panel.append(ghp, hint, ok);
						return;
					}

					// 已绑定：账号 + 仓库选择
					const who = mk('display:inline-flex;align-items:center;gap:5px;');
					who.appendChild(icon('git', 13));
					const nm = document.createElement('strong'); nm.textContent = cfg.user ? '@' + cfg.user : t_.bound; nm.style.cssText = 'color:var(--dsw-alias-label-primary);font-weight:600;';
					who.appendChild(nm);
					if (cfg.email) { const em = mk(''); em.textContent = cfg.email; em.style.cssText = 'opacity:.6;'; who.appendChild(em); }
					const lg = btnEl(t_.logout, false, true);
					lg.onclick = async () => { const r = await api('/api/github-sync/logout'); if (r.ok) { row.textContent = ''; buildRow(holder); } };
					row.appendChild(who); row.appendChild(lg);

					const ws = info.wsConfig || null;
					const repoSel = selectEl('dsh-github-sync-repo');
					const branchSel = selectEl('dsh-github-sync-branch');
					const loadBranches = (repo, defBranch) => {
						branchSel.textContent = '';
						branchSel.appendChild(new Option(t_.branch + '…', ''));
						if (!repo) return;
						api('/api/github-sync/branches?repo=' + encodeURIComponent(repo)).then((d) => {
							if (!d.ok || !d.branches) { branchSel.appendChild(new Option(t_.repo + '…', '')); return; }
							for (const b of d.branches) {
								const o = new Option(b, b);
								if ((ws && ws.branch === b) || (!ws && defBranch && b === defBranch)) o.selected = true;
								branchSel.appendChild(o);
							}
						});
					};
					const fillRepos = (into, exclude) => {
						api('/api/github-sync/repos').then((d) => {
							if (!d.ok || !d.repos) { into.appendChild(new Option(t_.repo + '…', '')); return; }
							for (const r of d.repos) {
								if (exclude && r.name === exclude) continue;
								const o = new Option(r.name, r.name);
								if (r.default) o.dataset.default = r.default;
								into.appendChild(o);
							}
						});
					};
					const saveWs = async () => {
						const repo = repoSel.value;
						let branch = branchSel.value;
						if (!repo) return;
						// 未选分支时用仓库默认分支（或下拉第一项）
						if (!branch) {
							const o = repoSel.selectedOptions[0];
							branch = (o && o.dataset.default) || (branchSel.options[1] && branchSel.options[1].value) || '';
						}
						if (!branch) { status(t_.failed + ': ' + t_.branch); return; }
						const r = await api('/api/github-sync/ws-save', { cwd, repo, branch });
						if (r.ok) { row.textContent = ''; buildRow(holder); } else { status(r.error || t_.failed); }
					};
					const status = mk(''); status.style.cssText = 'font-size:12px;display:inline-flex;align-items:center;gap:5px;min-width:0;';

					if (!ws) {
						const b = btnEl(t_.optional, false, true);
						b.prepend(icon('cloud', 13));
						row.appendChild(b);
						const panel = mk('display:none;flex:1;min-width:200px;gap:6px;align-items:center;flex-wrap:wrap;');
						row.appendChild(panel);
						repoSel.appendChild(new Option(t_.repo + '…', ''));
						fillRepos(repoSel);
						repoSel.onchange = () => { const o = repoSel.selectedOptions[0]; loadBranches(repoSel.value, o && o.dataset.default); };
						const ok = btnEl(t_.save, true);
						ok.onclick = saveWs;
						b.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
						panel.append(repoSel, branchSel, ok);
						return;
					}

					const tag = mk('display:inline-flex;align-items:center;gap:5px;min-width:0;flex:0 1 auto;');
					tag.appendChild(icon('repo', 13));
					const rn = document.createElement('strong'); rn.textContent = ws.repo; rn.style.cssText = 'color:var(--dsw-alias-label-primary);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;flex:none;';
					const br = mk(''); br.textContent = '#' + ws.branch; br.style.cssText = 'opacity:.65;flex:none;';
					tag.append(rn, br);
					const syncBtn = btnEl(t_.sync, true);
					syncBtn.prepend(icon('arrowUp', 12));
					const chg = btnEl(t_.change, false, true);
					const stp = btnEl(t_.stop, false, true);
					row.append(tag, syncBtn, chg, stp, status);

					syncBtn.onclick = async () => {
						syncBtn.disabled = true; syncBtn.textContent = t_.syncing;
						const r = await api('/api/github-sync/sync', { sessionId: realSid, repo: ws.repo, branch: ws.branch });
						syncBtn.disabled = false; syncBtn.textContent = t_.sync; syncBtn.prepend(icon('arrowUp', 12));
						status.textContent = '';
						if (r.ok) { status.style.color = 'var(--dsw-alias-state-success-primary)'; status.appendChild(icon('check', 12)); status.appendChild(document.createTextNode(t_.synced + ' → ' + (r.url || r.file))); }
						else { status.style.color = 'var(--dsw-alias-state-error-primary)'; status.appendChild(document.createTextNode(t_.failed + ': ' + (r.error || ''))); }
					};
					chg.onclick = () => {
						row.textContent = '';
						row.appendChild(btnEl(t_.repo + '…', false, true));
						const panel = mk('display:flex;flex:1;min-width:200px;gap:6px;align-items:center;flex-wrap:wrap;');
						row.appendChild(panel);
						repoSel.appendChild(new Option(ws.repo, ws.repo, false, true));
						fillRepos(repoSel, ws.repo);
						loadBranches(ws.repo);
						repoSel.onchange = () => { const o = repoSel.selectedOptions[0]; loadBranches(repoSel.value, o && o.dataset.default); };
						const ok = btnEl(t_.save, true); ok.onclick = saveWs;
						panel.append(repoSel, branchSel, ok);
					};
					stp.onclick = async () => {
						const r = await api('/api/github-sync/ws-save', { cwd });
						if (r.ok) { row.textContent = ''; buildRow(holder); }
					};
				});
			}
			function rowRemoved(holder) { holder.textContent = ''; }

			function findComposer() {
				const ed = document.querySelector('[contenteditable="true"]');
				const ta = document.querySelector('textarea');
				const any = ed || ta;
				if (!any) return null;
				// 找到 composer 输入框容器（紧邻的祖先），行插在其上方
				let el = any.parentElement;
				for (let i = 0; el && i < 5; i++) {
					const s = getComputedStyle(el);
					if (el.clientWidth > 320 && (s.position === 'fixed' || s.position === 'sticky' || el.querySelector('button'))) return el;
					el = el.parentElement;
				}
				return any.parentElement;
			}

			function ensureRow() {
				const container = findComposer();
				if (!container || !container.parentElement) return false;
				const parent = container.parentElement;
				const key = extractSessionId() || '';
				// 行插在 composer 兄弟位置（紧贴上方），检查也必须查 parent 内
				if (key && key === lastKey && parent.querySelector('[data-dsh-ghsync]')) return true;
				lastKey = key;
				// 防残留/防重复：清掉所有已注入行再插新的
				document.querySelectorAll('[data-dsh-ghsync]').forEach((el) => el.remove());
				const holder = mk('flex:none;');
				parent.insertBefore(holder, container);
				buildRow(holder, container);
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
		module.exports = { inject: [], apply: () => {} };
		return module.exports;
	}
});
