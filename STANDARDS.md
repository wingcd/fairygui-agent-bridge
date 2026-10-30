# FairyGUI UI 制作规范（agent 强制）

> 面向 AI/自动化手写 FairyGUI 工程的场景。违反任何一条 ✗ 项都会在编辑器或运行时炸出真实事故（每条规矩背后都是一次踩坑）。配套机器检查（编辑器不用开）：`node scripts/lint_components.mjs <工程根>`，或 `node cli/fgui.mjs lint '{"project":"<工程根>"}'` / MCP `lint` 工具；预提交/发布前必跑。

## 1. 目录规范（按功能分文件夹）

```
assets/<pkg>/
  package.xml            # 资源登记（id/name/path）
  components/
    common/              # 跨页面复用件：WideButton / TabButton / PanelFrame / BottomNav …
    stash/               # 背包页：Stash / OrbCell / OrbDetail / UnlockSlot
    shop/                # 商店页：Shop / ShopItemCell …
    stats/               # 统计页
  images/
    bg/ frames/ orbs/ slots/ buttons/ nav/ …   # 图片同样按用途分组
```

- package.xml 的 `path` 与物理目录一致（`path="/components/shop/"`）。
- 新建页面先建文件夹，禁止把所有组件平铺在 components/ 根下——不然后面没法按功能优化和修改。
- 目录分组是**组织规范**，不是加载前提：根目录平铺（`path="/"`）编辑器完全合法（生产工程就有平铺登记正常加载）。**编辑器整包报错先查包 id 位数（§2.8），别折腾目录布局。**

## 2. 组件化纪律

- **禁止把所有资源塞进一个组件**：一个组件只承担一个职责——一个页面、一个复用件或一个 cell。把全部图片、全部页面、全部状态堆进一个 XML 的后果：没法按功能复用和修改、优化无从下手、加载/发布体积失控、编辑器打开卡顿。资源分层放：图片进 `images/` 按用途分组，组件按功能建文件夹（见 §1），页面之间靠引用组合，不靠"全塞一起"。
- **复用件一律抽组件放 `common/`**：按钮（底图+文字）、面板框（九宫格底+内阴影）、标签页、底栏、货币条……第二次出现就必须抽。
- **页面组件只做布局装配**：引用 common 件 + 页面私有件，不放重复的裸 image+text 组合。
- 单组件显示对象建议 ≤ 80 个（超过说明该拆 cell/子组件，lint ⚠ 提醒）。
- 动态重复结构（背包格子、商店卡片）用 `list`（`layout="flow_hz"` + `defaultItem`）+ 独立 cell 组件，禁止在页面里平铺 N 份（同构行的指纹判定与 lint 检查看 §2.11）。
- 子对象用语义名（`btnHome`/`capText`），禁止裸 `n0/n1`；扩展件遵守内置名约定（Button 的 `title`/`icon`）。

## 2.5 引擎自带能力（禁止手搓实现）

FairyGUI 编辑器/运行时已内置的能力**直接用配置表达**，禁止用图片裁剪、复制节点、外部代码模拟：

| 要用 | 内置做法 | 禁止的手搓 |
|---|---|---|
| **九宫格拉伸** | package.xml `<image … scale="9grid" scale9grid="x,y,w,h"/>`（编辑器属性面板「九宫格」），边角不糊地拉伸面板/按钮——**适用范围与切法限制见 §2.7** | ❌ 切图/裁剪出多张图拼；❌ 生成多尺寸变体 png |
| 图标缩放进框 | GLoader `fill`：`scale`（填满）/`scaleMatchWidth/Height`（按边适配）/`scaleNoBorder`（保比例裁边覆盖） | ❌ 预裁剪图片；❌ 放大 loader 让图"看起来合适"（超框事故根源） |
| 图片变色/半透明 | image `color="#RRGGBB"` + `alpha`（运行时着色） | ❌ 生成染色后的图片副本 |
| 响应式布局 | `<relation sidePair="width-width,height-height"/>` 等关系（全屏页面的分层绑定与成组见 §2.14） | ❌ 代码里逐节点重排坐标 |
| 多状态切换（选中/未选、页签、分页） | controller + `gearDisplay/gearXY/gearSize/gearText`；单选是 Button `mode="Radio"` 皮肤 + **使用方实例关联 controller**（§2.13，不是靠 group 分组） | ❌ 同一位置叠 N 份节点靠 visible 切 |
| 列表/网格/瀑布 | GList：`layout="flow_hz/flow_vt"` + `defaultItem` + `itemRenderer` + 虚拟列表 `setVirtual/numItems` | ❌ 在页面组件里平铺 N 个 cell；❌ 自制滚动 |
| 滚动区 | 容器 `overflow="scroll"`（ScrollPane） | ❌ 自写滚动/裁剪 |
| 动效 | Transition（编辑器时间轴 + label/hook） | ❌ 代码逐帧驱动补间 |
| 按钮按压反馈 | `<Button downEffect="scale" downEffectValue=".97"/>` | ❌ 手写缩放动画 |
| 文本描边/阴影 | text `stroke`/`shadowColor` 等属性 | ❌ 叠多层文本模拟 |
| 旋转/翻转/锚点 | `pivot`/`rotation`/`skew` | ❌ 预旋转图片 |
| 简单色块/几何 | GGraph | ❌ 1x1 png 拉伸 |
| 置灰/禁用 | GObject `grayed` | ❌ 换灰度图副本 |

> 判断标准：想动图片本身（裁/染/缩/切）之前，先查引擎有没有配置项——有就必须用配置。九宫格是重灾区：任何"把图切一下"的念头都先去 package.xml 写 `scale9grid`。

## 2.6 类型白名单（创建前先选型，禁止发明类型）

**动手创建任何对象之前，先判断它对应 FairyGUI 支持的哪一种类型，按支持的类型创建。** FairyGUI 的对象类型是封闭集合——不在集合内的标签编辑器不认识，轻则解析丢对象，重则整个组件打不开。依据：官方编辑器自身工程（FairyGUI-Editor 仓库 288 个 XML）全量普查 + 官方 demo 交叉验证。

**displayList 里能放的显示对象标签只有 10 种：**

