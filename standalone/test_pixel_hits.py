import unittest
from PIL import Image
from pixel_hits import make_pixel_mask


class PixelHitMaskTest(unittest.TestCase):
    def test_half_resolution_rounding_sampling_and_threshold(self):
        image = Image.new('RGBA', (5, 3), (0, 0, 0, 0))
        for position, alpha in [((1, 1), 10), ((3, 1), 11), ((1, 2), 255)]:
            image.putpixel(position, (0, 0, 0, alpha))
        self.assertEqual(make_pixel_mask(image), {'width': 2, 'divisor': 2, 'pixels': b'\x02'})
        self.assertEqual(make_pixel_mask(Image.new('RGBA', (1, 1), (0, 0, 0, 255))), {'width': 1, 'divisor': 2, 'pixels': b'\x01'})
