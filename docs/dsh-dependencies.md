# 对 DSH 的依赖与变更对照

这份文档只服务一件事：**DSH 升级时，能快速判断这个插件会不会坏、坏在哪、要改哪一行。**
每次对照请在更新后重新跑一遍文末的核对清单。

- 对照基线（本文档写就时实测通过的版本）：**@deepseek-ai/dsh 0.2.1-rc.2**，安装路径 `C:\Users\dongkid\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`。
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
| 8 | 客户端模块系统（dsh-client-modules） | `window.__ModuleLoader__.load({ id, factory })`；`factory(require)` 只允许平台模块表（本插件用 `react`；弹窗置顶层用 `react-dom` 的 `createPortal`，属平台内置，无需 `dsh.client.external`） | `lib/client.js` 文件头、`portalize()` 与尾部 | **硬失败**：模块装载不上，页面看不到本控件（其它插件不受影响）；`react-dom` 缺失时弹窗退回内联渲染（可能被设置卡片遮挡） |
| 9 | 插件清单声明 | `dsh.manifestVersion`、`dsh.bundle.patch`、`dsh.client.platform='web'`、`dsh.client.inject`、`exports['./client']` | `package.json` | **硬失败**：声明不合法会让**整张客户端模块表**装载失败（同一个宿主进程里的所有客户端插件一起消失） |
| 10 | 目录选择器（dsh-client-ui-workspace + dsh-api-workspace-controller） | `ctx.get('uiWorkspace')` 的 `pickDirectory()` / `listDirectory(path)` / `createDirectory(path, name)`；错误码 `directory-picker/unreadable` / `directory-picker/unavailable`（读 `error.rpcError.code`） | `lib/client.js` | **降级**：优先 `pickDirectory()`（系统弹窗）；被拒时跟随官方改用内置网页选择器（同一组 list/create 接口）；两者都不可用时给出提示。错误码改名会让"读不到"的标注不再出现（不会再误报） |
| 11 | 语言服务（dsh-client-locale） | `ctx.get('locale').getLocale().active`、`locale.subscribe(listener)` | `lib/client.js` | **降级**：读不到时按 `navigator.language` 回退 |
| 12 | 视觉主题 | 只用 `var(--dsw-alias-*, fallback)` 语义令牌 | `lib/client.js` `STYLES` | **外观**：令牌改名会退化成 fallback 颜色 |
| 13 | 页面样式注入（浏览器 DOM） | `document.head.appendChild(<style id="dsh-extra-workspaces-responsive">)`（已存在时就地更新）；CSS 自定义属性、`@media`、`env(safe-area-inset-*)`、`100dvh` | `lib/client.js` `ensureStyles()` | **降级**：注入失败或被 CSP 拦下时，弹窗仍用内联 fallback 尺寸与基础按钮样式（功能不受影响，只是没有悬停/焦点/自适应装饰） |
| 14 | 会话列表客户端服务（dsh-api-session-controller，**可选**） | `ctx.get('sessions').list` 的 `getSnapshot()` / `subscribe(fn)`；读 `byId[sessionId].cwd`，只用于推荐"同级目录" | `lib/client.js` `QuickAdd` / `sessionCwdOf` | **降级**：服务缺席或字段改名时不出现"同级目录"推荐，其余功能照常 |
| 15 | 工作区列表客户端服务（dsh-api-workspace-controller，**可选**） | `ctx.get('workspaces').list`；读 `items[].{ path, title, updatedAt }`，用于"推荐"和选择器"常用位置" | `lib/client.js` `QuickAdd` / `placesOf` | **降级**：服务缺席时"已有工作区"推荐与相应快捷位置不出现 |
| 16 | 浏览器本地存储 | `localStorage`：`dsh-extra-workspaces:history-v1`（最近使用，最多 20 条）、`dsh-extra-workspaces:last-browse-dir`（选择器上次目录） | `lib/client.js` `readHistory` / `writeHistory` / `readLastDir` | **降级**：存储被禁或写满时历史与"上次目录"失效，清单与提醒不受影响 |

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

1. `node --test "tests/**/*.spec.mjs"`（当前 51 例）——纯函数、注册形状、网页选择器回退、快速添加快捷项（历史/推荐/同级目录过滤）、选择器"常用位置"与重复/上限提示、置顶层渲染、固定表单位置与响应式注入。
2. 活体确认注册真的被收下（需要 DSH 在跑）：
   ```powershell
   (Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3080/session-settings/api/registrations.list' -Body '{}' -ContentType 'application/json').value.registrations | ConvertTo-Json -Depth 6
   ```
   期望看到 `pluginId: dsh-extra-workspaces`、`items[0].key: workspaces`、`type: stringList`。
