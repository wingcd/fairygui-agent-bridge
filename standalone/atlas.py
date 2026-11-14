"""Deterministic MaxRects packing primitives for a future offline publisher.

Item width and height describe unrotated source pixels; a rotated item's packed
footprint swaps those dimensions. `padding` is reserved on all four sides.
This module does not generate FairyGUI package descriptors.
"""


def overlaps(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def contains(a, b):
    return a[0] <= b[0] and a[1] <= b[1] and a[0] + a[2] >= b[0] + b[2] and a[1] + a[3] >= b[1] + b[3]


def split_free(free, used):
    result = []
    for x, y, w, h in free:
        if not overlaps((x, y, w, h), used):
            result.append((x, y, w, h))
            continue
        ux, uy, uw, uh = used
        if ux > x: result.append((x, y, ux - x, h))
        if ux + uw < x + w: result.append((ux + uw, y, x + w - ux - uw, h))
        if uy > y: result.append((x, y, w, uy - y))
        if uy + uh < y + h: result.append((x, uy + uh, w, y + h - uy - uh))
    # Remove duplicate rectangles before removing contained rectangles.
    unique = list(dict.fromkeys(result))
    return [r for i, r in enumerate(unique) if not any(i != j and contains(s, r) for j, s in enumerate(unique))]


def split_free_pruned(free, used):
    """Split an already-pruned free list without rechecking untouched pairs.

    Every new rectangle is a subset of an old split rectangle. An untouched
    rectangle therefore cannot be newly contained by it: otherwise it would
    already have been contained by that old rectangle. The input must have no
    duplicates or contained rectangles, as maintained by `pack`.
    """
    result, untouched = [], set()
    ux, uy, uw, uh = used
    for x, y, w, h in free:
        rectangle = (x, y, w, h)
        if not overlaps(rectangle, used):
            result.append(rectangle)
            untouched.add(rectangle)
            continue
        if ux > x: result.append((x, y, ux - x, h))
        if ux + uw < x + w: result.append((ux + uw, y, x + w - ux - uw, h))
        if uy > y: result.append((x, y, w, uy - y))
        if uy + uh < y + h: result.append((x, uy + uh, w, y + h - uy - uh))
    unique = list(dict.fromkeys(result))
    return [rectangle for index, rectangle in enumerate(unique)
            if rectangle in untouched or not any(index != other_index and contains(other, rectangle)
                                                 for other_index, other in enumerate(unique))]


class AtlasCapacityError(ValueError):
    pass


def pack(images, width=2048, height=2048, padding=2, shrink=False, max_pages=None, rotatable=()):
    if type(shrink) is not bool: raise ValueError('shrink must be a boolean')
    if max_pages is not None and (type(max_pages) is not int or max_pages < 1): raise ValueError('max_pages must be a positive integer')
    if any(type(v) is not int for v in (width, height, padding)) or not 0 < width <= 2147483647 or not 0 < height <= 2147483647 or not 0 <= padding <= 2147483647:
        raise ValueError('page dimensions must be positive integers and padding nonnegative')
    rotatable = set(rotatable)
    ids = set()
    for image in images:
        ident, w, h = image['id'], image['width'], image['height']
        if not isinstance(ident, str) or not ident or ident in ids:
            raise ValueError('image ids must be nonempty and unique')
        ids.add(ident)
        if type(w) is not int or type(h) is not int or w <= 0 or h <= 0 or not ((w + 2 * padding <= width and h + 2 * padding <= height) or (ident in rotatable and h + 2 * padding <= width and w + 2 * padding <= height)):
            raise ValueError(f'image {ident!r} has invalid dimensions or exceeds the page')
    if rotatable - ids: raise ValueError('rotatable references unknown image')
    pages = []
    ordered = sorted(images, key=lambda i: (-max(i['width'], i['height']), -i['width'] * i['height'], i['id']))
    for image in ordered:
        original_w, original_h = image['width'] + 2 * padding, image['height'] + 2 * padding
        orientations = [(False, original_w, original_h)]
        if image['id'] in rotatable and original_w != original_h: orientations.append((True, original_h, original_w))
        candidates = [(min(fw-w, fh-h), max(fw-w, fh-h), page_index, y, x, index, rotated, w, h)
                      for page_index, page in enumerate(pages)
                      for index, (x, y, fw, fh) in enumerate(page['free'])
                      for rotated, w, h in orientations if fw >= w and fh >= h]
        if candidates:
            _, _, page_index, y, x, _, rotated, w, h = min(candidates)
        else:
            if max_pages is not None and len(pages) >= max_pages: raise AtlasCapacityError('image set exceeds page limit')
            page_index = len(pages)
            pages.append({'free': [(0, 0, width, height)], 'items': []})
            x = y = 0
            rotated, w, h = min((option for option in orientations if option[1] <= width and option[2] <= height), key=lambda option: (min(width-option[1], height-option[2]), max(width-option[1], height-option[2]), option[0]))
        page = pages[page_index]
        page['free'] = split_free_pruned(page['free'], (x, y, w, h))
        item = {'id': image['id'], 'x': x + padding, 'y': y + padding, 'width': image['width'], 'height': image['height']}
        if rotated: item['rotated'] = True
        page['items'].append(item)
    if not shrink:
        return [{'width': width, 'height': height, 'items': page['items']} for page in pages]
    result = []
    for page in pages:
        used_width = max(item['x'] + (item['height'] if item.get('rotated') else item['width']) + padding for item in page['items'])
        used_height = max(item['y'] + (item['width'] if item.get('rotated') else item['height']) + padding for item in page['items'])
        # Keep the configured maximum even when it is not a power of two.
        page_width = min(width, 1 << (used_width - 1).bit_length())
        page_height = min(height, 1 << (used_height - 1).bit_length())
        result.append({'width': page_width, 'height': page_height, 'items': page['items']})
    return result


def plan(images, width=2048, height=2048, padding=2, shrink=False, optimize=False, rotatable=()):
    """Optionally try a bounded selection of smaller single-page layouts.

    The optimized result never uses more pages or pixels than the compact
    baseline. Multi-page layouts retain their original packing to preserve
    asset group placement. This is best effort, not a globally optimal pack.
    """
    if type(optimize) is not bool: raise ValueError('optimize must be a boolean')
    if type(shrink) is not bool: raise ValueError('shrink must be a boolean')
    rotatable = set(rotatable)
    if not optimize: return pack(images, width, height, padding, shrink, rotatable=rotatable)
    baseline = pack(images, width, height, padding, True, rotatable=rotatable)
    if len(baseline) != 1: return baseline
    current_area = baseline[0]['width'] * baseline[0]['height']
    required_width = max((min(item['width'], item['height']) if item['id'] in rotatable else item['width']) + 2 * padding for item in images)
    required_height = max((min(item['width'], item['height']) if item['id'] in rotatable else item['height']) + 2 * padding for item in images)
    total_area = sum((item['width'] + 2 * padding) * (item['height'] + 2 * padding) for item in images)
    def dimensions(maximum, minimum):
        choices, value = {maximum}, 1
        while value < maximum:
            if value >= minimum: choices.add(value)
            value *= 2
        return sorted(choice for choice in choices if choice >= minimum)
    candidates = [(w * h, abs(w - h), w, h) for w in dimensions(width, required_width)
                  for h in dimensions(height, required_height)
                  if total_area <= w * h < current_area]
    for _, _, w, h in sorted(candidates)[:16]:
        try:
            return pack(images, w, h, padding, True, max_pages=1, rotatable=rotatable)
        except (AtlasCapacityError, ValueError):
            continue
    return baseline


def plan_grouped(images, groups, width=2048, height=2048, padding=2, shrink=False, rotatable=()):
    """Pack related sprites on one page, using deterministic composite blocks.

    Overlapping groups are merged. Each group is first packed into a single
    page and its occupied rectangle becomes a block in the outer packing. This
    conservative fallback can use more space than an unconstrained layout and
    does not guarantee finding every feasible arrangement.
    """
    # Reuse the normal packer's dimension and identifier validation.
    rotatable = set(rotatable)
    pack(images, width, height, padding, max_pages=None, rotatable=rotatable)
    by_id = {image['id']: image for image in images}
    parent = {ident: ident for ident in by_id}
    def root(ident):
        while parent[ident] != ident:
            parent[ident] = parent[parent[ident]]
            ident = parent[ident]
        return ident
    for group in groups:
        group = list(group)
        if any(ident not in by_id for ident in group): raise ValueError('atlas group references unknown image')
        if not group: continue
        first = root(group[0])
        for ident in group[1:]:
            other = root(ident)
            if first != other:
                parent[other] = first
    merged = {}
    for ident in sorted(by_id): merged.setdefault(root(ident), []).append(by_id[ident])
    blocks, members = [], {}
    for index, group in enumerate(sorted(merged.values(), key=lambda g: g[0]['id'])):
        block_id = str(index)
        try:
            layout = pack(group, width, height, padding, max_pages=1, rotatable=rotatable.intersection(item['id'] for item in group))[0]['items']
        except AtlasCapacityError as exc:
            raise AtlasCapacityError('related atlas sprites do not fit on one page') from exc
        occupied_width = max(item['x'] + (item['height'] if item.get('rotated') else item['width']) + padding for item in layout)
        occupied_height = max(item['y'] + (item['width'] if item.get('rotated') else item['height']) + padding for item in layout)
        blocks.append({'id': block_id, 'width': occupied_width, 'height': occupied_height})
        members[block_id] = layout
    pages = pack(blocks, width, height, 0, shrink)
    for page in pages:
        page['items'] = [{**item, 'x': item['x'] + block['x'], 'y': item['y'] + block['y']}
                         for block in page['items'] for item in members[block['id']]]
    return pages


def render(pages, sources, duplicate_padding=(), padding=0):
    """Render RGBA pages from id -> PIL image, preserving pixel values exactly.

    The caller owns the returned PIL images. Selected images have their edge
    pixels extended into their reserved padding. Rotated items are stored
    clockwise. Source dimensions must match the unrotated layout dimensions.
    """
    from PIL import Image
    output = []
    for page in pages:
        canvas = Image.new('RGBA', (page['width'], page['height']), (0, 0, 0, 0))
        for item in page['items']:
            source = sources[item['id']]
            if source.size != (item['width'], item['height']):
                raise ValueError(f"image {item['id']!r} changed size after packing")
            # No mask: alpha-compositing onto transparent pixels modifies RGB
            # for translucent pixels and destroys invisible RGB information.
            source = source.convert('RGBA')
            if item.get('rotated'):
                rotated = source.transpose(Image.Transpose.ROTATE_270)
                source.close()
                source = rotated
            x, y = item['x'], item['y']
            w, h = source.size
            canvas.paste(source, (x, y))
            if item['id'] in duplicate_padding and padding:
                if x < padding or y < padding or x + w + padding > canvas.width or y + h + padding > canvas.height:
                    raise ValueError('image padding exceeds atlas bounds')
                canvas.paste(source.crop((0, 0, w, 1)).resize((w, padding), Image.Resampling.NEAREST), (x, y-padding))
                canvas.paste(source.crop((0, h-1, w, h)).resize((w, padding), Image.Resampling.NEAREST), (x, y+h))
                canvas.paste(source.crop((0, 0, 1, h)).resize((padding, h), Image.Resampling.NEAREST), (x-padding, y))
                canvas.paste(source.crop((w-1, 0, w, h)).resize((padding, h), Image.Resampling.NEAREST), (x+w, y))
                for px, py, cx, cy in ((0, 0, x-padding, y-padding), (w-1, 0, x+w, y-padding), (0, h-1, x-padding, y+h), (w-1, h-1, x+w, y+h)):
                    canvas.paste(source.getpixel((px, py)), (cx, cy, cx+padding, cy+padding))
            source.close()
        output.append(canvas)
    return output
