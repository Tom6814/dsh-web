# DeepSeek Harness (dsh) —— Zeabur 一键部署镜像
#
# 使用方式：把本目录推送到 Git 仓库，在 Zeabur 导入该仓库即可，
#           Zeabur 会自动识别根目录的 Dockerfile 并构建部署。
#
# 架构说明：
#   dsh 出于安全设计不支持 --host 0.0.0.0（防止远程代码执行暴露），
#   因此容器内用 nginx 监听 0.0.0.0:$PORT 反代到 dsh 的 127.0.0.1:3080。
#   「选择/添加工作区」通过 patches/web.cordis.patch.yml 固定为网页内目录浏览；
#   同文件还挂载了插件市场（dsh-plugin-market），可在设置中搜索 GitHub
#   topic:dsh-plugin 的社区插件并一键安装。

# 基于 Node LTS；slim 版体积小，补齐编译工具链以防原生模块（koffi/node-pty）
# 的 prebuild 不可用时需要本地编译
FROM node:22-bookworm-slim

# 编译依赖 + CA 证书 + nginx（对外反代）+ git（安装 Git 托管插件需要）
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates nginx git \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# 可选：构建时更换 npm 源，例如
#   docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com .
ARG NPM_REGISTRY=https://registry.npmjs.org

# 全局安装 DeepSeek Harness CLI + pnpm（dsh plugin 安装插件依赖 pnpm）
RUN npm install -g --no-fund --no-audit --registry=$NPM_REGISTRY @deepseek-ai/dsh@latest pnpm

# dsh 的数据目录：配置文件、profile、会话都存这里。
# 在 Zeabur 上建议把持久化存储挂载到 /data，重启后数据不丢。
ENV DSH_HOME=/data/dsh

# dsh 的「调用目录」即默认 workspace root，这里固定为 /workspace
WORKDIR /workspace

# Zeabur 适配层：browse 交互 + 插件市场 patch、插件包、Floatboat 风格 preset、启动脚本
COPY patches/ /opt/dsh-zeabur/patches/
COPY plugin-market/ /opt/dsh-zeabur/plugin-market/
COPY plugins/ /opt/dsh-zeabur/plugins/
COPY presets/ /opt/dsh-zeabur/presets/
COPY start.sh /usr/local/bin/start-dsh
RUN chmod +x /usr/local/bin/start-dsh

# 构建时预装插件市场与 Floatboat 风格提示插件（失败不阻断构建；start.sh 首次启动兜底补装）
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugin-market || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/floatboat-style || true

# 端口声明：Zeabur 会注入 $PORT（默认 8080），nginx 实际监听 $PORT
EXPOSE 8080

CMD ["start-dsh"]
