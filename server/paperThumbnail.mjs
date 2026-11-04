import { extractImages } from 'unpdf';

const MIN_IMAGE_AREA = 8_000;
const MAX_IMAGE_AREA = 40_000_000;
const PREVIEW_MAX_EDGE = 960;

export function selectFirstPageImage(images) {
  return images
    .filter(img => img.width >= 80 && img.height >= 60
      && img.width * img.height >= MIN_IMAGE_AREA
      && img.width * img.height <= MAX_IMAGE_AREA
      && [1, 3, 4].includes(img.channels))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null;
}

export async function encodeImageThumbnail(image) {
  if (!image) return null;
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const frame = context.createImageData(width, height);
  const src = image.data;
  const channels = image.channels;

  // Resample while converting grayscale/RGB/RGBA source data to RGBA.
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const si = (sy * image.width + sx) * channels;
      const di = (y * width + x) * 4;
      if (channels === 1) {
        frame.data[di] = frame.data[di + 1] = frame.data[di + 2] = src[si];
        frame.data[di + 3] = 255;
      } else {
        const alpha = channels === 4 ? src[si + 3] / 255 : 1;
        frame.data[di] = src[si] * alpha + 255 * (1 - alpha);
        frame.data[di + 1] = src[si + 1] * alpha + 255 * (1 - alpha);
        frame.data[di + 2] = src[si + 2] * alpha + 255 * (1 - alpha);
        frame.data[di + 3] = 255;
      }
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas.toBuffer('image/jpeg', 82);
}

/**
 * Extract the largest meaningful raster image embedded on page one and encode
 * a small JPEG for the feed. Returns null for text/vector-only first pages.
 */
export async function createFirstPageImageThumbnail(pdfBuffer) {
  const images = await extractImages(new Uint8Array(pdfBuffer), 1);
  return encodeImageThumbnail(selectFirstPageImage(images));
}
