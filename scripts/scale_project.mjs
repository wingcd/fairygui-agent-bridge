#!/usr/bin/env node
/**
 * scale_project.mjs — FairyGUI 工程设计分辨率缩放导出（零依赖，Node 18+）
 *
 * 把一个按设计分辨率 A（如 1080x1920 / 750x1334）制作的 FairyGUI 工程，整体缩放成
 * 设计分辨率 B 的**副本工程**，然后用本仓库的 ensure → refresh → publish 走官方发布，
 * 得到目标分辨率的包（含按比例缩小的图片资源）。
 *
 * 为什么改源不改产物：发布产物（图集坐标 + .bin）patch 等于重写打图集器；图集重打包
 * 本来就是编辑器 publish 的事，所以缩放发生在「喂给发布的源工程」上（STANDARDS §5/§6）。
 *
 * 用法：
 *   node scripts/scale_project.mjs --src <工程根（含 .fairy 与 assets/）> --to 750x1334
 *
 *   --to WxH             目标设计尺寸（与 --rate 二选一）
 *   --rate R             直接给比例（如 0.6944）
 *   --from WxH           源设计尺寸；默认从全屏组件尺寸自动探测（取众数）
 *   --out <dir>          副本输出目录（默认 <src 同级>/<工程名>_scaled_<W>x<H>）
 *   --res shrink|keep    资源策略：图片像素同比例缩小（默认）| 保留高清只缩布局
 *   --packages a,b,c     只处理这些包（默认全部）
 *   --port N             副本插件端口（写 port.txt；与源工程编辑器双开时防冲突）
 *   --sharp-dir <dir>    含 node_modules(sharp) 的目录；jpg 缩放需要（png 零依赖即可）
 *   --dry                只打印计划，不写盘（源工程永远只读）
 *   --force              输出目录已存在时删除重建
 *
 * 缩放清单（实证依据见 STANDARDS §2.12；来源：4 工程 1460 组件普查 + gist 原型补漏）：
 *   布局：xy / size（嵌套 displayList 一并处理）/ group xy,size / designImageOffsetX,Y
 *   文本：fontSize / titleFontSize / leading / strokeSize / shadowOffset
 *   列表：lineGap / colGap / margin；graph：lineSize / corner / points
 *   gear：gearXY / gearSize（w,h 缩、scale 分量不缩）/ gearFontSize
 *   transition：XY / Size 缩两维，Width / Height / Shake 缩一维，Scale/Pivot/Alpha/
 *     Rotation/Color/Text/Icon 等不缩；time/duration/ease 永不缩
 *   package.xml：image scale9grid 四值（仅当该图真实缩小后）
 *   图片：png 纯 JS 重采样（区域平均+预乘 alpha）；jpg 需 sharp；细线(min边<=4px)、
 *     缩后<3px 的小图保留原图；jta(内嵌二进制贴图)/ttf(动态字体) 不动，仅上报
 *   不缩：pivot/anchor(相对)、scale/rotation/alpha/skew、relations(百分比)、
 *     controller/action/remark、Button downEffectValue、combobox/progressbar 值
 *
 * 管线（缩放完照抄执行，验收双闸见 STANDARDS §4/§6）：
 *   node scripts/lint_components.mjs <out>
 *   node cli/fgui.mjs ensure '{"project":"<out>","editor":"…/FairyGUI-Editor.exe"}'
 *   node cli/fgui.mjs refresh '{}' && node cli/fgui.mjs list-items '{"pkg":"<包名>"}'
 *   node cli/fgui.mjs publish '{"pkg":"<包名>"}'
 *
 * 注意：跑本脚本前把源工程在编辑器里保存并关闭（编辑器 refresh 会用内存态覆盖盘上，
 * STANDARDS §3；脚本对源工程只读，副本可随时 --force 重建）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import process from 'node:process';

// ---------------- 参数 ----------------
function fail(msg) { console.error(`error: ${msg}`); process.exit(2); }
function parseArgs(argv) {
  const a = { res: 'shrink' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : undefined);
    switch (k) {
      case '--src': a.src = next(); break;
      case '--out': a.out = next(); break;
      case '--to': a.to = next(); break;
      case '--from': a.from = next(); break;
      case '--rate': a.rate = Number(next()); break;
      case '--res': a.res = next(); break;
      case '--packages': a.packages = String(next() || '').split(',').map(s => s.trim()).filter(Boolean); break;
      case '--port': a.port = Number(next()); break;
      case '--sharp-dir': a.sharpDir = next(); break;
      case '--dry': a.dry = true; break;
      case '--force': a.force = true; break;
      default: fail(`未知参数 ${k}（用法见文件头注释）`);
    }
  }
  if (!a.src) fail('--src <工程根> 必填');
  if (!a.to && a.rate == null) fail('--to WxH 或 --rate R 必填其一');
  return a;
}
const parseSize = (s) => {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(String(s || '').trim());
  if (!m) fail(`尺寸格式应为 WxH，如 750x1334，收到 "${s}"`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

// ---------------- 工程遍历 ----------------
function listPackages(assetsDir, onlyPkgs) {
  return fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(assetsDir, e.name, 'package.xml')))
    .map(e => e.name)
    .filter(n => !onlyPkgs || !onlyPkgs.length || onlyPkgs.includes(n));
}
function walkXml(dir, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkXml(p, cb);
    else if (e.name.endsWith('.xml') && e.name !== 'package.xml') cb(p);
  }
}

// 全屏组件 = 根 size 达到设计分辨率量级（宽>=500 高>=800）；取众数。
// 近似并列（次数差 <=20%）时告警列出候选——kaizong_lipai 实测 1000,2000 与 750,1334 并存。
function detectDesignSize(assetsDir, onlyPkgs) {
  const freq = new Map();
  for (const pkgDir of listPackages(assetsDir, onlyPkgs)) {
    walkXml(path.join(assetsDir, pkgDir), (file) => {
      const m = /<component size="(\d+),(\d+)"/.exec(fs.readFileSync(file, 'utf8'));
      if (!m) return;
      const w = +m[1], h = +m[2];
      if (w >= 500 && h >= 800) {
        const k = `${w}x${h}`;
        freq.set(k, (freq.get(k) || 0) + 1);
      }
    });
  }
  if (!freq.size) return null;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const ambiguous = sorted.length > 1 && sorted[0][1] - sorted[1][1] <= 0.2 * sorted[0][1];
  return { size: parseSize(sorted[0][0]), ambiguous, candidates: sorted.slice(0, 3) };
}

// ---------------- 图片尺寸 ----------------
function pngSize(file) {
  try {
    const buf = Buffer.alloc(24);
    const fd = fs.openSync(file, 'r');
    try {
      if (fs.readSync(fd, buf, 0, 24, 0) !== 24) return null;
      if (buf.readUInt32BE(0) !== 0x89504e47) return null;
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}
// JPEG：走 SOFn 标记（0xC0~0xCF 除 C4/C8/CC）读宽高
function jpegSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let pos = 2;
    while (pos + 9 < buf.length) {
      if (buf[pos] !== 0xff) { pos++; continue; }
      const marker = buf[pos + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      const len = buf.readUInt16BE(pos + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(pos + 5), w: buf.readUInt16BE(pos + 7) };
      }
      pos += 2 + len;
    }
  } catch { /* fallthrough */ }
  return null;
}

