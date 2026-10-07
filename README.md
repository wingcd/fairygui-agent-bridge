# fgui-agent-bridge

**English summary:** A FairyGUI editor plugin + CLI + MCP server that lets AI agents build and publish FairyGUI UI through official editor APIs. Works with the **free** editor — including publishing (verified: output is byte-identical to clicking Publish in the GUI).

让 AI（Claude / Cursor / ZCode / 任何 MCP 客户端，或裸 CLI / curl）直接操作 FairyGUI 编辑器制作 UI：

- **创建组件**、插入/删除舞台元件、改属性（走官方编辑器 API，支持撤销）
- **发布 UI 包**（产出与编辑器手动发布**逐字节一致**，实测 md5 相同）
- 读写组件 XML 源码、资源树查询、截图

FairyGUI 编辑器官方没有 MCP/对外 CLI（命令行 batchmode 发布是付费专业版功能），本项目用**编辑器插件**补上这一环，实测**免费版编辑器即可发布**。

## 架构

```
AI agent ──MCP(stdio)──┐
AI agent ──CLI─────────┼──► HTTP (localhost:7531) ──► FairyGUI 编辑器插件（官方 API）
你本人 ───curl─────────┘                                   │
                                                           ▼
                                              组件 XML / .bin / 图集（官方发布产物）
```

三层可独立使用：

| 层 | 位置 | 说明 |
|---|---|---|
| 编辑器插件 | `plugin/` | 装进 UI 工程的 `plugins/agent-bridge/`，在编辑器内起 localhost HTTP 服务，单线程帧驱动（不跨线程调 Unity API） |
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
curl -X POST http://localhost:7531/ -d "{\"cmd\":\"ping\"}"
```

**编辑器没开？一条命令拉起并等就绪**（AI 工作流入口）：

```bash
node cli/fgui.mjs ensure '{"project":"D:/work/my-ui-project"}'
# 编辑器路径：参数 editor 或环境变量 FGUI_EDITOR_EXE，否则探测常见安装位置
```

- `ensure`：桥不通就自动启动编辑器（加载 `.fairy` 工程）并轮询到 ping 就绪后返回；已在运行则直接返回
- `launch`：只启动不等就绪

**关于「无端/headless」**：编辑器命令行 `batchmode` 是**专业版**功能（免费版实测被 `CheckProLicense` 拦截），插件也必须活在编辑器进程里，因此完全无窗口在免费版做不到。替代方案：插件已设置 `Application.runInBackground=true`，编辑器**最小化/失焦也能正常服务**，接近无感运行。

端口默认 7531，改端口：在 `plugins/agent-bridge/` 下放一个 `port.txt`（内容如 `7900`），重启工程生效。

## 三种用法

**curl（任何语言 3 行代码对接）：**

```bash
curl -X POST http://localhost:7531/ -d "{\"cmd\":\"list_packages\"}"
curl -X POST http://localhost:7531/ -d "{\"cmd\":\"create_component\",\"args\":{\"pkg\":\"common\",\"name\":\"Demo\",\"width\":400,\"height\":300}}"
curl -X POST http://localhost:7531/ -d "{\"cmd\":\"publish\",\"args\":{\"pkg\":\"common\",\"out_path\":\"C:/tmp/out\"}}"
```

**CLI：**

```bash
node cli/fgui.mjs ping
node cli/fgui.mjs list-items '{"pkg":"common","depth":2}'
node cli/fgui.mjs set-property '{"pkg":"common","name":"Demo","target":"n0","props":{"title":"开始游戏"}}'
node cli/fgui.mjs publish '{"pkg":"common"}'
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

AI 的典型制作循环：`list_items` 找素材 → `read_component` 读组件 XML（拿到子对象名/id）→ `create_component` / `insert_object` / `set_property` 摆 UI → `publish` 出包 → 游戏侧加载验证。

## 命令参考

请求：`POST http://localhost:7531/`，body `{"cmd":"<命令>","args":{...}}`；响应 `{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`。

| 命令 | 参数 | 说明 |
|---|---|---|
| `ping` | — | 存活/版本检查 |
| `project_info` | — | 当前工程信息 |
| `list_packages` | — | 包列表（id/name/basePath） |
| `list_items` | `pkg`, `depth?` | 包内资源树（组件/图片/字体，id、路径、尺寸） |
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

## 同时编辑多个项目（多编辑器实例）

FairyGUI 一个编辑器实例只开一个工程；开多个编辑器窗口编辑多个工程时，本桥**自动区分**：

- 端口冲突自动递增：第一个实例占 7531，第二个自动用 7532，依此类推（可在各工程 `plugins/agent-bridge/port.txt` 固定指定）
- 每个实例启动时把 `{port, pid, project}` 注册到 `~/.fgui-agent-bridge/registry.json`，退出自动注销（含陈旧条目清理）
- `ping` / `project_info` 返回本实例端口与工程名，一眼核对连的是谁
- CLI：`node cli/fgui.mjs discover` 列出所有在线实例及其工程、端口
- 指定实例：CLI/MCP 设 `FGUI_BRIDGE_URL=http://localhost:7532/`

