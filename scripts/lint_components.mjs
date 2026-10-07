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
 *
 * 退出码：有问题=1（可配合 CI/预提交拦截），干净=0
 */
import fs from 'node:fs';
import path from 'node:path';

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
      for (const m of line.matchAll(/<([a-zA-Z]+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)) {
        const attrs = [...m[2].matchAll(/\s([\w:]+)="/g)].map((x) => x[1]);
        const seen = new Set();
        const dup = attrs.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
        if (dup.length) { console.log(`✗ ${rel}:${ln} 重复属性 ${[...new Set(dup)].join(',')}`); problems++; }
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
  }
}

console.log(problems ? `\n${problems} 个问题（✗ 阻断项）` : '\n✓ 全部通过');
process.exit(problems ? 1 : 0);
