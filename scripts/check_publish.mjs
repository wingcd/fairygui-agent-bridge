#!/usr/bin/env node
/**
 * check_publish.mjs — 发布产物完整性校验（组件丢失防线）
 * 用法：node scripts/check_publish.mjs <工程根> [发布产物目录，缺省 <根>/../dist]
 * 校验：package.xml 里每个 exported="true" 的资源 name（去 .xml/.png）都出现在 .bin 字节流中。
 * 原理：FairyGUI bin 为二进制但 name 以 UTF-8 明文存储；缺失即发布被静默丢弃（exported 缺失等）。
 */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.');
const dist = path.resolve(process.argv[3] || path.join(root, '..', 'dist'));
const pkgDir0 = path.join(root, 'assets');
let missing = 0, total = 0;
for (const pkg of fs.readdirSync(pkgDir0)) {
  const pkgXml = path.join(pkgDir0, pkg, 'package.xml');
  const bin = path.join(dist, pkg + '.bin');
  if (!fs.existsSync(pkgXml) || !fs.existsSync(bin)) continue;
  const data = fs.readFileSync(bin);
  const px = fs.readFileSync(pkgXml, 'utf8');
  for (const m of px.matchAll(/<(image|component)\b[^>]*exported="true"[^>]*>/g)) {
    const name = (m[0].match(/ name="([^"]+)"/) || [])[1] || '';
    const bare = name.replace(/\.(xml|png)$/i, '');
    total++;
    if (!data.includes(Buffer.from(bare, 'utf8'))) {
      console.log(`✗ ${pkg}/${bare} 未出现在 ${pkg}.bin（发布被丢弃！）`);
      missing++;
    }
  }
}
console.log(missing ? `✗ ${missing}/${total} 丢失` : `✓ ${total} 个 exported 资源全部在发布产物中`);
process.exit(missing ? 1 : 0);
