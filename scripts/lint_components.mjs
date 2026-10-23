#!/usr/bin/env node
/**
 * lint_components.mjs — FairyGUI 手写组件 XML 规范检查（零依赖，Node 18+）
 *
 * 用法：node scripts/lint_components.mjs <工程根目录（含 assets/ 和 .fairy）>
 *       node scripts/lint_components.mjs .            # 在工程根目录下
 *
 * 检查项（全部来自真实事故，见 STANDARDS.md）：
 *   1. 重复属性        —— 非法 XML，编辑器双击组件必弹错误框
 *   2. 8 位颜色        —— #RRGGBBAA 部分运行时只取后 6 位（黑影变纯蓝事故）
 *   3. 引用缺失        —— src=/url=/defaultItem= 以及 icon=/titleIcon=/sound=/font= 的 ui://
 *                         引用在目标包 package.xml 解析不到（icon 类悬空全静默，STANDARDS §2.15）
 *   4. 图片名缺 .png   —— package.xml 里 image name 不带 .png 会被编辑器重复导入
 *   5. 子对象命名      —— 警告：name 为 n\d+ 裸编号（规范要求语义名）
 *   6. 发明类型标签    —— displayList 对象标签不在 10 种白名单内（编辑器解析丢对象/组件打不开）
 *   7. 非法 extention  —— 组件扩展值不在 8 种合法值内（CheckBox/Radio/View… 都不存在）
 *   8. 对象数超限      —— 警告：单组件显示对象 > 80（资源堆一个组件，该拆 cell/子组件）
 *   9. 九宫格越界      —— scale9grid 格式非法或中心区超出图片实际尺寸（读 png 头对账，STANDARDS §2.7）
 *  10. 九宫格压角      —— 带九宫格的图显示 size 小于四角宽高总和（图尺寸−中心区：四角放不下被压缩变形；
 *                         四角和~源图之间只压中间区角不动，合法。STANDARDS §2.7）
 *  11. 包 id 格式      —— packageDescription id 必须恰为 8 位 [0-9a-z]（ui:// 定长保留位；kzlpcommon 10 字符事故，STANDARDS §2.8）
 *  12. 资源 id 字符集  —— package.xml 条目 id 只允许 [0-9a-z]（长度不限：实证 4~13 位都能加载，长度不是加载错误源）
 *  13. 登记存在性      —— package.xml 条目 path+name 指向的文件必须真实存在（移动/删除文件不同步登记，发布丢资源）
 *  14. fileName 对账   —— 警告：组件 XML fileName 与 src 登记路径不一致（编辑器按 src 定位仍可加载，但合并/移动后必须同步）
 *  15. 组件命名拼装    —— 警告：组件名 >28 字/版本复制后缀/同文件夹同名双登记/单文件夹组件 >25（STANDARDS §2.9）
 *  16. 单图纯转发组件  —— 警告：displayList 只有一个 image 且无 extention/controller/transition/gear（包一层零能力纯开销，STANDARDS §2.10）
 *  17. 同构行未合并    —— 警告：同文件夹内结构指纹相同的组件 ≥4 个（每行建了组件文件，应一个 cell + list，STANDARDS §2.11）
 *  18. 单选未关联控制器 —— 警告：静态 radio 实例缺 controller="名" page="N" 关联（互斥选中/初始态/联动
 *                         退化为代码手工管理，STANDARDS §2.13）
 *  19. 全屏贴底漏绑    —— 警告：全屏量级组件里贴底元素未绑 bottom 类 relation 也未入绑底的组
 *                         （FitWidth 适配下底部悬空露边，STANDARDS §2.14）
 *  20. 单件转发层      —— 警告：displayList 只有一个 component 且无 extention/controller/transition/gear
 *                         （组件包组件纯转发：使用方可直接引用内层组件，STANDARDS §2.16）
 *  21. 磁盘孤儿        —— 警告：编辑器可消费类型文件（图片/音频/ttf/xml）在包目录里但 package.xml
 *                         未登记——编辑器看不见、发布不带（STANDARDS §2.15 形态③）
 *
 * 白名单依据：官方编辑器自身工程（fairygui/FairyGUI-Editor 仓库 288 个 XML）全量普查
 * + 官方 demo 工程交叉验证，见 STANDARDS.md §2.6。id/目录约定依据本机生产工程
 * （挪一挪猪等 5 包 481 条登记）普查实证，见 STANDARDS.md §2.8。跨包引用（pkg= /
 * ui://他包id）按目标包的 package.xml 对账——11~14 与跨包解析配套。组件命名与
 * 文件夹隔离依据本机十余生产工程 8 包全量普查（名字主体 7~17 字、全机最长 28、
 * 同名组件跨文件夹大量合法共存、单文件夹最多 21 个），见 STANDARDS.md §2.9。
 * 单图包装依据 CopyCat 复原工程（taptap_maker）导出器事故 + 生产 Reddot 存量实证，
 * 见 STANDARDS.md §2.10。同构行依据 taptap_maker 7 组实证（字节级相同×10、只差
 * text 值×20）+ 生产 6 工程零命中，见 STANDARDS.md §2.11。单选关联依据 taptap_maker
 * 反例（Catalog/RacePreparation/Settings 十余 radio 实例零关联）+ 挪一挪猪正例
 * （AchievementWindow `<Button controller="mode" page="N"/>`）实证，见 STANDARDS.md §2.13。
 * 贴底绑定依据 BricksBreakerRPG Stash（改后全链路正例）vs Shop（全裸放反例）+ 锦鹏系
 * 5 工程窗口式 UI 零命中实证，见 STANDARDS.md §2.14。单件转发层依据 kaizong_lipai
 * （CopyCat 导出）22 个纯包装实证（ren-001/node_* 只带一份实例变换属性）+ 手作 5 工程
 * 零命中（唯一同形态 EffectContainer 带 extention="Label" 被逻辑豁免）；引用链深实证
 * 手作 ≤3、导出复原工程到 5，见 STANDARDS.md §2.16。磁盘孤儿依据挪一挪猪
 * game/images/dycollect/2.jpg 真实存量 + 6 工程其余零误报（登记 path 大小写与磁盘
 * 不一致的生产脏数据实证——对账必须大小写不敏感），见 STANDARDS.md §2.15。
 *
 * 退出码：有问题=1（可配合 CI/预提交拦截），干净=0
 */
