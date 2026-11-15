import io
from contextlib import redirect_stderr
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

from PIL import Image
from cocos_runtime_probe import count_screenshot_differences, temporary_workspace, run


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class ScreenshotComparisonTest(unittest.TestCase):
    def test_controller_comparison_requires_reference(self):
        with self.assertRaisesRegex(ValueError, 'requires reference comparison'):
            run(Path('.'), Path('.'), Path('.'), Path('.'), compare_controller_states=True)

    def test_counts_pixels_above_one_channel_level(self):
        original = Image.new('RGB', (3, 1), (10, 20, 30))
        changed = original.copy()
        changed.putpixel((0, 0), (11, 19, 31))
        changed.putpixel((1, 0), (12, 20, 30))
        changed.putpixel((2, 0), (10, 20, 25))
        self.assertEqual(count_screenshot_differences(png(original), png(changed)), 2)

    def test_rejects_mismatched_dimensions(self):
        with self.assertRaisesRegex(ValueError, 'dimensions differ'):
            count_screenshot_differences(png(Image.new('RGB', (3, 1))), png(Image.new('RGB', (2, 1))))

    def test_cleanup_failure_does_not_discard_result(self):
        warning = io.StringIO()
        with patch('cocos_runtime_probe.shutil.rmtree') as remove, redirect_stderr(warning):
            with temporary_workspace() as directory:
                Path(directory, 'open.log').write_text('data')
                result = 'completed'
            remove.assert_called_once_with(directory, ignore_errors=True)
        try:
            self.assertEqual(result, 'completed')
            self.assertIn(str(directory), warning.getvalue())
        finally:
            shutil.rmtree(directory)
