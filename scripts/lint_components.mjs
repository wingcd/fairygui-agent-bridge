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
 *   3. 引用缺失        —— src= 的 id / url= 的 ui://pkgId+itemId 在 package.xml 解析不到
 *   4. 图片名缺 .png   —— package.xml 里 image name 不带 .png 会被编辑器重复导入
 *   5. 子对象命名      —— 警告：name 为 n\d+ 裸编号（规范要求语义名）
 *   6. 发明类型标签    —— displayList 对象标签不在 10 种白名单内（编辑器解析丢对象/组件打不开）
 *   7. 非法 extention  —— 组件扩展值不在 8 种合法值内（CheckBox/Radio/View… 都不存在）
 *   8. 对象数超限      —— 警告：单组件显示对象 > 80（资源堆一个组件，该拆 cell/子组件）
 *   9. 九宫格越界      —— scale9grid 格式非法或中心区超出图片实际尺寸（读 png 头对账，STANDARDS §2.7）
 *  10. 九宫格缩小      —— 带九宫格的图显示 size 小于源图尺寸（四角块被压缩变形，STANDARDS §2.7）
 *  11. 包 id 格式      —— packageDescription id 必须恰为 8 位 [0-9a-z]（ui:// 定长保留位；kzlpcommon 10 字符事故，STANDARDS §2.8）
 *  12. 资源 id 字符集  —— package.xml 条目 id 只允许 [0-9a-z]（长度不限：实证 4~13 位都能加载，长度不是加载错误源）
 *  13. 登记存在性      —— package.xml 条目 path+name 指向的文件必须真实存在（移动/删除文件不同步登记，发布丢资源）
 *  14. fileName 对账   —— 警告：组件 XML fileName 与 src 登记路径不一致（编辑器按 src 定位仍可加载，但合并/移动后必须同步）
 *
 * 白名单依据：官方编辑器自身工程（fairygui/FairyGUI-Editor 仓库 288 个 XML）全量普查
 * + 官方 demo 工程交叉验证，见 STANDARDS.md §2.6。id/目录约定依据本机生产工程
 * （挪一挪猪等 5 包 481 条登记）普查实证，见 STANDARDS.md §2.8。
 * 跨包引用（pkg= / ui://他包id）按目标包的 package.xml 对账——11~14 与跨包解析配套。
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
  // 带合法九宫格的包内图片：id → {name, file}（loader 装包内图会复制源图 grid，一并纳入缩小检查）
  const gridById = new Map();
  for (const e of entries) {
    const id = (e.match(/ id="([^"]+)"/) || [])[1];
    const name = (e.match(/ name="([^"]+)"/) || [])[1];
    if (!id) continue;
    if (byId.has(id)) { console.log(`✗ ${pkgDir}/package.xml: id 重复 ${id}`); problems++; }
    byId.set(id, name || '');
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
        gridById.set(id, { name: name || id, file: imgFile });
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

  const compRoot = path.join(assetsDir, pkgDir, 'components');
  if (!fs.existsSync(compRoot)) continue;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.xml') ? [path.join(dir, d.name)] : []);
  for (const file of walk(compRoot)) {
    const rel = path.relative(root, file);
    const src = fs.readFileSync(file, 'utf8');
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
      // 必须按目标包的 package.xml 对账（挪一挪猪等真实工程存在合法跨包引用，按本包查会误报）
      for (const tg of line.matchAll(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g)) {
        const tag = tg[0];
        const v = (tag.match(/(?:src|url|defaultItem)="([^"]+)"/) || [])[1];
        if (v !== undefined) {
          if (v.startsWith('ui://')) {
            if (v.slice(5).includes('/')) { console.log(`✗ ${rel}:${ln} ui:// 格式为 pkgId+itemId 直连无斜杠：${v}`); problems++; }
            // ui:// 后前 8 位固定是包 id（STANDARDS §2.8）——先按它找到目标包
            const p8 = v.slice(5, 13);
            const ownerDir = pkgById.get(p8);
            if (!ownerDir) {
              console.log(`✗ ${rel}:${ln} 引用缺失 ${v}（包 id "${p8}" 不在本工程 assets/ 下，或长度≠8 位错位截取）`); problems++;
            } else {
              const itemId = v.slice(13);
              if (!PKGS.get(ownerDir).byId.has(itemId)) {
                console.log(`✗ ${rel}:${ln} 引用缺失 ${v}（itemId 不在 ${ownerDir}/package.xml）`); problems++;
              }
            }
          } else if (/^[0-9a-zA-Z]{4,13}$/.test(v)) {
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
      // STANDARDS §2.7：九宫格只放大不缩小——size 小于源图 = 四角块被压缩（圆角压扁/边框粗细不均）
      for (const u of line.matchAll(/<(image|loader)\b[^>]*>/g)) {
        const sId = (u[0].match(/ src="([^"]+)"/) || [])[1];
        const g = sId && gridById.get(sId);
        if (!g) continue;
        const sz = (u[0].match(/ size="([^"]+)"/) || [])[1];
        if (!sz) continue; // 无 size = 按源图原尺寸显示
        const [w, h] = sz.split(',').map(Number);
        if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
        const ps = pngSize(g.file);
        if (ps && (w < ps.w || h < ps.h)) {
          console.log(`✗ ${rel}:${ln} ${g.name} 带九宫格但 size="${sz}" 小于源图 ${ps.w}x${ps.h}（四角被压缩变形——只放大不缩小，见 STANDARDS §2.7）`);
          problems++;
        }
      }
    });
    // STANDARDS §2：禁止把所有资源堆进一个组件——显示对象超限说明该拆 cell/子组件
    const objCount = (src.match(/<(?:image|graph|loader|loader3D|text|richtext|list|component|jta|group)[\s/>]/g) || []).length;
    if (objCount > 80) {
      console.log(`⚠ ${rel} 显示对象 ${objCount} 个（>80，把资源堆一个组件了——按页面/复用件/cell 拆，见 STANDARDS §2）`);
    }
  }
}

console.log(problems ? `\n${problems} 个问题（✗ 阻断项）` : '\n✓ 全部通过');
process.exit(problems ? 1 : 0);