import fs from 'node:fs';
import path from 'node:path';

// STANDARDS.md §2.6：FairyGUI 对象类型封闭集合，禁止发明
// displayList 显示对象标签（10 种）
const OBJ_TAGS = new Set(['image', 'graph', 'loader', 'loader3D', 'text', 'richtext', 'list', 'component', 'jta', 'group']);
// 组件 XML 里其余合法结构标签：根/结构/控制器动作/关系/时间轴/gear*/list item/扩展属性元素
const STRUCT_TAGS = new Set([
  'component', 'displayList', 'controller', 'action', 'relation', 'transition', 'item',
  'Button', 'Label', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar', 'List', 'Tree',
]);
const KNOWN_TAGS = new Set([...OBJ_TAGS, ...STRUCT_TAGS]);
// 根元素 extention 合法值（无 CheckBox/Radio——那是 Button 的 mode）
const EXTENTIONS = new Set(['Button', 'Label', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar', 'List', 'Tree']);

// 读 PNG IHDR 取宽高（文件缺失/非 png 返回 null，跳过越界检查）
const pngCache = new Map();
function pngSize(file) {
  if (pngCache.has(file)) return pngCache.get(file);
  let size = null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(24);
      if (fs.readSync(fd, buf, 0, 24, 0) !== 24) return null;
      if (buf.readUInt32BE(0) !== 0x89504e47) return null; // PNG 签名
      size = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    } finally {
      fs.closeSync(fd);
    }
  } catch { return null; }
  pngCache.set(file, size);
  return size;
}

const root = path.resolve(process.argv[2] || '.');
const assetsDir = path.join(root, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error(`no assets/ under ${root} — pass the project root containing assets/`);
  process.exit(2);
}

// displayList 内容按标签配平深度切出直接子件（STANDARDS §2.14 贴底检查用：嵌套子件
// 的 xy/relation 属于被引用组件内部，不能当本组件顶层几何）
function topLevel(dl) {
  const out = [];
  const tokens = [...dl.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\s*(\/?)>/g)];
  let depth = 0, cur = null, innerStart = 0;
  for (const t of tokens) {
    if (t[1]) { // 闭标签
      if (depth > 0) depth--;
      if (depth === 0 && cur) { cur.inner = dl.slice(innerStart, t.index); out.push(cur); cur = null; }
      continue;
    }
    // 自闭合看全文结尾：attrs 段允许 "/"（fileName/url 里合法），组捕获会被吞掉
    const selfClose = t[0].endsWith('/>');
    if (depth === 0) {
      cur = { tag: t[2], attrs: t[3] || '', inner: '' };
      if (selfClose) out.push(cur);
      else { depth = 1; innerStart = t.index + t[0].length; }
    } else if (!selfClose) depth++;
  }
  return out;
}

let problems = 0;