### 按请求选择工程（多项目推荐）

MCP 新增 `discover_projects`，返回每个在线窗口的工程绝对路径、端口和包名。所有编辑器工具都接受 `project`、`port` 或 `bridge_url`，无需修改 MCP 配置或重连即可操作不同窗口：

```text
discover_projects {}
publish {"project":"H:/games/Storm/fairygui","pkg":"StormRacing"}
read_component {"project":"H:/games/Other/fairygui","pkg":"Common","name":"Button"}
```

CLI 同样支持：`node cli/fgui.mjs publish '{"project":"H:/games/Storm/fairygui","pkg":"StormRacing"}'`。`project` 可以是目录、`.fairy` 文件或唯一工程名；同名工程必须用绝对路径区分。多个窗口在线却未指定目标时，返回明确错误，不会随便操作第一个窗口。环境变量仍兼容。

`ensure` / `launch` 会先核对目标工程，已有其他工程不能算目标已打开；新进程就绪后也只匹配目标。插件使用独立的 `~/.fgui-agent-bridge/instances/<pid>.json` 注册文件，避免多个窗口同时启动覆盖共享注册表。旧版本插件仍可通过 `registry.json` 发现；新项目复制最新 `plugin/main.js`。MCP 工具列表更新后需要重新连接一次客户端。

回归检查：`node scripts/test_instances.mjs`。真实多窗口编辑和发布还需以编辑器在线结果验收；编辑器自身启动崩溃与 HTTP 路由是不同问题。

## 已实测（免费版编辑器，端到端）

以下全部在免费版编辑器上通过（Windows，编辑器最小化后台运行）：

- `ensure` 启动器：CLI 拉起编辑器（自动解析 `.fairy` 工程文件）→ 约 3 秒桥就绪
- `list_packages` / `list_items`：包与资源树正确列出
- `create_component`：`CreateComponentItem`（Button 扩展）→ id/url/文件路径返回，package.xml 登记
- `set_property`：`title`/`titleFontSize`（扩展属性通道）、`size`（自动拆 width/height 通道）→ `read_component` XML 验证落盘
- `insert_object`：跨包引用插入舞台子对象（`n0`），`list_children` 可见
- `publish`：`PublishHandler` 发布成功（小包 ~165ms），产物与 GUI 手动发布 **md5 逐字节一致**；无专业版拦截
- `delete_item`：删除测试组件，工程 git 状态还原干净
- `discover`：多实例注册表（`~/.fgui-agent-bridge/registry.json`）列出端口/pid/工程名
- 命令行 `batchmode` 发布会被 `CheckProLicense` 挡（专业版功能）——本桥不经过 batchmode，不受影响

开发中踩过的坑（对二次开发有用）：编辑器 Unity 运行时裁掉了 `Encoding.UTF8.GetBytes(string)` 重载（用 `StreamWriter` 替代）；窗口最小化会暂停主循环（插件设 `runInBackground` 解决）；包对象懒加载（`getPkg` 统一 `EnsureOpen`）；`CreateComponentItem` 的 `path`/`extentionId` 未用时必须传 `null` 而非 `""`。

v0.1.1 追加（2026-10 实测）：

- **`OpenDocument` 不可靠**：本编辑器构建里 `App.docView.OpenDocument(url, true)` 静默返回 null、`OpenDocument(item)` 抛 "overload is striped by unity"——程序化开文档不通。`read_component` 是直接 `File.ReadAllText` 读盘上 XML，**不代表编辑器能打开该组件**（XML 非法如重复属性，编辑器双击仍会炸错误框；手写 XML 必须先 lint 重复属性）。
- **`screenshot` 的 `ScreenCapture` 系列也被裁**：且 Jint 里被裁方法可能暴露为 *truthy 但不可调用*，`typeof`/真值守卫拦不住，必须 try/catch 实调（已实现）。此构建下该命令明确报错，用 OS 级窗口截屏（PowerShell `PrintWindow`/`CopyFromScreen`）替代。
- **`launch`/`ensure` 新增 `args.args` 透传**：如 `{"project":"...","args":["-screen-width","1440","-screen-height","960"]}`；编辑器窗口尺寸 Unity 每帧自管，外部 `SetWindowPos` 无效，窗口畸形只能带参数重启解决。
- **手写 XML 的 8 位色坑**：`#RRGGBBAA` 运行时可能只取后 6 位（`#000000c8`→纯蓝 `(0,0,200)`），组件里用 6 位色 + `alpha="0.x"` 属性组合。

限制：编辑器需保持运行（可最小化）；仅监听 localhost，无鉴权（不要端口转发到公网）；一次执行一个命令（串行队列，AI 工作流够用）。

## 状态

v0.1.0 —— 核心链路已验证。计划中：transition/controller 编辑、图集级查询、预览渲染截图、发布进度流。

## License

MIT（见 [LICENSE](LICENSE)）。与 FairyGUI 官方无关联，插件通过官方公开插件 API 工作。
