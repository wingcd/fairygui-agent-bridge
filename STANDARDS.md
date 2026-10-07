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

## 3. XML 硬规矩（✗ 阻断项，lint 机器查）

| 规矩 | 原因（事故） |
|---|---|
| 一个标签内禁止重复属性 | `Stash.xml` 曾写两个 `color` → 编辑器双击组件弹错误框（“组件打不开”真凶） |
| 颜色只用 6 位 `#RRGGBB`，透明度用 `alpha="0.x"` 属性 | 8 位 `#RRGGBBAA` 部分运行时只取后 6 位：`#000000c8` 渲染成纯蓝 `(0,0,200)` |
| `ui://` = `ui://` + pkgId + itemId 直连，**无斜杠** | `ui://pkg/ item` 解析不到 |
| package.xml image 的 `name` 必须带 `.png` | 不带后缀 refresh 会整包重复导入（51 图变 102 条目事故） |
| `src=` 裸 itemId、`url=` 完整 `ui://` | 两者格式不同，混用解析失败 |
| 组件 id 序列：图片 `b000NN`、组件 `c000NN` | 与编辑器生成风格一致，避免碰撞 |

## 4. 坐标与真值

- 复原类项目：所有 xy/size 必须来自运行时 dump 真值（uidump JSON 的 `r` 字段），不许目测。
- 手写 XML → lint → 编辑器 refresh → `read_component` 抽查 → publish → 产物拷贝到游戏 assets。**禁止手改发布产物 .bin**。
- 注意：`read_component` 只读盘上文件，返回 ok **不代表**编辑器能打开该组件（编辑器打开走自己的 XML 解析，重复属性就是这里炸）。

## 5. 发布与同步

- publish 产物（.bin + atlas）→ 游戏工程 assets/（运行时以 json 扩展名加载的要注意同步拷贝）。
- 组件 XML 改动后必须重新 publish + 拷贝，运行时不会读编辑器工程源文件。
