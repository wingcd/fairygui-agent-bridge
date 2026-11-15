import random
import unittest
from unittest.mock import patch
from atlas import split_free, split_free_pruned, plan, plan_grouped, overlaps, pack, render


class AtlasTest(unittest.TestCase):
    def test_rotation_fits_and_preserves_pixels_and_padding(self):
        from PIL import Image
        source = Image.new('RGBA', (6, 3))
        source.putdata([(x * 30, y * 70, 20, 100 + x) for y in range(3) for x in range(6)])
        images = [{'id': 'i', 'width': 6, 'height': 3}]
        with self.assertRaises(ValueError): pack(images, 5, 8, 1)
        page = pack(images, 5, 8, 1, shrink=True, rotatable={'i'})[0]
        item = page['items'][0]
        self.assertTrue(item['rotated'])
        canvas = render([page], {'i': source}, {'i'}, 1)[0]
        restored = canvas.crop((item['x'], item['y'], item['x'] + 3, item['y'] + 6)).transpose(Image.Transpose.ROTATE_90)
        self.assertEqual(restored.tobytes(), source.tobytes())
        self.assertEqual(canvas.getpixel((0, 0)), canvas.getpixel((1, 1)))
        self.assertEqual((page['width'], page['height']), (5, 8))
        canvas.close(); restored.close(); source.close()

    def test_random_rotated_layouts_are_deterministic_and_disjoint(self):
        rng = random.Random(113)
        images = [{'id': str(i), 'width': rng.randint(2, 40), 'height': rng.randint(2, 40)} for i in range(120)]
        rotatable = {image['id'] for image in images if int(image['id']) % 2 == 0}
        pages = pack(images, 64, 64, 1, shrink=True, rotatable=rotatable)
        self.assertEqual(pages, pack(list(reversed(images)), 64, 64, 1, shrink=True, rotatable=rotatable))
        for page in pages:
            rectangles = []
            for item in page['items']:
                if item.get('rotated'): self.assertIn(item['id'], rotatable)
                w, h = (item['height'], item['width']) if item.get('rotated') else (item['width'], item['height'])
                rect = (item['x'] - 1, item['y'] - 1, w + 2, h + 2)
                self.assertTrue(rect[0] >= 0 and rect[1] >= 0 and rect[0] + rect[2] <= page['width'] and rect[1] + rect[3] <= page['height'])
                self.assertFalse(any(overlaps(rect, other) for other in rectangles))
                rectangles.append(rect)

    def test_grouped_fallback_keeps_overlapping_groups_together(self):
        sizes = [(3, 6), (2, 4), (2, 5), (5, 5), (7, 5)]
        images = [{'id': str(i), 'width': width, 'height': height} for i, (width, height) in enumerate(sizes)]
        baseline = plan(images, 8, 8, 0)
        locations = {item['id']: index for index, page in enumerate(baseline) for item in page['items']}
        self.assertNotEqual(locations['0'], locations['1'])
        pages = plan_grouped(images, [['0', '1'], ['1', '2']], 8, 8, 0)
        self.assertEqual(pages, plan_grouped(list(reversed(images)), [['0', '1'], ['1', '2']], 8, 8, 0))
        locations = {item['id']: index for index, page in enumerate(pages) for item in page['items']}
        self.assertEqual(len({locations[x] for x in ('0', '1', '2')}), 1)
        for page in pages:
            rectangles = [(i['x'], i['y'], i['width'], i['height']) for i in page['items']]
            for index, (x, y, w, h) in enumerate(rectangles):
                self.assertTrue(x >= 0 and y >= 0 and x + w <= 8 and y + h <= 8)
                self.assertFalse(any(overlaps(rectangles[index], other) for other in rectangles[index+1:]))
        with self.assertRaisesRegex(ValueError, 'one page'):
            plan_grouped(images, [['0', '4']], 8, 8, 0)

    def test_random_placements_are_in_bounds_and_separated(self):
        rng = random.Random(93)
        images = [{'id': str(i), 'width': rng.randint(1, 35), 'height': rng.randint(1, 35)} for i in range(300)]
        pages = pack(images, 128, 128, 2)
        self.assertEqual(pages, pack(list(reversed(images)), 128, 128, 2))
        self.assertEqual({i['id'] for i in images}, {i['id'] for p in pages for i in p['items']})
        for page in pages:
            rects = [(i['x']-2, i['y']-2, i['width']+4, i['height']+4) for i in page['items']]
            for n, (x, y, w, h) in enumerate(rects):
                self.assertTrue(x >= 0 and y >= 0 and x+w <= 128 and y+h <= 128)
                self.assertFalse(any(overlaps(rects[n], other) for other in rects[n+1:]))

    def test_pruned_split_and_layout_match_reference(self):
        import atlas
        for seed in range(4):
            rng = random.Random(seed)
            free = [(0, 0, 256, 256)]
            for _ in range(50):
                if not free: break
                x, y, width, height = rng.choice(free)
                used = (x + rng.randrange(width), y + rng.randrange(height), 1, 1)
                expected = split_free(free, used)
                self.assertEqual(split_free_pruned(free, used), expected)
                free = expected
            images = [{'id': str(i), 'width': rng.randint(1, 30), 'height': rng.randint(1, 30)} for i in range(160)]
            optimized = pack(images, 128, 128, 2)
            with patch.object(atlas, 'split_free_pruned', side_effect=split_free):
                reference = pack(images, 128, 128, 2)
            self.assertEqual(optimized, reference)

    def test_shrink_preserves_placement_and_padding(self):
        rng = random.Random(11)
        images = [{'id': str(i), 'width': rng.randint(1, 35), 'height': rng.randint(1, 35)} for i in range(300)]
        full = pack(images, 130, 130, 2)
        compact = pack(images, 130, 130, 2, shrink=True)
        self.assertEqual([page['items'] for page in compact], [page['items'] for page in full])
        small = pack([{'id': 'small', 'width': 3, 'height': 5}], 130, 130, 2, shrink=True)
        self.assertEqual((small[0]['width'], small[0]['height']), (8, 16))
        for page in compact:
            self.assertLessEqual(page['width'], 130)
            self.assertLessEqual(page['height'], 130)
            for item in page['items']:
                self.assertLessEqual(item['x'] + item['width'] + 2, page['width'])
                self.assertLessEqual(item['y'] + item['height'] + 2, page['height'])
        with self.assertRaises(ValueError): pack(images, 130, 130, shrink='true')

    def test_bounded_optimization_is_safe_deterministic_and_no_worse(self):
        rng = random.Random(41)
        for count in (3, 25, 150):
            images = [{'id': str(i), 'width': rng.randint(1, 35), 'height': rng.randint(1, 35)} for i in range(count)]
            baseline = plan(images, 256, 256, 2, shrink=True)
            optimized = plan(images, 256, 256, 2, optimize=True)
            self.assertEqual(optimized, plan(list(reversed(images)), 256, 256, 2, optimize=True))
            self.assertLessEqual(len(optimized), len(baseline))
            self.assertLessEqual(sum(p['width'] * p['height'] for p in optimized), sum(p['width'] * p['height'] for p in baseline))
            self.assertEqual({item['id'] for page in optimized for item in page['items']}, {item['id'] for item in images})
            for page in optimized:
                rectangles = [(item['x'] - 2, item['y'] - 2, item['width'] + 4, item['height'] + 4) for item in page['items']]
                for i, (x, y, w, h) in enumerate(rectangles):
                    self.assertTrue(x >= 0 and y >= 0 and x + w <= page['width'] and y + h <= page['height'])
                    self.assertFalse(any(overlaps(rectangles[i], other) for other in rectangles[i+1:]))
        with self.assertRaises(ValueError): plan([], optimize=True, shrink='true')
        with self.assertRaises(ValueError): plan([], width=2147483648)

    def test_rejects_invalid_and_oversized(self):
        for images in ([{'id': 'a', 'width': 129, 'height': 1}], [{'id': 'a', 'width': 1, 'height': 1}, {'id': 'a', 'width': 2, 'height': 2}], [{'id': 'a', 'width': 0, 'height': 1}]):
            with self.assertRaises(ValueError):
                pack(images, 128, 128)

    def test_render_preserves_transparent_and_partial_alpha_pixels(self):
        from PIL import Image
        source = Image.new('RGBA', (2, 2))
        source.putdata([(20, 30, 40, 0), (240, 12, 17, 128), (1, 2, 3, 255), (0, 1, 2, 64)])
        pages = pack([{'id': 'a', 'width': 2, 'height': 2}], 8, 8, 1)
        canvas = render(pages, {'a': source})[0]
        item = pages[0]['items'][0]
        cropped = canvas.crop((item['x'], item['y'], item['x'] + 2, item['y'] + 2))
        self.assertEqual(cropped.tobytes(), source.tobytes())
        self.assertEqual(canvas.getpixel((0, 0)), (0, 0, 0, 0))
        with self.assertRaises(ValueError):
            render(pages, {'a': Image.new('RGBA', (1, 1))})

    def test_duplicate_padding_copies_edges_and_corners_exactly(self):
        from PIL import Image
        source = Image.new('RGBA', (2, 2))
        pixels = [(20, 30, 40, 0), (240, 12, 17, 128), (1, 2, 3, 255), (0, 1, 2, 64)]
        source.putdata(pixels)
        pages = pack([{'id': 'a', 'width': 2, 'height': 2}], 8, 8, 2)
        canvas = render(pages, {'a': source}, {'a'}, 2)[0]
        for y in range(6):
            for x in range(6):
                self.assertEqual(canvas.getpixel((x, y)), pixels[(0 if y < 3 else 2) + (0 if x < 3 else 1)])


if __name__ == '__main__': unittest.main()
