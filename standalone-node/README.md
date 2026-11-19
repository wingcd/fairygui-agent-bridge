# FairyGUI 独立 Node 服务

[English](README.en.md) · [项目主页](../README.md)

通过 CLI 或 MCP 直接读写磁盘上的 FairyGUI 工程，导入资源，检查引用，规划图集，预览和截图，以及试验性地发布资源包。使用这些功能时无需打开 FairyGUI 编辑器。

## 安装与启动

需要 Node.js 20.19 或更新版本，推荐 Node.js 22 LTS。从 `standalone-node/` 目录启动服务。

```powershell
npm ci
node http-server.mjs --port 7532
```

- JSON-RPC 入口为 `http://127.0.0.1:7532/rpc`，MCP Streamable HTTP 入口为 `http://127.0.0.1:7532/mcp`。HTTP 服务只接受本机回环请求。
- 可以用 `node mcp-server.mjs` 启动 stdio MCP。一个服务可处理多个工程，每次工具调用都传入 `project`，值为工程目录或 `.fairy` 文件路径。
- 通过 MCP 的 `tools/list` 查看参数定义，用 `tools/call` 调用工具。服务会在执行前校验调用参数。

CLI 可直接接收 JSON 对象，也可通过 `@` 前缀读取 UTF-8 JSON 文件。文件可以带 BOM。将以下示例保存为 `args.json`，并把路径改成自己的工程。

```json
{"project":"D:/work/my-ui-project"}
```

```powershell
node fgui.mjs list_packages '@args.json'
```

## 编辑工程

先用 `read_component` 读取组件，编辑时把返回的 `sha256` 作为 `expected_sha256` 传入，避免覆盖其他调用方的新改动。Windows 上遇到临时性的文件替换失败时，最多重试 370 毫秒，每次重试都会重新检查版本和依赖。持续失败会返回错误。组件和包 XML 支持读取 UTF-8 和 UTF-16，写入时统一使用 UTF-8 并同步更新编码声明。写入前会拒绝 XML 禁用字符。`read_component` 也能返回格式有误的源 XML，便于用 `write_component` 修复，修复后的 XML 须通过结构和引用检查。

| 任务 | 工具与限制 |
| --- | --- |
| 组件属性 | `set_component_properties` 支持尺寸、不透明、遮罩、命中测试、溢出、边距和滚动配置。传 `null` 可清除遮罩、命中测试或滚动专用属性。 |
| 组件子对象 | `insert_object`、`move_object`、`remove_object` 编辑显示列表。新对象必须提供有效的 `xy`。如果对象仍被组件内其他内容引用，删除会失败。`insert_resource` 按名称或 ID 插入已登记资源，可选 `ref_pkg`、`object_name`、`x`、`y` 和从 0 开始的 `index`。 |
| 控制器 | `create_controller` 和 `set_controller_pages` 编辑控制器页，会检查修改是否造成页面引用失效。`set_controller_actions` 替换受支持的播放动效动作，并检查页面和动效引用。 |
| 动效 | `list_transitions` 返回动效、条目属性及组件 SHA-256。`upsert_transition` 从 XML 新建或替换受支持的动效。`remove_transition` 会检查本包和跨包的嵌套动效引用，有引用或扫描不完整时拒绝删除。扫描与写入期间持有服务的工程写锁。运行时动态引用和服务之外的写入需由调用方协调。 |
| 关联与 Gear | `set_relation`、`remove_relation`、`set_display_gear`、`set_display2_gear`、`remove_gear` 编辑子对象行为。文本、图标、颜色、位置、尺寸、外观、字号和动画也有对应的 `set_*_gear` 工具，可按控制器页面设置值。 |
| Button 和 Label | `set_button_options` 设置按钮模式、音效和按下效果。`set_button_instance_options` 和 `set_label_instance_options` 设置实例属性，支持跨包图标。 |
| ProgressBar 和 Slider | `set_progress_options` 和 `set_slider_options` 设置组件的标题显示模式及方向。`set_progress_instance_options` 和 `set_slider_instance_options` 设置实例的整数值、最小值和最大值。 |
| ComboBox | `set_combobox_options` 设置下拉组件的已登记 URL，支持跨包，传空字符串清除。`set_combobox_instance_options` 设置可见项数量和条目，图标可使用跨包 URL，省略的属性保留原值。 |
| 资源导入 | `import_image`、`import_sound`、`import_movieclip` 分别校验并登记 PNG/JPEG、WAV/MP3/OGG、JTA。`import_font` 登记受支持的位图字体，并检查字形图或纹理引用。 |

