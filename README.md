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

## 已实测（免费版编辑器）

- `publish`：`PublishHandler` 发布成功（171ms，小包），产物与 GUI 手动发布 md5 **逐字节一致**；无专业版拦截
- 命令行 `batchmode` 发布会被 `CheckProLicense` 挡（专业版功能）——本桥不经过 batchmode，不受影响
- `create_component` / `insert_object` / `set_property`：走 `CreateComponentItem` / `Document.InsertObject` / `DocElement.SetProperty`，全部主线程执行、可撤销

限制：编辑器需保持打开（可最小化）；仅监听 localhost，无鉴权（不要端口转发到公网）；一次执行一个命令（串行队列，AI 工作流够用）。

## 状态

v0.1.0 —— 核心链路已验证。计划中：transition/controller 编辑、图集级查询、预览渲染截图、发布进度流。

## License

MIT（见 [LICENSE](LICENSE)）。与 FairyGUI 官方无关联，插件通过官方公开插件 API 工作。