// ---------------- PNG 编解码（零依赖） ----------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not png');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported png (bitDepth=${bitDepth} interlace=${interlace})`);
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`unsupported colorType ${colorType}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(w * h * channels);
  const bpp = channels; // 8-bit 深度下 bpp=通道数
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, s = i * channels;
    if (colorType === 6) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = px[s + 3]; }
    else if (colorType === 2) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = 255; }
    else if (colorType === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = 255; }
    else if (colorType === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = px[s + 1]; }
    else if (colorType === 3) {
      const idx = px[s] * 3;
      rgba[o] = plte[idx]; rgba[o + 1] = plte[idx + 1]; rgba[o + 2] = plte[idx + 2];
      rgba[o + 3] = trns && px[s] < trns.length ? trns[px[s]] : 255;
    }
  }
  return { w, h, rgba };
}

function encodePng(w, h, rgba) {
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter None——编辑器发布时自己还会重压图集
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 区域平均降采样（预乘 alpha，避免半透明边缘发暗）
function resampleArea(src, sw, sh, tw, th) {
  const dst = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sh / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sw / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < sh; sy++) {
        for (let sx = x0; sx < x1 && sx < sw; sx++) {
          const o = (sy * sw + sx) * 4;
          const al = src[o + 3] / 255;
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += src[o + 3]; n++;
        }
      }
      const o = (y * tw + x) * 4;
      const al = a / n / 255;
      dst[o + 3] = Math.round(a / n);
      if (al > 0) {
        dst[o] = Math.round(r / n / al); dst[o + 1] = Math.round(g / n / al); dst[o + 2] = Math.round(b / n / al);
      }
    }
  }
  return dst;
}

// ---------------- sharp（可选，jpg 用） ----------------
async function loadSharp(sharpDir) {
  try { return (await import('sharp')).default; } catch { /* 继续找候选目录 */ }
  const candidates = [sharpDir, process.env.FGUI_SCALE_SHARP_DIR].filter(Boolean);
  for (const dir of candidates) {
    try {
      const req = (await import('node:module')).createRequire(path.resolve(dir, 'noop.js'));
      return req('sharp');
    } catch { /* next */ }
  }
  return null;
}

// ---------------- 属性策略表 ----------------
// S  = 原样取整（xy/0 合法的值：leading=0 表默认、lineGap 可负）
// S1 = 最小 1（size/fontSize：缩成 0 = 消失）
const mk = {
  num: (S) => (v) => String(S(Number(v))),
  pair: (S) => (v) => { const f = v.split(','); return f.length === 2 && f.every(x => Number.isFinite(Number(x))) ? `${S(Number(f[0]))},${S(Number(f[1]))}` : v; },
  pairsAll: (S) => (v) => v.split(',').map(Number).map(S).join(','),
  // gear values：按 | 分页，每页缩前两维（gearXY=x,y / gearSize=w,h,sx,sy——scale 分量不缩）
  gear12: (S) => (v) => v.split('|').map(pg => {
    const f = pg.split(',').map(Number);
    if (f.length < 2 || f.some(Number.isNaN)) return pg;
    return [S(f[0]), S(f[1]), ...f.slice(2)].join(',');
  }).join('|'),
  gearNum: (S) => (v) => v.split('|').map(pg => (Number.isFinite(Number(pg)) ? String(S(Number(pg))) : pg)).join('|'),
};

const buildPolicy = (S, S1) => ({
  '*': { xy: mk.pair(S), size: mk.pair(S1) },
  text: { fontSize: mk.num(S1), leading: mk.num(S), strokeSize: mk.num(S), shadowOffset: mk.pair(S) },
  richtext: { fontSize: mk.num(S1), leading: mk.num(S), strokeSize: mk.num(S), shadowOffset: mk.pair(S) },
  Button: { titleFontSize: mk.num(S1) },
  list: { lineGap: mk.num(S), colGap: mk.num(S), margin: mk.pairsAll(S) },
  group: { lineGap: mk.num(S), colGap: mk.num(S), margin: mk.pairsAll(S) },
  graph: { lineSize: mk.num(S), corner: mk.num(S), points: mk.pairsAll(S) },
  scrollPane: { margin: mk.pairsAll(S) },
  component: { designImageOffsetX: mk.num(S), designImageOffsetY: mk.num(S) },
  gearXY: { values: mk.gear12(S), default: mk.gear12(S) },
  gearSize: { values: mk.gear12(S), default: mk.gear12(S) },
  gearFontSize: { values: mk.gearNum(S1), default: mk.gearNum(S1) },
});

// transition type → startValue/endValue 缩几维（编辑器 XML 首字母大写，忽略大小写匹配）
const TRANSITION_SCALE_DIMS = { xy: 2, size: 2, width: 1, height: 1, shake: 1 };

// 已确认非像素的属性（不缩，也不再上报 unknown）。来源：4 工程 1460 组件普查 + 官方语义。
const NOOP_ATTRS = new Set([
  'id', 'name', 'src', 'fileName', 'pkg', 'exported', 'path', 'scale', 'rotation', 'skew', 'alpha',
  'pivot', 'anchor', 'aspect', 'color', 'titleColor', 'shadowColor', 'strokeColor', 'fillColor', 'lineColor',
  'visible', 'touchable', 'grayed', 'opaque', 'mask', 'reversedMask', 'group', 'align', 'vAlign',
  'autoSize', 'text', 'title', 'icon', 'url', 'prompt', 'ubb', 'bold', 'italic', 'underline', 'singleLine',
  'input', 'maxLength', 'restrictSize', 'font', 'vars', 'pages', 'selected', 'controller',
  'default', 'tween', 'condition', 'layout', 'overflow', 'scroll', 'scrollBar', 'scrollBarFlags',
  'defaultItem', 'autoItemSize', 'autoResizeItem', 'autoClearItems', 'autoClearText',
  'scrollItemToViewOnClick', 'fill', 'fillMethod', 'fillOrigin', 'fillAmount', 'clearOnPublish',
  'useResize', 'type', 'extention', 'mode', 'checked', 'downEffect', 'downEffectValue', 'value', 'max',
  'titleType', 'dropdown', 'visibleItemCount', 'target', 'propertyId', 'objectId', 'fromPage', 'toPage',
  'transition', 'stopOnExit', 'time', 'duration', 'ease', 'repeat', 'yoyo', 'page', 'homePageType',
  'homePage', 'alias', 'designImage', 'designImageAlpha', 'designImageLayer', 'advanced',
  'excludeInvisibles', 'sidePair', 'autoPlay', 'autoPlayRepeat', 'frameRate', 'options',
  'samplePointSize', 'renderMode', 'touchDragEffect', 'elastic', 'embed',
  // values/default：仅 gearXY/gearSize/gearFontSize 是像素（进策略表）；gearIcon=url、
  // gearText=文本、gearColor=颜色、gearLook=rotation,alpha —— 按标签先查策略，非像素落这里
  'values', 'default', 'targetPage', 'controllers',
]);

const KNOWN_TAGS = new Set([
  'component', 'displayList', 'controller', 'action', 'relation', 'transition', 'item', 'remark',
  'Button', 'Label', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar', 'List', 'Tree',
  'image', 'graph', 'loader', 'loader3D', 'text', 'richtext', 'list', 'jta', 'group',
  'gearIcon', 'gearColor', 'gearDisplay', 'gearDisplay2', 'gearText', 'gearLook',
  'customProperty', 'property', 'scrollPane', 'font',
]);

// ---------------- 组件 XML 重写 ----------------
// 逐标签重写像素属性值，其余字节原样保留（格式零扰动，编辑器 diff 友好）；
// 全文本扫描天然覆盖嵌套 displayList（overflow=scroll 容器内部那层）。
function transformComponentXml(text, policy, report) {
  const star = policy['*'];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g)) {
    const tag = m[1];
    if (!KNOWN_TAGS.has(tag)) continue; // 未知标签不动（lint 检查 6 拦发明标签）
    const attrText = m[2];
    const policies = { ...star, ...(policy[tag] || {}) };
    let newAttrs = attrText;

    if (tag === 'item' && / type="/.test(attrText)) {
      // transition 关键帧：按 type 决定 startValue/endValue 缩几维；list 的 <item url=> 无 type，不进这
      const t = (/ type="([^"]*)"/.exec(attrText) || [])[1] || '';
      const dims = TRANSITION_SCALE_DIMS[t.toLowerCase()] || 0;
      if (dims) {
        const tv = (v) => {
          const f = v.split(',').map(Number);
          if (f.some(Number.isNaN)) return null;
          return f.map((n, i) => (i < dims ? Math.round(n * report.rate) : n)).join(',');
        };
        for (const attr of ['startValue', 'endValue']) {
          newAttrs = rewriteAttr(newAttrs, attr, tv);
        }
      }
    } else {
      for (const [attr, fn] of Object.entries(policies)) {
        newAttrs = rewriteAttr(newAttrs, attr, fn);
      }
    }
    // 上报未分类属性（不在策略、不在 NOOP——给规范演化留证据，不阻断）
    for (const am of attrText.matchAll(/([\w:.-]+)="/g)) {
      if (policies[am[1]] || am[1] === 'type' || am[1] === 'startValue' || am[1] === 'endValue'
        || NOOP_ATTRS.has(am[1])) continue;
      const k = `${tag}.${am[1]}`;
      report.unknownAttrs.set(k, (report.unknownAttrs.get(k) || 0) + 1);
    }
    if (newAttrs !== attrText) {
      out += text.slice(last, m.index) + `<${tag}${newAttrs}${m[0].endsWith('/>') ? '/>' : '>'}`;
      last = m.index + m[0].length;
    }
  }
  return out + text.slice(last);
}

function rewriteAttr(attrText, attr, fn) {
  const m = new RegExp(`(\\s${attr}=)"([^"]*)"`).exec(attrText);
  if (!m) return attrText;
  let nv;
  try { nv = fn(m[2]); } catch { return attrText; }
  if (nv == null) return attrText;
  return attrText.slice(0, m.index) + m[1] + `"${nv}"` + attrText.slice(m.index + m[0].length);
}

