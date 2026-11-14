import sharp from 'sharp';

// Keep all four channels, including RGB values behind zero alpha.
export async function decodeImage(input,{ignoreIcc=false}={}) {
  const {data,info} = await sharp(input,{failOn:'error',limitInputPixels:268402689,ignoreIcc}).ensureAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  if (info.channels !== 4) throw new Error('expected RGBA image');
  return {width:info.width,height:info.height,pixels:data};
}

export async function encodePng(image) {
  const {width,height,pixels} = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('invalid RGBA image');
  return sharp(Buffer.from(pixels),{raw:{width,height,channels:4}}).png().toBuffer();
}

export function makePixelMask(image, divisor = 2) {
  const {width,height,pixels} = image;
  if (![1,2].includes(divisor)) throw new Error('unsupported pixel hit divisor');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('invalid RGBA image');
  const outWidth = Math.max(1,Math.floor(width / divisor)), outHeight = Math.max(1,Math.floor(height / divisor));
  const mask = Buffer.alloc(Math.ceil(outWidth * outHeight / 8));
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const sx = Math.min(x * divisor + Math.floor(divisor / 2),width - 1), sy = Math.min(y * divisor + Math.floor(divisor / 2),height - 1);
    const index = y * outWidth + x;
    if (pixels[(sy * width + sx) * 4 + 3] > 10) mask[Math.floor(index / 8)] |= 1 << (index % 8);
  }
  return {width:outWidth,divisor,pixels:mask};
}
