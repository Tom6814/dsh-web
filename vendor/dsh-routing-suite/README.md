# dsh-routing-suite（vendored）

来源：https://github.com/yjh051108/dsh-routing-suite（MIT）

- **injector/**：dsh-super-injector v0.3.3 —— 运行时注入器（dev_* 工具全家桶：
  inject/uninject/reload/stage/scaffold/build/release/install + 路由自愈 + 设置页插件管理 UI）。
  仓库只含 TS 源码，本目录的 `lib/` 为构建产物：
  - `lib/index.js`：host 端（`npx tsc -p tsconfig.json` 编译）
  - `lib/client.js`：client 端（tsc 编译 src/client → 再经 `scripts/wrap-client.mjs`
    转换为 dsh `window.__ModuleLoader__.load` loader 格式；包名带 scope，
    client id 必须为 `@dsh-external/dsh-super-injector`）
  - `package.json` 的 `exports['./client'].default` 已调整为 `./lib/client.js`
  - **加载方式**：`dsh plugin --profile web add <injector>` 通过 `dsh.bundle.patch`
    注册为 profile 层（启动时动态应用其 `cordis.patch.yml` 的 insert 条目）。
    ⚠️ 不要在 web patch 里再手动 insert 同名 id，否则 `duplicate loader entry id`
    启动失败——bundle 注册是唯一加载来源。
- **preset/**：dsh-router-standard v0.1.1 —— 思维模式路由预设（spec/react/weak 三模式 +
  近距离引导 + 单任务三锚；`dev_router_status/dev_router_mode` 自优化工具）。
  部署到 `$DSH_HOME/.agent-presets/router-standard`（agent.cordis.yml + preset.yml + *.mjs）。

重新构建：`cd injector && npm i --no-save typescript@^5.9 tsdown@^0.22 @types/node@^24 &&
npx tsc -p tsconfig.json && npx tsc -p tsconfig.client.json && node scripts/wrap-client.mjs`
（类型声明来自 dsh fork 包，会有少量 TS2305/TS2339 类型报错，产物不受影响。）
