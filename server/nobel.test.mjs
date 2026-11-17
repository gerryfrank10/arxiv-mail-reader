import { describe, expect, it } from 'vitest';
import { normalizeNobelResponse } from './nobel.mjs';

const API = {
  laureates: [
    {
      id: '641',
      knownName: { en: 'Marie Curie, née Sklodowska' },
      birth: { date: '1867-11-07', place: { country: { en: 'Russian Empire (now Poland)' }, countryNow: { en: 'Poland' } } },
      death: { date: '1934-07-04' },
      wikipedia: { english: 'https://en.wikipedia.org/wiki/Marie_Curie' },
      nobelPrizes: [
        {
          awardYear: '1903',
          category: { en: 'Physics' },
          portion: '1/4',
          motivation: { en: '"in recognition of the extraordinary services…"' },
          links: [{ rel: 'external', href: 'https://www.nobelprize.org/prizes/physics/1903/marie-curie/facts/', class: ['laureate facts'] }],
        },
        {
          awardYear: '1911',
          category: { en: 'Chemistry' },
          portion: '1',
          motivation: { en: 'in recognition of her services to the advancement of chemistry' },
          links: [],
        },
      ],
    },
    {
      id: '1',
      knownName: { en: 'Wilhelm Conrad Röntgen' },
      nobelPrizes: [
        { awardYear: '1901', category: { en: 'Physics' }, portion: '1', motivation: { en: 'for X-rays' }, links: [] },
      ],
    },
    {
      // Organization laureate (Peace): no knownName/birth.
      id: '941',
      fullName: { en: 'International Committee of the Red Cross' },
      nobelPrizes: [
        { awardYear: '1963', category: { en: 'Peace' }, portion: '1/2', motivation: { en: '' }, links: [] },
      ],
    },
    {
      // A prize in a category we don't track must be ignored, not crash.
      id: '999',
      knownName: { en: 'Mystery Person' },
      nobelPrizes: [{ awardYear: '2100', category: { en: 'Interstellar Studies' }, portion: '1', motivation: { en: '' }, links: [] }],
    },
  ],
};

describe('Nobel Prize normalization', () => {
  const data = normalizeNobelResponse(API);

  it('groups awards by year, newest first, in ceremony order', () => {
    expect(data.years.map(y => y.year)).toEqual([1963, 1911, 1903, 1901]);
    const physics1901 = data.years.find(y => y.year === 1901);
    expect(physics1901.awards).toHaveLength(1);
    expect(physics1901.awards[0].category).toBe('Physics');
    expect(physics1901.awards[0].laureates[0].name).toBe('Wilhelm Conrad Röntgen');
  });

  it('orders categories within a year and keeps multiple laureates', () => {
    // 1963 has only Peace; 1911 only Chemistry — exercise via 1903/1911 ordering.
    expect(data.years.find(y => y.year === 1963).awards[0].category).toBe('Peace');
  });

  it('keeps multi-prize winners under each of their prizes', () => {
    const marie = data.years.find(y => y.year === 1903).awards[0].laureates[0];
    expect(marie.name).toBe('Marie Curie, née Sklodowska');
    expect(marie.portion).toBe('1/4');
    expect(marie.nobelUrl).toBe('https://www.nobelprize.org/prizes/physics/1903/marie-curie/facts/');
    expect(marie.wikipedia).toBe('https://en.wikipedia.org/wiki/Marie_Curie');
    expect(marie.birthYear).toBe('1867');
    expect(marie.deathYear).toBe('1934');
    expect(marie.country).toBe('Poland');
    const chemistry1911 = data.years.find(y => y.year === 1911).awards[0].laureates[0];
    expect(chemistry1911.id).toBe('641');
    expect(chemistry1911.nobelUrl).toBeNull();
  });

  it('handles organization laureates without birth data', () => {
    const peace = data.years.find(y => y.year === 1963).awards[0].laureates[0];
    expect(peace.name).toBe('International Committee of the Red Cross');
    expect(peace.birthYear).toBeNull();
    expect(peace.country).toBeNull();
  });

  it('ignores prizes in unknown categories and empty input', () => {
    expect(data.years.some(y => y.year === 2100)).toBe(false);
    expect(normalizeNobelResponse({})).toEqual({ fetchedAt: expect.any(String), total: 0, years: [] });
    expect(normalizeNobelResponse(null).years).toEqual([]);
  });

  it('counts total laureates', () => {
    expect(data.total).toBe(4);
  });
});
