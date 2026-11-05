// Node's test runner keeps this integration test out of the web app's Vitest glob.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import paperFixture from './fixtures/papers-v1.json' with { type: 'json' };
import { isParallaxPublicRead, registerParallaxPublicApi } from './publicApi.mjs';

test('Parallax public read API serves only the fixed 10-paper fixture and cited benchmark data', async (t) => {
  assert.equal(paperFixture.length, 10);
  assert.equal(new Set(paperFixture.map(paper => paper.arxivId)).size, 10);
  const allowedPaperKeys = ['id', 'arxivId', 'title', 'authors', 'categories', 'abstractExcerpt', 'submittedAt', 'source', 'sourceUrl'];
  for (const paper of paperFixture) {
    assert.deepEqual(Object.keys(paper).sort(), [...allowedPaperKeys].sort());
    assert.match(paper.sourceUrl, /^https:\/\/arxiv\.org\/abs\//);
    assert.equal(paper.id, paper.arxivId);
    assert.equal('userId' in paper, false);
    assert.equal('email' in paper, false);
    assert.equal('organization' in paper, false);
  }

  const app = express();
  registerParallaxPublicApi(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const overLimitResponse = await fetch(`${base}/api/v1/public/feed?limit=1000`);
  assert.equal(overLimitResponse.status, 200);
  const overLimit = await overLimitResponse.json();
  assert.equal(overLimit.isFixture, true);
  assert.equal(overLimit.limit, 10);
  assert.equal(overLimit.papers.length, 10);

  const smallFeed = await (await fetch(`${base}/api/v1/public/feed?limit=3`)).json();
  assert.equal(smallFeed.papers.length, 3);

  const detail = await fetch(`${base}/api/v1/public/papers/2401.00139`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.paper.arxivId, '2401.00139');
  assert.equal(detailBody.paper.submittedAt, '2023-12-30T04:51:46Z');
  const missing = await fetch(`${base}/api/v1/public/papers/not-in-fixture`);
  assert.equal(missing.status, 404);

  const benchmarkResponse = await fetch(`${base}/api/v1/public/benchmarks/terminal-bench`);
  assert.equal(benchmarkResponse.status, 200);
  const { catalog } = await benchmarkResponse.json();
  assert.equal(catalog.currentVersion, '4.0.0');
  const latest = catalog.versions.find(version => version.version === '4.0.0');
  const historical = catalog.versions.find(version => version.version === '3.0.0');
  assert.equal(latest.metric.id, 'resolution_rate');
  assert.equal(latest.datasetVersion, '4.0.0');
  assert.equal(latest.results.length, 0);
  assert.equal(historical.metric.id, 'pass_rate');
  assert.equal(historical.datasetVersion, '3.0.0');
  assert.equal(historical.results.length, 8);
  assert.ok(historical.results.every(result => result.sourceUrl === 'https://www.tbench.ai/news/terminal-bench-3-0'));
  assert.ok(historical.results.every(result => result.publishedAt === '2026-07-30' && result.evaluatedAt === null));
  assert.ok(historical.results.every(result => result.scope === 'suite-aggregate' && result.taskId === null));
  assert.ok(historical.results.every(result => result.modelVersion === null && result.agentVersion === null));
  assert.ok(historical.results.every(result => result.paperUrl === null && result.codeUrl));

  assert.equal(isParallaxPublicRead({ method: 'GET', originalUrl: '/api/v1/public/feed?limit=10' }), true);
  assert.equal(isParallaxPublicRead({ method: 'POST', originalUrl: '/api/v1/public/feed' }), false);
  assert.equal(isParallaxPublicRead({ method: 'GET', originalUrl: '/api/v1/public/profiles/me' }), false);
});

test('pilot paper fixture can be disabled without disabling public benchmark catalog reads', async (t) => {
  const app = express();
  registerParallaxPublicApi(app, { pilotFixtureEnabled: false });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/v1/public/feed`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/public/papers/2401.00014`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/public/benchmarks/terminal-bench`)).status, 200);
});
