# DeepSeek Harness Web 部署版

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`）的 Web 网页部署版，
基于 **Docker** 一键部署。部署后通过浏览器访问完整的 Harness Web 界面：对话、工作区（网页内目录浏览 + 新建文件夹）、
插件市场（搜索 GitHub `dsh-plugin` 插件并安装）等。

> #### 目前项目正在高速开发中，很快将增加更多功能

## Docker 部署

```bash
# 构建镜像
docker build -t dsh-web .

# 运行
docker run -d --name dsh \
  -p 8080:8080 \
  -e PORT=8080 \
  -v dsh-data:/data \
  dsh-web

# 浏览器打开 http://localhost:8080
```

> 💡 **DeepSeek API Key 在网页里配置**：首次打开后进入「设置 → 模型」填入
> `DEEPSEEK_API_KEY`（dsh 把密钥保存在配置文件中，不通过环境变量注入）。

> ⚠️ **务必挂载持久化目录**：`-v dsh-data:/data` 将数据卷挂载到容器 `/data`，
> 用于保存 dsh 的配置、工作区、会话记录和安装的插件。**不挂载的话，容器重建后这些数据会全部丢失。**

其他常用参数：

```bash
# 绑定其他端口（如 9000）
-p 9000:8080 -e PORT=8080

# 国内网络构建较慢时，可换 npm 镜像源加速
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t dsh-web .
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | **在网页「设置 → 模型」中配置**，不通过环境变量注入 |
| `PORT` | `8080` | 对外端口 |
| `DSH_HOME` | `/data/dsh` | dsh 数据目录（即持久化卷挂载点 `/data`） |
| `DSH_TRUSTED_HOSTS` | — | 额外信任的主机（逗号分隔），通过域名访问时使用 |
| `PREVIEW_ALLOW_PORTS` | `3000-9999` | 预览面板可反代的容器内端口白名单（如 `5173,8000-9000`），防止任意端口探测 |
| `PREVIEW_EXTRA_ROOTS` | — | 预览可读的额外根目录（逗号分隔），默认含 `/tmp` |

## 项目结构

```
├── Dockerfile                  # 镜像构建（Node LTS + nginx 反代 + dsh + Patchright 浏览器）
├── start.sh                    # 启动脚本
├── patches/                    # 部署适配配置（网页目录浏览 + 插件市场 + 浏览器 MCP + 自动化）
│   ├── web.cordis.patch.yml    # web profile：browse 交互 / 插件市场 / MCP 浏览器 / 自动化
│   └── headless.cordis.patch.yml # headless profile：仅浏览器 MCP（自动化任务执行时使用）
├── plugin-market/              # 插件市场插件（搜索安装 / 预览面板 / 导出项目）
├── plugins/floatboat-style/    # Floatboat 风格提示词注入插件（prompt sections）
├── plugins/automation/         # 自动化插件（定时触发 AI 执行任务）
├── plugins/image-gen/          # 图片生成插件（对话内生成图片，gpt-image-1/2 等）
├── plugins/model-extras/       # 模型增强插件（OpenAI Responses API / 自定义模型）
├── plugins/mcp-skill/          # 技能与 MCP 管理（侧栏入口 + Cursor mcp.json 导入）
├── presets/floatboat/          # 「Floatboat 风格」agent preset（部署到用户预设目录）
└── vendor/dsh-routing-suite/   # 第三方：dsh-super-injector（运行时注入器）+ router-standard 路由预设
```

## 说明

- **模型配置走官方原生**：「设置 → 模型」配置 DeepSeek API Key 或添加任意 OpenAI 兼容
  自定义提供方（官方支持）。额外提供 **OpenAI Responses API 适配器**（Codex / gpt-5 的
  `/v1/responses` 协议，原生仅支持 chat/completions）：在官方 Models 页选择 `openai-responses`
  提供方后，把端点配置写入 `$DSH_HOME/model-extras.json`（baseURL / apiKey / models），
  /models 自动获取模型列表。
- **对话内生成图片（GPT Image 1/2 等）**：「设置 → 插件 → 图片生成」配置图片端点（OpenAI 兼容
  `/images/generations`）与 Key，自动获取图片模型（gpt-image-1、gpt-image-2、dall-e-3…）。
  之后直接让 Agent 生成图片——工具 `generate_image` 会把图片保存到工作区 `images/` 并可预览。
- **自动化（主页侧栏）**：左侧栏底部「⏰ 自动化」入口（类 TRAE 任务栏），点击打开抽屉面板，
  可创建定时任务——间隔分钟、每天几点、每周周几几点，到点由 dsh 自带 headless 运行器执行
  任务（复用同一模型配置）；支持「✨ AI 优化」把一句话需求扩展为结构化任务指令、立即运行、
  运行历史查看。
- **技能与 MCP（侧栏）**：左侧栏「技能与 MCP」入口（自动化下方）打开管理面板——
  - **MCP 服务器**：新增/编辑/删除/启停（stdio 命令或 streamable-http URL）；**热插拔**：
    保存/启停后立即连接或断开并注册/注销工具（`mcp__<服务器>__<工具>`），无需重启；
    面板显示「已热连接 N 工具」状态；重启后自动恢复连接；
  - **Cursor 格式导入**：粘贴 `.cursor/mcp.json` 内容或填工作区路径（如 `.cursor/mcp.json`），
    自动解析 `mcpServers`（command/args/env 与 url/headers 均支持）批量导入，导入即热生效；
  - **Skills**：管理 `$DSH_HOME/skills/<name>/SKILL.md`（Claude 风格技能根），新建/删除/启停，
    保存即出现在输入框「/」技能菜单（dsh 技能文件监听，实时生效）。