// 预扫描全部包：包 id、登记条目、id→登记相对路径。
// 跨包引用（pkg="他包id" / ui://他包id+itemId）要按目标包对账，必须先有全工程索引。
const PKGS = new Map();     // 包目录名 → { pkgId, entries, pathOf }
const pkgById = new Map();  // 包 id → 包目录名
for (const pkgDir of fs.readdirSync(assetsDir)) {
  const pkgXml = path.join(assetsDir, pkgDir, 'package.xml');
  if (!fs.existsSync(pkgXml)) continue;
  const raw = fs.readFileSync(pkgXml, 'utf8');
  const pkgId = (raw.match(/<packageDescription id="([^"]+)"/) || [])[1];
  const entries = [...raw.matchAll(/<(image|component|font|swf|movieclip|sound)\b[^>]*>/g)].map((m) => m[0]);
  const pathOf = new Map(); // 资源 id → 登记相对路径（path+name，fileName 对账与存在性检查共用）
  const byId = new Map();   // 资源 id → name（先建全工程份，供其它包的跨包引用检查）
  for (const e of entries) {
    const id = (e.match(/ id="([^"]+)"/) || [])[1];
    const name = (e.match(/ name="([^"]+)"/) || [])[1];
    if (!id || !name) continue;
    const p = ((e.match(/ path="([^"]+)"/) || [])[1] || '/').replace(/^\/+|\/+$/g, '');
    pathOf.set(id, p ? `${p}/${name}` : name);
    byId.set(id, name);
  }
  PKGS.set(pkgDir, { pkgId, entries, pathOf, byId });
  if (pkgId) {
    if (pkgById.has(pkgId)) {
      console.log(`✗ 包 id 冲突：${pkgById.get(pkgId)} 与 ${pkgDir} 同为 "${pkgId}"（ui:// 解析二义，必须改一个）`);
      problems++;
    } else {
      pkgById.set(pkgId, pkgDir);
    }
  }
}

// STANDARDS §2.13 预扫描：全工程 radio 皮肤件索引（包目录名 → Set(资源 id)）。
// mode="Radio" 住在皮肤件根 Button 上，使用方内嵌 <Button> 常省略 mode——判定
// "component 引用是不是单选实例"必须反查目标皮肤件（跨包引用一并覆盖）。
const walkXml = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walkXml(path.join(dir, d.name)) : d.name.endsWith('.xml') ? [path.join(dir, d.name)] : []);
// 全文件遍历（跳隐藏文件/目录）——磁盘孤儿对账用（§2.15 形态③）
const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.name.startsWith('.') ? [] : d.isDirectory() ? walkFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const radioSkins = new Map();
for (const [pd, P] of PKGS) {
  const compRoot = path.join(assetsDir, pd, 'components');
  if (!fs.existsSync(compRoot)) continue;
  const rev = new Map(); // 登记相对路径 → 资源 id（pathOf 反查；双登记脏数据任取其一）
  for (const [id, rel] of P.pathOf) if (rel && rel.endsWith('.xml')) rev.set(rel, id);
  for (const file of walkXml(compRoot)) {
    if (!/<Button\b[^>]*mode="Radio"/.test(fs.readFileSync(file, 'utf8'))) continue;
    const id = rev.get(path.relative(path.join(assetsDir, pd), file).replace(/\\/g, '/'));
    if (id) {
      if (!radioSkins.has(pd)) radioSkins.set(pd, new Set());
      radioSkins.get(pd).add(id);
    }
  }
}

