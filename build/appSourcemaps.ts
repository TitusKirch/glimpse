import path from 'node:path';
import { filterSourcemapSources } from './sourcemapFilter';

// Ships source maps for the app's own code and for nothing else.
//
// A release stack trace otherwise reads `ClNIOtIm.js:1:48213` — the chunk and
// no more. Full maps answer that but cost ~8 MB against a 2.4 MB bundle, and
// almost all of it is dependency source nobody debugs into. The build emits
// maps as usual; this plugin then reduces each one to the sources under `app/`
// and drops the ones left with nothing.

const SOURCE_MAPPING_URL = /\r?\n?\/\/# sourceMappingURL=\S*[\r\n]*$/;
const LEADING_RELATIVE = /^(?:\.\.?\/)+/;

export interface AppSourcemapsOptions {
  /** Absolute path of the project root a map's `sources` are written against. */
  rootDir: string;
  /** Absolute path of the directory holding the app's own source. */
  appDir: string;
}

interface OutputChunk {
  type: 'chunk';
  fileName: string;
  code: string;
  moduleIds?: string[];
  map?: unknown;
  sourcemapFileName?: string | null;
}

interface OutputAsset {
  type: 'asset';
  source: string | Uint8Array;
}

type OutputBundle = Record<string, Partial<OutputChunk & OutputAsset>>;

export function appSourcemaps({ rootDir, appDir }: AppSourcemapsOptions) {
  const root = trimSlash(toPosix(rootDir));
  const appRoot = `${trimSlash(toPosix(appDir))}/`;
  const isAppFile = (file: string) =>
    file.startsWith(appRoot) && !file.includes('/node_modules/');

  return {
    name: 'glimpse:app-sourcemaps',
    apply: 'build' as const,
    // After every plugin that could still emit or rewrite a map.
    enforce: 'post' as const,

    generateBundle(_options: unknown, bundle: OutputBundle) {
      // Walk the bundle once and hold on to the objects that walk hands out.
      // Rolldown's bundle is backed by Rust, and a fresh property read can
      // return a fresh JS object — writing through `bundle[name]` then goes
      // nowhere, while a `delete` on the same key still lands.
      const entries = Object.entries(bundle);
      const assets = new Map(
        entries.filter(([, output]) => output.type === 'asset')
      );

      for (const [fileName, output] of entries) {
        if (output.type !== 'chunk' || typeof output.code !== 'string')
          continue;

        const mapFileName = output.sourcemapFileName ?? `${fileName}.map`;
        const asset = assets.get(mapFileName);
        const kept =
          asset && typeof asset.source === 'string'
            ? keepAppSources(asset, output, root, isAppFile)
            : (output.moduleIds ?? []).some((id) => isAppFile(toPosix(id)));
        if (kept) continue;

        delete bundle[mapFileName];
        output.map = null;
        output.code = output.code.replace(SOURCE_MAPPING_URL, '\n');
      }
    }
  };
}

// Narrows one chunk's map to the app's own sources. Returns false when none
// are left, so the caller can drop the map entirely.
//
// The map is held twice — as the `.js.map` asset and on the chunk itself — and
// which of the two the bundler serialises is its own business, so both are
// replaced.
function keepAppSources(
  asset: Partial<OutputAsset>,
  chunk: Partial<OutputChunk>,
  root: string,
  isAppFile: (file: string) => boolean
): boolean {
  const filtered = filterSourcemapSources(
    JSON.parse(String(asset.source)),
    (source) => isAppFile(resolveAgainstRoot(source, root))
  );
  if (!filtered) return false;

  asset.source = JSON.stringify(filtered);
  chunk.map = filtered;
  return true;
}

// A map's `sources` are relative paths back to the project root — but not from
// the directory the bundler reports: Nuxt builds the client into a cache
// directory and Nitro copies the result into `.output/public`, so the two
// differ by several levels. What holds either way is that dropping the leading
// `../` run leaves a path relative to the project root.
function resolveAgainstRoot(source: string, root: string): string {
  return path.posix.join(root, toPosix(source).replace(LEADING_RELATIVE, ''));
}

function toPosix(file: string): string {
  return file.replaceAll('\\', '/');
}

function trimSlash(file: string): string {
  return file.replace(/\/+$/, '');
}
