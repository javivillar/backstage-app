import { CHECKS, cell, isoWeek, riskScore, weekly, weeklyCounts } from './heatmap';
import type { Status } from './model';

const ctx = (status: Status = { kind: 'latest' }, more: Partial<{ health: string; owner: string; hasDocs: boolean }> = {}) => ({ status, owner: 'group:default/team', hasDocs: true, ...more });
const facts = (f: Record<string, unknown>) => f;

describe('cell', () => {
  it('line: latest 0, 1 behind 1, 2 behind 2, 3 behind or unmaintained 3', () => {
    expect(cell('line', {}, ctx({ kind: 'latest' })).level).toBe(0);
    expect(cell('line', {}, ctx({ kind: 'behind', behind: 1 })).level).toBe(1);
    expect(cell('line', {}, ctx({ kind: 'behind', behind: 2 })).level).toBe(2);
    expect(cell('line', {}, ctx({ kind: 'behind', behind: 3 })).level).toBe(3);
    expect(cell('line', { frameworkLineMaintained: false }, ctx({ kind: 'latest' })).level).toBe(3);
    expect(cell('line', {}, ctx({ kind: 'ending', daysLeft: 40 })).level).toBe(0);
    expect(cell('line', undefined, ctx({ kind: 'behind', behind: 1 })).text).toBe('1 behind');
  });
  it('lineEnds: text 0 "—", >183 days 0, 92-183 2, <92 3', () => {
    expect(cell('lineEnds', {}, ctx({ kind: 'latest' }))).toEqual({ text: '—', level: 0 });
    expect(cell('lineEnds', {}, ctx({ kind: 'latest', daysLeft: 300 }))).toEqual({ text: '10 mo', level: 0 });
    expect(cell('lineEnds', {}, ctx({ kind: 'ending', daysLeft: 182 })).level).toBe(2);
    expect(cell('lineEnds', {}, ctx({ kind: 'ending', daysLeft: 150 }))).toEqual({ text: '5 mo', level: 2 });
    expect(cell('lineEnds', {}, ctx({ kind: 'ending', daysLeft: 92 })).level).toBe(2);
    expect(cell('lineEnds', {}, ctx({ kind: 'ending', daysLeft: 73 }))).toEqual({ text: '73 d', level: 3 });
  });
  it('frameworkVulns / ownVulns: critical 3, 2+ high 3, 1 high 2, else 0', () => {
    expect(cell('frameworkVulns', facts({ frameworkLayerCritical: 2, frameworkLayerHigh: 0 }), ctx())).toEqual({ text: '2 crit', level: 3 });
    expect(cell('frameworkVulns', facts({ frameworkLayerCritical: 0, frameworkLayerHigh: 1 }), ctx())).toEqual({ text: '1 high', level: 2 });
    expect(cell('frameworkVulns', facts({ frameworkLayerCritical: 0, frameworkLayerHigh: 2 }), ctx())).toEqual({ text: '2 high', level: 3 });
    expect(cell('ownVulns', facts({ ownLayerCritical: 0, ownLayerHigh: 0 }), ctx())).toEqual({ text: '0', level: 0 });
    expect(cell('ownVulns', facts({ ownLayerCritical: 1, ownLayerHigh: 3 }), ctx())).toEqual({ text: '1 crit, 3 high', level: 3 });
  });
  it('supplyChain: SBOM on every image and scanned', () => {
    expect(cell('supplyChain', facts({ sbomOnEveryImage: true, imagesScanned: true }), ctx())).toEqual({ text: 'yes', level: 0 });
    expect(cell('supplyChain', facts({ sbomOnEveryImage: true, imagesScanned: false }), ctx())).toEqual({ text: 'no', level: 3 });
  });
  it('tests: none failed 0, else 3', () => {
    expect(cell('tests', facts({ testsFailed: 0 }), ctx())).toEqual({ text: '0 failed', level: 0 });
    expect(cell('tests', facts({ testsFailed: 2 }), ctx())).toEqual({ text: '2 failed', level: 3 });
  });
  it('coverage: the best of backend and frontend', () => {
    const cov = (b: number, f = -1) => cell('coverage', facts({ backendCoverage: b, frontendCoverage: f }), ctx());
    expect(cov(80)).toEqual({ text: '80%', level: 0 });
    expect(cov(79.9).level).toBe(1);
    expect(cov(60).level).toBe(1);
    expect(cov(59).level).toBe(2);
    expect(cov(40).level).toBe(2);
    expect(cov(39).level).toBe(3);
    expect(cov(30, 85).level).toBe(0);
    expect(cov(-1, -1)).toEqual({ text: 'n/a', level: null });
  });
  it('codeIssues: lint + type errors', () => {
    const ci = (l: number, ty: number) => cell('codeIssues', facts({ lintIssues: l, typeErrors: ty }), ctx()).level;
    expect(ci(0, 0)).toBe(0);
    expect(ci(1, 0)).toBe(1);
    expect(ci(5, 5)).toBe(1);
    expect(ci(11, 0)).toBe(2);
    expect(ci(50, 0)).toBe(2);
    expect(ci(51, 0)).toBe(3);
    expect(ci(4, -1)).toBe(1);
  });
  it('endOfLife: OS, toolchain or runtime out of support 3, ending soon 2', () => {
    const eol = (os: number, tc: number, soon: number, comp = 0) => cell('endOfLife', facts({ osEndOfLife: os, toolchainsEndOfLife: tc, componentsEndingSoon: soon, componentsEndOfLife: comp }), ctx()).level;
    expect(eol(1, 0, 0)).toBe(3);
    expect(eol(0, 1, 0)).toBe(3);
    expect(eol(0, 0, 0, 1)).toBe(3);
    expect(eol(0, 0, 2)).toBe(2);
    expect(eol(0, 0, 0)).toBe(0);
    expect(eol(-1, 0, 0)).toBeNull();
  });
  it('licenses: denied 3, unknown 1', () => {
    expect(cell('licenses', facts({ deniedLicenses: 1, unknownLicenses: 0 }), ctx()).level).toBe(3);
    expect(cell('licenses', facts({ deniedLicenses: 0, unknownLicenses: 2 }), ctx())).toEqual({ text: '2 unknown', level: 1 });
    expect(cell('licenses', facts({ deniedLicenses: 0, unknownLicenses: 0 }), ctx())).toEqual({ text: 'ok', level: 0 });
  });
  it('health from Argo CD', () => {
    expect(cell('health', undefined, ctx(undefined, { health: 'Healthy' }))).toEqual({ text: 'Healthy', level: 0 });
    expect(cell('health', undefined, ctx(undefined, { health: 'Progressing' })).level).toBe(1);
    expect(cell('health', undefined, ctx(undefined, { health: 'Degraded' })).level).toBe(3);
    expect(cell('health', undefined, ctx(undefined, { health: 'Missing' })).level).toBe(3);
    expect(cell('health', undefined, ctx(undefined, { health: 'Unknown' })).level).toBeNull();
    expect(cell('health', undefined, ctx())).toEqual({ text: 'n/a', level: null });
  });
  it('ownerDocs: a group and docs', () => {
    expect(cell('ownerDocs', undefined, ctx())).toEqual({ text: 'ok', level: 0 });
    expect(cell('ownerDocs', undefined, ctx(undefined, { hasDocs: false }))).toEqual({ text: 'no docs', level: 2 });
    expect(cell('ownerDocs', undefined, ctx(undefined, { owner: 'user:default/jane' })).level).toBe(2);
    expect(cell('ownerDocs', undefined, ctx(undefined, { owner: undefined, hasDocs: false })).level).toBe(3);
  });
  it('missing facts give n/a', () => {
    expect(cell('ownVulns', undefined, ctx())).toEqual({ text: 'n/a', level: null });
    expect(cell('supplyChain', undefined, ctx())).toEqual({ text: 'n/a', level: null });
  });
  it('-1 gives n/a', () => {
    expect(cell('ownVulns', facts({ ownLayerCritical: -1, ownLayerHigh: -1 }), ctx())).toEqual({ text: 'n/a', level: null });
    expect(cell('tests', facts({ testsFailed: -1 }), ctx())).toEqual({ text: 'n/a', level: null });
  });
  it('every check has a lens, a source and a tab', () => {
    expect(CHECKS).toHaveLength(12);
    for (const c of CHECKS) expect(c.source && c.lens && typeof c.to === 'string').toBeTruthy();
  });
});

