import { describe, expect, it } from 'vitest';
import { createPaperFigureThumbnails, encodeImageThumbnail, selectFirstPageImage, selectPaperFigureImages } from './paperThumbnail.mjs';

function createPdfWithImages(images) {
  const objects = [null];
  const pageRefs = [];
  for (let index = 0; index < images.length; index++) {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    pageRefs.push(`${pageId} 0 R`);
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const jpeg = images[index];
    const imagePrefix = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 120 /Height 80 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    const imageSuffix = Buffer.from('\nendstream');
    objects[imageId] = Buffer.concat([imagePrefix, jpeg, imageSuffix]);
    const content = Buffer.from('q 120 0 0 80 0 0 cm /Im0 Do Q');
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]);
  }
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${images.length} >>`);

  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.concat(chunks).length;
    chunks.push(Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from('\nendobj\n'));
  }
  const xrefOffset = Buffer.concat(chunks).length;
  const xref = [Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n`)];
  for (let id = 1; id < objects.length; id++) {
    xref.push(Buffer.from(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
  }
  chunks.push(...xref, Buffer.from(
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ));
  return Buffer.concat(chunks);
}

describe('paper figure previews', () => {
  it('ignores tiny logos and selects the largest meaningful raster image', () => {
    const tinyLogo = { width: 40, height: 30, channels: 3, data: new Uint8Array(40 * 30 * 3) };
    const figure = { width: 160, height: 100, channels: 3, data: new Uint8Array(160 * 100 * 3) };
    const largerFigure = { width: 240, height: 140, channels: 4, data: new Uint8Array(240 * 140 * 4) };
    expect(selectFirstPageImage([tinyLogo, figure, largerFigure])).toBe(largerFigure);
    expect(selectPaperFigureImages([tinyLogo, figure, largerFigure])).toEqual([figure, largerFigure]);
    expect(selectFirstPageImage([tinyLogo])).toBeNull();
  });

  it('encodes RGB data as a JPEG preview', async () => {
    const image = {
      width: 120,
      height: 80,
      channels: 3,
      data: new Uint8Array(120 * 80 * 3).fill(90),
    };
    const jpeg = await encodeImageThumbnail(image);
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.length).toBeGreaterThan(100);
  });

  it('extracts figures from later pages as well as the first page', async () => {
    const jpeg1 = await encodeImageThumbnail({
      width: 120, height: 80, channels: 3, data: new Uint8Array(120 * 80 * 3).fill(70),
    });
    const jpeg2 = await encodeImageThumbnail({
      width: 120, height: 80, channels: 3, data: new Uint8Array(120 * 80 * 3).fill(180),
    });
    const figures = await createPaperFigureThumbnails(createPdfWithImages([jpeg1, jpeg2]));
    expect(figures).toHaveLength(2);
    expect(figures.map(figure => figure.pageNumber)).toEqual([1, 2]);
    expect(figures.every(figure => figure.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))).toBe(true);
  });
});
