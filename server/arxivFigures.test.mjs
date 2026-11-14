import { describe, expect, it } from 'vitest';
import { createArxivHtmlFigures, extractArxivFigureSources } from './arxivFigures.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#369"/></svg>';

describe('arXiv HTML figure extraction', () => {
  it('keeps external assets, inline SVG, and nested subfigure groups', () => {
    const html = `
      <figure id="F1" class="ltx_figure"><object data="paper/one.svg"></object><figcaption>Figure 1</figcaption></figure>
      <figure id="F2" class="ltx_figure"><svg width="10" height="10"><rect width="10" height="10"/></svg></figure>
      <figure id="F3" class="ltx_figure">
        <figure class="ltx_figure ltx_figure_panel"><object data="paper/two.svg"></object></figure>
        <figure class="ltx_figure ltx_figure_panel"><object data="paper/three.svg"></object></figure>
      </figure>`;
    const groups = extractArxivFigureSources(html, 'https://arxiv.org/html/1234.56789v1');
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual(['https://arxiv.org/html/paper/one.svg']);
    expect(groups[1][0]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(groups[2]).toEqual([
      'https://arxiv.org/html/paper/two.svg',
      'https://arxiv.org/html/paper/three.svg',
    ]);
  });

  it('decodes original SVG assets without making network requests in production code', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/figure.svg')) return new Response(SVG, { status: 200 });
      return new Response('<figure class="ltx_figure"><object data="figure.svg"></object></figure>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const figures = await createArxivHtmlFigures('2401.00001', { fetchImpl });
    expect(figures).toHaveLength(1);
    expect(figures[0].width).toBeGreaterThan(0);
    expect(figures[0].height).toBeGreaterThan(0);
    expect(figures[0].buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('marks a failed figure for PDF fallback without dropping later figures', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/good.svg')) return new Response(SVG, { status: 200 });
      if (String(url).endsWith('/bad.svg')) return new Response('missing', { status: 404 });
      return new Response(`
        <figure class="ltx_figure"><object data="bad.svg"></object></figure>
        <figure class="ltx_figure"><object data="good.svg"></object></figure>`, { status: 200 });
    };
    const figures = await createArxivHtmlFigures('2401.00001', { fetchImpl });
    expect(figures).toHaveLength(2);
    expect(figures[0]).toBeNull();
    expect(figures[1].buffer.length).toBeGreaterThan(100);
  });
});
