# 对 DSH 的依赖与变更对照

这份文档只服务一件事：**DSH 升级时，能快速判断这个插件会不会坏、坏在哪、要改哪一行。**
每次对照请在更新后重新跑一遍文末的核对清单。

- 对照基线（本文档写就时实测通过的版本）：**@deepseek-ai/dsh 0.2.0-rc.2**，安装路径 `C:\Users\dongkid\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`。
- 插件的定位：**纯消费者**。它不修改 DSH 的任何文件，只调用公开服务与声明式接口。
- 唯一对 DSH 侧的"改造"发生在 **profile**，不在 DSH 本体（见第三节）。

## 一、依赖的 DSH 能力（按失败影响排序）

| # | 依赖 | 用到的具体接口 | 插件内位置 | 失效时表现 |
|---|---|---|---|---|
| 1 | 会话设置基础设施（相邻插件 dsh-session-settings） | 宿主服务 `ctx.sessionSettings.register(registration)`、`ctx.sessionSettings.getItem(pluginId, itemKey, sessionId)`（同步返回） | `lib/index.js` apply / text 回调 | **硬失败**：服务缺席时插件不激活（`inject: ['sessionSettings']`），设置页不会出现本项 |
| 2 | 同上，浏览器侧 | 客户端服务 `sessionSettings.registerRenderer(pluginId, itemKey, Component)` | `lib/client.js` apply | **降级**：注册失败只打日志，页面回落到内置控件（本插件依赖第 1 节"渲染器缺席保护"避免写坏数据） |
| 3 | 运行时上下文（dsh-system-prompt） | `ctx.inject(['systemPrompt'], scope => scope.systemPrompt.context({ name, order, text }))`；`text` 是**每个 step 都会求值**的同步函数 | `lib/index.js` | **降级**：服务缺席时静默不贡献，设置项照常工作，模型不再被通知 |
| 4 | 上下文排序表 | `order` 用裸数字 **118**（介于官方 `SANDBOX_POLICY=110`、`APPROVAL_POLICY=115`、`SUBAGENT_DELEGATION=120` 之间；该表在 dsh-system-prompt 内，外部插件无法注册新名字） | `lib/index.js` `CONTEXT_ORDER` | **语义漂移**：数字仍合法不会报错，但与其他贡献的相对顺序可能变化 |
| 5 | 会话对象 | `session.id`（取本会话的值）、`session.header.cwd`（判断某条目是否包含主工作区） | `lib/index.js` text 回调 | **硬失败/错话**：字段改名会让 text 抛错或措辞失真 |
| 6 | 权限档（dsh-sandbox-policy，可选） | `ctx.get('sandboxPolicy').resolve({ session }).mode`，取值 `read-only` / `workspace-write` / `danger-full-access` | `lib/index.js` `permissionMode()` | **降级**：读不到时提醒里改用"取决于当前权限档"的中性措辞 |
| 7 | 权限语义（dsh-sandbox） | 事实前提：`workspace-write` 的可写根 = 会话 cwd + `/tmp` + `os.tmpdir()`；**读取不受限制**；`read-only` 无可写根 | `lib/rules.js` `CAPABILITY` 文案 | **说假话**：如果 DSH 改了可写根语义，提醒会与 `sandbox:policy` 段矛盾 |
| 8 | 客户端模块系统（dsh-client-modules） | `window.__ModuleLoader__.load({ id, factory })`；`factory(require)` 只允许基线模块（本插件只用 `react`） | `lib/client.js` 文件头与尾部 | **硬失败**：模块装载不上，页面看不到本控件（其它插件不受影响） |
| 9 | 插件清单声明 | `dsh.manifestVersion`、`dsh.bundle.patch`、`dsh.client.platform='web'`、`dsh.client.inject`、`exports['./client']` | `package.json` | **硬失败**：声明不合法会让**整张客户端模块表**装载失败（同一个宿主进程里的所有客户端插件一起消失） |
| 10 | 目录选择器（dsh-client-ui-workspace + dsh-api-workspace-controller） | `ctx.get('uiWorkspace').pickDirectory()`；`listDirectory(path)`；错误码 `directory-picker/unreadable` / `directory-picker/unavailable`（读 `error.rpcError.code`） | `lib/client.js` | **降级**：选择器缺席时给出提示；错误码改名会让"读不到"的标注不再出现（不会再误报） |
| 11 | 语言服务（dsh-client-locale） | `ctx.get('locale').getLocale().active`、`locale.subscribe(listener)` | `lib/client.js` | **降级**：读不到时按 `navigator.language` 回退 |
| 12 | 视觉主题 | 只用 `var(--dsw-alias-*, fallback)` 语义令牌 | `lib/client.js` `STYLES` | **外观**：令牌改名会退化成 fallback 颜色 |

