import { describe, expect, it } from 'vitest';
import { filterSourcemapSources } from './sourcemapFilter';

// One generated line, three segments, hand-encoded so the expectations below
// are literals rather than something this module recomputes:
//
//   AAAA  -> col 0,  source 0 (app/a.ts),  line 0, col 0
//   KCEG  -> col 5,  source 1 (vendor),    line 2, col 3   (deltas +5,+1,+2,+3)
//   KCCCA -> col 10, source 2 (app/c.ts),  line 3, col 4, name 0
//
// Base64-VLQ digits: A=0, C=1, E=2, G=3, I=4, K=5.
const MAP = {
  version: 3 as const,
  file: 'chunk.js',
  names: ['alpha', 'beta'],
  sources: ['../../app/a.ts', '../../node_modules/dep/b.js', '../../app/c.ts'],
  sourcesContent: ['export const a = 1;', 'module.exports = 2;', 'export c;'],
  mappings: 'AAAA,KCEG,KCCCA'
};

const isApp = (source: string) => source.includes('/app/');

describe('filterSourcemapSources', () => {
  it('keeps only the accepted sources and their content, in order', () => {
    const filtered = filterSourcemapSources(MAP, isApp);

    expect(filtered?.sources).toEqual(['../../app/a.ts', '../../app/c.ts']);
    expect(filtered?.sourcesContent).toEqual([
      'export const a = 1;',
      'export c;'
    ]);
  });

  it('rewrites the mappings against the compacted source list', () => {
    // Hand-encoded expectation for the fixture above:
    //
    //   AAAA  -> col 0,  source 0 (app/a.ts, now index 0), line 0, col 0
    //   K     -> col 5,  the dropped vendor segment, now an unmapped marker so
    //                    app/a.ts does not appear to cover the vendor code
    //   KCGIA -> col 10 (delta +5), source 1 (app/c.ts), line 3, col 4, name 0
    expect(filterSourcemapSources(MAP, isApp)?.mappings).toBe('AAAA,K,KCGIA');
  });

  it('carries the running deltas across dropped segments and lines', () => {
    // Three generated lines, one segment each. Source index, line and column
    // run as deltas across the whole map, so the app segment on the third line
    // is only reachable by having tracked the vendor segment on the second:
    //
    //   AAAA -> source 0 (app/a.ts), line 0
    //   ACEA -> source 1 (vendor),   line 2   (+1 source, +2 line)
    //   ACCA -> source 2 (app/c.ts), line 3   (+1 source, +1 line)
    const map = { ...MAP, names: [], mappings: 'AAAA;ACEA;ACCA' };

    // The vendor line empties out; the third line is re-encoded fresh against
    // the compacted list — column 0 'A', source +1 'C', line +3 'G', col 0 'A'.
    expect(filterSourcemapSources(map, isApp)?.mappings).toBe('AAAA;;ACGA');
  });

  it('remaps the ignore lists onto the surviving source indices', () => {
    // Both spellings are index arrays into `sources`. Left alone they would
    // still name index 1 — now app/c.ts — and a debugger hides the frames of
    // an ignored source, which is exactly the file the trace has to name.
    const map = { ...MAP, ignoreList: [1, 2], x_google_ignoreList: [1] };
    const filtered = filterSourcemapSources(map, isApp);

    expect(filtered?.ignoreList).toEqual([1]);
    expect(filtered?.x_google_ignoreList).toEqual([]);
  });

  it('returns null when the map holds no accepted source', () => {
    expect(filterSourcemapSources(MAP, (s) => s.includes('/nowhere/'))).toBe(
      null
    );
  });
});
