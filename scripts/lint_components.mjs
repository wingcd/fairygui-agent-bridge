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
 *
 * 白名单依据：官方编辑器自身工程（fairygui/FairyGUI-Editor 仓库 288 个 XML）全量普查
 * + 官方 demo 工程交叉验证，见 STANDARDS.md §2.6。
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

const root = path.resolve(process.argv[2] || '.');
const assetsDir = path.join(root, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error(`no assets/ under ${root} — pass the project root containing assets/`);
  process.exit(2);
}

let problems = 0;

for (const pkgDir of fs.readdirSync(assetsDir)) {
  const pkgXml = path.join(assetsDir, pkgDir, 'package.xml');
  if (!fs.existsSync(pkgXml)) continue;
  const pkgId = (fs.readFileSync(pkgXml, 'utf8').match(/<packageDescription id="([^"]+)"/) || [])[1];
  const entries = [...fs.readFileSync(pkgXml, 'utf8').matchAll(/<(image|component|font|swf|movieclip|sound)\b[^>]*>/g)].map((m) => m[0]);
  const byId = new Map();
  for (const e of entries) {
    const id = (e.match(/ id="([^"]+)"/) || [])[1];
    const name = (e.match(/ name="([^"]+)"/) || [])[1];
    if (!id) continue;
    if (byId.has(id)) { console.log(`✗ ${pkgDir}/package.xml: id 重复 ${id}`); problems++; }
    byId.set(id, name || '');
    // FairyGUI 发布只收 exported="true" 的资源——缺这个 = 加载正常但发布静默丢（组件丢失事故）
    if (!/exported="true"/.test(e)) {
      console.log(`✗ ${pkgDir}/package.xml: ${e.slice(1, 30)}... 缺 exported="true"（发布会被静默丢弃）`);
      problems++;
    }
    if (e.startsWith('<image') && name && !name.endsWith('.png')) {
      console.log(`✗ ${pkgDir}/package.xml: image name 缺 .png 后缀 "${name}"（refresh 会重复导入）`);
      problems++;
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
      for (const r of line.matchAll(/(?:src|url)="([^"]+)"/g)) {
        const v = r[1];
        if (v.startsWith('ui://')) {
          if (v.slice(5).includes('/')) { console.log(`✗ ${rel}:${ln} ui:// 格式为 pkgId+itemId 直连无斜杠：${v}`); problems++; }
          const id = v.slice(5).replace(pkgId, '');
          if (!byId.has(id)) { console.log(`✗ ${rel}:${ln} 引用缺失 ${v}（itemId ${id} 不在 ${pkgDir}/package.xml）`); problems++; }
        } else if (/^[0-9a-z]{5,8}$/i.test(v) && !byId.has(v)) {
          console.log(`✗ ${rel}:${ln} 引用缺失 src=${v}（不在 ${pkgDir}/package.xml）`);
          problems++;
        }
      }
      for (const n of line.matchAll(/name="(n\d+)"/g)) {
        console.log(`⚠ ${rel}:${ln} 子对象裸编号名 ${n[1]}（规范要求语义名）`);
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
