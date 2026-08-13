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
└── plugin-market/              # 插件市场插件
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
- **插件安装**：搜索结果的安装按钮支持 `owner/repo` GitHub 简写（自动归一化为
  `github:owner/repo` 交给 pnpm）；Git 托管的带构建脚本插件需要先在容器
  `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 配置 `allowBuilds`（安装失败时的提示会说明）。
- **重启服务**：安装成功后点「重启服务」→ 进程退出 → 容器平台自动拉起新实例，插件生效。
  请确保已为 `/data` 挂载持久化卷，否则重启会丢失新装的插件与会话数据。