// ---------------- 主流程 ----------------
const args = parseArgs(process.argv.slice(2));
const src = path.resolve(args.src);
if (!fs.existsSync(path.join(src, 'assets'))) fail(`${src} 下没有 assets/（应传工程根：含 .fairy 与 assets）`);

let rate = args.rate;
let fromSize = args.from ? parseSize(args.from) : null;
let toSize = args.to ? parseSize(args.to) : null;
const detected = fromSize ? null : detectDesignSize(path.join(src, 'assets'), args.packages);
if (!fromSize) {
  if (!detected) fail('未能从全屏组件探测设计尺寸（无 宽>=500 高>=800 的根组件）——请显式传 --from WxH');
  fromSize = detected.size;
}
if (rate == null) rate = toSize.w / fromSize.w;
if (!toSize) toSize = { w: Math.round(fromSize.w * rate), h: Math.round(fromSize.h * rate) };

const warnings = [];
if (detected?.ambiguous) {
  warnings.push(`设计尺寸探测近似并列：${detected.candidates.map(([k, c]) => `${k}×${c}`).join('、')}，已取 ${fromSize.w}x${fromSize.h}；若不符请 --from 显式指定`);
}
const aspectDelta = Math.abs((toSize.w / toSize.h) / (fromSize.w / fromSize.h) - 1);
if (aspectDelta > 0.02) {
  warnings.push(`目标宽高比与源不一致（差 ${(aspectDelta * 100).toFixed(1)}%）——统一按宽度比例 ${rate.toFixed(4)} 缩，高度差交给运行时适配；不要 x/y 各用各的比例（九宫格/位图字会拉变形）`);
}
if (args.res !== 'shrink' && args.res !== 'keep') fail(`--res 只能是 shrink|keep，收到 ${args.res}`);

