# fgui-agent-bridge

**English summary:** A FairyGUI editor plugin + CLI + MCP server that lets AI agents build and publish FairyGUI UI through official editor APIs. Works with the **free** editor — including publishing (verified: output is byte-identical to clicking Publish in the GUI).

让 AI（Claude / Cursor / ZCode / 任何 MCP 客户端，或 CLI）直接操作 FairyGUI 编辑器制作 UI：

- **创建组件**、插入/删除舞台元件、改属性（走官方编辑器 API，支持撤销）
- **发布 UI 包**（产出与编辑器手动发布**逐字节一致**，实测 md5 相同）
- 读写组件 XML 源码、资源树查询、截图

FairyGUI 编辑器官方没有 MCP/对外 CLI（命令行 batchmode 发布是付费专业版功能），本项目用**编辑器插件**补上这一环，实测**免费版编辑器即可发布**。

## 独立 Node 服务（无需打开编辑器）

`standalone-node/` 提供正在完善的独立 CLI 和 MCP 服务。**一个服务可以操作多个项目**：每次调用都传入 `project`，指向项目目录或 `.fairy` 文件。

```powershell
cd standalone-node
npm ci
node http-server.mjs --port 7532
```

JSON-RPC 地址为 `http://127.0.0.1:7532/rpc`，MCP Streamable HTTP 地址为 `http://127.0.0.1:7532/mcp`；也可用 `node mcp-server.mjs` 启动 stdio MCP。CLI 示例：

```powershell
node fgui.mjs list_packages '{"project":"D:/work/my-ui-project"}'
```

启动服务后，访问 `http://127.0.0.1:7532/viewer` 可选择项目、包和组件，
通过 FairyGUI Pixi 运行时预览并截图；无需打开编辑器。逐个检查项目中已注册
组件能否截图，可在 `standalone-node` 目录运行：

```powershell
node audit-screenshots.mjs D:/work/my-ui-project
```

默认逐个检查；可添加 `--concurrency=2` 并行检查（支持 1–4，会增加资源占用）。并行时结果按完成顺序输出。
检查结果逐行输出 JSON，失败时返回非零退出码。截图使用的 Pixi 预览仍有
功能与排版限制，生成图片不等同于验证与编辑器逐像素一致。

服务支持项目和组件读写、资源导入、校验、图集及实验性发布。项目级发布和预检默认按导出资源及跨包依赖处理；设置 `exported_only: false` 可包含全部已注册资源。写操作使用读取结果中的 `sha256` 防止覆盖过期版本。16 个 Cocos 样例的筛选发布结果已经过编辑器数据和图集像素对比；并非全部编辑器功能和运行时渲染均已验证。完整用法、限制和测试命令见 [独立服务说明](standalone-node/README.md)。Python 实现仍保留在 `standalone/`。

## 架构

```
AI agent ──MCP(stdio)──┐
AI agent ──CLI─────────┼──► 本地文件队列 ──► FairyGUI 编辑器插件（官方 API）
你本人 ───CLI──────────┘                                   │
                                                           ▼
                                              组件 XML / .bin / 图集（官方发布产物）
```

三层可独立使用：

| 层 | 位置 | 说明 |
|---|---|---|
| 编辑器插件 | `plugin/` | 装进 UI 工程的 `plugins/agent-bridge/`，通过本地文件队列通信，编辑器单线程帧驱动（不跨线程调 Unity API） |
| CLI | `cli/fgui.mjs` | 零依赖 Node 18+，`node cli/fgui.mjs <cmd> '<json>'` |
| MCP server | `mcp/server.mjs` | 零依赖 stdio MCP，每个命令注册为一个 tool |

## 安装

前置：FairyGUI 编辑器（Windows/Mac 均可，免费版即可）+ Node 18+（仅 CLI/MCP 层需要）。

