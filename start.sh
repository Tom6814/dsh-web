#!/bin/sh
# DeepSeek Harness 启动脚本（Zeabur 容器环境）
#
# 架构：
#   nginx 监听 0.0.0.0:$PORT（Zeabur 负载均衡可达），反向代理到
#   dsh 自身的 127.0.0.1:$DSH_LISTEN_PORT。dsh 故意不支持 --host 0.0.0.0
#   （官方安全护栏，防止远程代码执行暴露），反代是容器部署的官方姿势。
#
# 环境变量：
#   PORT               Zeabur 注入的对外端口（默认 8080）
#   DSH_LISTEN_PORT    dsh 自身监听端口（默认 3080，仅本机反代访问）
#   DSH_PROFILE        启动的 profile（默认 web；headless 时不启用反代与 patch）
#   DSH_HOME           dsh 数据目录（默认 /data/dsh，建议挂持久化卷到 /data）
#   DSH_TRUSTED_HOSTS  额外信任的主机（逗号分隔），追加到 /api 浏览器信任围栏
#   ZEABUR_WEB_URL     Zeabur 自动注入的对外 URL，自动提取 host 加入信任围栏
set -e

: "${PORT:=8080}"
: "${DSH_LISTEN_PORT:=3080}"
: "${DSH_PROFILE:=web}"
: "${DSH_HOME:=/data/dsh}"

mkdir -p "$DSH_HOME"

echo "==> DeepSeek Harness 启动"
echo "    profile : $DSH_PROFILE"
echo "    DSH_HOME: $DSH_HOME"

if [ "$DSH_PROFILE" = "web" ]; then
  # ── 1. 确保内置插件已安装（挂载新持久化卷后首次启动需要补装）──
  #        镜像构建时已预装；若卷覆盖了 /data 则在此兜底。
  for pkg in dsh-plugin-market dsh-tree-picker; do
    if [ ! -d "$DSH_HOME/profiles/web/node_modules/$pkg" ]; then
      echo "    $pkg: 首次安装…"
      dsh plugin --profile web add "/opt/dsh-zeabur/$pkg"
    fi
  done

  # ── 2. 组装 --trusted-host：Zeabur 域名 + 用户自定义 ──
  #        从 URL 提取时只取 hostname（去掉端口）：port-less 条目在信任围栏中
  #        匹配该主机名的任意端口，避免 :443 等显式端口与浏览器 Host 头不一致导致 403。
  TRUSTED_FLAGS=""
  if [ -n "$ZEABUR_WEB_URL" ]; then
    H=$(printf '%s' "$ZEABUR_WEB_URL" | sed -E 's|^[a-zA-Z]+://([^:/]+).*|\1|')
    TRUSTED_FLAGS="--trusted-host $H"
    echo "    信任主机(自动): $H"
  fi
  if [ -n "$DSH_TRUSTED_HOSTS" ]; then
    for h in $(printf '%s' "$DSH_TRUSTED_HOSTS" | tr ',' ' '); do
      TRUSTED_FLAGS="$TRUSTED_FLAGS --trusted-host $h"
      echo "    信任主机(手动): $h"
    done
  fi

  # ── 3. 生成 nginx 反代配置（gzip 压缩 + 插件长缓存 + SSE/WS 兼容）──
  #        性能优化：client 插件 bundle 约 3MB 无压缩；gzip 后约 700KB，
  #        /plugins/ 内容带 rev 参数不可变，可浏览器长缓存（二次访问 0 下载）。
  cat > /etc/nginx/conf.d/dsh.conf <<'NGINX'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      "";
}

# 文本类响应 gzip 压缩（SSE/WS 流不受影响：buffering off 时不压缩）
gzip on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_vary on;
gzip_types text/plain text/css application/json application/javascript text/javascript application/xml image/svg+xml;

server {
    listen 0.0.0.0:__PORT__;

    # SSE / WebSocket 下行：流式透传，不缓冲、不压缩
    location ~ ^/api/events\.(mux|host)$ {
        proxy_pass http://127.0.0.1:__LISTEN__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # 插件 bundle：URL 带 rev 参数、内容不可变，浏览器长缓存
    location /plugins/ {
        proxy_pass http://127.0.0.1:__LISTEN__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        proxy_read_timeout 60s;
    }

    # 其余（index.html / api JSON 等）：gzip 压缩
    location / {
        proxy_pass http://127.0.0.1:__LISTEN__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX
  sed -i "s/__PORT__/${PORT}/g; s/__LISTEN__/${DSH_LISTEN_PORT}/g" /etc/nginx/conf.d/dsh.conf

  echo "    nginx 反代 : 0.0.0.0:${PORT} -> 127.0.0.1:${DSH_LISTEN_PORT}"
  nginx -c /etc/nginx/nginx.conf

  echo "    listen    : 127.0.0.1:${DSH_LISTEN_PORT}"
  # shellcheck disable=SC2086
  exec dsh --profile web --patch /opt/dsh-zeabur/patches/web.cordis.patch.yml $TRUSTED_FLAGS --port "$DSH_LISTEN_PORT" "$@"
fi

# headless 等模式：无反代、无 patch，直接透传
exec dsh --profile "$DSH_PROFILE" "$@"
