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
  -e DEEPSEEK_API_KEY=sk-xxx \
  -v dsh-data:/data \
  dsh-web

# 浏览器打开 http://localhost:8080
```

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
| `DEEPSEEK_API_KEY` | — | **必填**，DeepSeek 官方 API Key |
| `PORT` | `8080` | 对外端口 |
| `DSH_HOME` | `/data/dsh` | dsh 数据目录（即持久化卷挂载点 `/data`） |
| `DSH_TRUSTED_HOSTS` | — | 额外信任的主机（逗号分隔），通过域名访问时使用 |

## 项目结构

```
├── Dockerfile                  # 镜像构建（Node LTS + nginx 反代 + dsh）
├── start.sh                    # 启动脚本
├── patches/                    # 部署适配配置（网页目录浏览 + 插件市场）
├── plugin-market/              # 插件市场插件
├── plugins/floatboat-style/    # Floatboat 风格提示词注入插件（prompt sections）
└── presets/floatboat/          # 「Floatboat 风格」agent preset（部署到用户预设目录）
```

## 说明

- 镜像基于 Node 22 LTS，内置 nginx 反向代理（`dsh` 出于安全设计不支持 `0.0.0.0` 直绑）。
- 首次使用：添加工作区 → 网页内目录树选目录 → 开始对话；模型配置在 设置 → Models。
- **预览面板**：右上角（Session Log 旁）「预览」胶囊按钮开关；对话中的 `localhost:端口`
  链接、**文件提及（MD / HTML / 图片 / 代码等）** 会自动在面板内打开（端口反代到容器内
  `127.0.0.1:<port>`，支持 WebSocket；MD 由 host 渲染为阅读页，代码文件按纯文本显示）。
  文件提及支持绝对路径（如 `/tmp/xxx.html`，host 会映射到容器工作区或临时目录，越界拒绝）。
  外部 http(s) 链接保持默认新标签页打开。`PREVIEW_ROOT` 可覆盖文件预览根（默认 `/workspace`），
  `PREVIEW_EXTRA_ROOTS` 追加额外可读根（逗号分隔；未设置时默认含容器临时目录）。
- **插件启停**：设置 → 插件 → 「插件列表」展开任意插件卡片，详情里带「启用 / 停用」按钮，
  通过写入 `$DSH_HOME/cordis.patch.yml` 用户补丁层即时生效（dsh 热更新），重启后保持。
- **Floatboat 风格预设**：新建会话时在预设选择器中选「Floatboat 风格」——将 Floatboat
  （AOE Tech Labs）提示词工程的精华迁移到 dsh：交付完整度优先的工作哲学、工具使用纪律
  （文件最小变更/来源可信度/浏览器与检索选择/凭据处理）、交付真实性契约（不虚构产物）、
  安全边界（防套取/防泄露）与委派记忆纪律。基于官方 standard preset，工具能力完全一致；
  提示段落由 `plugins/floatboat-style` 插件以 `systemPrompt.section()` 注入（对应
  Floatboat 的 prompt-segment 机制），每段可独立关闭。
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
