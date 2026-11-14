// Deterministic MaxRects layout, ported from standalone/atlas.py.
// Rendering and FairyGUI package publication are separate operations.
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const contains = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[0] + a[2] >= b[0] + b[2] && a[1] + a[3] >= b[1] + b[3];
const key = r => r.join(',');
const compare = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
const textCompare = (a, b) => { const aa = Array.from(a, c => c.codePointAt(0)), bb = Array.from(b, c => c.codePointAt(0)); return compare(aa, bb) || aa.length - bb.length; };

function splitFree(free, used) {
  const result = [], untouched = new Set(), [ux, uy, uw, uh] = used;
  for (const [x, y, w, h] of free) {
    const r = [x, y, w, h];
    if (!overlaps(r, used)) { result.push(r); untouched.add(key(r)); continue; }
    if (ux > x) result.push([x, y, ux - x, h]);
    if (ux + uw < x + w) result.push([ux + uw, y, x + w - ux - uw, h]);
    if (uy > y) result.push([x, y, w, uy - y]);
    if (uy + uh < y + h) result.push([x, uy + uh, w, y + h - uy - uh]);
  }
  const unique = [...new Map(result.map(r => [key(r), r])).values()];
  return unique.filter((r, i) => untouched.has(key(r)) || !unique.some((s, j) => i !== j && contains(s, r)));
}

export class AtlasCapacityError extends Error {}

export function pack(images, { width = 2048, height = 2048, padding = 2, shrink = false, maxPages = null, rotatable = [] } = {}) {
  if (typeof shrink !== 'boolean') throw new Error('shrink must be a boolean');
  if (maxPages !== null && (!Number.isInteger(maxPages) || maxPages < 1)) throw new Error('max_pages must be a positive integer');
  if (![width, height, padding].every(Number.isInteger) || width <= 0 || height <= 0 || padding < 0 || Math.max(width, height, padding) > 2147483647) throw new Error('page dimensions must be positive integers and padding nonnegative');
  const rotate = new Set(rotatable), ids = new Set();
  for (const image of images) {
    const { id, width: w, height: h } = image;
    if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('image ids must be nonempty and unique');
    ids.add(id);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || !((w + 2 * padding <= width && h + 2 * padding <= height) || (rotate.has(id) && h + 2 * padding <= width && w + 2 * padding <= height))) throw new Error(`image ${JSON.stringify(id)} has invalid dimensions or exceeds the page`);
  }
  for (const id of rotate) if (!ids.has(id)) throw new Error('rotatable references unknown image');
  const pages = [];
  const ordered = [...images].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height || textCompare(a.id, b.id));
  for (const image of ordered) {
    const ow = image.width + 2 * padding, oh = image.height + 2 * padding;
    const orientations = [[false, ow, oh]];
    if (rotate.has(image.id) && ow !== oh) orientations.push([true, oh, ow]);
    let best = null;
    pages.forEach((page, pi) => page.free.forEach(([x, y, fw, fh], fi) => orientations.forEach(([rotated, w, h]) => {
      if (fw >= w && fh >= h) {
        const candidate = [Math.min(fw - w, fh - h), Math.max(fw - w, fh - h), pi, y, x, fi, Number(rotated), w, h];
        if (!best || compare(candidate, best) < 0) best = candidate;
      }
    })));
    let pageIndex, x, y, rotated, w, h;
    if (best) { [, , pageIndex, y, x, , rotated, w, h] = best; rotated = Boolean(rotated); }
    else {
      if (maxPages !== null && pages.length >= maxPages) throw new AtlasCapacityError('image set exceeds page limit');
      pageIndex = pages.length; pages.push({ free: [[0, 0, width, height]], items: [] }); x = y = 0;
      const options = orientations.filter(([, w, h]) => w <= width && h <= height);
      options.sort((a, b) => compare([Math.min(width - a[1], height - a[2]), Math.max(width - a[1], height - a[2]), Number(a[0])], [Math.min(width - b[1], height - b[2]), Math.max(width - b[1], height - b[2]), Number(b[0])]));
      [rotated, w, h] = options[0];
    }
    const page = pages[pageIndex]; page.free = splitFree(page.free, [x, y, w, h]);
    const item = { id: image.id, x: x + padding, y: y + padding, width: image.width, height: image.height };
    if (rotated) item.rotated = true;
    page.items.push(item);
  }
  return pages.map(({ items }) => {
    if (!shrink) return { width, height, items };
    const usedWidth = Math.max(...items.map(i => i.x + (i.rotated ? i.height : i.width) + padding));
    const usedHeight = Math.max(...items.map(i => i.y + (i.rotated ? i.width : i.height) + padding));
    return { width: Math.min(width, 2 ** Math.ceil(Math.log2(usedWidth))), height: Math.min(height, 2 ** Math.ceil(Math.log2(usedHeight))), items };
  });
}

