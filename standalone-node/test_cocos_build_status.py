"""Ensure the runtime probe does not hide unexpected build failures."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'standalone'))
from cocos_runtime_probe import successful_build


class BuildStatusTest(unittest.TestCase):
    def test_only_recognized_babel_diagnostic_allows_exit_36(self):
        note = 'Error: error: [build-script][BABEL] Note: code generator has deoptimised the styling of file as it exceeds the max of 500KB.'
        self.assertTrue(successful_build(0, 'build success', True))
        self.assertTrue(successful_build(36, note + '\nbuild success', True))
        self.assertFalse(successful_build(36, note + '\nerror: missing module\nbuild success', True))
        self.assertFalse(successful_build(0, 'error: missing module\nbuild success', True))
        self.assertTrue(successful_build(0, note + '\nbuild success', True))
        self.assertFalse(successful_build(1, note + '\nbuild success', True))
        self.assertFalse(successful_build(36, 'build success', True))
        self.assertFalse(successful_build(0, 'build success', False))


if __name__ == '__main__':
    unittest.main()