| 标签 | 类型 | 用途 / 备注 |
|---|---|---|
| `image` | GImage | 静态图集图片（`src=` 指向 package.xml 登记的图） |
| `graph` | GGraph | 几何色块/占位框/命中区 |
| `loader` | GLoader | 运行时动态加载（图标/头像/跨包内容） |
| `loader3D` | GLoader3D | 3D/骨骼内容（Spine、DragonBones） |
| `text` | GTextField | 文本；**加 `input="true"` 即输入框**（配 `prompt`/`maxLength`） |
| `richtext` | GRichTextField | 富文本（UBB/链接/内嵌图） |
| `list` | GList | 列表（内联 `item` 子项 + `defaultItem`） |
| `component` | GComponent | 引用其他组件资源（`src=`） |
| `jta` | GMovieClip | 序列帧动画（资源文件就是 .jta） |
| `group` | GGroup | 组（虚拟容器，整体移动/显隐） |

**高频发明错误（标签根本不存在，✗ lint 拦截）：**

| 想要的 | 正确写法 | ❌ 错误发明 |
|---|---|---|
| 输入框 | `<text input="true" prompt="请输入"/>` | `<inputtext>`（ObjectType 叫 InputText，但 XML 标签就是 text+input） |
| 序列帧动画 | `<jta src="…"/>` | `<movieclip>`（movieclip 只在 package.xml 里作资源登记标签，不上舞台） |
| 复选框/单选 | Button 扩展 + `<Button mode="Check"/>`（见 §2.5） | `<checkbox>`/`<radio>` |
| 通用容器/视图 | `<component>`（或抽独立组件再引用） | `<view>`/`<panel>`/`<div>`/`<sprite>` |

**组件扩展 `extention`（根元素属性）合法值只有 8 种：**

`Button` / `Label` / `ComboBox` / `ProgressBar` / `Slider` / `ScrollBar` / `List` / `Tree`（不写 = 普通组件）

- 注意拼写就是 **`extention`**（FairyGUI 官方就这么拼，不是 `extension`——写错编辑器静默忽略，组件退化为普通组件）。
- 没有 CheckBox/Radio 扩展——它们是 Button 的 mode。
- 选型顺序：先查 §2.5 引擎能力表（有没有现成配置项），再查本表（用哪种对象承载）。

## 2.7 九宫格使用范围（不是所有图都能切、不是所有对象都生效）

> 事故：胶囊形"全部"按钮（圆头弧线占满整高）直接套常规九宫格 → 圆头弧线被横向拉宽，弧线内外脱节出现月牙残影。**九宫格只救得了"四角保真、中间可延伸"的图，救不了任意图形。**

**三个前提**：九宫格是**图片资源的属性**（package.xml `<image … scale="9grid" scale9grid="x,y,w,h"/>`），不是显示对象属性——一张图全工程共用一份格线；只在显示尺寸 ≠ 源尺寸时生效；`gridTile` 位掩码可把指定格改为平铺（bit0/1=上下中、bit2/3=左右中、bit4=中心；`gridTile="15"` = 四边平铺，边框纹理用）。

**适合切九宫格的图**：四角小圆角+直边的面板/按钮框、**中间区域纯色（无渐变、无花纹）**的可拉伸底板、进度条槽等单轴延伸件。中间格是拿来"拉"的，拉得住的只有纯色。

**不适合的图（切了必变形，禁止硬切）**：

| 图形 | 为什么不能切 | 正确做法 |
|---|---|---|
| **胶囊/全圆头按钮**（圆弧占满整高） | 弧线横跨会被拉宽脱节（本节事故）；纵向拉伸弧变椭圆 | 只做**单轴横向拉伸**：中心区纵向占满整图 `scale9grid="圆头宽,0,图宽-2×圆头宽,图高"`，圆头完整落进左右边栏；需要双向弹性就改用 graph 圆角矩形 |
| 圆形/放射图案（圆图标、光圈、径向渐变） | 任何方向拉伸都变形 | 不可切，按原比例用（loader fill 系列） |
| 中间区域带**渐变**（纵向/横向/对角高光过渡） | 渐变方向被拉伸后，中段过渡带与边栏内渐变节奏脱节，出现色阶断层 | 不切；渐变底整图按原比例用，或渐变拆成独立窄条图只做单轴拉伸 |
| 中间区域带**花纹/纹理**（斜纹、噪点、图案底、贯穿线条） | 中段拉伸后疏密不均、线条断续 | 均匀图案用 `gridTile` 位掩码平铺；非均匀图案不可切 |
| 中间有具体图案/文字 | 中间格被拉坏 | 图案独立成图叠上去，底图单独切 |
| 尺寸太小的图（格线中心区 ≈ 整图） | 边栏吃掉整图，切了等于没切 | 不切，直接原尺寸或换图 |

**九宫格生效的对象范围**：

| 范围 | 说明 |
|---|---|
| ✅ `image` 对象 | size ≠ 源尺寸时按格拉伸（含 aspect、relation 拉伸） |
| ✅ Button/ProgressBar/Slider 的底图 | 本质是 image，生效 |
| ✅ `loader` 装**包内**图片 | 运行时会复制源图的 grid/tile 设置 |
| ❌ `loader` 装外部图（URL/CDN/头像） | 外部图没有资源登记，无格线，按 fill 模式整体缩放 |
| ❌ `graph` / `jta` / `richtext` | 与图片格线无关，拉伸即整体变形 |
| ❌ `component` 整体 | 组件没有九宫格概念，拉大是整体缩放；要弹性得内部图片各自切好格线 + relation |

**使用纪律（切法对了两条也得守）**：

- **使用尺寸不得小于四角宽高总和**：带九宫格的图，四角在目标矩形里占的位置由格线划死——显示宽小于横向四角和（图宽−中心宽），或显示高小于纵向四角和（图高−中心高），四个角放不下就被压缩：圆角压扁、边框线粗细不均、弧线变形，和拉中间是同一类事故反着来。**对账基准是四角总和，不是源图尺寸**：四角总和 ≤ 使用尺寸 < 源图尺寸是合法的——压的只是中间区，角不动；超过源图尺寸则是中间拉伸，角同样不动。需要更小尺寸就按原比例换小图，或用 graph 圆角矩形（可任意尺寸）。lint 读 png 尺寸 + scale9grid 算四角和对账 `size` 拦截。
- **只当纯色底板用**：九宫格的定位是"中间可拉伸的底板"——中间区域必须无渐变、无花纹（见上表）。渐变底、花纹底想弹性，走 graph/单独切窄条/`gridTile` 平铺，不许套九宫格。
- **四角总和小于使用大小要慎用**：四角占使用尺寸的比例随差值摊薄——源图上占两成的边框拉到 5 倍宽的组件上只剩 4%，圆角/框线的框感丢失；中间实际宽 = 使用宽−横向四角和，拉伸倍数 =（使用宽−横向四角和）÷ 中心设计宽，倍数越高非纯色越糊（轻渐变/噪点拉成条带）。一张图多处使用按最大使用尺寸对账；对账不过就换接近使用尺寸的源图、窄条拆分单轴拉、`gridTile` 平铺或 graph 圆角矩形。此条与"中间必须纯色"同为内容判断，lint 不查，切格线时人工对账。