`set_properties` 和 `set_properties_batch` 支持图片填充与翻转、Loader 的 URL 与填充、MovieClip 的播放帧与播放状态，以及图形类型、颜色和几何属性。切换图形类型会清除不兼容的属性。位于原点的同包图片可用 `forHitTest` 开关像素命中测试，冲突的命中设置或不受支持的变换会导致操作失败。

- **列表和树**支持列表布局、选择模式、行列间距和数量、自动调整条目尺寸、自动清除、绘制顺序、点击滚动、折叠不可见条目、溢出和滚动方向、滚动条、边距、裁切柔化、默认条目 URL，以及页面和选择控制器。用 `scrollBarRes` 和 `ptrRes` 指定滚动条和下拉刷新资源对。清除滚动专用字段时传 `null`，从 `scroll` 切换为其他溢出模式时也适用。`set_list_items` 替换列表或树的条目，校验资源引用和树节点层级，并保留其他列表行为。
- **文本**支持描边和阴影，传 `null` 清除。输入框还支持提示文字、字符限制、长度、键盘类型和密码模式。
- **组**支持高级模式、布局、间距、排除不可见成员、自动尺寸和主网格索引。关闭高级模式后，组仅在编辑器中使用。用 `set_properties` 将 `group` 设为同级组 ID 以加入组，传 `null` 移除成员关系。组和成员都应是同一显示列表的同级对象，嵌套在 `<group>` 内的显示对象会校验失败。

### 导入生成器 XML

`adapt_generator_component` 接收 `project`、目标 `pkg` 和生成器输出的 `xml`，返回待审阅的 `xml`、变更列表 `changes`、转换假设 `assumptions` 和引用检查结果 `references_valid`、`reference_issues`。调用只生成建议稿。

工具将已登记的图片和组件 URL 解析为编辑器资源 ID，将嵌套的横向或纵向组展开为同级对象，并转换组内相对坐标。缺失坐标按尺寸和间距推算。组内文本显式声明的尺寸按固定尺寸处理，生成器的 `flow` 按 `flow_hz` 处理。资源缺失、引用歧义或无法推断布局时会报错。

审阅返回的假设后，用当前 SHA-256 调用 `write_component`，再运行 `validate`、`preflight_publish` 和 `screenshot` 检查写入结果。

### 本地化与引用

`export_strings` 提供实验性的 TranslationHelper 兼容 XML。可选 `output` 只创建新文件。已测试文本与提示、文本及组件实例的文本 Gear、Button 和 Label 标题、Label 提示、ComboBox 和列表标题、工具提示，以及 `inputtext` 和 `text input="true"` 的内容与提示。嵌套在组内的显示对象会报错。过滤规则遵循实测的编辑器行为。Cocos 样例与编辑器导出的 233 个键、值、标签、顺序和组件注释一致。将输出作为完整翻译目录前，应核对项目所用的本地化字段和过滤边界。

`find_references` 扫描已登记组件、受支持的 UI URL、工程设置和同包位图字体。`complete` 表示扫描是否完整，遇到不受支持的嵌套对象、多个显示列表、设置链接成环或无法读取等情况时会反映在结果中。扫描会跟随设置链接，范围限于静态引用。`unregister_resource` 需要当前包的 SHA-256，发现引用或扫描不完整时拒绝注销，资源源文件会保留。

## 校验、图集和发布

| 工具 | 用途 |
| --- | --- |
| `lint` | 运行项目规范检查，返回报告和校验状态。 |
| `validate` | 默认校验全部已登记资源，包括组件尺寸语法、列表布局、选择模式和滚动值。`exported_only: true` 将资源检查范围缩到导出资源及传递依赖，仍检查包结构和资源 ID。依赖闭包损坏时会报错，并回退到检查全部资源。 |
| `atlas_layout`、`atlas_export` | 计算图集排布、导出图集。 |
| `preflight_publish` | 对工程中的各包试运行实验性发布，汇总失败及依赖错误，结束后清理临时产物。若扫描期间已读取的工程元数据、设置或源文件发生变化，本次检查会失败。 |
| `publish_basic_experimental` | 发布单包的受支持组件和资源。`publish_simple_experimental` 是同一 Node 发布器的兼容命令名。 |
| `publish_project_experimental` | 将全部非空包和依赖清单写到临时目录，所有包及依赖均成功后才将目录移到目标位置。目标输出目录必须是新目录。 |
| `inspect_published`、`validate_published` | 查看和校验受支持的二进制包及编辑器 XML ZIP 包。 |