const outDefault = `${src.replace(/[\\/]+$/, '')}_scaled_${Math.round(toSize.w)}x${Math.round(toSize.h)}`;
const out = path.resolve(args.out || outDefault);
const S = (v) => Math.round(v * rate);
const S1 = (v) => Math.max(1, Math.round(v * rate));
const policy = buildPolicy(S, S1);

console.log(`缩放：${fromSize.w}x${fromSize.h} → ${toSize.w}x${toSize.h}  rate=${rate.toFixed(4)}  资源=${args.res}${args.dry ? '  [dry]' : ''}`);
console.log(`源：${src}（只读）\n副本：${out}`);

if (fs.existsSync(out)) {
  if (!args.force) fail(`输出目录已存在：${out}（--force 删除重建；副本是生成物，源工程不受影响）`);
  if (!args.dry) fs.rmSync(out, { recursive: true });
}

// 发布输出目录（settings/Publish.json 的 path 相对 settings/）不拷——旧分辨率产物混进新副本才是坑
let publishOutDir = null;
try {
  const pj = JSON.parse(fs.readFileSync(path.join(src, 'settings', 'Publish.json'), 'utf8'));
  if (pj.path) publishOutDir = path.resolve(path.join(src, 'settings'), pj.path);
} catch { /* 无 Publish.json 就全拷 */ }