> 判断口诀：切格线前先看图形——**弧/圆只许整段留在边栏里，直线才许被拉伸**；套格线后再看三件事——**中间必须是纯色，尺寸只许比四角宽高总和大，四角总和小于使用大小要慎用**。

## 2.8 id 与名字的命名空间（禁止发明格式）

> 事故：另一个 AI 合并工程时自造包 id `kzlpcommon`（10 字符）→ 编辑器打开整包所有资源报错；它先怀疑"资源 id 格式 / 根目录平铺"折腾了一轮，真凶只是包 id 位数。id 格式是封闭约定，**动手前先查本表，禁止自造**。依据：本机生产工程（挪一挪猪等 5 包 481 条登记）普查实证。

| 命名空间 | 在哪里 | 合法格式 | 依据 / 事故 |
|---|---|---|---|
| **包 id** | package.xml 根元素 `<packageDescription id="…">` | **恰 8 位 `[0-9a-z]`**（全小写 base36，如 `x6189mem`；hex 是其子集也可） | `ui://` 定长保留 8 字符包 id（§3 既有 jw6b0r 错位事故）；非 8 位全包引用错位、编辑器整包报错（`kzlpcommon` 10 字符事故）。lint ✗，包 id 冲突 ✗ |
| **资源 id** | package.xml 条目 `id="…"` | **全小写 `[0-9a-z]`**；编辑器原生生成 5-8 位随机。**长度不是加载错误源**——实证 4~13 位都能正常加载，别拿"太长/太短"解释加载失败 | 合并/生成时随机分配 + 包内查重；禁止语义前缀+序号（`kz0000k` 这种多页合并必撞，撞了还得补去重逻辑）。字符集非法 lint ✗，含大写 ⚠ |
| **显示对象 id** | 组件 XML 内舞台对象 `id="…"` | `b000NN` / `c000NN` 序列（§3 既有约定） | 这是舞台对象的 id，与资源 id 是两个命名空间，互不套用格式 |
| **组件名** | package.xml 条目 `name="…"`（=文件名，带 .xml） | PascalCase 1~3 个词；同名跨文件夹合法、同文件夹禁止；按名字寻址的入口组件须包内唯一 | 名字被当唯一键用 → 无限拼定语变长（`NormalButtonYellowSmallAD` 25 字实证）；命名纪律见 §2.9 |

**误诊防线（实证结论，别再踩）**：

- **根目录平铺（`path="/"`）合法**——生产工程里就有 18 条平铺登记，正常加载。目录分组（§1）是组织规范，不是加载前提。**编辑器整包报错先查包 id 位数，别去折腾目录布局和资源 id 长度。**
- 资源 id 用随机 base36。语义前缀+序号（`kz0000k`）既不符合编辑器风格，又在多来源合并时必撞车。

## 2.9 组件命名：名字不拼装变长，模块用文件夹隔离

> AI 生成/迭代组件的通病是名字**越改越长**：每加一个模块、一轮需求、一个变体就往名字里拼一段——`Button` → `ShopButton` → `ShopBuyButton` → `ShopBuyButtonNew2`。名字的唯一职责是回答"它是什么"；"在哪/谁的/第几版/哪个变体"各有正确载体，不许堆进名字。

**技术前提（为什么不必拼前缀，实证于本机十余生产工程 8 包全量普查）**：

- **组件间引用全走 id 不走名字**（`src=` 裸 itemId / `ui://pkgId+itemId`，§3）——名字不参与组件间寻址，**不需要**靠拼模块前缀自证唯一。
- **同名组件跨文件夹合法共存**：fsjnh/game 包 6 个模块文件夹各有一份 `AwardItem.xml`（awards/sevenDaySign/achievement/adGetProp/dailySign/success），`ShopPackView.xml` 同时登记在 `/windows/shop/` 与 `/windows/iapShop/`，照常加载发布。编辑器不强制包内名字唯一。
- 模块上下文由文件夹承载：202 组件的 game 包按 `windows/<模块>/`（iapShop 19 个、weekTask 17 个…）、`activities/<模块>/` 分放。
- 生产名字主体 7~17 字，全机最长 28（`EditableAndCheckIconListItem`）；拼装的真实下场是 `NormalButtonYellowSmallAD`——5 段定语 25 字，名字被迫当唯一键用，只好无限加词。

**名字里的词归谁管（加词前先查表）**：

| 想往名字里加的 | 归谁管 | 正确做法 |
|---|---|---|
| 模块/页面归属（Main/Shop/Stash 前缀链） | **文件夹**（§1） | 组件放 `windows/shop/`，名字就叫 `BuyButton`；模块私有 cell/部件可跨模块同名（AwardItem×6 实证） |
| 变体（Yellow/Small/AD 后缀链） | **引擎配置**（§2.5） | 换色用 `color` 着色、多状态用 controller+gear；真是另一种控件就另起短名 |
| 版本/副本（New/V2/(1)） | **原名迭代**（§6） | 在原组件上改。改名=全工程引用断链（§6 四同步），留旧名副本=死资源 |
| 唯一性 | **id**（§2.8） | 引用按 id 解析；名字唯一性只对"按名字寻址"的组件有要求（见下） |

**同名的两条边界（跨文件夹同名合法，但有两处不行）**：

- **按名字寻址的入口组件必须包内唯一**：代码 `UIPackage.CreateObject(pkg, "名字")` / `GetItemByName` 按名字取**第一个**匹配；发布代码生成按名字出类。窗口/入口组件用名字取，重名即歧义——入口名可带模块词（`ShopWindow`/`GameActivity`，模块本体叫模块名不算拼装）。
- **同一文件夹内禁止同名**：path+name 定位同一份文件，两条登记 = 两个 id 指向一个文件，登记歧义（实证生产脏数据：`icon_music.png` 双 id、`开始游戏.png` 双登记；编辑器粘贴重名自己都会改名成 `Xxx(1)`）。