工程发布和预检默认处理导出资源及其传递的跨包依赖。设 `exported_only: false` 可包含全部已登记资源。跨包目标须在所属包中导出，或能从该包某个已导出资源到达，否则发布会失败。跨包子对象和 URL 引用会记录为依赖，运行时需一并加载依赖包。

### 实验性发布的支持范围

- **二进制组件**支持图片、MovieClip、嵌套组件、图形、文本、富文本、输入文本、列表和树，以及受支持的子对象变换。支持组件和子对象的关联、基础控制器和播放动效动作、常用 Gear 及补间设置、动效条目及补间路径。二进制包运行时的初始控制器状态由发布首页决定。
- **布局和交互数据**包括普通组和高级组，后者支持无布局、横向、纵向、间距、排除不可见成员、自动尺寸和主网格。组件支持枢轴、边距、滚动溢出、不透明选项、遮罩、子对象命中测试及受支持的图片像素命中测试。列表行列条目数用 `lineItemCount` 和 `lineItemCount2` 设置。编辑器会忽略源 XML 中的 `lineCount` 和 `colCount`。
- **资源与扩展组件**支持图片着色、翻转和填充、MovieClip 着色、基础 Loader、位图字体，以及 Loader 和组件实例图标 URL。支持 Label、Button、ComboBox、ProgressBar、Slider 和 ScrollBar 基础扩展，以及受支持的实例覆盖值、跨包下拉组件和同包按钮音效。
- **XML 包**支持图片（含平铺及九宫格）、WAV，以及由同包图片、基础文本和矩形构成的简单组件。超出范围的功能、资源类型以及 `compressDesc` 会报错。FairyGUI Cocos Creator 运行时要求 `binaryFormat: true`。其他可加载 XML 包的运行时尚待验证。
- **格式与压缩**可在发布或预检时用 `binary_format: true` 或 `false` 覆盖当前调用的包格式，无需修改 `Publish.json`。省略时使用工程设置。Cocos Creator 工程请求 `compressDesc: true` 时会警告并生成不压缩的二进制包，与实测编辑器行为一致。其他目标的压缩二进制输出尚不支持。

发布会拒绝不受支持的功能和循环组件引用。遇到未知 Gear 页面或缺失的动效目标时，发布器会按实测编辑器行为保留前者或跳过对应动效条目，并给出警告。Cocos 样例本身存在这些问题，例如 PullToRefresh 的 `Footer.xml` 和 Transition 的 `BOSS.xml`，全量校验还会在 HitTest 的 `component1.xml` 找到一处未解析的引用。因此，成功生成样例包时，也可能有需要修复的源引用。

### 校验发布产物

`validate_published` 检查图集和音频文件、媒体和精灵引用、组件子对象及控制器 ID、关联目标和类型、Gear 的控制器索引与设置、像素遮罩尺寸。用 `check_overlaps` 可检查精灵重叠，用 `compare_source` 可对比源图元数据和像素、源音频字节。像素对比忽略 ICC 配置和完全透明像素的 RGB 值。校验经过筛选的发布包时传 `exported_only: true`。

对于二进制包，`compare_components: true` 可对比组件属性、子对象及引用、变换、样式、控件扩展与实例覆盖值、列表和树、控制器及受支持的动作、Gear 和补间、关联，以及受支持的动效条目、值和路径。XML ZIP 包校验覆盖资源元数据、组件 XML 结构、精灵清单、动画帧和位图字形引用。运行时交互和最终画面需要通过实际运行验证。

## 组件预览与截图

启动 HTTP 服务后打开 `http://127.0.0.1:7532/viewer`，选择工程、包、组件和渲染器，即可截图。在界面中可切换 Pixi 预览的控制器页面并下载图片。

`screenshot` 支持 CLI 和两种 MCP 传输方式。MCP 返回 `image/png` 和 JSON 元数据，`output` 可省略。CLI 返回 JSON 元数据，须设置 `output`。提供输出路径时，目标 PNG 文件必须尚不存在。

