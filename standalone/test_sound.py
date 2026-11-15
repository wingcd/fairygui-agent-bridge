import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from sound import inspect_mp3, inspect_ogg_vorbis


class SoundTest(unittest.TestCase):
    def test_mp3_frame_structure_and_tags(self):
        # Two MPEG-1 Layer III frames at 128 kbps / 44.1 kHz.
        frame = bytes.fromhex('fffb9000') + bytes(413)
        tag = b'ID3\x04\x00\x00\x00\x00\x00\x00'
        data = tag + frame * 2 + b'TAG' + bytes(125)
        info = inspect_mp3(data)
        self.assertEqual((info['frames'], info['sample_rate'], info['channels']), (2, 44100, 2))
        for broken in (data[:-129], tag + frame[:-1], b'ID3\x04\x00\x00\x80\x00\x00\x00' + frame):
            with self.subTest(length=len(broken)), self.assertRaises(ValueError): inspect_mp3(broken)

    def test_real_sample_mp3_when_available(self):
        sample = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo')) / 'UIProject/assets/Transition/images/BUZZ4.mp3'
        if not sample.is_file(): self.skipTest('Cocos sample MP3 unavailable')
        result = inspect_mp3(sample.read_bytes())
        self.assertEqual((result['sample_rate'], result['channels']), (11025, 1))
        self.assertGreater(result['frames'], 1)

    def test_ogg_vorbis_checksums_and_truncation(self):
        ffmpeg = shutil.which('ffmpeg')
        if not ffmpeg: self.skipTest('ffmpeg not available to make an Ogg fixture')
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'sound.ogg'
            process = subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libvorbis', '-y', str(file)], capture_output=True)
            if process.returncode != 0: self.skipTest('ffmpeg has no Vorbis encoder')
            data = file.read_bytes()
            info = inspect_ogg_vorbis(data)
            self.assertEqual((info['format'], info['channels'], info['sample_rate']), ('ogg-vorbis', 1, 44100))
            self.assertGreater(info['pages'], 1)
            for broken in (data[:-1], data[:100], data[:100] + bytes([data[100] ^ 1]) + data[101:]):
                with self.subTest(length=len(broken)), self.assertRaises(ValueError): inspect_ogg_vorbis(broken)


if __name__ == '__main__': unittest.main()