## 二、依赖的相邻插件

- **dsh-session-settings**：既提供注册通道（宿主 + 客户端服务），也是本插件在设置页里的唯一宿主。本插件依赖它的 **protocol v1**（`registrations.list` / `values.get` / `values.set` / `values.reset`）与"一项的值可以是任意 JSON"这一事实——清单就用一个 `stringList` 项装下了对象数组。
- 没有其它相邻插件依赖。

## 三、对 DSH 做出的变更

**DSH 本体：零改动。** 没有补丁、没有替换官方行、没有改任何官方文件。

插件只做**增量注册**：

| 注册了什么 | 通过什么 | 影响面 |
|---|---|---|
| 一个会话设置声明项（pluginId `dsh-extra-workspaces`，item `workspaces`，`type: stringList`，default `[]`） | `ctx.sessionSettings.register`（包在 `ctx.effect` 里，可卸载） | 只在设置页多出一节 |
| 一段运行时上下文文本 | `scope.systemPrompt.context({name, order: 118, text})` | 只在有额外工作区时进入最新上下文，且**内容不变不会重复注入** |
| 一个自定义渲染器 | 客户端 `sessionSettings.registerRenderer` | 只替换该项的控件 |

**唯一落在 DSH 周边的是 profile**（`~/.dsh/profiles/web/`）：

```jsonc
// package.json
"dependencies":   { "dsh-extra-workspaces": "link:D:/projects/dsh-plugins/dsh-extra-workspaces" },
"dsh.profile.bundles": [ /* … , */ "dsh-extra-workspaces" ]
```

删除插件 = 从这两处移除，DSH 本体不受影响。

## 四、升级 DSH 后要跑的核对清单

1. `node --test "tests/**/*.spec.mjs"`（当前 30 例）——纯函数与注册形状。
2. 活体确认注册真的被收下（需要 DSH 在跑）：
   ```powershell
   (Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3080/session-settings/api/registrations.list' -Body '{}' -ContentType 'application/json').value.registrations | ConvertTo-Json -Depth 6
   ```
   期望看到 `pluginId: dsh-extra-workspaces`、`items[0].key: workspaces`、`type: stringList`。
3. 在界面里添加一个工作区，确认下一轮对话里出现提醒（应有条目、作用域说明、以及与本会话权限档一致的措辞）。
4. 若界面出现"没有可用的查看方式"，先 **Ctrl+Shift+R** 硬刷新——客户端模块换了版本号后，普通刷新可能还拿着旧清单。
5. 对照第 1 节逐行检查：`sessionSettings` 的方法签名、`systemPrompt.context` 的 `order`/`text` 契约、`session.header.cwd`、`sandboxPolicy.resolve().mode`、`uiWorkspace` 的两个方法与错误码、`dsh.client` 四个字段。

## 五、已知脆弱点（升级时优先看）

1. **`order: 118` 是自选数字**：官方排序表不接受外部注册，只能占位。若 DSH 调整了 110/115/120 的间距或含义，需要重新确认这个位置。
2. **客户端错误码**：`directory-picker/unreadable` 是字符串契约，改名后"读不到"的标注会静默消失（不会误报，属于安全方向的降级）。
3. **`existsSync` 一律不得回到请求路径**：曾经在这里做过一次目录存在性探测，导致网络路径不可达时**整个 DSH 进程同步阻塞约 21 秒**（网络盘、UNC、VPN 断连都会触发）。这是本插件最重要的一条设计红线，改动前请先读 `docs/faq.md`（若有）或本次修复记录：**提醒文本不得做任何阻塞式系统调用**。
4. **值形状是约定而非校验**：`workspaces` 的值是对象数组，靠本插件两侧自行规范化（`lib/rules.js` 的 `normalizeEntries` 与 `lib/client.js` 的镜像规则）。