export function plan(images, { width = 2048, height = 2048, padding = 2, shrink = false, optimize = false, rotatable = [] } = {}) {
  if (typeof optimize !== 'boolean') throw new Error('optimize must be a boolean');
  if (typeof shrink !== 'boolean') throw new Error('shrink must be a boolean');
  if (!optimize) return pack(images, { width, height, padding, shrink, rotatable });
  const baseline = pack(images, { width, height, padding, shrink: true, rotatable });
  if (baseline.length !== 1) return baseline;
  const rotated = new Set(rotatable), area = baseline[0].width * baseline[0].height;
  const requiredWidth = Math.max(...images.map(i => (rotated.has(i.id) ? Math.min(i.width, i.height) : i.width) + 2 * padding));
  const requiredHeight = Math.max(...images.map(i => (rotated.has(i.id) ? Math.min(i.width, i.height) : i.height) + 2 * padding));
  const total = images.reduce((sum, i) => sum + (i.width + 2 * padding) * (i.height + 2 * padding), 0);
  function dimensions(max, min) { const values = new Set([max]); for (let n = 1; n < max; n *= 2) if (n >= min) values.add(n); return [...values].filter(n => n >= min); }
  const candidates = [];
  for (const w of dimensions(width, requiredWidth)) for (const h of dimensions(height, requiredHeight)) if (total <= w * h && w * h < area) candidates.push([w * h, Math.abs(w - h), w, h]);
  candidates.sort(compare);
  for (const [, , w, h] of candidates.slice(0, 16)) {
    try { return pack(images, { width: w, height: h, padding, shrink: true, maxPages: 1, rotatable }); } catch (error) { if (!(error instanceof AtlasCapacityError) && !(error instanceof Error)) throw error; }
  }
  return baseline;
}

export function planGrouped(images, groups, { width = 2048, height = 2048, padding = 2, shrink = false, rotatable = [] } = {}) {
  pack(images, { width, height, padding, rotatable });
  const byId = new Map(images.map(image => [image.id, image]));
  const parent = new Map(images.map(image => [image.id, image.id]));
  const root = id => {
    while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
    return id;
  };
  for (const group of groups) {
    if (group.some(id => !byId.has(id))) throw new Error('atlas group references unknown image');
    if (!group.length) continue;
    const first = root(group[0]);
    for (const id of group.slice(1)) { const other = root(id); if (first !== other) parent.set(other, first); }
  }
  const merged = new Map();
  for (const id of [...byId.keys()].sort(textCompare)) {
    const r = root(id);
    if (!merged.has(r)) merged.set(r, []);
    merged.get(r).push(byId.get(id));
  }
  const blocks = [], members = new Map(), rotate = new Set(rotatable);
  const ordered = [...merged.values()].sort((a, b) => textCompare(a[0].id, b[0].id));
  for (const [index, group] of ordered.entries()) {
    let layout;
    try { layout = pack(group, { width, height, padding, maxPages: 1, rotatable: group.filter(item => rotate.has(item.id)).map(item => item.id) })[0].items; }
    catch (error) { if (error instanceof AtlasCapacityError) throw new AtlasCapacityError('related atlas sprites do not fit on one page'); throw error; }
    const w = Math.max(...layout.map(i => i.x + (i.rotated ? i.height : i.width) + padding));
    const h = Math.max(...layout.map(i => i.y + (i.rotated ? i.width : i.height) + padding));
    const id = String(index); blocks.push({ id, width: w, height: h }); members.set(id, layout);
  }
  return pack(blocks, { width, height, padding: 0, shrink }).map(page => ({
    ...page, items: page.items.flatMap(block => members.get(block.id).map(item => ({ ...item, x: item.x + block.x, y: item.y + block.y })))
  }));
}

// Render RGBA bytes without alpha compositing, including RGB under transparent pixels.
// Sources are {width, height, pixels: Uint8Array}, keyed by resource id.
export function render(pages, sources, { duplicatePadding = [], padding = 0 } = {}) {
  if (!Number.isInteger(padding) || padding < 0) throw new Error('invalid padding');
  const duplicate = new Set(duplicatePadding);
  return pages.map(page => {
    if (!Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width <= 0 || page.height <= 0) throw new Error('invalid page dimensions');
    const pixels = Buffer.alloc(page.width * page.height * 4);
    for (const item of page.items) {
      const source = sources[item.id];
      if (!source || source.width !== item.width || source.height !== item.height || source.pixels.length !== source.width * source.height * 4) throw new Error(`image ${JSON.stringify(item.id)} changed size after packing`);
      const w = item.rotated ? item.height : item.width, h = item.rotated ? item.width : item.height;
      const pad = duplicate.has(item.id) ? padding : 0;
      if (item.x - pad < 0 || item.y - pad < 0 || item.x + w + pad > page.width || item.y + h + pad > page.height) throw new Error('image padding exceeds atlas bounds');
      for (let y = -pad; y < h + pad; y++) for (let x = -pad; x < w + pad; x++) {
        const px = Math.max(0, Math.min(w - 1, x)), py = Math.max(0, Math.min(h - 1, y));
        const sx = item.rotated ? py : px, sy = item.rotated ? item.height - 1 - px : py;
        const src = (sy * item.width + sx) * 4, dst = ((item.y + y) * page.width + item.x + x) * 4;
        for (let channel = 0; channel < 4; channel++) pixels[dst + channel] = source.pixels[src + channel];
      }
    }
    return {width:page.width,height:page.height,pixels};
  });
}