将以下示例保存为 `screenshot.json`，按需修改工程、包、组件和输出路径。

```json
{
  "project": "D:/work/my-ui-project",
  "pkg": "MainMenu",
  "name": "Main",
  "output": "D:/work/main-preview.png",
  "width": 1000,
  "height": 700,
  "settle_ms": 0
}
```

```powershell
node fgui.mjs screenshot '@screenshot.json'
```

两种渲染器都会等待包资源、浏览器字体、配置的等待时间和两个动画帧。资源或字体加载超时会报错。应用自身的异步操作可能还需要额外的 `settle_ms`。

### Pixi（默认）

`renderer: "pixi"` 使用社区 FairyGUI PixiJS 运行时。服务会在常见位置查找 Chrome 和 Windows 上的 Edge，也可通过 `chrome` 参数或 `FGUI_CHROME` 选择浏览器。浏览器报告资源 HTTP 错误或未捕获的运行时错误时，截图会失败。

预览默认使用工程中控制器保存的 `selected` 页。在截图参数中加入以下字段即可切换状态，无需写入工程。

```json
{
  "controller_pages": {"state": "pageId"},
  "controller_overrides": [{"path": ["childId"], "controller": "state", "page": "pageId"}]
}
```

`path` 是从根组件到嵌套实例经过的显示列表子对象 ID。查看器可加载根组件及嵌套实例的控制器，最多 128 个实例。无效的控制器名、页面 ID 或重复覆盖会报错。缓存按所选状态区分。16 个 Cocos 样例主组件均有控制器树发现和初始截图检查。编辑器或 Cocos 运行时的文字与其他渲染细节可能与 Pixi 有差异。

| 功能 | 已支持的预览范围 |
| --- | --- |
| 组布局 | 支持成员尺寸固定的横向、纵向组。图片或图形成员通过 `gearSize` 或受支持的自动播放 `Size` 动效改变尺寸时会重新布局。有显式布局设置的组如果被关系引用，或成员自身带有关系，预览会报错。基础组可向成员传递可见性和位置。 |
| 文本 | 支持描边、阴影、实测的位图字体字形与着色。`inputtext` 和 `text input="true"` 按未聚焦状态渲染，支持密码遮蔽、纯文本和实测的带颜色提示。编辑器背景色和 `demoText` 仅在编辑器中显示。 |
| 富文本 | 支持纯文本、部分 UBB（粗体、斜体、下划线、颜色、字号、字体、链接、包内嵌图）和部分 HTML（上述样式、换行和包内图片）。其他 HTML、位图字体上的 UBB、有内容且限制尺寸的富文本会报错。 |
| 图片和图形 | 支持着色、水平和垂直翻转及组合、九宫格、平铺，以及默认填充起点的横向、纵向、90°、180°、360° 填充。支持椭圆、多边形、正多边形、统一整数圆角的矩形，以及图形遮罩。反向遮罩限于无边框和变换的静态矩形或椭圆。 |
| 基础变换 | 支持缩放、不透明度、可见性、小数角度旋转、嵌套组件枢轴和枢轴作为锚点。静态置灰使用 Pixi 灰度滤镜。 |
| MovieClip 和 Loader | 支持 JTA 动画预览帧、播放状态和着色。图片及组件 Loader 支持本包和跨包 UI URL、对齐和缩放。图片 Loader 支持着色和实测的填充方式。支持本包 MovieClip Loader、树条目的 MovieClip 图标。组件 Loader 着色和外部 URL 尚不支持。 |
| Gear 和控件 | 支持常用位置、尺寸、外观、文本、字号、颜色和描边 Gear，组合显示 Gear，以及 MovieClip 的帧切换。Loader 图标 Gear 接受图片或组件 URL 和空值。支持基础嵌套 Button、Label、ComboBox 初始条目标题，以及进度条实例值、默认值和非零最小值。 |
| 列表和树 | 支持由组件构成的静态行列、流式和实测的分页列表、间距、溢出裁切及滚动配置。含实测的自动垂直滚动条、`Common.json` 默认滚动条和下拉刷新。支持初始化展开状态、缩进、叶节点控制器和图标。截图查看器的范围限于这些状态。列表的裁切柔化按 Cocos 行为忽略，Button 条目支持非空标题和图标覆盖。 |
| 自动播放动效 | 支持实测的旋转、位置、不透明度、尺寸、缩放、颜色、可见性及动画帧条目，包括立即动作和补间、重复、往返、组件自身目标以及 Linear、Quad、Cubic、Quart、Quint、Sine、Circ、Expo、Back、Bounce、Elastic 缓动。暂存的预览包会省略非自动播放动效。 |

