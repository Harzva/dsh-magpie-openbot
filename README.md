# DSH × Magpie — OpenBot host adapter

[English](#english) · MIT

把 **原版 [dsh-x-magpie](https://github.com/StrayDragon/dsh-x-magpie)** 接入 OpenBot 桌面宿主：本机安装、依赖状态、同步启停、模型连接，以及人与 Agent 共用的配置操作。

这份仓库发布的是 OpenBot 适配代码。DSH 插件本体由 StrayDragon 维护，随仓库保留的 `0.7.2` 发布包未修改；[Magpie](https://github.com/yetone/magpie) 是独立运行的模型网关。

## 分工

`订阅/API账号 → Magpie网关 → 原版DSH同步插件 → OpenBot命名模型连接 → BOT`

- Magpie 管理其支持的供应商、订阅、账号、额度与路由组。
- 插件通过 `configEditor / credentials / llm-pi-ai` 同步模型路由。
- 本适配使用真实 DSH Loader/SDK 与服务；只对 `webServer.register` 契约提供桌面 carrier。控制传输为带随机令牌的私有 Unix socket，无新增 TCP 控制端口。
- OpenBot 提供人可点击的设置页；Agent 走同一个宿主处理器与存储，身份、批准与提交前复核由宿主负责。

本仓库不是新的独立 DSH bundle，也不替代原版插件。直接使用 DSH Web 的用户请按[上游安装说明](https://github.com/StrayDragon/dsh-x-magpie#安装)安装原版插件；无需本桌面适配。

## 安装与测试本适配

需要 Node.js 22.12+、npm；当前控制传输需 Unix socket（macOS/Linux）。

```sh
git clone https://github.com/Harzva/dsh-magpie-openbot.git
cd dsh-magpie-openbot
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

所有依赖来自公开 npm，未依赖私有 OpenBot 仓库。`private:true` 只防止意外发到 npm，不影响本仓库 MIT 开源。

测试使用临时目录、原版插件、真实 DSH 服务和受控的本机模型目录网关；不读取你的订阅登录，不使用付费模型，不访问真实 OpenBot 资料。

## 接入自己的桌面宿主

版本 **0.2.1** 从包根导出 `createMagpieHost`、`MagpieManager`、`installLocalDshBundle`。集成人与 Agent 的统一入口使用一个 host 实例：

```js
const { createMagpieHost } = require('@harzva/dsh-magpie-openbot');
const host = createMagpieHost({
  home: '/absolute/private/application-data',
  config: hostModelConnections,
  assertOpen() {
    hostAssertNotClosing();
    hostAssertCurrentSettingsAuthority();
  }
});
await host.invoke('install'); // 只装本包内部定位并校验 SHA256 的原版 0.7.2
await host.invoke('configure', { gatewayUrl: 'http://127.0.0.1:3425', apiKey: 'USER_SUPPLIED_GATEWAY_KEY' });
await host.invoke('enable');
await host.invoke('sync');
const status = await host.invoke('status');
// 从 status.status.models 选择精确 ID：
// await host.invoke('useModel', { modelId: 'provider/model' });
await host.invoke('disable');
await host.close();
```

`invoke(operation,input)` 只接受 `status/install/configure/enable/disable/sync/useModel`。无参数操作的 input 只能省略或为 `{}`；`configure` 只接受 `gatewayUrl? / apiKey?` 且至少一项；`useModel` 只接受非空 `modelId`。未知操作、额外字段、数组和访问器均拒绝。`install` 不接受路径、kind 或代码，由宿主内部相对 `src/host.js` 定位固定发布包并检查原始归档摘要。该入口没有任意 IPC 转发。

`home` 使用宿主自己的专用资料目录。`config.upsertProfile({id,name,baseUrl,apiKey,model})` 必须保存命名连接并返回 `{ok:true}` 或 `{ok:false,code,message}`；连接ID由manager生成。真实凭据只交给本机存储，不返回到renderer/Agent。`isBusy()` 与 `close()` 委托同一个 manager；重启不会自动启用。宿主在人或 Agent 调用前完成身份及批准校验，`assertOpen` 在分派和 manager 队列执行时再次检查；`close()` 用于退出清理，不依赖仍然有效的调用授权。

低层 `MagpieManager` 和 `installLocalDshBundle` 为可信宿主保留兼容性，允许本地路径；不要直接暴露给模型。它们不代表 `createMagpieHost.invoke('install')` 可接受路径。

先在 Magpie 中登录或添加供应商并启动其网关。默认网关密钥是 `magpie`；自定义密钥由用户提供。修改网关配置前先停用同步。关闭同步只停止本适配的服务，已创建模型连接仍直接访问 Magpie。宿主重启后不自动启用。

### 人可点击

`renderer/openbot-magpie.js/.css` 是 OpenBot 的既有组件源码参考。它依赖宿主页 DOM、国际化、样式和受控 preload；不是可直接双击打开的独立网页。设置页入口为「设置 → 应用连接 → DSH 插件与 Magpie」。

宿主仅向可信拥有者窗口暴露下列固定调用：

| preload方法 | IPC意图 | manager方法 |
| --- | --- | --- |
| `magpieStatus` | `magpie:status` | `refresh()` |
| `magpieInstall` | `magpie:install` | `host.invoke('install')`，只允许内置固定原版 |
| `magpieConfigure` | `magpie:configure` | `configure(input)` |
| `magpieEnable/Disable` | `magpie:enable/disable` | `enable()/disable()` |
| `magpieSync` | `magpie:sync` | `sync()` |
| `magpieUseModel` | `magpie:useModel` | `useModel({modelId})` |

### Agent 也可以设置

`patches/openbot-agent-settings.patch` 是基于 OpenBot `ee80c1b` 的有限宿主增量，包含已验的7个设置意图及异步提交授权接线。它需要 OpenBot 已有设置服务，并非通用Agent运行时；其他宿主可按下表复用同一manager。

| `settings_action.actionId` | args | 权限 |
| --- | --- | --- |
| `magpie.status` | `{}` | 当前主脑，只读 |
| `magpie.install` | `{}` | 主脑 + 用户批准，只装内置固定原版 |
| `magpie.configure` | `{gatewayUrl?,apiKey?}`，至少一项 | 主脑 + 用户批准 |
| `magpie.enable/disable/sync` | `{}` | 主脑 + 用户批准 |
| `magpie.use-model` | `{modelId}` | 主脑 + 用户批准 |

先调用 `settings_describe({actionId:'magpie.configure'})` 读取参数结构。Agent不能指定插件路径、任意IPC、可执行文件或账号文件。队列执行、落盘与控制请求前核验实际身份/取消信号。批准和审计不返回密钥；不能靠提示词自授予主脑权限。创建连接不会切换默认模型或改动其他BOT。

## 范围与验证

仅允许启用内容摘要匹配的原版 `@straydragon/dsh-x-magpie@0.7.2`。其他导入包只保存，不执行；不运行npm安装脚本，不自动补插件依赖。网关地址仅支持loopback HTTP根地址。目录隔离不等于操作系统沙箱。

公开包测试验证原插件与真实DSH服务、模型目录同步、连接创建、密钥投影、鉴权、停止/重启、内容篡改与归档边界。真实供应商订阅、所有路由模式、Windows、独立网页UI和完整App安装不属于本仓库测试声明。Agent补丁在OpenBot来源树通过54专项和49运行时回归及完整npm，公开仓库自身不重复冒称这些为独立包测试。

订阅登录/续订与Magpie路由组编辑仍在Magpie自己的UI/CLI完成；本适配没有这些管理API。当前OpenBot发布版本是否包含最新Agent补丁，需以该App构建为准。

## 来源与许可

- OpenBot适配与bundle fingerprint辅助函数：MIT，OpenBot contributors；来源提交及提取变更见 `PROVENANCE.json`。
- StrayDragon/dsh-x-magpie：MIT，保留原始tgz、许可及SHA256。见 `vendor/dsh-x-magpie-LICENSE.txt` 和 provenance。
- yetone/magpie：上游独立项目，本仓库不复制其程序或账号配置。
- DeepSeek Harness：直接使用公开的 `@deepseek-ai/*` 包，依赖版本由lockfile固定，许可见各上游包。

## English

This repository is the MIT-licensed **OpenBot desktop host adapter** for the unmodified upstream DSH Magpie plugin. Magpie manages supported accounts and routing; the upstream plugin synchronizes its model catalog; the adapter supplies desktop service transport and host settings integration.

Run `npm ci --ignore-scripts && npm test` on Node.js 22.12+ and macOS/Linux. The tests run the original plugin and real DSH services against a controlled local gateway, without accessing personal logins or paid providers. There is no private OpenBot package dependency. The renderer is host integration source, not a standalone web app. The Agent patch requires OpenBot's existing authorization/settings service. Upstream authorship and MIT notices are retained.

### Public host API 0.2.1

The package root exports `createMagpieHost`, `MagpieManager`, and `installLocalDshBundle`. Create one host with `{home, config, assertOpen}` for approved human and Agent callers. `invoke` accepts only `status`, `install`, `configure`, `enable`, `disable`, `sync`, and `useModel`. Installation accepts no arguments other than an empty object: it resolves the bundled original 0.7.2 archive internally and verifies its SHA256. No caller-controlled path, kind, code, or arbitrary IPC is accepted. `configure` requires at least one of `gatewayUrl` and `apiKey`; `useModel` requires `modelId`. Other operations accept omitted input or `{}`. Extra fields and accessors are rejected.

The host checks `assertOpen` before dispatch and passes it into the shared manager for queued checks. The embedding app owns identity, approval and audit policy. `isBusy()` and `close()` delegate to that same manager; closing remains available for cleanup after authority revocation. Low-level manager/installer exports remain for trusted host use and must not be exposed directly to model-generated input. The MIT adapter and unchanged upstream plugin provenance remain separate.

### 可信桌面文件选择器导入

`await host.importSelectedBundle(sourcePath)` 仅供可信桌面宿主接收用户通过操作系统文件选择器选择的绝对 `.tgz` 或文件夹路径。调用前由宿主核验拥有者身份与选择来源；此方法检查 `assertOpen` 并委托同一个 manager，不创建第二份状态。不要把它暴露为模型工具，也不要把模型提供的路径传给它。`invoke('importSelectedBundle', ...)` 始终拒绝；模型入口 `invoke('install')` 仍只装内置固定原版，不能接收路径或 kind。取消文件选择时可用 `await host.invoke('status')` 获取脱敏状态。

`host.importSelectedBundle(sourcePath)` is a separate trusted desktop UI method for absolute paths returned by the OS file picker after owner authorization. It shares the same manager and checks `assertOpen`. Never expose it to models or forward model-supplied paths. It is deliberately absent from `invoke`; model-facing installation remains pinned to the bundled archive.

### 0.2.1 — SDK 导入后的授权复核

真实 SDK 的异步导入结束后、创建运行目录或启动 DSH 子进程之前，再次检查宿主授权。若导入期间操作被取消或权限撤销，启动会失败，不创建运行资料或启动插件。既有队列、持久化及控制请求前的授权复核保持不变。

Version 0.2.1 rechecks host authority after asynchronous SDK import, before runtime files or child startup. Revocation during import fails startup without creating runtime state or launching the plugin. The existing queue, persistence and control-request checks remain in place.

### 0.2.1 宿主实时状态通知

宿主在成功处理上述操作后，将同一份已脱敏的 `{ok:true,status}` 结果广播为 `magpie:changed`，preload提供 `onMagpieChanged(callback)`（返回取消订阅函数）。设置组件会更新服务状态和按钮，同时保留未保存的网关/密钥草稿；Agent修改后无需人手动刷新。广播只发给可信拥有者窗口，不暴露密钥，也不成为新的模型可调用IPC。
