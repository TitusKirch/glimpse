import { describe, expect, it } from 'vitest';
import { appSourcemaps } from './appSourcemaps';

const ROOT_DIR = '/repo';
const APP_DIR = '/repo/app';
const VENDOR = '/repo/node_modules/.pnpm/dep@1.0.0/node_modules/dep/index.js';

// Nuxt builds the client into its own cache directory and Nitro copies the
// result to `.output/public`, so the directory the bundler reports is not the
// one a map's `sources` are written against. Passing it here keeps that apart.
const BUNDLER_DIR = '/repo/node_modules/.cache/nuxt/.nuxt/dist/client';

// What a map's `sources` look like: relative, and pointing back at the repo.
const VENDOR_SOURCE = '../../../node_modules/.pnpm/dep@1.0.0/dep/index.js';
const APP_SOURCE = '../../../app/components/commit/Graph.vue';

// The fixture entries carry a LITERAL `type`, not a widened `string`. The
// plugin takes a discriminated union, so a bundle typed as
// `Record<string, Record<string, unknown>>` was not assignable to it — and the
// same discriminant is what lets the assertions below read `code` off a chunk
// and `source` off an asset without a cast.
interface Chunk {
  type: 'chunk';
  fileName: string;
  moduleIds: string[];
  map: unknown;
  sourcemapFileName: string;
  code: string;
}

interface MapAsset {
  type: 'asset';
  fileName: string;
  source: string;
}

type Bundle = Record<string, Chunk | MapAsset>;

// Narrowing, not casting: an entry the plugin was supposed to leave as a chunk
// but turned into something else reads as `undefined` here and fails the
// assertion, rather than being asserted through.
function chunkAt(bundle: Bundle, name: string): Chunk | undefined {
  const entry = bundle[name];
  return entry?.type === 'chunk' ? entry : undefined;
}

function assetAt(bundle: Bundle, name: string): MapAsset | undefined {
  const entry = bundle[name];
  return entry?.type === 'asset' ? entry : undefined;
}

function chunk(fileName: string, moduleIds: string[]): Chunk {
  return {
    type: 'chunk',
    fileName,
    moduleIds,
    map: { version: 3 },
    sourcemapFileName: `${fileName}.map`,
    code: `console.log(1);\n//# sourceMappingURL=${fileName.split('/').pop()}.map`
  };
}

function mapAsset(fileName: string, sources: string[]): MapAsset {
  return {
    type: 'asset',
    fileName: `${fileName}.map`,
    source: JSON.stringify({
      version: 3,
      names: [],
      sources,
      sourcesContent: sources.map((s) => `/* ${s} */`),
      // One mapped segment per source, one per generated line.
      mappings: sources.map((_, i) => (i === 0 ? 'AAAA' : 'ACAA')).join(';')
    })
  };
}

function run(bundle: Bundle): Bundle {
  appSourcemaps({ rootDir: ROOT_DIR, appDir: APP_DIR }).generateBundle(
    { dir: BUNDLER_DIR },
    bundle
  );
  return bundle;
}

describe('appSourcemaps', () => {
  it('drops the map of a chunk built only from dependencies', () => {
    const bundle: Bundle = {
      '_nuxt/vendor.js': chunk('_nuxt/vendor.js', [VENDOR]),
      '_nuxt/vendor.js.map': mapAsset('_nuxt/vendor.js', [VENDOR_SOURCE])
    };

    run(bundle);

    expect(bundle['_nuxt/vendor.js.map']).toBeUndefined();
    expect(chunkAt(bundle, '_nuxt/vendor.js')?.code).toBe('console.log(1);\n');
    expect(chunkAt(bundle, '_nuxt/vendor.js')?.map).toBe(null);
  });

  it('reduces a mixed chunk to the app sources and keeps its map', () => {
    const bundle: Bundle = {
      '_nuxt/entry.js': chunk('_nuxt/entry.js', [
        VENDOR,
        '/repo/app/components/commit/Graph.vue'
      ]),
      '_nuxt/entry.js.map': mapAsset('_nuxt/entry.js', [
        VENDOR_SOURCE,
        APP_SOURCE
      ])
    };

    run(bundle);

    // The bundler serialises the map the chunk carries, so the asset alone is
    // not enough — both sides have to end up narrowed.
    expect(chunkAt(bundle, '_nuxt/entry.js')?.map).toMatchObject({
      sources: [APP_SOURCE],
      sourcesContent: [`/* ${APP_SOURCE} */`]
    });

    const map = JSON.parse(
      String(assetAt(bundle, '_nuxt/entry.js.map')?.source)
    );
    expect(map.sources).toEqual([APP_SOURCE]);
    expect(map.sourcesContent).toEqual([`/* ${APP_SOURCE} */`]);
    // Still advertised, or the webview never fetches the map at all.
    expect(chunkAt(bundle, '_nuxt/entry.js')?.code).toContain(
      '//# sourceMappingURL=entry.js.map'
    );
  });
});