名字长不是加载错误（§2.8 同精神）——本条是组织纪律，lint ⚠ 不阻断：名长 >28、版本/复制后缀（New/V\d+/(数字)/Bak/Final；不含 Copy/Old——`BtnCopy`、`*Gold` 误报实证）、同文件夹同名双登记、单文件夹组件 >25（生产最大 21：Basic 包 `/Button/`）。

> 判断口诀：往名字里加词之前先问这个词归谁管——**"哪个模块"归文件夹管，"哪个变体"归 controller 管，"第几版"归原名管；都不归名字管。**

## 2.10 单图禁包组件：图片直用 image（纯转发层零能力）

> 来源事故：CopyCat 复原导出器把图片逐个包成组件——taptap_maker 工程同质子树重复包装（指纹去重修复后 cultivate 220→153、shop 50→38），去重后仍残留纯转发层：`events/WTufashijian17/lbl_info1.xml` 就是一个 `<component size="569,64">` 装一张同尺寸 image，零逻辑零增量。本条是"不必要嵌套"在 image 上的特例；通用嵌套自查与"组件包组件"转发形态见 §2.16。

**组件必须有"组件的理由"**：组合 ≥2 个显示对象，或承载逻辑（`extention` 扩展 / controller+gear / transition）。displayList 只有一个 image、无任何逻辑的组件是**纯转发层**——删掉包装，在使用方直接写 `<image src=…/>`。

为什么禁：包一层**不新增任何能力**（image 本身就有 color/alpha/size/scale9grid/relations/gear/grayed，见 §2.5），代价却全是实打实的——图片+组件双份登记、引用链深一层（改图要穿透两层）、发布体积与实例化多一层开销。

**生成器纪律（导出/复原场景，也是 AI 手写纪律）**：

- 子树是单个显示对象 → 直接输出该对象节点，不建包装组件。
- 同质子树出现多次 → 抽成一个组件被引用 N 次（§2 复用件纪律）。
- **真差异不算重复**：taptap_maker 的 suo 家族 8 把"锁"初判"同一把重复 8 次"，diff 实证是不同底图/位置——指纹不同不合并是对的，**别为凑去重数硬合**。

**不算违规的边界**：

- `extention="Button"` 等扩展——那是按钮/标签，不是包装；
- 带 controller/gear/transition 的——包装承载状态/动效逻辑（可复用动效必须住进组件，单独 image 装不了时间轴）；
- graph/loader 单件（占位槽/头像槽的语义组件）——另有语义，本条只查 image 重灾区。

实证存量：生产工程每包有 1~2 个历史单图组件（`Reddot.xml` 红点，纯 image 无逻辑），容忍存在、不再新增——lint ⚠ 不阻断。

> 判断口诀：包一层组件之前先问：**这层带来了 image 本身没有的什么？** 答不出来就直接用 image。

## 2.11 同构行收敛：一个 cell + list，禁止每行建组件文件

> 来源事故：CopyCat 导出器没识别列表结构——taptap_maker 工程两形态并存：WGongfa1 十份行组件**字节级相同**（btn_up1~10，md5 全同仍各占一个文件）；WKaishi1 二十份（a1~a20，底图/几何/字号全同，**只差 text 值**——"每行文本不同就没去重"）。全工程普查共 7 组 ≥4 同构（另有 WChanye×4、WqianWeek×7/×4/×7、WYingdao×8）。

**行内容是数据不是结构**：同构行只建**一个 cell 组件**，行与行的差异（文本/数值）用数据表达——动态行用 list（`layout="flow_vt"` + `defaultItem` + itemRenderer 填数据，§2.5），静态行引用同一 cell N 次；**禁止每行一个组件文件**。

**结构指纹的判定（什么算"同构"）**：标签序列 + 几何（size/xy）+ 底图（src）+ 颜色/字号相同，仅 id/name 编号与 **text 文本值**不同 → 同构。反向边界：

- **真差异不算同构**（承 §2.10 suo 教训）：底图不同（`NormalButtonGray/Red/Yellow` 颜色变体家族）、尺寸不同、子件增减 = 真差异，各自独立合法——别为凑合并硬抹平。
- **跨模块文件夹不算**：同名组件各模块一份合法（§2.9 AwardItem×6），本条只查**同一文件夹内**的重复。
- **list 偶有异构行**：先怀疑结构切错了（重对齐尺寸/子件再比指纹）；确属异构的少数行才单独建件——"偶尔不同"不能成为整列表每行建件的理由。

lint ⚠ 检查 17：同文件夹内结构指纹相同的组件 ≥4 个（生产 6 工程回归零命中；taptap_maker 命中全部 7 组）。

> 判断口诀：**第 3 个"只差字"的同款行出现时，停下——它是 list 的一行，不是新组件；行里差的"字"是数据，用 itemRenderer 喂。**

## 2.12 设计分辨率缩放导出：改源副本再发布，禁止 patch 发布产物

> 场景：工程按 1080×1920 制作，小游戏要 750×1334 的包（包体/内存）。**缩放发生在"喂给发布的源工程"，不是发布函数、更不是发布产物**——图集区域坐标 + .bin patch 等于重写打图集器，图集重打包本来就是编辑器 publish 的事。

**管线**：`scripts/scale_project.mjs --src <工程根> --to 750x1334` 生成缩放副本（源只读，副本可 `--force` 重建）→ lint → bridge `launch(visible:true)` → `refresh` + `list-items` → `publish`。图集不用自己重打，publish 自己算。

**比例与取整**：统一按宽度单比例（750/1080=0.6944），禁止 x/y 各用各的比例（宽高比微差交给运行时适配；非均匀缩放会拉变形九宫格和位图字）。一律 `Math.round`，**永远从源工程一次转换**——1080→750 之后再 →别的会累积取整误差。设计尺寸不在 .fairy 里，体现在全屏组件尺寸上：脚本按众数自动探测（kaizong_lipai 实测 1000×2000 与 750×1334 并存会近似并列，须 --from 显式指定）。

**缩放清单（4 工程 1460 组件普查实证）**：布局 xy/size（嵌套 displayList 一并）、group xy/size/colGap/lineGap、designImageOffsetX/Y；文本 fontSize/titleFontSize/leading/strokeSize/shadowOffset；list margin/colGap/lineGap；graph lineSize/corner/points；gearXY/gearSize（w,h 缩、scale 分量不缩）/gearFontSize；transition 按 type 分派（XY/Size 缩两维、Width/Height/Shake 一维、Scale/Pivot/Alpha/Rotation 不缩，time/duration 永不缩）；package.xml 的 scale9grid 仅当该图真实缩小后同步（格线必须贴缩后像素，防取整漂移越界）。**不缩**：pivot/anchor（相对）、scale/rotation/alpha、relations（百分比）、controller/action、downEffectValue。