if (!args.dry) {
  fs.cpSync(src, out, {
    recursive: true,
    filter: (f) => {
      if (publishOutDir && (f === publishOutDir || f.startsWith(publishOutDir + path.sep))) return false;
      const rel = path.relative(src, f);
      if (/[\\/]logs([\\/]|$)/.test(rel)) return false;
      if (rel.endsWith('.log') || rel.endsWith('.stackdump')) return false;
      return true;
    },
  });
  if (args.port) {
    const portFile = path.join(out, 'plugins', 'agent-bridge', 'port.txt');
    fs.mkdirSync(path.dirname(portFile), { recursive: true });
    fs.writeFileSync(portFile, String(args.port));
  }
  if (!fs.existsSync(path.join(out, 'plugins', 'agent-bridge'))) {
    warnings.push('副本里没有 agent-bridge 插件——发布前先 scripts/install.bat <out>（或从源工程拷 plugins/）');
  }
}

// dry 模式没有副本，直接在源上做只读演算
const assetsWork = args.dry ? path.join(src, 'assets') : path.join(out, 'assets');
const pkgs = listPackages(assetsWork, args.packages);
if (!pkgs.length) fail('assets/ 下没有任何含 package.xml 的包');

// 多语言分支目录（assets_zh/assets_en/…）不在处理范围——实证：挪一挪猪 4 个分支目录，
// 分支资源若含图和坐标，发布分支包时仍是原分辨率。当前仅上报，分支缩放待后续版本。
const branchDirs = fs.readdirSync(path.dirname(assetsWork), { withFileTypes: true })
  .filter(e => e.isDirectory() && /^assets_/.test(e.name))
  .map(e => e.name);