for (const [pkgDir, P] of PKGS) {
  const { pkgId, entries, pathOf } = P;
  // STANDARDS §2.8：包 id 是 ui:// 的定长 8 字符保留位——非 8 位小写字母数字 = 全包引用错位
  if (!pkgId) {
    console.log(`✗ ${pkgDir}/package.xml: 缺包 id（<packageDescription id="…">）`);
    problems++;
  } else if (!/^[0-9a-z]{8}$/.test(pkgId)) {
    console.log(`✗ ${pkgDir}/package.xml: 包 id "${pkgId}" 非法——必须恰为 8 位小写字母数字（ui:// 定长保留位，非 8 位全包引用错位/编辑器整包报错；kzlpcommon 10 字符事故，见 STANDARDS §2.8）`);
    problems++;
  }
  const byId = new Map();
  // 带合法九宫格的包内图片：id → {name, file, gw, gh}（loader 装包内图会复制源图 grid，一并纳入压角检查）
  const gridById = new Map();
  // STANDARDS §2.9：组件名不拼装变长——版本/复制后缀检查（Copy/Old 不查：BtnCopy、*Gold 是合法名，误报实证）
  const VER_SUFFIX = /((new|bak|final)\d*|v\d+|\(\d+\))$/i;
  const regSeen = new Map();     // 归一化 path|name → 首见 id（同文件夹同名双登记检查）
  const compPerPath = new Map(); // 文件夹 → 组件数（平铺一把梭检查）
  for (const e of entries) {
    const id = (e.match(/ id="([^"]+)"/) || [])[1];
    const name = (e.match(/ name="([^"]+)"/) || [])[1];
    if (!id) continue;
    if (byId.has(id)) { console.log(`✗ ${pkgDir}/package.xml: id 重复 ${id}`); problems++; }
    byId.set(id, name || '');
    // STANDARDS §2.9：组件名只回答"它是什么"——模块归属归文件夹（§1）、变体归引擎配置（§2.5）、
    // 版本归原名迭代（§6）、唯一性归 id（§2.8）。名字被迫当唯一键用就会无限拼定语变长。
    const dir = ((e.match(/ path="([^"]+)"/) || [])[1] || '/').replace(/\/+$/, '') || '/';
    if (name) {
      // path+name 定位同一份文件：同文件夹两条同名登记 = 两个 id 指向一个文件，登记歧义
      // （跨文件夹同名合法——引用走 id 不走名字，实证 fsjnh 六个模块各一份 AwardItem.xml）
      const sameFile = `${dir}|${name}`;
      if (regSeen.has(sameFile)) {
        console.log(`⚠ ${pkgDir}/package.xml: ${dir === '/' ? '根目录' : dir} 下 "${name}" 重复登记（id ${regSeen.get(sameFile)} 与 ${id} 指向同一文件——登记歧义，去重或挪文件夹，见 STANDARDS §2.9）`);
      } else {
        regSeen.set(sameFile, id);
      }
    }
    if (e.startsWith('<component') && name) {
      const base = name.replace(/\.xml$/i, '');
      if (base.length > 28) {
        console.log(`⚠ ${pkgDir}/package.xml: 组件名 "${base}" ${base.length} 字拼装过长（生产普查全机最长 28——模块归属交文件夹、变体交 controller/gear、迭代改原名，别往名字里拼下一个定语，见 STANDARDS §2.9）`);
      }
      if (VER_SUFFIX.test(base)) {
        console.log(`⚠ ${pkgDir}/package.xml: 组件名 "${base}" 带版本/复制后缀（在原名上迭代：改名=引用断链、留副本=死资源，见 STANDARDS §2.9/§6）`);
      }
      compPerPath.set(dir, (compPerPath.get(dir) || 0) + 1);
    }
    // STANDARDS §2.8：资源 id 字符集 [0-9a-z]（长度不限——实证 4~13 位都能加载，长度不是加载错误源，
    // 别拿"id 太长/太短"当加载失败的原因）
    if (!/^[0-9a-zA-Z]+$/.test(id)) {
      console.log(`✗ ${pkgDir}/package.xml: 资源 id "${id}" 含非法字符（只允许 0-9a-z，编辑器风格全小写）`);
      problems++;
    } else if (!/^[0-9a-z]+$/.test(id)) {
      console.log(`⚠ ${pkgDir}/package.xml: 资源 id "${id}" 含大写字母（编辑器生成风格是小写 base36，大小写混用易撞车）`);
    }
    // STANDARDS §6：登记与磁盘对账——文件移动/删除后不同步 package.xml，编辑器容受但发布丢资源
    const reg = pathOf.get(id);
    if (name && reg && !fs.existsSync(path.join(assetsDir, pkgDir, reg))) {
      console.log(`✗ ${pkgDir}/package.xml: 登记的文件不存在 ${reg}（移动/删除文件后未同步登记，见 STANDARDS §6）`);
      problems++;
    }
    // FairyGUI 发布只收 exported="true" 的资源——缺这个 = 加载正常但发布静默丢（组件丢失事故）
    if (!/exported="true"/.test(e)) {
      console.log(`✗ ${pkgDir}/package.xml: ${e.slice(1, 30)}... 缺 exported="true"（发布会被静默丢弃）`);
      problems++;
    }
    if (e.startsWith('<image') && name && !/\.[a-zA-Z0-9]+$/.test(name)) {
      console.log(`✗ ${pkgDir}/package.xml: image name 缺扩展名 "${name}"（须带 .png/.jpg 等，不带 refresh 会重复导入）`);
      problems++;
    }
    // STANDARDS §2.7：scale9grid 中心区必须在图内——越界格线 = 切错图，拉伸必炸
    const grid = (e.match(/ scale9grid="([^"]+)"/) || [])[1];
    if (grid) {
      const parts = grid.split(',').map(Number);
      const [gx, gy, gw, gh] = parts;
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        console.log(`✗ ${pkgDir}/package.xml: scale9grid="${grid}" 非法（须为 4 个整数）`);
        problems++;
      } else if (gw < 1 || gh < 1 || gx < 0 || gy < 0) {
        // 官方编辑器自己会在 svg 图标上写出负值格线（源尺寸/显示尺寸换算怪癖），降为警告
        console.log(`⚠ ${pkgDir}/package.xml: scale9grid="${grid}" 含负值/零（${name}——svg 上的编辑器怪癖可忽略，手写的须改）`);
      } else {
        const p = (e.match(/ path="([^"]+)"/) || [])[1] || '/';
        const imgFile = path.join(assetsDir, pkgDir, p, name || '');
        gridById.set(id, { name: name || id, file: imgFile, gw, gh });
        const size = pngSize(imgFile);
        if (size) {
          if (gx + gw > size.w || gy + gh > size.h) {
            console.log(`✗ ${pkgDir}/package.xml: ${name} scale9grid="${grid}" 越界（图实际 ${size.w}x${size.h}，中心区必须整块落在图内）`);
            problems++;
          }
        }
      }
    }
  }

  // STANDARDS §2.9：单文件夹堆组件——模块隔离靠文件夹，不靠平铺一把再让名字去区分模块
  // （生产普查单文件夹最多 21 个：Basic 包 /Button/；gm 包 15 个平铺根目录也正常加载——组织纪律非阻断）
  for (const [dir, n] of compPerPath) {
    if (n > 25) {
      console.log(`⚠ ${pkgDir}/package.xml: ${dir === '/' ? '根目录' : dir} 平铺 ${n} 个组件（>25，生产普查单文件夹最多 21——按模块拆子文件夹，见 STANDARDS §1/§2.9）`);
    }
  }

  // STANDARDS §2.15 形态③：磁盘孤儿——与检查 13（登记了但文件不在）合成双向对账。只查编辑器
  // 可消费类型（图片/音频/ttf 字体/xml 组件）；.fui/.json 等发布产物或杂物编辑器本就不导入，不报。
  // 对账必须大小写不敏感：生产实证登记 path="/images/dyCollect/" 与磁盘 dycollect/ 并存（挪一挪猪）。
  {
    const regFiles = new Set([...pathOf.values()].filter(Boolean).map((v) => v.toLowerCase()));
    const CONSUMABLE = new Set(['png', 'jpg', 'jpeg', 'svg', 'jta', 'mp3', 'wav', 'ttf', 'xml']);
    const pkgRoot = path.join(assetsDir, pkgDir);
    for (const f of walkFiles(pkgRoot)) {
      const rel = path.relative(pkgRoot, f).split(path.sep).join('/').toLowerCase();
      if (rel === 'package.xml' || !CONSUMABLE.has(rel.split('.').pop())) continue;
      if (!regFiles.has(rel)) {
        console.log(`⚠ ${pkgDir}/${rel} 磁盘孤儿（文件在包目录但 package.xml 未登记——编辑器看不见、发布不带；要么关编辑器补登记再重启加载，要么删掉，见 STANDARDS §2.15）`);
      }
    }
  }

  const compRoot = path.join(assetsDir, pkgDir, 'components');
  if (!fs.existsSync(compRoot)) continue;
  // STANDARDS §2.11：同构行收敛——同文件夹内结构指纹相同的组件 ≥4 个 = 每行建了组件文件。
  // 指纹 = 剥离 id/name/fileName/text 值与元素内文本（保留 src/几何/颜色/字号）后的全文：
  // 字节级相同（WGongfa1×10）与只差 text 值（WKaishi1×20）都算同构；底图/尺寸/子件不同是真差异
  // （NormalButton 变体家族、suo 家族）不算；跨模块文件夹的同名组件合法（§2.9）不在本查范围。
  const rowFp = new Map(); // 目录 → Map(指纹 → {n, first, second})
  for (const file of walkXml(compRoot)) {
    const rel = path.relative(root, file);
    const src = fs.readFileSync(file, 'utf8');
    {
      const dir = path.dirname(file);
      const fp = src
        .replace(/\s(?:id|name|fileName|text|prompt)="[^"]*"/g, '')
        .replace(/>([^<>]*)</g, '><')
        .replace(/\s+/g, ' ');
      if (!rowFp.has(dir)) rowFp.set(dir, new Map());
      const g = rowFp.get(dir);
      const cur = g.get(fp) || { n: 0, first: path.basename(file), second: path.basename(file) };
      if (cur.n === 1) cur.second = path.basename(file);
      cur.n++;
      g.set(fp, cur);
    }
    src.split('\n').forEach((line, i) => {
      const ln = i + 1;
      for (const m of line.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)) {
        const attrs = [...m[2].matchAll(/\s([\w:]+)="/g)].map((x) => x[1]);
        const seen = new Set();
        const dup = attrs.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
        if (dup.length) { console.log(`✗ ${rel}:${ln} 重复属性 ${[...new Set(dup)].join(',')}`); problems++; }
      }
      // STANDARDS §2.6：类型封闭集合——未知标签一律拦（输入框是 text input="true"，动画是 jta）
      for (const t of line.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])/g)) {
        const tag = t[1];
        if (!KNOWN_TAGS.has(tag) && !tag.startsWith('gear')) {
          console.log(`✗ ${rel}:${ln} 发明的标签 <${tag}>——FairyGUI 不支持（displayList 只允许 ${[...OBJ_TAGS].join('/')}，见 STANDARDS §2.6）`);
          problems++;
        }
      }
      for (const e of line.matchAll(/extention="([^"]*)"/g)) {
        if (!EXTENTIONS.has(e[1])) {
          console.log(`✗ ${rel}:${ln} 非法 extention="${e[1]}"——合法值 ${[...EXTENTIONS].join('/')}（复选/单选是 Button 的 mode，不是扩展）`);
          problems++;
        }
      }
      if (/extension="/.test(line)) {
        console.log(`✗ ${rel}:${ln} 拼写错误 extension=——FairyGUI 的属性名是 extention`);
        problems++;
      }
      for (const c of line.matchAll(/color="(#[0-9a-fA-F]*)"/g)) {
        if (!/^#[0-9a-fA-F]{6}$/.test(c[1])) {
          console.log(`✗ ${rel}:${ln} 颜色须为 6 位 #RRGGBB（用 alpha 属性表达透明度），现为 ${c[1]}`);
          problems++;
        }
      }
      // 引用解析按整个标签看：src= 裸 id 指本包；带 pkg= 或 ui://前 8 位是包 id 的指他包，
      // 必须按目标包的 package.xml 对账（挪一挪猪等真实工程存在合法跨包引用，按本包查会误报）。
      // STANDARDS §2.15：icon/titleIcon/sound/font 同为资源引用（Button/Label 的图标、text 的
      // 位图字体），只认 ui:// 形态——font="家族名" 明文不是引用不查；这类引用悬空时编辑器
      // 与运行时都静默容受（图标/字体空白无报错），必须机器拦。
      for (const tg of line.matchAll(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g)) {
        const tag = tg[0];
        for (const am of tag.matchAll(/\b(src|url|defaultItem|icon|titleIcon|sound|font)="([^"]+)"/g)) {
          const attr = am[1];
          const v = am[2];
          if (v.startsWith('ui://')) {
            if (v.slice(5).includes('/')) { console.log(`✗ ${rel}:${ln} ui:// 格式为 pkgId+itemId 直连无斜杠：${v}`); problems++; }
            // ui:// 后前 8 位固定是包 id（STANDARDS §2.8）——先按它找到目标包
            const p8 = v.slice(5, 13);
            const ownerDir = pkgById.get(p8);
            if (!ownerDir) {
              console.log(`✗ ${rel}:${ln} 引用缺失 ${attr}=${v}（包 id "${p8}" 不在本工程 assets/ 下，或长度≠8 位错位截取）`); problems++;
            } else {
              const itemId = v.slice(13);
              if (!PKGS.get(ownerDir).byId.has(itemId)) {
                console.log(`✗ ${rel}:${ln} 引用缺失 ${attr}=${v}（itemId 不在 ${ownerDir}/package.xml——悬空引用无任何报错，编辑器/运行时图标或字体直接空白，见 STANDARDS §2.15）`); problems++;
              }
            }
          } else if ((attr === 'src' || attr === 'url' || attr === 'defaultItem') && /^[0-9a-zA-Z]{4,13}$/.test(v)) {
            const pkgAttr = (tag.match(/ pkg="([^"]+)"/) || [])[1];
            const ownerDir = pkgAttr ? pkgById.get(pkgAttr) : pkgDir;
            if (pkgAttr && !ownerDir) {
              console.log(`✗ ${rel}:${ln} 引用缺失 pkg="${pkgAttr}"（本工程 assets/ 下没有这个包 id）`); problems++;
            } else if (!PKGS.get(ownerDir).byId.has(v)) {
              console.log(`✗ ${rel}:${ln} 引用缺失 src=${v}（不在 ${ownerDir}/package.xml${pkgAttr ? `，pkg="${pkgAttr}"` : ''}）`); problems++;
            }
          }
        }
        // STANDARDS §6：fileName 与登记对账——编辑器按 src 定位所以错 fileName 仍能加载（真实工程有此脏数据），
        // 只警告不阻断；但批量合并/移动文件后不同步 fileName 就是断链隐患
        const fn = (tag.match(/ fileName="([^"]+)"/) || [])[1];
        if (fn) {
          const pkgAttr = (tag.match(/ pkg="([^"]+)"/) || [])[1];
          const ownerDir = pkgAttr ? pkgById.get(pkgAttr) : pkgDir;
          const owner = ownerDir ? PKGS.get(ownerDir) : null;
          if (!owner) {
            console.log(`⚠ ${rel}:${ln} fileName="${fn}" 指向未知包 pkg="${pkgAttr}"`);
          } else {
            const sid = (tag.match(/ src="([^"]+)"/) || [])[1];
            const regPath = sid ? owner.pathOf.get(sid) : null;
            if (regPath && regPath !== fn.replace(/^\/+/, '')) {
              console.log(`⚠ ${rel}:${ln} fileName="${fn}" 与登记路径 ${regPath} 不一致（编辑器按 src 定位仍可加载；合并/移动文件后必须同步，见 STANDARDS §6）`);
            }
          }
        }
      }
      for (const n of line.matchAll(/name="(n\d+)"/g)) {
        console.log(`⚠ ${rel}:${ln} 子对象裸编号名 ${n[1]}（规范要求语义名）`);
      }
      // STANDARDS §2.7：使用尺寸的下限是四角宽高总和（横向=图宽−中心宽，纵向=图高−中心高）——
      // 小于四角总和 = 角放不下被压缩（圆角压扁/边框粗细不均）；四角和~源图之间只压缩中间区，角不动
      for (const u of line.matchAll(/<(image|loader)\b[^>]*>/g)) {
        const sId = (u[0].match(/ src="([^"]+)"/) || [])[1];
        const g = sId && gridById.get(sId);
        if (!g) continue;
        const sz = (u[0].match(/ size="([^"]+)"/) || [])[1];
        if (!sz) continue; // 无 size = 按源图原尺寸显示
        const [w, h] = sz.split(',').map(Number);
        if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
        const ps = pngSize(g.file);
        if (!ps) continue;
        const frameW = ps.w - g.gw, frameH = ps.h - g.gh;
        if (w < frameW || h < frameH) {
          console.log(`✗ ${rel}:${ln} ${g.name} 带九宫格但 size="${sz}" 小于四角宽高总和 ${frameW}x${frameH}（图 ${ps.w}x${ps.h} 中心区 ${g.gw}x${g.gh}——四角放不下被压缩变形，尺寸下限是四角总和不是源图尺寸，见 STANDARDS §2.7）`);
          problems++;
        }
      }
    });
    // STANDARDS §2：禁止把所有资源堆进一个组件——显示对象超限说明该拆 cell/子组件
    const objCount = (src.match(/<(?:image|graph|loader|loader3D|text|richtext|list|component|jta|group)[\s/>]/g) || []).length;
    if (objCount > 80) {
      console.log(`⚠ ${rel} 显示对象 ${objCount} 个（>80，把资源堆一个组件了——按页面/复用件/cell 拆，见 STANDARDS §2）`);
    }
    // STANDARDS §2.10/§2.16：单件纯转发层——displayList 只有一个 image 或 component 且无
    // extention/controller/transition/gear。包一层不新增任何能力（image 本身有 color/alpha/size/
    // scale9grid/relations/gear；component 实例自带 xy/scale/pivot/size——"只带一份变换属性"
    // 不是包装理由），却多一份登记、深一层引用链（改内层要穿透两层）。graph/loader/text 等
    // 单件另有语义（占位槽/头像槽），不查（§2.10 边界）。
    // 依据：taptap_maker 导出器残留 lbl_info1.xml + 生产存量 Reddot.xml（每包 1~2 个，容忍不再新增）；
    // 组件包组件形态 kaizong_lipai 22 个（ren-001/node_*）实证，手作 5 工程零命中。
    // 只查文件里恰一个 displayList 且无 list/item 内联（嵌套 displayList 会数错直接子件）。
    if ((src.match(/<displayList>/g) || []).length === 1) {
      const dl = src.match(/<displayList>([\s\S]*?)<\/displayList>/);
      if (dl && !/<(?:list|item)\b/.test(dl[1])) {
        const kids = [...dl[1].matchAll(/<([a-zA-Z][a-zA-Z0-9]*)[\s/>]/g)].map((m) => m[1]).filter((t) => OBJ_TAGS.has(t));
        // 扩展元素首字母大写（<Button>…），与对象标签 <button> 不冲突；gearXY/gearDisplay 等以 gear+大写开头
        const noLogic = !/extention=|<controller|<transition|<action|gear[A-Z]|<(?:Button|Label|ComboBox|ProgressBar|Slider|ScrollBar|List|Tree)\b/.test(src);
        if (kids.length === 1 && noLogic && (kids[0] === 'image' || kids[0] === 'component')) {
          const why = kids[0] === 'image'
            ? 'displayList 只有一个 image、无 extention/controller/transition/gear——直接在使用方 <image src=>，见 STANDARDS §2.10'
            : 'displayList 只有一个 component、无 extention/controller/transition/gear——使用方可直接引用内层组件（xy/scale/pivot/size 是实例属性，写在引用处即可），见 STANDARDS §2.16';
          console.log(`⚠ ${rel} 单件纯转发组件（${why}）`);
        }
      }
    }
    // STANDARDS §2.13：单选组必须 controller 化——displayList 里静态引用的单选实例必须关联
    // 本组件定义的控制器。运行时互斥选中/初始态/内容联动全靠 relatedController（GButton.selected
    // → controller.SetSelected(page)；controller 变页 → HandleControllerChanged 同步选中，零代码）；
    // 缺关联的"单选组"互斥失去分组依据，只能代码手工管理每个按钮的 selected（taptap_maker
    // Catalog filter0~2、RacePreparation 三组调校、Settings 画质组全部无关联实证）。边界：
    // list 的 <item> 内联引用（动态行单选，互斥归 itemRenderer/onClickItem）、Check 模式
    // （单开关无互斥需求）、皮肤件定义处（根级 Button mode="Radio"，关联发生在使用方）不查。
    {
      // 剥掉 list <item> 内联区段：行是数据不是静态结构，嵌套 item 顶多漏报不会误报
      const staticPart = src.replace(/<item\b[\s\S]*?<\/item>/g, '');
      const myCtrls = new Set([...src.matchAll(/<controller\b[^>]*\sname="([^"]+)"/g)].map((m) => m[1]));
      for (const cm of staticPart.matchAll(/<component\b[^>]*>/g)) {
        const tag = cm[0];
        const v = (tag.match(/\b(?:src|url)="([^"]+)"/) || [])[1];
        if (!v) continue; // 根元素/无引用的 component 不查
        let ownerDir = pkgDir;
        let itemId = v;
        if (v.startsWith('ui://')) {
          ownerDir = pkgById.get(v.slice(5, 13));
          itemId = v.slice(13);
        } else {
          const pkgAttr = (tag.match(/\bpkg="([^"]+)"/) || [])[1];
          if (pkgAttr) ownerDir = pkgById.get(pkgAttr);
        }
        const isRadioSkin = ownerDir && radioSkins.get(ownerDir)?.has(itemId);
        const bm = staticPart.slice(cm.index + tag.length).match(/^\s*<Button\b([^>]*?)\/?>/);
        const btn = bm ? bm[1] : '';
        if (!isRadioSkin && !/mode="Radio"/.test(btn)) continue;
        const name = (tag.match(/\bname="([^"]+)"/) || [])[1] || (tag.match(/\bid="([^"]+)"/) || [])[1] || itemId;
        const ctrl = (btn.match(/\bcontroller="([^"]+)"/) || [])[1];
        if (!ctrl) {
          console.log(`⚠ ${rel} 单选实例 "${name}" 未关联 controller（${tag.endsWith('/>') ? '自闭合引用无内嵌' : '内嵌 <Button> 缺'} controller="名" page="N"——互斥选中/初始态/联动退化为代码手工管理，见 STANDARDS §2.13）`);
        } else if (!myCtrls.has(ctrl)) {
          console.log(`⚠ ${rel} 单选实例 "${name}" 关联的 controller "${ctrl}" 不在本组件定义（悬空等同未关联，见 STANDARDS §2.13）`);
        }
      }
    }
    // STANDARDS §2.14：全屏页面贴底必绑——FitWidth 等比适配下富余高度累积在底部，贴底元素
    // （y+h≈组件高）不绑 bottom 类 relation、也不进绑了底的组，实际屏幕上底部悬空/露边
    // （BricksBreakerRPG Stash 底部导航改前实证：改后底栏组 bottom-bottom + 容量条组对组
    // bottom-top 链式锚定）。只查全屏量级组件（短边≥700 长边≥1000：720x1280/750x1334/
    // 1000x2000 全屏页面；644x1049 窗口、800x600 框架不查——锦鹏系生产工程全是 WindowFrame
    // 居中弹窗，全屏件仅 mask/transition 框架，实证无此需求）。豁免：自带 bottom/height-height
    // relation（height-height 高度跟随、底边自动贴底）；所归组绑了 bottom（组绑一次成员全跟随）。
    {
      const [rw, rh] = (src.match(/<component\b[^>]*\bsize="(\d+),(\d+)"/) || []).slice(1).map(Number);
      if (rw && rh && Math.min(rw, rh) >= 700 && Math.max(rw, rh) >= 1000) {
        // 贪婪到最后一个 </displayList>：滚动容器等内嵌 <displayList> 时非贪婪只切到最内层闭合，
        // 顶层后半段元素全部漏检（BricksBreakerRPG Shop.xml content 内嵌 displayList 实证）
        const dlBody = src.match(/<displayList>([\s\S]*)<\/displayList>/);
        if (dlBody) {
          const tops = topLevel(dlBody[1]);
          const grpRel = new Map(); // 组 id → 组上 relation 的 sidePair
          for (const el of tops) {
            if (el.tag !== 'group') continue;
            const gid = (el.attrs.match(/\bid="([^"]+)"/) || [])[1];
            if (gid) grpRel.set(gid, (el.inner.match(/<relation\b[^>]*\bsidePair="([^"]+)"/) || [])[1] || '');
          }
          for (const el of tops) {
            const [x, y] = (el.attrs.match(/\bxy="(-?\d+),(-?\d+)"/) || []).slice(1).map(Number);
            const [w, h] = (el.attrs.match(/\bsize="(\d+),(\d+)"/) || []).slice(1).map(Number);
            if (!Number.isFinite(y) || !Number.isFinite(h)) continue;
            if (Math.abs(y + h - rh) > 4) continue; // 不贴底
            const sp = (el.inner.match(/<relation\b[^>]*\bsidePair="([^"]+)"/) || [])[1] || '';
            if (/bottom|height-height/.test(sp)) continue;
            if (el.tag !== 'group') {
              const gid = (el.attrs.match(/\bgroup="([^"]+)"/) || [])[1];
              if (gid && /bottom|height-height/.test(grpRel.get(gid) || '')) continue;
            }
            const name = (el.attrs.match(/\bname="([^"]+)"/) || [])[1] || (el.attrs.match(/\bid="([^"]+)"/) || [])[1] || el.tag;
            console.log(`⚠ ${rel} 全屏组件内 "${name}" 贴底未绑定（y+h=${y + h}≈组件高${rh}：自身无 bottom/height 类 relation、所归组也未绑——FitWidth 适配下富余高度堆在底部，底部悬空露边；底栏绑 bottom-bottom 或成组后组上绑、整幅背景/弹性区绑 height-height，见 STANDARDS §2.14）`);
          }
        }
      }
    }
  }
  // STANDARDS §2.11 报告：按文件夹分组输出 ≥4 个同构指纹的组件组
  for (const [dir, g] of rowFp) {
    for (const { n, first, second } of g.values()) {
      if (n >= 4) {
        console.log(`⚠ ${path.relative(root, dir)} ${n} 个同构组件（如 ${first}、${second}…结构指纹相同只差文本/编号——抽一个 cell + list（flow_vt + defaultItem + itemRenderer 喂数据），见 STANDARDS §2.11）`);
      }
    }
  }
}

console.log(problems ? `\n${problems} 个问题（✗ 阻断项）` : '\n✓ 全部通过');
process.exit(problems ? 1 : 0);