预览按所选组件及其依赖生成临时资源。跨包图片和组件的 `pkg` 可用包名或 ID，外部资源受导出范围限制，包名在临时数据中规范化。预览图集关闭裁切和旋转，以兼容旧版运行时的精灵偏移行为。支持横屏和竖屏。包内可带 MP3 和 Ogg 文件。音频播放和交互命中测试需在实际运行时验证。

通过 `reuse_screenshot: true` 可复用当前服务进程中的上一张匹配图片。Pixi 按输入内容判断缓存是否失效，相同输入的并发请求会合并。大文件分块读取计算指纹。缓存会跟随资源链接，遇到循环链接会报错。

Pixi 默认最多同时渲染 4 个任务，额外任务按到达顺序排队。可在启动服务前设 `FGUI_PIXI_CONCURRENCY` 为 1–4。`/health` 返回并发上限、渲染和排队数量，以及共享任务和调用方数量。HTTP 客户端断开后会退出队列，其他调用方仍在等待的共享任务继续排队。已开始的渲染可能继续完成，取消请求自身的输出文件不会写入。

### Cocos Creator

设 `renderer: "cocos"` 可用实际的 `fairygui-cc` 运行时截图。需要匹配样例结构的 Cocos Demo、编译好的 `fairygui-cc`（含 `package.json` 和 `dist/`）、Cocos Creator 3.8 和 Chrome。将以下字段加入截图参数，并按本机安装修改路径。

```json
{
  "renderer": "cocos",
  "demo": "E:/game_dev/FairyGUI-cocoscreator/demo",
  "distribution": "E:/game_dev/FairyGUI-cocoscreator/source",
  "creator": "C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe",
  "chrome": "C:/Program Files/Google/Chrome/Application/chrome.exe"
}
```

也可分别用 `FGUI_COCOS_DEMO`、`FGUI_COCOS_DISTRIBUTION`、`FGUI_COCOS_CREATOR` 和 `FGUI_CHROME` 设置默认值，显式参数优先。查看器中这些字段可留空。

每次新截图都会构建临时 Web Demo，并在网络请求趋于稳定后截图。发布器须能处理目标包及依赖包的导出资源。即使目标组件未导出也会纳入截图构建，跨包依赖仍须在其所属包导出，或能从其导出资源到达。截图包括组件默认位置和 Demo 背景，记录一个运行时状态。配置控制器页的覆盖参数目前仅用于 Pixi。

设置 `reuse_screenshot: true` 可在同一服务进程中复用匹配帧，跳过 Web 构建。仍会发布并计算资源、Demo、运行时、Creator 和浏览器的指纹。缓存最多保留 4 张各不超过 8 MiB 的图片，不接受符号链接输入。结果用 `cached` 标明是否命中。缓存沿用上一帧当时的动画进度、字体及运行环境，重启服务会清空缓存。

正在构建截图时，MCP 服务仍可处理其他独立请求。响应按 JSON-RPC ID 对应，可能乱序返回。可选的端到端截图测试会检查 stdio 和 Streamable HTTP 在 Cocos 构建期间是否能同时服务其他工程。

### 批量截图检查

```powershell
node audit-screenshots.mjs D:/work/my-ui-project
node audit-screenshots.mjs D:/work/my-ui-project --concurrency=2
```

逐个用 Pixi 截取所有已登记组件，按行输出 JSON 和汇总。任一截图失败时返回非零退出码。默认并发为 1，支持 1–4。并发时按完成顺序输出。该命令检查能否生成图片，像素一致性需另行对比。

## 测试与性能

在 `standalone-node/` 下运行 `npm test`。测试文件串行执行，避免浏览器和样例构建争抢资源。MCP 测试使用官方 SDK，通过 stdio 和 Streamable HTTP 验证多工程调用。