if (branchDirs.length) warnings.push(`检测到多语言分支目录 ${branchDirs.join('/')}：本次未缩放（发布分支包仍为原分辨率），需要分支缩放时另行处理`);

const sharp = args.res === 'shrink' ? await loadSharp(args.sharpDir) : null;
if (args.res === 'shrink' && !sharp) {
  warnings.push('sharp 未找到：jpg/jpeg 保留原尺寸（布局仍按比例缩），png 不受影响。可选：npm i sharp 后 --sharp-dir <其目录>');
}

const report = { rate, from: fromSize, to: toSize, res: args.res, packages: {}, unknownAttrs: new Map(), warnings };
const imgOutcomes = new Map(); // 图片文件 → {resized, w, h, tw, th, reason}

const statOf = (pkg) => report.packages[pkg] || (report.packages[pkg] = {
  components: 0, imagesResized: 0, imagesKept: [], scale9gridFixed: 0, fontsUntouched: [], jtaUntouched: 0,
});

// 1) 图片先缩（缩放结论决定 package.xml 的 scale9grid 是否跟随）
if (args.res === 'shrink') {
  for (const pkg of pkgs) {
    const pkgDir = path.join(assetsWork, pkg);
    const raw = fs.readFileSync(path.join(pkgDir, 'package.xml'), 'utf8');
    for (const em of raw.matchAll(/<image\b[^>]*>/g)) {
      const e = em[0];
      const name = (/ name="([^"]+)"/.exec(e) || [])[1];
      const p = ((/ path="([^"]*)"/.exec(e) || [])[1] || '/').replace(/^\/+|\/+$/g, '');
      if (!name) continue;
      const file = path.join(pkgDir, p, name);
      const is9 = / scale="9grid"/.test(e);
      if (!fs.existsSync(file)) { warnings.push(`登记文件缺失（lint 检查 13 也会拦）：${path.relative(assetsWork, file)}`); continue; }
      const ext = path.extname(name).toLowerCase();
      const dims = ext === '.png' ? pngSize(file)
        : (ext === '.jpg' || ext === '.jpeg') ? jpegSize(file) : null;
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') { imgOutcomes.set(file, { resized: false, reason: `非 png/jpg（${ext}）不动` }); continue; }
      if (!dims) { imgOutcomes.set(file, { resized: false, reason: '读不出尺寸' }); warnings.push(`读不出尺寸：${path.relative(assetsWork, file)}`); continue; }

      const tw = S1(dims.w), th = S1(dims.h);
      // 保留判定：细线（源最短边<=4px，缩了就没了）；缩后 <3px；九宫格缩后 <3px 四刀切不出来
      if (Math.min(dims.w, dims.h) <= 4) { imgOutcomes.set(file, { resized: false, w: dims.w, h: dims.h, reason: '细线/极小图保留' }); continue; }
      if (Math.min(tw, th) < 3) { imgOutcomes.set(file, { resized: false, w: dims.w, h: dims.h, reason: is9 ? '九宫格缩后<3px保留' : '缩后<3px保留' }); continue; }
      if (tw === dims.w && th === dims.h) { imgOutcomes.set(file, { resized: false, w: dims.w, h: dims.h, reason: '比例≈1跳过' }); continue; }

      if (args.dry) { imgOutcomes.set(file, { resized: true, w: dims.w, h: dims.h, tw, th, reason: 'dry' }); continue; }
      try {
        let buf;
        if (ext === '.png') {
          const img = decodePng(fs.readFileSync(file));
          if (img.w !== dims.w || img.h !== dims.h) throw new Error('IHDR 与解码不一致');
          buf = encodePng(tw, th, resampleArea(img.rgba, img.w, img.h, tw, th));
        } else {
          // 读成 Buffer 再喂 sharp：libvips 在 Windows 上打不开非 ASCII 路径（中文工程名实测）
          buf = await sharp(fs.readFileSync(file)).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
        }
        fs.writeFileSync(file, buf);
        imgOutcomes.set(file, { resized: true, w: dims.w, h: dims.h, tw, th });
      } catch (err) {
        imgOutcomes.set(file, { resized: false, w: dims.w, h: dims.h, reason: `缩放失败:${err.message}` });
        warnings.push(`图片缩放失败（保留原图）${path.relative(assetsWork, file)}: ${err.message}`);
      }
    }
  }
}