- **浏览器自动化（MCP）**：镜像内置 Patchright（playwright 的 stealth 分支，驱动级反检测，
  能过基础机器人验证）的 MCP server。Agent 工具集中出现 `mcp__browser__browse / interact /
  extract / close`，可查看、填写、点击网页。web 与 headless（自动化任务）profile 都可用。
- **dsh-routing-suite（vendored，MIT）**：
  - **dsh-super-injector v0.3.3**：运行时注入器，`dev_*` 工具全家桶——注入/卸载/热重载/
    侧挂转正/脚手架/构建发布/插件自检（`dev_inject_plugin`、`dev_uninject_plugin`、
    `dev_reload_package`、`dev_plugin_status`、`dev_scaffold_plugin` 等 14 个），
    junction 链接 + loader.create 免重启装配；设置页「插件」区提供插件管理 UI
    （列表/卸载/拖入内化）；清单持久化重启自动恢复。
  - **router-standard 预设 v0.1.1**：任务感知思维模式路由（spec/react/weak 三模式 +
    近距离引导 + 单任务三锚）。新建会话选择 **Router Standard (experimental)** 预设，
    生成类任务自动 react、维护类任务自动 spec；AI 自优化工具
    `dev_router_status` / `dev_router_mode` / `dev_mode_subagent`。
  - 构建方式见 `vendor/dsh-routing-suite/README.md`。
- **导出**：右上角「导出」按钮二级菜单——导出项目（工作区打包 zip 直接下载，不落盘，
  自动排除 node_modules/.git/dist 等）、导出会话日志（复用官方 Session log）。
- **预览面板**：对话中的 localhost 链接与文件在右侧分栏预览（可拖宽、缩放、移动端全屏）；
  地址栏显示 `127.0.0.1:端口` / `file://` 格式；除二进制外任意文件可预览（文本直接显示，
  二进制给出下载页）。

- 镜像基于 Node 22 LTS，内置 nginx 反向代理（`dsh` 出于安全设计不支持 `0.0.0.0` 直绑）。
- 首次使用：添加工作区 → 网页内目录树选目录 → 开始对话；模型配置在 设置 → 模型。
  外部 http(s) 链接保持默认新标签页打开。`PREVIEW_ROOT` 可覆盖文件预览根（默认 `/workspace`），
  `PREVIEW_EXTRA_ROOTS` 追加额外可读根（逗号分隔；未设置时默认含容器临时目录）。
- **插件启停**：设置 → 插件 → 「插件列表」展开任意插件卡片，详情里带「启用 / 停用」按钮，
  通过写入 `$DSH_HOME/cordis.patch.yml` 用户补丁层即时生效（dsh 热更新），重启后保持。
- **Floatboat 风格预设**：新建会话时在预设选择器中选「Floatboat 风格」——将 Floatboat
  （AOE Tech Labs）提示词工程的精华迁移到 dsh：交付完整度优先的工作哲学、工具使用纪律
  （文件最小变更/来源可信度/浏览器与检索选择/凭据处理）、交付真实性契约（不虚构产物）、
  安全边界（防套取/防泄露）与委派记忆纪律。基于官方 standard preset，工具能力完全一致；
  提示段落由 `plugins/floatboat-style` 插件以 `systemPrompt.section()` 注入（对应
  Floatboat 的 prompt-segment 机制），每段可独立关闭。⚠️ 该 preset **依赖
  `dsh-floatboat-style` 插件**（镜像已内置），单独复制 preset 到未装插件的环境会挂载失败。
- **插件安装**：搜索 GitHub `topic:dsh-plugin` 仓库后，自动检测每个仓库对应的
  **npm 包**（读根 package.json；monorepo 探测 `packages/` 子包，免 GitHub API 限流）：
  卡片标注 `✓ npm: <包名>` 表示该仓库有已发布的 npm 插件包，**点击「安装」直接安装
  npm 包**（而非 GitHub 根包，避免 monorepo 根包无 `dsh.bundle` 装完不生效的坑）。
  安装时自动处理 pnpm 构建授权（`allowBuilds` 占位自动批准 + 重试）与兜底 reconcile；
  安装后做**插入条目冲突检测**（聚合包与单包同时装会致重启崩溃，装时即警告并可一键
  卸载 `/api/plugin-market/uninstall`）。
- **重启服务**：安装成功后点「重启服务」→ 进程以**非零码退出**（`exit(1)`，平台判定
  崩溃必重启；优雅退出 exit 0 可能被平台视为正常关闭而不重启）→ 容器平台自动拉起
  新实例 → 插件进入 loader 组合与 Web UI。前端在服务恢复后自动提示并引导刷新页面
  （index.html 已禁缓存，保证新插件入口图 `__DSH_BOOT__` 重新拉取）。请确保已为
  `/data` 挂载持久化卷，否则重启会丢失新装的插件与会话数据。
- **排查日志**：插件市场所有操作（install/uninstall/toggle/restart）都以
  `[plugin-market]` 前缀输出详细日志（spec、profile 路径、pnpm 输出、allowBuilds
  处理、bundles 现状、冲突检测结果），在 Zeabur 日志面板可直接 grep 定位问题。