**资源策略 shrink（默认）**：png 纯 JS 区域平均重采样（预乘 alpha）；jpg 需 sharp（Windows 中文路径必须传 Buffer 不能传路径——libvips 打不开非 ASCII 路径，挪一挪猪实证）；细线（源最短边 ≤4px）、缩后 <3px、九宫格缩后 <3px 保留原图；ttf 动态字体无位图度量不动；jta 内嵌二进制贴图不动（仅上报）；**多语言分支目录 assets_zh/assets_en/… 不在处理范围**（脚本会告警，分支包仍是原分辨率）。保留高清选项 `--res keep` 只缩布局。

**验收与实证（挪一挪猪 750×1334→540×960 全链路）**：10535 个属性逐项对账零错（变的全符合策略、没变的逐字节一致）；12 张 png 与 sharp lanczos 交叉校验尺寸全对、通道均值差 max 1.85；lint 源/副本同为 429 零新增；编辑器 5/5 包 list-items + 4 组件 open-doc 全过；publish 成功，atlas 页 1024×512→512×512，game 包 2.15MB→1.95MB（**-9.3%**——纯色 UI 素材 PNG 本身压缩率高、.bin 尺寸不随坐标变，别拿"面积 52%"当预期；图片占比越高/jpg 越多降幅越大）。

> 运维坑（实测）：①编辑器曾崩溃后 `ensure` 默认隐藏窗口启动会**永久卡死帧循环**（崩溃恢复对话框 × 隐藏窗口，Player.log 无痕）——崩溃过的编辑器一律 `launch '{"visible":true}'`；②两个实例并发开同一工程 → GameAssembly 0xC0000005 同偏移崩溃，串行操作；③插件的 list-items 遇 font/sound/jta 等叶子资源 children=null 必炸（itemInfo 缺判空守卫，已修）。

## 2.13 单选组必须 controller 化：radio 实例在使用方关联 controller，禁止代码手工管理互斥

> 来源事故：页面放了单选按钮但整个页面没有一个 controller、实例也不带关联——互斥选中、初始选中态、按选项联动内容全部退化为代码手工实现（onClick 里逐个改 selected、手摆 checked、手动切面板显隐）。taptap_maker（CopyCat 导出工程）全工程普查：Tuning 25 个、RacePreparation 11 个（调校方案/轮胎/部件三组）、Settings 10 个（画质档）、Catalog 10 个（筛选页签）等共 114 个 radio 实例零关联。

**三层结构（哪一层管什么，实证挪一挪猪 AchievementWindow + 毛线填色 Basic 包）**：

- **皮肤件**：`extention="Button"` + 根 `<Button mode="Radio"/>`，内部只有按钮状态 controller（`name="button"`，管 up/down/over 皮肤）。皮肤件**不知道自己属于哪个组**——它只是"长成单选样子的按钮"。
- **页面 controller**：使用方页面定义业务 controller，每页 = 一个选项（`<controller name="mode" pages="0,,1," selected="1"/>`）。
- **实例关联**：每个 radio 实例在引用的内嵌 `<Button>` 上写 `controller="名" page="N"`——**分组在这里完成**：

```xml
<controller name="mode" pages="0,,1," selected="1"/>
…
<component id="n143" name="btnAchieve" src="ku5317g" fileName="windows/achievement/TabItem.xml" xy="95,1184">
  <Button controller="mode" page="0"/>
</component>
<component id="n146" name="btnMyAchieve" src="ku5317g" fileName="windows/achievement/TabItem.xml" xy="369,1184">
  <Button checked="true" title="我的成就" controller="mode" page="1"/>
</component>
```

**为什么必须关联（运行时机制，GButton 源码）**：radio 的互斥和状态同步靠 relatedController 双向驱动——点选 → `selected=true` → `relatedController.SetSelected(page)`，同组（同 controller 关联的）实例由 `HandleControllerChanged` 自动互斥同步；controller 变页（代码 `selectedIndex` 或另一个 radio 点击）→ 全组选中态自动跟随。**没有 controller，"单选组"就没有分组依据**：互斥各亮各的、初始态只能 checked 手摆、选项内容联动（gearDisplay 挂同一 controller）无从谈起——全是本该配置表达的东西被迫写进代码。初始态由 controller 的 `selected` 属性表达，别逐个手摆 checked。

**正确分工**：controller/pages 是"选项集合"的声明（编辑器可预览），代码只读/设 `selectedIndex`（存档恢复、默认值下发）。

**不算违规的边界**：

- **list 的动态行单选**（`defaultItem` 引 radio 皮肤 + itemRenderer 填数据，挪一挪猪 SetLanguageWindow 语言选择实证）：行的数量/内容是数据不是结构，互斥在 onClickItem/itemRenderer 里管理是正确分工——本条只查 displayList 里的静态 `<component>` 实例。
- **Check 模式不查**：复选是独立开关（"记住密码"），无互斥需求，selected 自管理合法；确需多态联动才上 controller（§2.5）。
- **单个按钮当开关**：用 Check，不是 Radio——Radio 单摆没有互斥对象，语义用错模式。
- **皮肤件定义处**：根级 `<Button mode="Radio"/>` 是皮肤声明，关联发生在使用方（见上）。

lint 检查 18 ⚠：`<component src=radio皮肤>` 的静态实例（含自闭合形态）缺 `controller="名" page="N"`，或关联的 controller 名不在本组件定义（悬空）；item 内联/defaultItem/Check 模式/皮肤定义处不查。生产 5 工程回归零命中零误报，taptap_maker 命中全部 114 个真实存量。

> 判断口诀：放第二个单选按钮之前，先建 controller——**"一组互斥选项"是 controller 的 pages，不是 N 个各自管 selected 的按钮**；点选联动靠 gear 挂同一 controller，代码只碰 selectedIndex。

## 2.14 全屏页面分层绑定：贴边必绑、弹性跟随、模块成组

> 场景：全屏页面（根 size = 设计分辨率量级，720×1280/750×1334/1000×2000…）不做适配绑定——FitWidth 等比适配下富余高度全部累积在底部，底栏悬空、底下露边。实证 BricksBreakerRPG Shop.xml：bgDark/bottomBg/三个导航按钮全部裸放；同工程 Stash.xml 改造后零问题（本节全部写法的出处）。

