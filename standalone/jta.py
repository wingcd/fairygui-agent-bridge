"""Read the observed FairyGUI JTA v102 movieclip resource format."""
from io import BytesIO
import struct


def read_jta(data):
    from PIL import Image
    pos = 0
    def read(n):
        nonlocal pos
        if n < 0 or pos + n > len(data): raise ValueError('truncated JTA resource')
        chunk = data[pos:pos+n]
        pos += n
        return chunk
    def number(fmt): return struct.unpack(fmt, read(struct.calcsize(fmt)))[0]
    name = read(number('>H')).decode('utf-8')
    version, reserved1, reserved2 = number('>I'), number('>I'), number('>I')
    width, height, rate, count = number('>H'), number('>H'), number('>B'), number('>I')
    if version != 102 or reserved1 or reserved2 or not width or not height or not rate or count > 32767:
        raise ValueError('unsupported JTA header')
    frames = []
    for _ in range(count):
        delay, x, y, w, h, index = (number('>H') for _ in range(6))
        if not w or not h or x + w > width or y + h > height: raise ValueError('invalid JTA frame rectangle')
        frames.append({'rect': [x, y, w, h], 'delay': delay * 1000 // 24, 'imageIndex': index})
    image_count = number('>H')
    images = []
    try:
        for _ in range(image_count):
            blob = read(number('>I'))
            with Image.open(BytesIO(blob)) as image:
                if image.format != 'PNG': raise ValueError('unsupported JTA frame image format')
                images.append(image.convert('RGBA'))
        if pos != len(data): raise ValueError('unsupported trailing JTA data')
        for frame in frames:
            if frame['imageIndex'] >= len(images) or images[frame['imageIndex']].size != tuple(frame['rect'][2:]):
                raise ValueError('invalid JTA frame image')
        return {'name': name, 'width': width, 'height': height, 'interval': rate * 1000 // 24, 'frames': frames, 'images': images}
    except Exception:
        for image in images: image.close()
        raise
