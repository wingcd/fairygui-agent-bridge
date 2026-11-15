import io
import struct
import unittest
from PIL import Image
from jta import read_jta


def sample_jta():
    output = io.BytesIO()
    Image.new('RGBA', (2, 1), (10, 20, 30, 128)).save(output, format='PNG')
    png = output.getvalue()
    header = struct.pack('>H', 5) + b'yytou' + struct.pack('>IIIHHBI', 102, 0, 0, 4, 3, 2, 2)
    frames = struct.pack('>6H', 0, 1, 1, 2, 1, 0) + struct.pack('>6H', 3, 0, 0, 2, 1, 0)
    return header + frames + struct.pack('>HI', 1, len(png)) + png


class JtaTest(unittest.TestCase):
    def test_parse_reused_frame_image_and_timing(self):
        clip = read_jta(sample_jta())
        try:
            self.assertEqual((clip['width'], clip['height'], clip['interval']), (4, 3, 83))
            self.assertEqual(clip['frames'][1], {'rect': [0, 0, 2, 1], 'delay': 125, 'imageIndex': 0})
            self.assertEqual(clip['images'][0].getpixel((0, 0)), (10, 20, 30, 128))
        finally:
            for image in clip['images']: image.close()

    def test_reject_truncation_and_unknown_version(self):
        data = sample_jta()
        with self.assertRaises(ValueError): read_jta(data[:-1])
        changed = bytearray(data)
        changed[10] = 103
        with self.assertRaisesRegex(ValueError, 'unsupported JTA header'): read_jta(changed)