describe('riskScore', () => {
  it('3 per act now, 1 per attention', () => expect(riskScore([3, 2, 0, null])).toBe(4));
});

describe('weekly', () => {
  const p = (timestamp: string, f: Record<string, unknown>) => ({ timestamp, facts: f });
  it('keys weeks by ISO week', () => {
    expect(isoWeek('2026-11-08')).toBe('2026-W45');
    expect(isoWeek('2026-11-09')).toBe('2026-W46');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
  it('3 points over 10 weeks gives 10 entries, 7 empty', () => {
    const out = weekly([p('2026-10-26T05:23:00Z', { frameworkLayerCritical: 0, frameworkLayerHigh: 0, ownLayerCritical: 0, ownLayerHigh: 1 }), p('2026-11-02T05:23:00Z', { frameworkLayerCritical: 0, frameworkLayerHigh: 0, ownLayerCritical: 0, ownLayerHigh: 0 }), p('2026-10-19T05:23:00Z', { frameworkLayerCritical: 1, frameworkLayerHigh: 2, ownLayerCritical: 0, ownLayerHigh: 1 })], 'vulns', 10, '2026-11-08');
    expect(out).toHaveLength(10);
    expect(out.filter(w => w.level === null && w.text === '')).toHaveLength(7);
    expect(out[0].week).toBe('W36');
    expect(out.slice(-3)).toEqual([
      { week: 'W43', text: '4', level: 3 },
      { week: 'W44', text: '1', level: 1 },
      { week: 'W45', text: '0', level: 0 },
    ]);
  });
  it('the latest point of a week wins', () => {
    const out = weekly([p('2026-11-03T05:00:00Z', { testsFailed: 3 }), p('2026-11-05T05:00:00Z', { testsFailed: 0 })], 'tests', 2, '2026-11-08');
    expect(out).toEqual([
      { week: 'W44', text: '', level: null },
      { week: 'W45', text: '0', level: 0 },
    ]);
  });
  it('coverage and line metrics', () => {
    expect(weekly([p('2026-11-03T05:00:00Z', { backendCoverage: 55, frontendCoverage: -1 })], 'coverage', 1, '2026-11-08')[0]).toEqual({ week: 'W45', text: '55%', level: 2 });
    expect(weekly([p('2026-11-03T05:00:00Z', { frameworkLine: '3.2', latestFrameworkLine: '3.3' })], 'line', 1, '2026-11-08')[0]).toEqual({ week: 'W45', text: '3.2', level: 2 });
    expect(weekly([p('2026-11-03T05:00:00Z', { frameworkLine: '3.3', latestFrameworkLine: '3.3' })], 'line', 1, '2026-11-08')[0].level).toBe(0);
    // a Spring app is compared with the latest line of its own framework, not with Python's 3.3
    expect(weekly([p('2026-11-03T05:00:00Z', { frameworkLine: '1.0', latestFrameworkLine: '3.3' })], 'line', 1, '2026-11-08', '1.0')[0].level).toBe(0);
  });
  it('vulns is n/a, not 0, when an image was not scanned (layer facts -1)', () => {
    const w = weekly([p('2026-11-03T05:00:00Z', { critical: 0, high: 0, frameworkLayerCritical: -1, frameworkLayerHigh: -1, ownLayerCritical: -1, ownLayerHigh: -1 })], 'vulns', 1, '2026-11-08')[0];
    expect(w.level).toBeNull();
    expect(weekly([p('2026-11-03T05:00:00Z', { critical: -1, high: -1 })], 'vulns', 1, '2026-11-08')[0]).toEqual({ week: 'W45', text: 'n/a', level: null });
  });
});

describe('line cell of an ending line', () => {
  it('uses the known lines behind', () => expect(cell('line', {}, { status: { kind: 'ending', daysLeft: 73 }, behind: 2, hasDocs: true })).toEqual({ text: '2 behind', level: 2 }));
});

describe('weeklyCounts (deploys, incidents)', () => {
  it('counts events per ISO week, oldest first', () => {
    const w = weeklyCounts(['2026-11-03T10:00:00Z', '2026-11-04T10:00:00Z', '2026-10-28T10:00:00Z'], 'deploys', 3, '2026-11-08');
    expect(w.map(x => x.week)).toEqual(['W43', 'W44', 'W45']);
    expect(w.map(x => x.text)).toEqual(['0', '1', '2']);
    expect(w.map(x => x.level)).toEqual([1, 0, 0]);
  });
  it('incidents: 0 good, 1 ok, 2 attention, 3+ act now', () => {
    const d = (n: number) => Array.from({ length: n }, () => '2026-11-03T10:00:00Z');
    expect(weeklyCounts(d(0), 'incidents', 1, '2026-11-08')[0].level).toBe(0);
    expect(weeklyCounts(d(1), 'incidents', 1, '2026-11-08')[0].level).toBe(1);
    expect(weeklyCounts(d(2), 'incidents', 1, '2026-11-08')[0].level).toBe(2);
    expect(weeklyCounts(d(5), 'incidents', 1, '2026-11-08')[0]).toEqual({ week: 'W45', text: '5', level: 3 });
  });
  it('a source that could not be read is n/a, never 0', () => {
    expect(weeklyCounts(undefined, 'incidents', 2, '2026-11-08')).toEqual([{ week: 'W44', text: 'n/a', level: null }, { week: 'W45', text: 'n/a', level: null }]);
  });
  it('ignores dates that do not parse', () => {
    expect(weeklyCounts(['', 'nope'], 'deploys', 1, '2026-11-08')[0].text).toBe('0');
  });
});