```bash
# 1. 把插件装进你的 UI 工程（含 .fairy 文件的目录）
scripts/install.bat D:\work\my-ui-project     # Windows
scripts/install.sh  /d/work/my-ui-project     # macOS / Linux

# 2. 用编辑器打开该工程（插件随工程加载，日志见 plugins/agent-bridge/bridge.log）

# 3. 验证
node cli/fgui.mjs ping
```

**插件升级（推荐）**：本仓库提供一条命令把 `plugin/` 铺到所有受管工程——工程清单存放在**用户目录** `~/.fgui-agent-bridge/projects.json`（不进 git，每人各自维护）。Windows 环境中还可能存在 `%APPDATA%/FairyGUI-Editor/plugins/agent-bridge`；排查重复加载时须同时核对全局和工程目录，迁移前保留备份，不要静默删除：

```bash
node cli/fgui.mjs sync-plugins '{"add":"D:/work/my-ui-project"}'   # 纳管一个工程
node cli/fgui.mjs sync-plugins                                       # 升级所有纳管工程
```

**编辑器没开？一条命令拉起并等就绪**（AI 工作流入口）：

```bash
node cli/fgui.mjs ensure '{"project":"D:/work/my-ui-project"}'
# 编辑器路径：参数 editor 或环境变量 FGUI_EDITOR_EXE，否则探测常见安装位置
```

- `ensure`：桥不通就自动启动编辑器（加载 `.fairy` 工程）并轮询到 ping 就绪后返回；已在运行则直接返回
- `launch`：只启动不等就绪

**关于「无端/headless」**：编辑器命令行 `batchmode` 是**专业版**功能（免费版实测被 `CheckProLicense` 拦截），插件也必须活在编辑器进程里，因此完全无窗口在免费版做不到。插件尝试设置 `Application.runInBackground=true`；这不能保证最小化后仍可响应，实际使用应以 `ping` 验证，遇到最小化后超时先恢复窗口排查。

每个编辑器实例使用独立的本地文件队列，不再监听 HTTP 端口。CLI 和 MCP 自动发现实例；旧版 HTTP 插件仍可通过 `bridge_url` 或 `port` 访问。升级工程插件后请重新打开工程，并重启 MCP 客户端。

## 使用方式

**CLI：**

```bash
node cli/fgui.mjs ping
node cli/fgui.mjs list-items '{"pkg":"common","depth":2}'
node cli/fgui.mjs set-property '{"pkg":"common","name":"Demo","target":"n0","props":{"title":"开始游戏"}}'
node cli/fgui.mjs publish '{"pkg":"common"}'
node cli/fgui.mjs lint '{"project":"D:/work/my-ui"}'   # STANDARDS 静态检查（本地跑，编辑器不用开）
```

**MCP（推荐给 AI 客户端）：**

```json
{
  "mcpServers": {
    "fgui": {
      "command": "node",
      "args": ["C:/path/to/fgui-agent-bridge/mcp/server.mjs"]
    }
  }
}
```

AI 的典型制作循环：`list_items` 找素材 → `read_component` 读组件 XML（拿到子对象名/id）→ `create_component` / `insert_object` / `set_property` 摆 UI → `lint` 静态自查（引用悬空/缺 exported/不必要嵌套/磁盘孤儿/文本溢出/翻译表对账等 27 项，见 STANDARDS.md）→ `publish` 出包 → 游戏侧加载验证。

## 命令参考

通过 CLI 或 MCP 发送命令；响应 `{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`。

