"""Parse the observed FairyGUI and single-page BMFont text formats."""
import shlex


def read_bitmap_font(data, texture=None):
    records = []
    for raw in data.decode('utf-8-sig', errors='replace').splitlines():
        raw = raw.strip()
        if not raw: continue
        try: tokens = shlex.split(raw)
        except ValueError as exc: raise ValueError('invalid bitmap font line') from exc
        values = {}
        for token in tokens[1:]:
            if '=' not in token: raise ValueError('invalid bitmap font attribute')
            key, value = token.split('=', 1)
            if key in values: raise ValueError('duplicate bitmap font attribute')
            values[key] = value
        if tokens[0] not in ('info', 'common', 'page', 'chars', 'char', 'kernings', 'kerning'):
            raise ValueError('unsupported bitmap font record')
        if tokens[0] == 'kerning' or (tokens[0] == 'kernings' and values.get('count', '0') != '0'):
            raise ValueError('bitmap font kerning is unsupported')
        records.append((tokens[0], values))
    infos = [v for k, v in records if k == 'info']
    commons = [v for k, v in records if k == 'common']
    if len(infos) != 1 or len(commons) > 1: raise ValueError('invalid bitmap font header')
    info, common = infos[0], commons[0] if commons else {}
    ttf = bool(texture)
    if int(common.get('pages', '1')) != 1: raise ValueError('multi-page bitmap fonts are unsupported')
    if info.get('colored', 'false') not in ('true', 'false'): raise ValueError('invalid bitmap font color setting')
    def integer(values, key, default=0):
        try: value = int(values.get(key, str(default)))
        except ValueError: raise ValueError('invalid bitmap font integer')
        if not -2147483648 <= value <= 2147483647: raise ValueError('bitmap font integer out of range')
        return value
    size = integer(info, 'size')
    if size < 0: raise ValueError('invalid bitmap font size')
    glyphs, seen = [], set()
    for kind, entry in records:
        if kind != 'char': continue
        ident = integer(entry, 'id')
        if ident == 0: continue  # editor omits the BMFont missing-glyph sentinel
        if not 1 <= ident <= 65535 or ident in seen: raise ValueError('invalid or duplicate bitmap font glyph')
        seen.add(ident)
        if ttf:
            if integer(entry, 'page') != 0: raise ValueError('multi-page bitmap glyph is unsupported')
            image = None
            x, y, width, height = (integer(entry, key) for key in ('x', 'y', 'width', 'height'))
            if min(x, y, width, height) < 0: raise ValueError('invalid bitmap font glyph rectangle')
            channel = integer(entry, 'chnl')
            if not 0 <= channel <= 255: raise ValueError('invalid bitmap font channel')
        else:
            image = entry.get('img')
            if not image: raise ValueError('bitmap font glyph image missing')
            x = y = width = height = channel = 0
        glyphs.append({'id': ident, 'image': image, 'x': x, 'y': y, 'xOffset': integer(entry, 'xoffset'), 'yOffset': integer(entry, 'yoffset'), 'width': width, 'height': height, 'xAdvance': integer(entry, 'xadvance'), 'channel': channel})
    return {'ttf': ttf, 'texture': texture, 'canTint': ttf or info.get('colored') == 'true', 'resizable': False, 'hasChannel': False, 'fontSize': size, 'xAdvance': 0, 'lineHeight': integer(common, 'lineHeight', size), 'glyphs': glyphs}
