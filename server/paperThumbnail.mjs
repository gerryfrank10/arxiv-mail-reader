import { extractImages, getDocumentProxy } from 'unpdf';

const MIN_IMAGE_AREA = 8_000;
const MAX_IMAGE_AREA = 40_000_000;
const PREVIEW_MAX_EDGE = 960;

export function selectFirstPageImage(images) {
  return selectPaperFigureImages(images)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null;
}

/** Keep figure-sized raster images while excluding tiny logos and glyphs. */
export function selectPaperFigureImages(images) {
  return images
    .filter(img => img.width >= 80 && img.height >= 60
      && img.width * img.height >= MIN_IMAGE_AREA
      && img.width * img.height <= MAX_IMAGE_AREA
      && [1, 3, 4].includes(img.channels));
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

/** Extract all figure-sized raster images from every page of a paper. */
export async function createPaperFigureThumbnails(pdfBuffer) {
  const document = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const figures = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const images = await extractImages(document, pageNumber);
      for (const image of selectPaperFigureImages(images)) {
        const thumbnail = await encodeImageThumbnail(image);
        if (thumbnail) {
          figures.push({
            buffer: thumbnail,
            pageNumber,
            width: image.width,
            height: image.height,
          });
        }
      }
    }
  } finally {
    await document.cleanup?.();
  }
  return figures;
}

/** Legacy first-page preview helper retained for callers outside the feed. */
export async function createFirstPageImageThumbnail(pdfBuffer) {
  const images = await extractImages(new Uint8Array(pdfBuffer), 1);
  return encodeImageThumbnail(selectFirstPageImage(images));
}
