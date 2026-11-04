import { describe, expect, it } from 'vitest';
import { encodeImageThumbnail, selectFirstPageImage } from './paperThumbnail.mjs';

describe('paper first-page image previews', () => {
  it('ignores tiny logos and selects the largest meaningful raster image', () => {
    const tinyLogo = { width: 40, height: 30, channels: 3, data: new Uint8Array(40 * 30 * 3) };
    const figure = { width: 160, height: 100, channels: 3, data: new Uint8Array(160 * 100 * 3) };
    const largerFigure = { width: 240, height: 140, channels: 4, data: new Uint8Array(240 * 140 * 4) };
    expect(selectFirstPageImage([tinyLogo, figure, largerFigure])).toBe(largerFigure);
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
});