| 命令 | 参数 | 说明 |
|---|---|---|
| `ping` | — | 存活/版本检查 |
| `project_info` | — | 当前工程信息 |
| `list_packages` | — | 包列表（id/name/basePath） |
| `operation_status` | 无 | 查询桥接队列当前操作、是否发布中及排队操作；可在发布期间调用 |
| `list_items` | `pkg`, `depth?` | 包内资源树（组件/图片/字体，id、路径、尺寸） |
| `export_strings` | `file?` | 导出多语言字符串 XML（官方 ExportStringsHandler，TranslationHelper 格式；`file` 缺省为工程根 strings.xml） |
| `import_strings` | `file` | 导入字符串 XML 到工程组件（官方 ImportStringsHandler，文本直接写入组件 XML 并保存；用于编辑器内预览译文，检查完导入原语言 XML 还原） |
| `read_component` | `pkg`, `name` | 组件 XML 源码（编辑前先读，了解子对象命名） |
| `create_component` | `pkg`, `name`, `width`, `height`, `path?`, `extention?`, `exported?` | 新建组件；`extention` 可为 Button/Label/ProgressBar/Slider/ComboBox/List/Tree 等 |
| `delete_item` | `pkg`, `name` | 删除资源（慎用） |
| `open_doc` / `close_doc` | `pkg`, `name` | 打开/关闭组件文档 |
| `list_children` | `pkg`, `name` | 舞台子对象列表 |
| `insert_object` | `pkg`, `name`, `url` 或 `ref_pkg`+`ref_name`, `x?`, `y?`, `index?`, `props?` | 插入库内元件（组件/图片等）到舞台 |
| `set_property` | `pkg`, `name`, `target?`, `props` | 改属性（官方 API，可撤销）；`target` 支持 `a/b` 路径，缺省为组件根 |
| `remove_object` | `pkg`, `name`, `target` | 删除舞台子对象 |
| `save_all` / `refresh` | — | 保存全部 / 刷新工程视图 |
| `publish` | `pkg`, `out_path?`, `branch?`, `timeout_ms?` | 发布包；`out_path` 缺省用工程发布设置。异步，完成才返回 |
| `screenshot` | `path` | 截图编辑器窗口（png 绝对路径） |
| `bridge_log` | `tail?` | 插件日志尾部（排障） |