**先判断页面形态，再决定要不要绑**：全屏页面必须按本条分层绑定；**窗口式弹窗（WindowFrame 居中框架承载）不适用**——锦鹏系生产工程（挪一挪猪等 5 工程）全屏件只有 mask/transition 框架，页面全是弹窗，全工程 relation 十几条是正常形态，别拿本条去要求弹窗。

**分层绑定模型（Stash.xml 720×1280 全链路实证）**：

| 层 | 绑什么 | 写法 |
|---|---|---|
| 全屏背景 | 铺满跟随 | `<relation target="" sidePair="width-width,height-height"/>` |
| 中间弹性内容区（库存面板/列表） | 高度吃掉富余空间、水平居中 | `sidePair="height-height,center-center"`（面板、内阴影、滚动列表同绑） |
| 居中装饰（标题） | 双向居中 | `sidePair="center-center,middle-middle"` |
| 底部模块（底栏：tab×3+背景+按钮×3） | **成组**，组上绑宿主底边 | 成员 `group="组id"` + `<group … advanced="true"><relation target="" sidePair="bottom-bottom"/></group>` |
| 底栏上方横条（容量条） | 独立小组，**组对组**钉在底栏上方 | `<group …><relation target="底栏组id" sidePair="bottom-top"/></group>` |

要点：`target=""` 指宿主组件本身；**组也是合法 target**——组间绑定（bottom-top = 钉在目标组上方）形成"底栏 → 底栏上方横条"的链式锚定，底栏整体换位置时上方横条自动跟随。顶部模块同理 top-top。

**成组的两种依据（什么时候建组）**：

1. **有一致绑定关系**：几个元素要一起钉在同处（都要贴底、都在底栏上方）→ 成组共用一条 relation，组绑一次成员全跟随——**禁止成员逐个绑同款 relation 散摆**；
2. **同类型或一个小模块**：底部导航（tab×3 + 背景 + 按钮×3）、顶栏货币条是一个功能模块 → 整组成组，组成为移动/绑定/显隐的单位。

反向边界：组是"一起动"的载体，**不是语义容器**——发现要在组里按名字找子对象做逻辑时，那该抽成组件（组内成员寻址、承载逻辑是组件的职责，§2）。

**代码分工**：适配全部在编辑器 relation 表达；运行时代码只碰业务状态，**不碰坐标**（§2.5 响应式布局行——代码逐节点重排坐标是禁止项）。

lint 检查 19 ⚠：全屏量级组件（短边 ≥700 长边 ≥1000）里贴底元素（y+h≈组件高 ±4）自身无 bottom/height 类 relation、所归组也未绑。中间弹性区跟随、该不该成组机器判不了，靠本节纪律；窗口/框架组件不查。

> 判断口诀：全屏页面先问三件事——**背景铺满了吗（width-width,height-height）、中间弹性区跟高度了吗（height-height）、贴边的绑边了吗（成组 + bottom）**；组和 relation 都在编辑器里表达，代码不碰坐标。

## 2.15 创建 UI 必查丢失资源：引用能解析、文件在盘、登记带 exported

> 来源事故（生产工程普查实证）：组件里 `icon="ui://…"` 指向的 itemId 在目标包登记里查无——整组引用随删图悬空、或指向只剩邻位登记的残留 id。这类悬空引用编辑器和运行时**全部静默容受**：按钮/标签的图标、文本的位图字体直接空白，无报错无日志——旧机器检查只对账 `src=/url=/defaultItem=`，icon 类引用全放行。

**丢失资源的四种形态（创建/改动 UI 收尾时逐一核对）**：

| 形态 | 长什么样 | 编辑器反应 |
|---|---|---|
| ① 引用悬空 | `src=/url=/defaultItem=/icon=/titleIcon=/sound=/font=` 指向的 id 在目标包 package.xml 解析不到 | 静默容受，图标/组件空白 |
| ② 死登记 | package.xml 登记了但 path+name 文件不在磁盘 | 容受，**发布丢资源**（§3 已有死登记事故） |
| ③ 磁盘孤儿 | 文件拷进了包目录但没登记 package.xml | 编辑器看不见、发布不带 |
| ④ 缺 exported | 登记在、文件在，但没 `exported="true"` | 加载正常，**发布静默丢弃**（§3 已有 27 图丢失事故） |

**机器闸门（lint）**：形态 ①②④ ✗ 阻断——引用对账覆盖 `icon=/titleIcon=/sound=/font=` 的 ui:// 引用（明文字体家族名不是引用，不查）；形态 ③ ⚠——磁盘孤儿对账（检查 21）：编辑器可消费类型文件（图片/音频/ttf 字体/xml 组件）在包目录但未登记，与登记存在性检查（13）合成**双向对账**；登记 path 与磁盘大小写不一致按不敏感匹配（生产实证 `path="/images/dyCollect/"` 配磁盘 `dycollect/`）。**组件内容检查（引用对账等）前提是文件在 `components/` 目录下**——登记在自定义目录的组件 lint 看不见，要么放 `components/` 下（§1），要么收尾自查；孤儿对账扫全包目录，不受此限。

**编辑器闸门**（§4 修复闭环）：lint ✗ 清零后 bridge `refresh` + `list_items`，新组件 `open-doc` 开一次——自定义目录里的文件仍靠这一道兜底。

> 判断口诀：写完 UI 别急着宣布完成——**每个引用问三件事：登记了吗、文件在吗、exported 了吗；盘上每个文件问一件：登记了吗**；组件在 components/ 外时 lint 管不到，编辑器装载是最后一道闸。

## 2.16 不必要组件嵌套：每层自带理由，改内层不许穿透两层

> 来源：AI 生成与导出复原的通病是"套娃"——组件再包一层组件。kaizong_lipai（CopyCat 导出）普查：22 个纯转发层——`SJSource_3` 与内层 `SJSource_4` 同尺寸 1:1 转发、`toggle2` 包 `toggle` 同尺寸 72×72、`ren-001` 只带一份 scale/pivot 实例变换；手作 5 工程（挪一挪猪/蚂蚁搬家/sort_up/BricksBreakerRPG/thread_jam）同形态**零命中**（唯一近似 EffectContainer 带 `extention="Label"`，是特效锚点不是转发）。

