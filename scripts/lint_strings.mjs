#!/usr/bin/env node
/**
 * lint_strings.mjs — FairyGUI export_strings 翻译表检查（零依赖，Node 18+）
 *
 * 用法：node scripts/lint_strings.mjs <源strings.xml> <译文1.xml> [译文2.xml …]
 *       （源 = export_strings 默认产物 strings.xml；译文 = strings_en.xml 等同目录语种文件）
 *
 * 检查项（编号接 lint_components.mjs，全部 ⚠ 不阻断——漏翻/残留不炸工程，但发布即带病）：
 *   25. 键覆盖   —— 译表缺键（漏翻：导入后该组件仍是源语言）/ 多键（组件删改后残留，
 *                    或键写错——导入静默无效）。键 = name（itemId-子对象id）+ mz（子对象名）。
 *   26. 修饰一致 —— 同键各语言的 FairyGUI 模板变量 {{var}} 集合与 UBB 标签（[b]/[color=…]
 *                    归一化为标签名）集合必须一致：译文丢 {{count}} 运行时插值落空，
 *                    丢 [b]/[url] 样式断裂（arrow_line 生产实证 [color=#FFDE58] 在用）。
 *   27. 未翻     —— 源含 CJK 且译文与原文完全相同（多半没翻）。无 CJK 的源（"OK"/数字/
 *                    "Title"）译文相同是合法保留，豁免。
 *
 * 依据：arrow_line 三语表（strings.xml/strings_en.xml/strings_ru.xml，源 568 行 vs en 390 行
 * ——键缺口当堂可见）+ sort_up export/ 双语表实证格式：<resources><string name="…" mz="…">文本</string>。
 * 均为 ⚠：漏翻/修饰断/未翻都是内容问题不阻断加载；想升 ✗ 先攒运行时事故实证。
 *
 * 退出码：参数/文件错误=2；检查完成恒 0（⚠ 不阻断，与 lint_components 的 ✗ 计数语义一致）。
 * 也被 lint_components.mjs 自动发现调用（工程根或 export/ 下有 strings.xml + strings_*.xml）。
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// 键 = name + mz（两者一起才定位一个文本；mz 是子对象名，title/按钮名/裸编号都有）
function parseStrings(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const map = new Map(); // key → value（实体已解码）
  for (const m of raw.matchAll(/<string\s+([^>]*?)>([^<]*)<\/string>/g)) {
    const name = (m[1].match(/\bname="([^"]*)"/) || [])[1];
    const mz = (m[1].match(/\bmz="([^"]*)"/) || [])[1];
    if (name === undefined || mz === undefined) continue;
    map.set(`${name}\u0000${mz}`, decodeXmlEntities(m[2]));
  }
  return map;
}

// 修饰集合：模板变量 {{var}} + UBB 标签名（[b]…[/b]、[color=#xxx] 归一化为裸标签名，参数忽略
// ——译文改颜色参数是改样式不是断修饰；开闭标签同名为同一修饰）
function modifiers(s) {
  const set = new Set();
  for (const v of s.matchAll(/\{\{([^}]+)\}\}/g)) set.add(`{{${v[1].trim()}}}`);
  for (const t of s.matchAll(/\[\/?([a-zA-Z][a-zA-Z0-9_]*)[^\]]*\]/g)) set.add(`[${t[1].toLowerCase()}]`);
  return set;
}

const HAS_CJK = /[\u2E80-\u9FFF\u3000-\u303F\uF900-\uFAFF\uFF00-\uFFEF]/;

// 返回 ⚠ 消息数组（不打印；调用方决定输出形态）。srcFile 源表，transFiles 语种译文表。
export function lintStrings(srcFile, transFiles) {
  const src = parseStrings(srcFile);
  const out = [];
  const srcName = (f) => `${f.split(/[\\/]/).pop()}`;
  for (const tf of transFiles) {
    const trans = parseStrings(tf);
    const missing = [...src.keys()].filter((k) => !trans.has(k));
    const extra = [...trans.keys()].filter((k) => !src.has(k));
    if (missing.length) {
      const sample = missing.slice(0, 3).map((k) => {
        const [name, mz] = k.split('\u0000');
        return `${name}+${mz} "${src.get(k).slice(0, 12)}"`;
      }).join('、');
      out.push(`⚠ ${srcName(tf)}: 缺 ${missing.length} 键（漏翻——导入后这些组件仍显示源语言，如 ${sample}${missing.length > 3 ? ' …' : ''}，见 STANDARDS §7）`);
    }
    if (extra.length) {
      const sample = extra.slice(0, 3).map((k) => k.split('\u0000').join('+')).join('、');
      out.push(`⚠ ${srcName(tf)}: 多 ${extra.length} 键（组件已删改的残留或键写错——导入静默无效，如 ${sample}${extra.length > 3 ? ' …' : ''}；重新 export_strings 对齐，见 STANDARDS §7）`);
    }
    let modBad = 0, untrans = 0;
    for (const [k, sv] of src) {
      const tv = trans.get(k);
      if (tv === undefined) continue;
      const sm = modifiers(sv), tm = modifiers(tv);
      if (sm.size !== tm.size || [...sm].some((x) => !tm.has(x))) {
        if (modBad < 5) {
          const diff = [...sm].filter((x) => !tm.has(x)).concat([...tm].filter((x) => !sm.has(x)));
          out.push(`⚠ ${srcName(tf)}: ${k.split('\u0000').join('+')} 修饰不一致（${[...sm].join('') || '无'} → ${[...tm].join('') || '无'}${diff.length ? `，差 ${diff.join('')}` : ''}——丢模板变量运行时插值落空、丢 UBB 标签样式断裂，见 STANDARDS §7）`);
        }
        modBad++;
      }
      if (HAS_CJK.test(sv) && tv === sv) {
        if (untrans < 5) {
          out.push(`⚠ ${srcName(tf)}: ${k.split('\u0000').join('+')} 译文与原文相同 "${sv.slice(0, 12)}"（源含中文——多半没翻，见 STANDARDS §7）`);
        }
        untrans++;
      }
    }
    if (modBad > 5) out.push(`⚠ ${srcName(tf)}: 另有 ${modBad - 5} 处修饰不一致（同上，不逐条列出）`);
    if (untrans > 5) out.push(`⚠ ${srcName(tf)}: 另有 ${untrans - 5} 处译文与原文相同（同上，不逐条列出）`);
  }
  return out;
}

// 独立运行：node scripts/lint_strings.mjs 源.xml 译文.xml […]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length < 2) {
    console.error('usage: node scripts/lint_strings.mjs <源strings.xml> <译文.xml> [更多译文.xml …]');
    process.exit(2);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error(`file not found: ${f}`); process.exit(2); }
  }
  const msgs = lintStrings(files[0], files.slice(1));
  for (const m of msgs) console.log(m);
  console.log(msgs.length ? `\n${msgs.length} 条翻译表提醒（⚠ 均不阻断）` : '✓ 翻译表全部通过');
}