属性名与编辑器属性面板/XML 属性一致（`xy`/`size`/`title`/`text`/`icon`/`fontSize`/`visible`/`pivot`/`anchor`…），向量值用 `"x,y"` 字符串形式。参考：编辑器插件 API 的权威定义见官方仓库 [fairygui/FairyGUI-Editor](https://github.com/fairygui/FairyGUI-Editor) 的 `plugin/TsAPI/editor.d.ts`（许可证未标明，故本仓库不复制该文件）。

**本地命令（不经编辑器）**：`lint`——`node cli/fgui.mjs lint '{"project":"<工程根>"}'`（MCP 同名工具），跑 `scripts/lint_components.mjs` 的 27 项 STANDARDS 检查：✗ 阻断（引用悬空含 icon/titleIcon/sound/font、缺 exported、死登记、发明标签、包 id 位数、九宫格越界/压角…）退出码 1；⚠ 提醒（命名、单件转发层、磁盘孤儿、单选未关联 controller、全屏贴底漏绑、文本 autoSize 未声明/非法值/静态现溢出…）不阻断；工程根或 export/ 下发现 `strings.xml` + `strings_语种.xml` 时自动对账翻译表（键覆盖/`{{模板}}`与 UBB 修饰一致/未翻，检查 25~27，STANDARDS §7，也可独立跑 `node scripts/lint_strings.mjs 源.xml 译文.xml…`）。上表编辑器命令不含 lint——它是磁盘审计，不需要编辑器在线。

## 同时编辑多个项目（多编辑器实例）

FairyGUI 一个编辑器实例只开一个工程；开多个编辑器窗口编辑多个工程时，本桥**自动区分**：

- 每个实例注册独立随机 ID 和工程路径，拥有自己的请求、响应目录；CLI 并发请求使用独立 ID，编辑器串行执行。
- `node cli/fgui.mjs discover` 列出可响应的实例。使用绝对工程路径选择目标，多个同路径实例会返回歧义错误。
- 客户端超时后尚未执行的请求会被丢弃；已经开始执行的操作可能仍会完成，避免盲目重试写操作。

### 按请求选择工程（多项目推荐）

MCP 新增 `discover_projects`，返回每个在线窗口的工程绝对路径、队列地址和包名。所有编辑器工具都接受 `project` 或 `bridge_url`（`port` 仅兼容旧 HTTP 插件），无需修改 MCP 配置或重连即可操作不同窗口：

```text
discover_projects {}
publish {"project":"H:/games/Storm/fairygui","pkg":"StormRacing"}
read_component {"project":"H:/games/Other/fairygui","pkg":"Common","name":"Button"}
```

CLI 同样支持：`node cli/fgui.mjs publish '{"project":"H:/games/Storm/fairygui","pkg":"StormRacing"}'`。`project` 可以是目录、`.fairy` 文件或唯一工程名；同名工程必须用绝对路径区分。多个窗口在线却未指定目标时，返回明确错误，不会随便操作第一个窗口。环境变量仍兼容。

`ensure` / `launch` 会先核对目标工程，已有其他工程不能算目标已打开；新进程就绪后也只匹配目标。MCP 工具列表更新后需要重新连接一次客户端。默认显示编辑器窗口：Windows 下隐藏启动可能导致 Unity 在建窗前卡住；如需尝试隐藏可传 `visible:false`。

**编辑器约束**：插件不调用 `System.Diagnostics.Process`，以避免部分裁剪版编辑器发生原生崩溃；队列在帧循环中启动，避免工程打开回调重入。

回归检查：`node scripts/test_file_queue.mjs` 和 `node scripts/test_instances.mjs`。

## 设计分辨率缩放导出（1080×1920 → 750×1334 之类）

把按分辨率 A 制作的工程整体缩放成分辨率 B 的**副本工程**，再用本桥走官方发布得到目标分辨率的包（含按比例缩小的图片）。缩放发生在源工程副本上——不 patch 发布产物（图集坐标/.bin），图集重打包交给编辑器 publish。

```bash
node scripts/scale_project.mjs --src D:/work/my-ui --to 750x1334
# 可选：--from 1080x1920（默认从全屏组件自动探测）--res keep（保留高清只缩布局）
#        --out <dir> --packages a,b --port N --dry --force
# jpg 缩放需 sharp：npm i sharp 后 --sharp-dir <含 node_modules 的目录>（png 零依赖）

# 副本验收双闸（缩放完脚本也会打印这串）：
node scripts/lint_components.mjs D:/work/my-ui_scaled_750x1334
node cli/fgui.mjs launch '{"project":"D:/work/my-ui_scaled_750x1334","visible":true}'
node cli/fgui.mjs refresh '{}' && node cli/fgui.mjs list-items '{"pkg":"common"}'
node cli/fgui.mjs publish '{"pkg":"common"}'
```

缩什么、不缩什么、资源策略细则与实证数字见 STANDARDS.md §2.12。要点：统一按宽度单比例、永远从源一次转换（不嵌套转换）；副本携带 `scale-report.json`（含未分类属性上报，供规范演化）。已知边界：多语言分支目录（assets_zh 等）与 jta 内嵌贴图不缩放（脚本会告警）。

## 已实测（免费版编辑器，端到端）

以下全部在免费版编辑器上通过（Windows，编辑器最小化后台运行）：

- `ensure` 启动器：CLI 拉起编辑器（自动解析 `.fairy` 工程文件）→ 约 3 秒桥就绪
- `list_packages` / `list_items`：包与资源树正确列出
- `create_component`：`CreateComponentItem`（Button 扩展）→ id/url/文件路径返回，package.xml 登记
- `set_property`：`title`/`titleFontSize`（扩展属性通道）、`size`（自动拆 width/height 通道）→ `read_component` XML 验证落盘
- `insert_object`：跨包引用插入舞台子对象（`n0`），`list_children` 可见
- `publish`：`PublishHandler` 发布成功（小包 ~165ms），产物与 GUI 手动发布 **md5 逐字节一致**；无专业版拦截
- `delete_item`：删除测试组件，工程 git 状态还原干净
- `discover`：多实例注册表列出在线队列和工程名
- 命令行 `batchmode` 发布会被 `CheckProLicense` 挡（专业版功能）——本桥不经过 batchmode，不受影响

开发中踩过的坑（对二次开发有用）：编辑器 Unity 运行时裁掉了 `Encoding.UTF8.GetBytes(string)` 重载（用 `StreamWriter` 替代）；窗口最小化可能暂停请求处理（`runInBackground` 不能保证解决）；包对象懒加载（`getPkg` 统一 `EnsureOpen`）；`CreateComponentItem` 的 `path`/`extentionId` 未用时必须传 `null` 而非 `""`。

v0.1.1 追加（2026-10 实测）：

- **`OpenDocument` 不可靠**：本编辑器构建里 `App.docView.OpenDocument(url, true)` 静默返回 null、`OpenDocument(item)` 抛 "overload is striped by unity"——程序化开文档不通。`read_component` 是直接 `File.ReadAllText` 读盘上 XML，**不代表编辑器能打开该组件**（XML 非法如重复属性，编辑器双击仍会炸错误框；手写 XML 必须先 lint 重复属性）。
- **`screenshot` 的 `ScreenCapture` 系列也被裁**：且 Jint 里被裁方法可能暴露为 *truthy 但不可调用*，`typeof`/真值守卫拦不住，必须 try/catch 实调（已实现）。此构建下该命令明确报错，用 OS 级窗口截屏（PowerShell `PrintWindow`/`CopyFromScreen`）替代。
- **`launch`/`ensure` 新增 `args.args` 透传**：如 `{"project":"...","args":["-screen-width","1440","-screen-height","960"]}`；编辑器窗口尺寸 Unity 每帧自管，外部 `SetWindowPos` 无效，窗口畸形只能带参数重启解决。
- **手写 XML 的 8 位色坑**：`#RRGGBBAA` 运行时可能只取后 6 位（`#000000c8`→纯蓝 `(0,0,200)`），组件里用 6 位色 + `alpha="0.x"` 属性组合。

限制：编辑器需保持运行（可最小化）；本地用户可以访问队列文件；每个编辑器一次执行一个命令（串行队列）。

## 状态

v0.1.0 —— 核心链路已验证。计划中：transition/controller 编辑、图集级查询、预览渲染截图、发布进度流。

## License

MIT（见 [LICENSE](LICENSE)）。与 FairyGUI 官方无关联，插件通过官方公开插件 API 工作。

`operation_status`（CLI：`node cli/fgui.mjs operation-status`）返回 `busy`、`publishing`、`current`、`queuedCount` 和 `queue`；操作包含命令、包、组件、目标和等待时长。状态只覆盖本桥接实例；编辑器界面操作和其他插件的操作不在统计范围。同步操作在编辑器主线程执行，查询只能在其结束后处理。

协作编辑前调用 `acquire_lock`：组件锁传 `{"scope":"component","pkg":"包名","name":"组件名","owner":"调用方"}`；项目锁传 `{"scope":"project","owner":"调用方"}`。返回的 `token` 在后续命令中作为 `lock_token` 传入，完成后调用 `release_lock`（传 `lock_token`）。锁默认 5 分钟过期，可用 `lease_ms` 指定 1 秒至 1 小时。组件锁阻止其他调用方操作同一组件及发布；项目锁阻止其他写操作及发布。发布执行期间队列暂停，锁请求等待发布结束。未持锁的调用仍可操作未锁定资源；需要跨多个调用保持独占时，所有调用方须先取得锁。锁在桥重启或工程关闭时清除；编辑器界面、磁盘直接修改及其他插件不受锁约束。