**每层嵌套必须自带"组件的理由"**（§2.10 判定从单图推广到一切包装）：组合 ≥2 个显示对象、或承载逻辑（`extention` 扩展 / controller+gear / transition）、或作为被引用 N 次的复用单元（§2.11 同构收敛）。**只有一份实例变换属性（xy/size/scale/pivot/rotation/color/alpha）不是理由**——这些全是引用处的实例属性，写在引用上效果相同；包装不新增任何能力，代价却实打实：多一份登记与文件、引用链深一层（改内层要穿透两层）、实例化多一层。

**机器可查的形态（lint 检查 20 ⚠）**：displayList 只有一个 `component` 子件且无 extention/controller/transition/gear——与检查 16（单 image 转发，§2.10）合成"单件转发"两形态。graph/loader/text 单件是占位槽/头像槽类语义组件，不查（§2.10 边界）。

**人工自查（层级必要性机器判不了，创建/改动 UI 收尾时过一遍）**：

1. 从每个入口组件往下数引用链，**每层说出自己的职责**——说不出 = 删层，把内层直接放到使用方。链深参考：手作生产 ≤3（实证），出现 4+ 层就该逐层审。
2. 使用方有没有**穿透包装层操作内层**（代码里 `a/b/c` 三级子路径、或先摆包装再单独挪内层）——穿透即多余层。
3. 包装与内层 **1:1 同尺寸**（size 相同）、1:1 生命周期（总是一起出现一起改）——是则合并成一层。

**不算违规的边界**：

- EffectContainer 型特效锚点：`extention` + pivot 语义，子件是 0×0 特效挂载点；
- 窗口框架包内容件：框架自带 transition/mask（锦鹏系 WindowFrame 形态），逻辑豁免；
- 适配层：内层组件绑 relation 铺满宿主（§2.14 弹性区承载）——若它真被复用（引用 N 次）是复用单元；仅此一层、无逻辑时会被检查 20 ⚠ 提示，人工确认是复用单位后保留。

> 判断口诀：再包一层之前先问：**这层带来了内层组件自身给不了的什么？**——组合、状态逻辑、复用单元三者其一才许包；"挪个位置/缩一下"不配一层组件。

## 2.17 文本必须声明溢出处理：autoSize 四值封闭，翻译/动态文本先想好框

**机器闸门（lint 检查 23 ⚠ + 24 ⚠）**：`<text>` 必须写 `autoSize`，值域封闭 `none/shrink/height/both`——缺=未声明、`true` 等布尔写法非法（枚举当布尔，生产实证 18 处，运行时按缺省处理、编辑器重存即被洗掉）。`autoSize="none"` 固定框 + `singleLine="true"` 禁换行 + 静态文本估宽超框 15% → 现溢出 ⚠（估宽：中文/全角按 fontSize、西文按 0.6×fontSize；位图字体 `font="ui://"` 度量未知、`{{模板}}` 长度运行时定，都不查）。

**为什么盯 text**：文本是唯一"内容长度不由制作者控制"的对象——翻译变长（中文 2 字翻英文 20 字符）、运行时填数据（昵称/数字），框没留量或没声明处理就溢出截断。生产普查佐证规则方向：编辑器手作件 96% 都写 autoSize（227/235），singleLine 文本 68 个里 48 个用 shrink 防护——`none+singleLine` 的 20 个几乎全是运行时填文本的槽位，恰是漏声明最危险的形态。

**四值怎么选**：`none` 固定框（内容确定且短——标题、固定文案）；`shrink` 缩字号塞进框（按钮/数值，宁小勿溢）；`height` 只加高（多行段落，框宽锁定）；`both` 宽高都自适应（无框纯文本）。**人工自查（机器查不了的）**：动态文本的运行时最长内容（估宽只算静态值）、翻译后各语种实际长度（译文长度 vs 框宽要人工过一遍，或看 import_strings 预览效果）。

## 3. XML 硬规矩（✗ 阻断项，lint 机器查）

| 规矩 | 原因（事故） |
|---|---|
| 一个标签内禁止重复属性 | `Stash.xml` 曾写两个 `color` → 编辑器双击组件弹错误框 |
| 标签必须配平（开/闭/自闭合一致） | 孤儿 `</image>` → 编辑器解析异常"Invalid xml format - <image> dismatched"，组件被静默丢弃 |
| **package.xml 每个要发布的资源必须 `exported="true"`** | 缺 exported = 加载正常但**发布静默丢弃**（27 图+组件丢失事故，check_publish.mjs 对账防线） |
| 颜色只用 6 位 `#RRGGBB` + `alpha="0.x"` 属性 | 8 位色部分运行时取后 6 位：`#000000c8` 渲染成纯蓝 |
| `ui://` = `ui://` + **8 字符包 id** + itemId 直连无斜杠 | 包 id 非 8 字符会吃掉 itemId 首字符（jw6b0r→jw6b0r00 重编事故） |
| package.xml image 的 `name` 必须带扩展名（.png/.jpg/.svg…） | 不带后缀 refresh 会整包重复导入 |
| 包 id 必须恰 8 位 `[0-9a-z]`（lint ✗；两包同 id 冲突 ✗） | 非 8 位 ui:// 错位 + 编辑器整包报错（`kzlpcommon` 10 字符事故，格式表见 §2.8） |
| 资源 id 只允许 `[0-9a-z]`（长度不限；含大写 ⚠） | 编辑器风格全小写；实证 4~13 位都能加载——长度不是加载错误源（§2.8） |
| package.xml 每条登记的文件（path+name）必须真实存在（lint ✗） | 移动/删除文件不同步登记：编辑器容受但**发布丢资源**（真实工程 9 条 design 死登记、删图未清 src 引用，编辑器照常加载实证） |
| 跨包引用（`pkg=` / `ui://他包id+itemId`）按目标包 package.xml 对账（lint ✗） | 分桶/合并后跨桶引用没改写成跨包引用 = 断链（§6） |
| 组件 XML `fileName` 与登记路径一致（lint ⚠——编辑器按 src 定位，错 fileName 仍能加载） | 合并/移动文件后 fileName 不同步是断链隐患（真实工程有此脏数据实证，见 §6） |
| `src=` 裸 itemId、`url=` 完整 `ui://` | 两者格式不同，混用解析失败 |
| 组件 id 序列：图片 `b000NN`、组件 `c000NN` | 与编辑器生成风格一致，避免碰撞 |
| displayList 对象标签只允许 §2.6 的 10 种 | 发明的标签（inputtext/movieclip/checkbox/view…）编辑器解析丢对象或组件打不开 |
| `extention` 只允许 §2.6 的 8 种合法值（且拼写是 extention） | 不存在的扩展（如 CheckBox）创建/加载失败 |
| `scale9grid="x,y,w,h"` 中心区不得超出图片实际尺寸（lint 读 png 尺寸对账；负值 ⚠——svg 上编辑器怪癖） | 越界格线 = 切错图，拉伸必炸（九宫格适用范围见 §2.7） |
| 带九宫格的图显示 `size` 不得小于四角宽高总和（图尺寸−中心区，lint 读 png+scale9grid 对账） | 小于四角总和 = 四角放不下被压缩，圆角压扁/边框粗细不均；四角和~源图之间只压中间区、角不动（见 §2.7） |
| `<text>` 必须声明 `autoSize`（none/shrink/height/both；缺/非法 ⚠，none+singleLine 静态估宽超框 ⚠） | 文本是唯一内容长度不可控的对象：翻译变长、运行时填数据，没声明就溢出截断（见 §2.17） |
| 翻译表（strings.xml × strings_语种.xml）键覆盖/修饰一致/未翻对账（lint ⚠，有译文文件才查） | 漏翻发布即带病、译文方括号会被 UBB 吞、缺键导入静默无效（见 §7） |
| 编辑器开着时禁止手写 package.xml | refresh 用内存态覆盖盘上（登记必须：关编辑器→写盘→重启加载） |

