# FairyGUI UI 制作规范（agent 强制）

> 面向 AI/自动化手写 FairyGUI 工程的场景。违反任何一条 ✗ 项都会在编辑器或运行时炸出真实事故（每条规矩背后都是一次踩坑）。配套机器检查：`node scripts/lint_components.mjs <工程根>`，预提交/发布前必跑。

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

## 2. 组件化纪律

- **复用件一律抽组件放 `common/`**：按钮（底图+文字）、面板框（九宫格底+内阴影）、标签页、底栏、货币条……第二次出现就必须抽。
- **页面组件只做布局装配**：引用 common 件 + 页面私有件，不放重复的裸 image+text 组合。
- 单组件显示对象建议 ≤ 80 个（超过说明该拆 cell/子组件）。
- 动态重复结构（背包格子、商店卡片）用 `list`（`layout="flow_hz"` + `defaultItem`）+ 独立 cell 组件，禁止在页面里平铺 N 份。
- 子对象用语义名（`btnHome`/`capText`），禁止裸 `n0/n1`；扩展件遵守内置名约定（Button 的 `title`/`icon`）。

## 2.5 引擎自带能力（禁止手搓实现）

FairyGUI 编辑器/运行时已内置的能力**直接用配置表达**，禁止用图片裁剪、复制节点、外部代码模拟：

| 要用 | 内置做法 | 禁止的手搓 |
|---|---|---|
| **九宫格拉伸** | package.xml `<image … scale="9grid" scale9grid="x,y,w,h"/>`（编辑器属性面板「九宫格」），边角不糊地拉伸面板/按钮 | ❌ 切图/裁剪出多张图拼；❌ 生成多尺寸变体 png |
| 图标缩放进框 | GLoader `fill`：`scale`（填满）/`scaleMatchWidth/Height`（按边适配）/`scaleNoBorder`（保比例裁边覆盖） | ❌ 预裁剪图片；❌ 放大 loader 让图"看起来合适"（超框事故根源） |
| 图片变色/半透明 | image `color="#RRGGBB"` + `alpha`（运行时着色） | ❌ 生成染色后的图片副本 |
| 响应式布局 | `<relation sidePair="width-width,height-height"/>` 等关系 | ❌ 代码里逐节点重排坐标 |
| 多状态切换（选中/未选、页签、分页） | controller + `gearDisplay/gearXY/gearSize/gearText`；Button 的 `mode="Check/Radio"` + group | ❌ 同一位置叠 N 份节点靠 visible 切 |
| 列表/网格/瀑布 | GList：`layout="flow_hz/flow_vt"` + `defaultItem` + `itemRenderer` + 虚拟列表 `setVirtual/numItems` | ❌ 在页面组件里平铺 N 个 cell；❌ 自制滚动 |
| 滚动区 | 容器 `overflow="scroll"`（ScrollPane） | ❌ 自写滚动/裁剪 |
| 动效 | Transition（编辑器时间轴 + label/hook） | ❌ 代码逐帧驱动补间 |
| 按钮按压反馈 | `<Button downEffect="scale" downEffectValue=".97"/>` | ❌ 手写缩放动画 |
| 文本描边/阴影 | text `stroke`/`shadowColor` 等属性 | ❌ 叠多层文本模拟 |
| 旋转/翻转/锚点 | `pivot`/`rotation`/`skew` | ❌ 预旋转图片 |
| 简单色块/几何 | GGraph | ❌ 1x1 png 拉伸 |
| 置灰/禁用 | GObject `grayed` | ❌ 换灰度图副本 |

> 判断标准：想动图片本身（裁/染/缩/切）之前，先查引擎有没有配置项——有就必须用配置。九宫格是重灾区：任何"把图切一下"的念头都先去 package.xml 写 `scale9grid`。



## 3. XML 硬规矩（✗ 阻断项，lint 机器查）

| 规矩 | 原因（事故） |
|---|---|
| 一个标签内禁止重复属性 | `Stash.xml` 曾写两个 `color` → 编辑器双击组件弹错误框 |
| 标签必须配平（开/闭/自闭合一致） | 孤儿 `</image>` → 编辑器解析异常"Invalid xml format - <image> dismatched"，组件被静默丢弃 |
| **package.xml 每个要发布的资源必须 `exported="true"`** | 缺 exported = 加载正常但**发布静默丢弃**（27 图+组件丢失事故，check_publish.mjs 对账防线） |
| 颜色只用 6 位 `#RRGGBB` + `alpha="0.x"` 属性 | 8 位色部分运行时取后 6 位：`#000000c8` 渲染成纯蓝 |
| `ui://` = `ui://` + **8 字符包 id** + itemId 直连无斜杠 | 包 id 非 8 字符会吃掉 itemId 首字符（jw6b0r→jw6b0r00 重编事故） |
| package.xml image 的 `name` 必须带 `.png` | 不带后缀 refresh 会整包重复导入 |
| `src=` 裸 itemId、`url=` 完整 `ui://` | 两者格式不同，混用解析失败 |
| 组件 id 序列：图片 `b000NN`、组件 `c000NN` | 与编辑器生成风格一致，避免碰撞 |
| 编辑器开着时禁止手写 package.xml | refresh 用内存态覆盖盘上（登记必须：关编辑器→写盘→重启加载） |

## 4. 坐标与真值

- 复原类项目：所有 xy/size 必须来自运行时 dump 真值（uidump JSON 的 `r` 字段），不许目测。
- 手写 XML → lint → 编辑器 refresh → `read_component` 抽查 → publish → 产物拷贝到游戏 assets。**禁止手改发布产物 .bin**。
- 注意：`read_component` 只读盘上文件，返回 ok **不代表**编辑器能打开该组件（编辑器打开走自己的 XML 解析，重复属性就是这里炸）。

## 5. 发布与同步

- publish 产物（.bin + atlas）→ 游戏工程 assets/（运行时以 json 扩展名加载的要注意同步拷贝）。
- 组件 XML 改动后必须重新 publish + 拷贝，运行时不会读编辑器工程源文件。
