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

# 全局安装 DeepSeek Harness CLI + pnpm（dsh plugin 安装插件依赖 pnpm）。
# ⚠️ 必须锁定 dsh 版本：dsh 处于 developer preview，官方声明"兼容性破坏随时发生"，
# 用 @latest 会导致每次构建拉到不同版本、部署行为漂移。升级方式：
#   npm view @deepseek-ai/dsh version 查最新 → 改下面的版本号 → 重新构建。
ARG DSH_VERSION=0.1.0-rc.6
RUN npm install -g --no-fund --no-audit --registry=$NPM_REGISTRY @deepseek-ai/dsh@$DSH_VERSION pnpm

# 浏览器自动化 MCP server（Patchright stealth 版）：Agent 通过
# mcp__browser__browse/interact/extract/close 查看与操作网页（可过基础机器人验证）
RUN git clone --depth 1 https://github.com/dylangroos/patchright-mcp-lite /opt/patchright-mcp \
    && cd /opt/patchright-mcp \
    && npm install --no-fund --no-audit --registry=$NPM_REGISTRY \
    && npm run build \
    && npx patchright install chromium \
    # MCP stdio 协议不容许杂音：把 server 的 console.log 改走 stderr，避免污染协议流
    && find dist -name '*.js' -exec sed -i 's/console\.log/console.error/g' {} + \
    || true

# dsh 的数据目录：配置文件、profile、会话都存这里。
# 在 Zeabur 上建议把持久化存储挂载到 /data，重启后数据不丢。
ENV DSH_HOME=/data/dsh

# 文件浏览器（browse directory picker）默认打开位置对齐持久化卷：
# 其初始路径取 homedir()（容器里是 /root，非持久），会引导用户把工作区
# 建到易丢的临时目录；patch-picker.js 把默认目录改为 DSH_HOME 的父目录（/data）。
# patch-picker-auto.js 让 directory-picker 后端支持 DSH_DIRECTORY_PICKER 覆盖。
COPY scripts/ /opt/dsh-zeabur/scripts/
RUN node /opt/dsh-zeabur/scripts/patch-picker.js
RUN node /opt/dsh-zeabur/scripts/patch-picker-auto.js
# terminal-bash 快结算 path A 需要 promptTextSeen（prompt 文本匹配 "dsh> "），
# 但 tool-bash-persistent 把 PS1 覆盖为 31 字符暗号 → promptTextSeen 永远 false →
# 每条命令兜底等 3.5 秒。去掉 promptTextSeen 门控，仅靠 OSC 133;D 标记快结算。
RUN node /opt/dsh-zeabur/scripts/patch-terminal-bash-prompt.js

# 云端目录选择固定为服务端浏览（browse）；本地开发可不设（auto 原生）
ENV DSH_DIRECTORY_PICKER=browse

# dsh 的「调用目录」即默认 workspace root，这里固定为 /workspace
WORKDIR /workspace

# Zeabur 适配层：browse 交互 + 插件市场 patch、插件包、Floatboat 风格 preset、启动脚本
COPY patches/ /opt/dsh-zeabur/patches/
COPY plugin-market/ /opt/dsh-zeabur/plugin-market/
COPY plugins/ /opt/dsh-zeabur/plugins/
COPY presets/ /opt/dsh-zeabur/presets/
COPY vendor/ /opt/dsh-zeabur/vendor/
COPY start.sh /usr/local/bin/start-dsh
RUN chmod +x /usr/local/bin/start-dsh
# 插件 import @deepseek-ai/* 官方包：把 harness 的 node_modules 链接到插件共享根，
# 使 /opt/dsh-zeabur/plugins/* 的 ESM import 可达（如 dsh-tools / dsh-llm / schemastery）
RUN ln -sfn "$(npm root -g)/@deepseek-ai/dsh/node_modules" /opt/dsh-zeabur/node_modules

# 构建时预装插件市场与 Floatboat 风格提示插件（失败不阻断构建；start.sh 首次启动兜底补装）
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugin-market || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/floatboat-style || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/automation || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/image-gen || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/model-extras || true
# headless（自动化任务运行器）同样挂载模型插件，任务级固定模型（DSH_AGENT_MODEL）才生效
RUN dsh plugin --profile headless add /opt/dsh-zeabur/plugins/model-extras || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/mcp-skill || true
RUN dsh plugin --profile web add /opt/dsh-zeabur/plugins/github-sync || true
# dsh-routing-suite：运行时注入器（dev_* 工具全家桶）；预设由 start.sh 部署
RUN dsh plugin --profile web add /opt/dsh-zeabur/vendor/dsh-routing-suite/injector || true
# injector 是 bundle 层，其 lib/index.js 在 /opt 下按真实路径解析依赖——
# 把运行时依赖链接到 dsh 全局树（cordis/schemastery/@deepseek-ai/*），否则
# 启动 import 报 Cannot find package 'schemastery'。
RUN INJ=/opt/dsh-zeabur/vendor/dsh-routing-suite/injector \
  && DT=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules \
  && mkdir -p "$INJ/node_modules/@deepseek-ai" \
  && ln -sfn "$DT/@deepseek-ai/cordis" "$INJ/node_modules/cordis" \
  && ln -sfn "$DT/@deepseek-ai/schemastery" "$INJ/node_modules/schemastery" \
  && ln -sfn "$DT/@deepseek-ai/dsh-client-ui-slots" "$INJ/node_modules/@deepseek-ai/dsh-client-ui-slots" \
  && ln -sfn "$DT/@deepseek-ai/dsh-llm" "$INJ/node_modules/@deepseek-ai/dsh-llm" \
  && ln -sfn "$DT/@deepseek-ai/dsh-tools" "$INJ/node_modules/@deepseek-ai/dsh-tools" \
  && if [ -d "$DT/tsdown" ]; then ln -sfn "$DT/tsdown" "$INJ/node_modules/tsdown"; fi \
  && echo "injector 依赖链接已建立"

# 端口声明：Zeabur 会注入 $PORT（默认 8080），nginx 实际监听 $PORT
EXPOSE 8080

CMD ["start-dsh"]
