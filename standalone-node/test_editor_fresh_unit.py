"""Checks for the editor publication comparison's sprite coverage."""
import unittest
from unittest.mock import patch

from test_editor_fresh import compare_atlas_pixels


class FontSpriteComparisonTest(unittest.TestCase):
    def test_font_texture_and_glyph_sprites_are_compared(self):
        expected = {
            'items': [{'type': 5, 'id': 'font', 'font': {
                'ttf': True, 'glyphs': [{'image': 'glyph'}],
            }}],
            'sprites': [{'id': 'font'}, {'id': 'glyph'}],
        }
        actual = {'sprites': [{'id': 'font'}, {'id': 'glyph'}]}

        def pixels(_package, filename, sprite):
            return sprite['id'], 'changed' if filename == 'node' and sprite['id'] == 'font' else 'same'

        with patch('test_editor_fresh.sprite_pixels', side_effect=pixels):
            differences = compare_atlas_pixels(actual, expected, 'node', 'editor')
        self.assertEqual([entry['id'] for entry in differences], ['font'])

        actual['sprites'].pop()
        with patch('test_editor_fresh.sprite_pixels', return_value=('size', 'same')):
            differences = compare_atlas_pixels(actual, expected, 'node', 'editor')
        self.assertEqual([(entry['id'], entry['error']) for entry in differences], [('glyph', 'sprite missing')])


if __name__ == '__main__':
    unittest.main()