## 4. 坐标与真值

- 复原类项目：所有 xy/size 必须来自运行时 dump 真值（uidump JSON 的 `r` 字段），不许目测。
- 手写 XML → lint → 编辑器 refresh → `read_component` 抽查 → publish → 产物拷贝到游戏 assets。**禁止手改发布产物 .bin**。
- 注意：`read_component` 只读盘上文件，返回 ok **不代表**编辑器能打开该组件（编辑器打开走自己的 XML 解析，重复属性就是这里炸）。
- **编辑器报错取证**：编辑器应用层错误**不落盘**（Player.log 只有内存统计，翻日志无用）。取证走 bridge：`refresh` 之后 `list_items`（内部 EnsureOpen 走编辑器装载路径，登记/id 坏了这一步就会炸出真实错误），bridge.log 同步留痕。
- **修复闭环**：lint 全绿只代表静态规则过了，**修完必须过一遍「编辑器实际加载」验证（refresh + list_items / 打开组件）才算完成**。事故：另一个 AI 自检脚本跑完就重启编辑器宣布"结构全对"，从头到尾没有编辑器级验证，真凶（包 id 位数）到下一轮才暴露。

## 5. 发布与同步

- publish 产物（.bin + atlas）→ 游戏工程 assets/（运行时以 json 扩展名加载的要注意同步拷贝）。
- 组件 XML 改动后必须重新 publish + 拷贝，运行时不会读编辑器工程源文件。

## 6. 批量生成/合并纪律（脚本改造工程时）

> 事故背景：另一个 AI 写脚本把多个页面 zip 重组成模块包——自造 id 格式（§2.8）、整仓删除重建、从无关生产工程拷 settings、修完不做编辑器级验证（§4），编辑器整包报错。

- **禁止整仓删除重建**：不许 rm 掉目标工程（或其 assets/）再全量重新生成。每次重建 = 全部 id/引用换血，既有断链无从发现，人工改过的内容无声丢失。生成/合并脚本必须**增量幂等**：已存在且未变的登记与文件不动，只补差量。
- **禁止跨工程拷 settings**：Common.json / i18n.json / CustomProperties.json 等带着别工程的文案与自定义数据，拷过来就是污染。新工程 settings 自己生成最小集。
- **合并四同步**：多包合并/分桶时，package.xml 登记（id 重映射）、组件 `src=` 引用、`fileName`、物理文件位置**四者同步改写**；分桶后跨桶引用必须改写成跨包引用（`pkg="目标包id"` 或完整 `ui://`）——漏一个就是断链（lint 跨包引用检查拦截）。
- **产物验收双闸**：合并/生成完 → `node scripts/lint_components.mjs <工程根>` ✗ 清零 → bridge `refresh` + `list_items` 走编辑器实际装载。两道都过才算完成。事故里产物带着 157 个问题（发明 `<button>` 标签、缺 exported、九宫格缩小——多数从源 zip 继承）无人发现，就是没过这道闸。

## 7. 翻译表（多语言工程）：export → 翻译 → 对账 → import 预览

工作流：bridge `export_strings` 导出工程全部文本（产物 `strings.xml`，默认工程根）→ 按语种复制为 `strings_en.xml`/`strings_ru.xml`… 翻译（键 = `name`（itemId-子对象id）+ `mz`（子对象名），**不动属性只译文**）→ `import_strings` 回导编辑器预览 → publish。格式：`<resources><string name="…" mz="…">文本</string>`。

**机器闸门（lint 检查 25~27 ⚠，工程根或 export/ 下发现 `strings.xml` + `strings_*.xml` 自动查，独立用 `node scripts/lint_strings.mjs 源.xml 译文.xml…`）**：

- **键覆盖（25）**：译文缺键 = 漏翻（导入后该组件仍是源语言）；多键 = 组件删改后残留或键写错（导入静默无效）。组件改版后翻译表必须重新 export 对齐，禁止手攒键。
- **修饰一致（26）**：同键各语种的 `{{模板变量}}` 集合与 UBB 标签（`[b]`/`[color=…]` 归一化标签名、参数忽略）集合必须一致——译文丢 `{{count}}` 运行时插值落空；**源文用中文括号【】、译文写方括号 `[Rewards]` 会被 UBB 解析当标签吞掉**（arrow_line 生产实证：en 表 2 处）。富文本翻译禁用裸 `[]`，用【】或（）。
- **未翻（27）**：源含中文且译文与原文完全相同 → 多半没翻。已知良性豁免不了但可忽略：语言选择器里的语言名（"简体中文"在任何语种里都该是"简体中文"）、无中文的源（"OK"/数字，译文相同是合法保留——本检查只报源含 CJK 的）。

实证：arrow_line 三语表——en/ru 各缺 37 键、en 2 处 [Rewards] 修饰不一致、"简体中文"未翻提示 1 条（良性）；sort_up 双语表 365 键全对账通过（干净表零输出，主 lint 打一行 ✓ 确认发现过文件）。全部 ⚠ 不阻断：漏翻/残留不炸工程，但发布即带病，升 ✗ 要先攒运行时事故实证。
