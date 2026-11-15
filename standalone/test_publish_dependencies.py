import unittest
from test_publish_samples import url_dependency, compare_hit_test_masks
from test_full_reference import compare_packages


class PublishDependencyTest(unittest.TestCase):
    def test_id_and_named_urls_and_invalid_references(self):
        entries = {'a1': object(), 'a2': object()}
        names = {'Button': ['a1'], 'Ambiguous': ['a1', 'a2']}
        def resolve(value):
            return url_dependency(value, '12345678', 'Demo', entries, names)
        self.assertEqual(resolve('ui://12345678a1'), 'a1')
        self.assertEqual(resolve('ui://Demo/Button'), 'a1')
        self.assertIsNone(resolve('https://example.com/image.png'))
        for value in ('ui://12345678missing', 'ui://Demo/Ambiguous', 'ui://Other/Button'):
            with self.assertRaises(ValueError): resolve(value)

    def test_whole_package_comparison_detects_missing_item_and_hit_difference(self):
        image = {'id': 'img', 'type': 0, 'width': 2, 'height': 2, 'name': 'image'}
        reference = {'items': [image, {'id': 'comp', 'type': 3}], 'hitTests': [{'id': 'img', 'width': 2, 'divisor': 1, 'pixels': '0c'}]}
        actual = {'items': [dict(image)], 'hitTests': [{'id': 'img', 'width': 1, 'divisor': 2, 'pixels': '01'}]}
        result = compare_packages(actual, reference)
        self.assertTrue(any(item['path'] == 'resourceIds' for item in result))
        self.assertTrue(any(item.get('different_pixels') == 2 for item in result))
        self.assertEqual(compare_packages(reference, reference), [])

    def test_hit_masks_compare_runtime_coordinates(self):
        full = {'width': 2, 'divisor': 1, 'pixels': '0c'}
        same = {'width': 2, 'divisor': 1, 'pixels': '0c'}
        other = {'width': 1, 'divisor': 2, 'pixels': '01'}
        self.assertEqual(compare_hit_test_masks(full, same, 2, 2), 0)
        self.assertEqual(compare_hit_test_masks(full, other, 2, 2), 2)
