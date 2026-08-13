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