3. 在界面里添加一个工作区，确认下一轮对话里出现提醒（应有条目、作用域说明、以及与本会话权限档一致的措辞）。再从 **快速添加** 点一个推荐项：应立即出现在清单里、计数 +1、在下一轮上下文里同样出现；把它移除后，它应出现在"最近使用"里，点一下能加回来，点它右侧的 × 只删历史、不写清单。
4. 若界面出现"没有可用的查看方式"，先 **Ctrl+Shift+R** 硬刷新——客户端模块换了版本号后，普通刷新可能还拿着旧清单。
5. 对照第 1 节逐行检查：`sessionSettings` 的方法签名、`systemPrompt.context` 的 `order`/`text` 契约、`session.header.cwd`、`sandboxPolicy.resolve().mode`、`uiWorkspace` 的三个方法与错误码、`dsh.client` 四个字段。
6. **带 `--trusted-host` 的部署专项核对**：点"添加工作区"应打开内置网页选择器（而不是"现在打不开目录选择器"的红色提示）；**弹窗应盖在会话设置卡片之上，底部按钮与卡片右下角的拖拽调高亮区都能正常点击**（弹窗经 `document.body` 的 react-dom portal 渲染并占用顶层 z-index）；路径栏旁应出现宿主真实盘符（C:、D:…，当前盘高亮），点一下能跳转；文件列表首行 `../` 可回上一级（根目录不显示）；"编辑路径"可直接输入 `D:\...`；关掉再开对话框应回到上次确认的目录。**"新建文件夹"的输入条出现在底栏上方固定区，长列表滚动时应仍可见且自动聚焦**；切换目录后列表回到顶部；Esc 关闭弹窗。底部"文件夹过多，仅显示开头部分。"固定在底栏上方状态条，只在单层超过 1000 个目录时出现。
8. **响应式专项**：把窗口缩到 640px 以内（或直接用手机/平板访问）时，弹窗应铺满视口（手机上去掉圆角）、行高与按钮变大、输入框 16px（防 iOS 聚焦缩放）、底栏按钮换行、底部留出 `safe-area` 安全区；点"新建文件夹"表单仍在底栏上方可见。
7. 若界面仍是旧行为：**Ctrl+Shift+R** 硬刷新；插件客户端模块按版本号缓存，版本已升到 0.4.1。选择器内应能看到"常用位置"一行、文件夹前的图标；把选择器切到已在清单里的目录时，"选择当前目录"应置灰并说明原因。

## 五、已知脆弱点（升级时优先看）

1. **`order: 118` 是自选数字**：官方排序表不接受外部注册，只能占位。若 DSH 调整了 110/115/120 的间距或含义，需要重新确认这个位置。
2. **客户端错误码**：`directory-picker/unreadable` 是字符串契约，改名后"读不到"的标注会静默消失（不会误报，属于安全方向的降级）。
   - **0.2.1 起的行为变化（重要）**：Host 的 `directory-picker-auto` 在 `allowsRemoteAuthorities` 为真时（即启动带了 `--trusted-host <非回环域名>`）强制组合 **browse** 后端，`pickDirectory()` 被拒（上游 commit `e31b85159a`）。本插件因此内置了网页选择器回退；若上游以后改回退的形态或错误码，检查这里。
3. **`existsSync` 一律不得回到请求路径**：曾经在这里做过一次目录存在性探测，导致网络路径不可达时**整个 DSH 进程同步阻塞约 21 秒**（网络盘、UNC、VPN 断连都会触发）。这是本插件最重要的一条设计红线，改动前请先读 `docs/faq.md`（若有）或本次修复记录：**提醒文本不得做任何阻塞式系统调用**。
4. **盘符探测是 26 个并发 browse listing**：每个盘根一次，仅 Windows 宿主、每次打开对话框后台触发一次（结果缓存 5 分钟，导航不重复探测），客户端 1.2s 后 abort；是否"探测成功"以宿主能列出该盘根为准。若上游改了 list 的 abort 语义，探测可能变慢或让 Host 更忙——此时优先检查 `dsh-host-directory-picker-browse`。
5. **值形状是约定而非校验**：`workspaces` 的值是对象数组，靠本插件两侧自行规范化（`lib/rules.js` 的 `normalizeEntries` 与 `lib/client.js` 的镜像规则）。
6. **两个客户端服务名与字段名**：`sessions`、`workspaces` 是可选的服务键；会话列表里用 `byId[id].cwd`，工作区列表里用 `items[].{ path, title, updatedAt }`。任一改名都只会让推荐少一块，不会报错或写坏数据；若要恢复该推荐，改 `lib/client.js` 的 `serviceList` / `sessionCwdOf` / `suggestionCandidates` 三处。
7. **历史存储是浏览器本地事实**：`dsh-extra-workspaces:history-v1` 记录的是 JSON 数组（`{ path, alias, note, updatedAt, source }`）。读到坏 JSON、非数组、空路径都按"没有历史"处理；升级改动这个形状时，换键名（`-v1` → `-v2`）即可安全弃用旧数据。