- 设置 `FGUI_SAMPLE_PROJECT` 可启用 Cocos 样例对比。编译后的 Cocos 读取器默认取自样例工程相对路径 `../../source/build`，也可用 `FGUI_COCOS_BUILD` 指定。测试用引擎桩读取包和组件数据。
- 设置 `FGUI_GENERATOR_TEMPLATES` 指向生成器的 `assets/templates`，执行 `node --test adapt-generator.test.mjs`。
- 设置 `FGUI_SCREENSHOT_CONFIG` 指向包含 Cocos 截图参数的 UTF-8 JSON 文件，省略 `output`，然后运行 `node --test screenshot.test.mjs`。测试会对比 MCP 返回的图片字节与保存的 PNG，需要本机 Creator 和 Chrome。
- 执行 `node benchmark-service.mjs PROJECT [PROJECT ...]`，用 4 个 worker 发出 100 次只读 `list_packages` 请求并报告吞吐量和延迟。可加 `--tool=project_info` 测量工程元数据读取。结果受主机负载和文件系统缓存影响，范围限于所选只读工具。

在 Windows 上重跑 Pixi 样例截图测试时，按本机安装修改工程和浏览器路径。

```powershell
$env:FGUI_SAMPLE_PROJECT = 'E:\game_dev\FairyGUI-cocoscreator\demo\UIProject'
$env:FGUI_CHROME = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node --test --test-name-pattern='PIXI renders.*(sample|initial state)' pixi-screenshot.test.mjs
```

这组测试涵盖 16 个样例主组件和部分其他组件，用于检查初始画面能否生成。

### 使用编辑器验证互操作

下列 Python 命令从仓库根目录运行，按实机替换 `PROJECT`、`EDITOR_EXE` 等参数。

| 命令 | 验证内容 |
| --- | --- |
| `python standalone-node/test_editor_roundtrip.py PROJECT EDITOR_EXE` | 复制到临时工程，创建带控制器、显示 Gear 和多边形的组件，每包修改一个已有组件，再由编辑器桥接打开。对比新发布的包数据和可见图集像素。有同级 Cocos 构建时也验证多边形数据读取。 |
| `python standalone-node/test_editor_reference.py PROJECT REFERENCE_DIR` | 对比既有编辑器发布产物的解析数据。 |
| `python standalone-node/test_editor_pixel_outputs.py PROJECT EDITOR_EXE --pattern` | 对比新发布包的解析数据及像素命中遮罩。 |
| `python standalone-node/test_editor_fresh.py PROJECT EDITOR_EXE` | 对比全部包的新发布数据及图片、动画帧、位图字体的可见图集像素，并用工程源数据检验编辑器产物。`FGUI_EDITOR_PACKAGES` 可指定逗号分隔的包名。 |
| `python standalone-node/test_editor_unicode_roundtrip.py PROJECT EDITOR_EXE` | 检查 Node 写入的 Unicode 分隔符在编辑器打开和导出多语言文本后是否保留。 |
| `python standalone-node/test_editor_cross_package.py PROJECT EDITOR_EXE` | 验证跨包编辑和发布。若有同级 Cocos 构建，还通过其读取器检查 MovieClip、Loader、ComboBox、ProgressBar 和 Slider 的跨包属性。 |
| `python standalone-node/test_editor_generator.py TEMPLATE_DIR EDITOR_EXE` | 在临时工程中打开适配后的所有生成器模板，并对比编辑器发布数据。 |

### 使用 Cocos Web 运行时验证

需要 Cocos Creator 3.8、Chrome、Python Playwright、Pillow 和编译好的 `fairygui-cc`。从仓库根目录运行探针。

```powershell
python standalone-node/cocos_runtime_probe.py --demo E:/game_dev/FairyGUI-cocoscreator/demo --distribution E:/game_dev/FairyGUI-cocoscreator/source --creator C:/ProgramData/Cocos/editors/Creator/3.8.4/CocosCreator.exe --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' --compare-reference --compare-controller-states --settle-ms 0
```

脚本构建临时 Demo，将初始截图和控制器状态树与样例既有的编辑器发布数据比较。报告包含 Creator 退出码和构建诊断。退出码 36 只有在构建报告成功、Web 入口存在、所有错误日志均为已知的 Babel 大文件优化提示时才视为成功。交互和动效的全面覆盖需另行验证。

另有 [Python 独立实现](../standalone/README.md)。