// 2) package.xml：image 的 scale9grid 四值，仅当该图真实缩小（格线必须贴缩后像素）
for (const pkg of pkgs) {
  const pkgFile = path.join(assetsWork, pkg, 'package.xml');
  const stat = statOf(pkg);
  let text = fs.readFileSync(pkgFile, 'utf8');
  let changed = false;
  text = text.replace(/<image\b[^>]*>/g, (e) => {
    const name = (/ name="([^"]+)"/.exec(e) || [])[1];
    const p = ((/ path="([^"]*)"/.exec(e) || [])[1] || '/').replace(/^\/+|\/+$/g, '');
    const outcome = imgOutcomes.get(path.join(assetsWork, pkg, p, name));
    if (!outcome?.resized) return e;
    const g = (/ scale9grid="([^"]*)"/.exec(e) || [])[1];
    if (!g) return e;
    const [gx, gy, gw, gh] = g.split(',').map(Number);
    if ([gx, gy, gw, gh].some(Number.isNaN)) return e;
    let nx = S(gx), ny = S(gy), nw = S1(gw), nh = S1(gh);
    // 取整漂移防越界：格线必须落在缩后图内（lint 检查 9 读 png 对账）
    nw = Math.min(nw, outcome.tw - nx); nx = Math.min(nx, outcome.tw - Math.max(1, nw));
    nh = Math.min(nh, outcome.th - ny); ny = Math.min(ny, outcome.th - Math.max(1, nh));
    stat.scale9gridFixed++; changed = true;
    return e.replace(/ scale9grid="[^"]*"/, ` scale9grid="${nx},${ny},${nw},${nh}"`);
  });
  // 字体/动画登记类型上报（ttf 动态字体无位图度量可缩；jta 内嵌二进制贴图不动）
  for (const em of text.matchAll(/<(font|movieclip|swf)\b[^>]*>/g)) {
    const name = (/ name="([^"]+)"/.exec(em[0]) || [])[1] || '';
    if (em[1] === 'font') stat.fontsUntouched.push(name);
    else stat.jtaUntouched++;
  }
  if (changed && !args.dry) fs.writeFileSync(pkgFile, text);
}

