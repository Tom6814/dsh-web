# DeepSeek Harness Web 部署版

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`）的 Web 网页部署版，
支持 **Docker** 部署，也可在 **Zeabur** 上一键部署。部署后通过浏览器访问完整的 Harness Web 界面：
对话、工作区（网页内目录浏览 + 新建文件夹）、插件市场（搜索 GitHub `dsh-plugin` 插件并安装）等。

#### 目前项目正在高速开发中，很快将增加更多功能

## 部署

### 方式一：Zeabur（推荐，一键部署）

1. 把本项目推送到 Git 仓库（GitHub / GitLab）：

   ```bash
   git init
   git add Dockerfile start.sh patches plugin-market
   git commit -m "add deepseek harness zeabur deploy"
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```

2. 打开 [Zeabur 控制台](https://dash.zeabur.com) → 新建项目 → 导入该仓库，
   自动识别根目录 `Dockerfile` 构建部署。

3. 在服务页 **Variables** 添加 `DEEPSEEK_API_KEY`（DeepSeek API Key，必填）。

4. 服务页 → **Networking** 生成域名或绑定自定义域名，浏览器打开即可使用。

### 方式二：Docker（本地或任意支持 Docker 的平台）

```bash
docker build -t dsh-zeabur .
docker run -d --name dsh \
  -p 8080:8080 \
  -e PORT=8080 \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -v dsh-data:/data \
  dsh-zeabur
# 浏览器打开 http://localhost:8080
```

- `-v dsh-data:/data`：持久化卷，保存配置、会话、安装的插件（建议挂载）
- 国内网络构建较慢时可换 npm 源：`docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com -t dsh-zeabur .`

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | **必填**，DeepSeek 官方 API Key |
| `PORT` | `8080` | 对外端口（Zeabur 会自动注入） |
| `DSH_HOME` | `/data/dsh` | dsh 数据目录，建议挂载到持久化卷 |
| `DSH_TRUSTED_HOSTS` | — | 额外信任的主机（逗号分隔），绑定自定义域名时使用 |

## 项目结构

```
├── Dockerfile                  # 镜像构建（Node LTS + nginx 反代 + dsh）
├── start.sh                    # 启动脚本
├── patches/                    # Zeabur 适配配置（网页目录浏览 + 插件市场）
└── plugin-market/              # 插件市场插件
```

## 说明

- 镜像基于 Node 22 LTS，内置 nginx 反向代理（`dsh` 出于安全设计不支持 `0.0.0.0` 直绑）。
- 首次使用：添加工作区 → 网页内目录树选目录 → 开始对话；配置模型在 设置 → Models。
