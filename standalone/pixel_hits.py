"""Pixel-hit masks in the Cocos FairyGUI package format."""


def make_pixel_mask(image, divisor=2):
    """Sample the center of each source block and encode alpha > 10, LSB first.

    Half-resolution dimensions and sampling follow the installed editor's
    published masks for tested even and odd image sizes.
    """
    if divisor not in (1, 2): raise ValueError('unsupported pixel hit divisor')
    width = max(1, image.width // divisor)
    height = max(1, image.height // divisor)
    alpha = image.getchannel('A')
    source = alpha.load()
    pixels = bytearray((width * height + 7) // 8)
    for y in range(height):
        sy = min(y * divisor + divisor // 2, image.height - 1)
        for x in range(width):
            sx = min(x * divisor + divisor // 2, image.width - 1)
            index = y * width + x
            if source[sx, sy] > 10: pixels[index // 8] |= 1 << (index % 8)
    return {'width': width, 'divisor': divisor, 'pixels': bytes(pixels)}