// 3) 组件 XML 全量重写（嵌套 displayList 由全文本扫描天然覆盖）
for (const pkg of pkgs) {
  const stat = statOf(pkg);
  walkXml(path.join(assetsWork, pkg), (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const outText = transformComponentXml(text, policy, report);
    if (outText !== text) {
      stat.components++;
      if (!args.dry) fs.writeFileSync(file, outText);
    }
  });
}

// ---------------- 报告 ----------------
for (const [file, o] of imgOutcomes) {
  const pkg = path.relative(assetsWork, file).split(path.sep)[0];
  const st = statOf(pkg);
  if (o.resized) st.imagesResized++;
  else if (o.reason !== 'dry') st.imagesKept.push(`${path.relative(assetsWork, file)}（${o.reason}）`);
}
report.unknownAttrs = Object.fromEntries([...report.unknownAttrs.entries()].sort((a, b) => b[1] - a[1]));

if (!args.dry) fs.writeFileSync(path.join(out, 'scale-report.json'), JSON.stringify(report, null, 2));

console.log('\n=== 汇总 ===');
for (const [pkg, st] of Object.entries(report.packages)) {
  console.log(`  ${pkg}: 组件 ${st.components || 0}，图缩 ${st.imagesResized || 0}，图留 ${(st.imagesKept || []).length}` +
    (st.scale9gridFixed ? `，九宫格 ${st.scale9gridFixed}` : '') +
    (st.fontsUntouched?.length ? `，字体不动 ${st.fontsUntouched.join('/')}` : '') +
    (st.jtaUntouched ? `，jta不动 ${st.jtaUntouched}` : ''));
}
if (Object.keys(report.unknownAttrs).length) {
  console.log('未分类属性（不缩，仅上报——如含像素值应进策略表）：', report.unknownAttrs);
}
for (const w of warnings) console.log(`⚠ ${w}`);

const outFwd = out.replace(/\\/g, '/');
console.log(`
下一步（验收双闸，STANDARDS §4/§6）：
  node scripts/lint_components.mjs ${out}
  node cli/fgui.mjs launch '{"project":"${outFwd}","editor":"D:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe","visible":true}'
  node cli/fgui.mjs refresh '{}' && node cli/fgui.mjs list-items '{"pkg":"${pkgs[0]}"}'
  node cli/fgui.mjs publish '{"pkg":"${pkgs[0]}"}'
（编辑器曾有崩溃时务必 visible:true 启动——隐藏窗口遇崩溃恢复对话框会永久卡住帧循环，实证见 STANDARDS §2.12）`);
