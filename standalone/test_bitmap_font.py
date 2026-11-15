import unittest
from bitmap_font import read_bitmap_font


class BitmapFontTest(unittest.TestCase):
    def test_image_glyphs_and_bitmap_texture_glyphs(self):
        font = read_bitmap_font(b'info size=12 colored=true\nchar id=65 img=im1 xoffset=-1 yoffset=2 xadvance=8\n')
        self.assertEqual((font['ttf'], font['canTint'], font['lineHeight'], font['glyphs'][0]['image']), (False, True, 12, 'im1'))
        bmfont = read_bitmap_font(b'info face="Test" size=16\ncommon lineHeight=18 pages=1\nchar id=0 x=0 y=0 width=1 height=1\nchar id=65 x=1 y=2 width=3 height=4 xoffset=1 yoffset=2 xadvance=5 chnl=15 page=0\n', 'texture')
        self.assertEqual((bmfont['ttf'], bmfont['lineHeight'], len(bmfont['glyphs']), bmfont['glyphs'][0]['width']), (True, 18, 1, 3))

    def test_rejects_unsupported_and_invalid_font_data(self):
        for data, texture in [(b'info size=10\ncommon pages=2\n', 'tex'), (b'info size=10\nchar id=65\n', None), (b'info size=10\nkernings count=1\n', 'tex')]:
            with self.assertRaises(ValueError): read_bitmap_font(data, texture)
