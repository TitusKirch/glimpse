// Narrows a source map down to a subset of its sources.
//
// Dropping a source is not just an edit to `sources`: every mapping segment
// carries an index into that array, and those indices — like the source line,
// column and name — are stored as deltas against the previous segment. So the
// `mappings` field has to be decoded, filtered and re-encoded alongside it, or
// the surviving mappings point at the wrong file.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((char, i) => [char, i]));

export interface RawSourceMap {
  version: number;
  file?: string;
  names?: string[];
  sources: (string | null)[];
  sourcesContent?: (string | null)[];
  mappings: string;
  [key: string]: unknown;
}

/**
 * Returns a copy of `map` holding only the sources `keep` accepts, or `null`
 * when it accepts none.
 */
export function filterSourcemapSources(
  map: RawSourceMap,
  keep: (source: string) => boolean
): RawSourceMap | null {
  // Old source index -> new one, for every source that survives.
  const moved = new Map<number, number>();
  const kept: number[] = [];
  map.sources.forEach((source, index) => {
    if (source === null || !keep(source)) return;
    moved.set(index, kept.length);
    kept.push(index);
  });
  if (kept.length === 0) return null;

  const content = map.sourcesContent;
  return {
    ...map,
    ...remapIgnoreLists(map, moved),
    sources: kept.map((i) => map.sources[i] ?? null),
    ...(content ? { sourcesContent: kept.map((i) => content[i] ?? null) } : {}),
    mappings: rewriteMappings(map.mappings, moved)
  };
}

// `ignoreList` (and the older `x_google_ignoreList`) index into `sources`, so a
// stale entry marks a surviving file as third-party — and a debugger hides the
// frames of an ignored source, which is the opposite of what shipping these
// maps is for.
function remapIgnoreLists(
  map: RawSourceMap,
  moved: Map<number, number>
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const key of ['ignoreList', 'x_google_ignoreList']) {
    const list = map[key];
    if (!Array.isArray(list)) continue;
    out[key] = list
      .map((index) => moved.get(index as number))
      .filter((index): index is number => index !== undefined);
  }
  return out;
}

// Rewrites the delta-encoded mappings so they address `moved`'s new source
// indices. A segment whose source did not survive is replaced by a one-field
// segment — "generated column reached, nothing maps here" — but only where a
// mapped segment precedes it on the line, so the mapping above it stops at the
// dropped code instead of appearing to cover it.
function rewriteMappings(mappings: string, moved: Map<number, number>): string {
  // Source index, line, column and name index run across the whole map; only
  // the generated column restarts on each line.
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;
  let outSource = 0;
  let outLine = 0;
  let outColumn = 0;
  let outName = 0;

  return mappings
    .split(';')
    .map((generatedLine) => {
      if (generatedLine === '') return '';
      let generated = 0;
      let outGenerated = 0;
      let mappedRun = false;
      const segments: string[] = [];

      for (const raw of generatedLine.split(',')) {
        if (raw === '') continue;
        const fields = decodeVlq(raw);
        generated += fields[0] ?? 0;

        // Already an unmapped marker: keep it, it terminates the run above.
        if (fields.length < 4) {
          segments.push(encodeVlq(generated - outGenerated));
          outGenerated = generated;
          mappedRun = false;
          continue;
        }

        source += fields[1] ?? 0;
        line += fields[2] ?? 0;
        column += fields[3] ?? 0;
        if (fields.length > 4) name += fields[4] ?? 0;

        const target = moved.get(source);
        if (target === undefined) {
          if (mappedRun) {
            segments.push(encodeVlq(generated - outGenerated));
            outGenerated = generated;
            mappedRun = false;
          }
          continue;
        }

        let segment =
          encodeVlq(generated - outGenerated) +
          encodeVlq(target - outSource) +
          encodeVlq(line - outLine) +
          encodeVlq(column - outColumn);
        outGenerated = generated;
        outSource = target;
        outLine = line;
        outColumn = column;
        if (fields.length > 4) {
          segment += encodeVlq(name - outName);
          outName = name;
        }
        segments.push(segment);
        mappedRun = true;
      }

      return segments.join(',');
    })
    .join(';');
}

function decodeVlq(segment: string): number[] {
  const fields: number[] = [];
  let accumulator = 0;
  let shift = 1;
  for (const char of segment) {
    const digit = B64_INDEX.get(char);
    if (digit === undefined) {
      throw new Error(`invalid base64-VLQ digit ${JSON.stringify(char)}`);
    }
    accumulator += (digit & 31) * shift;
    if (digit & 32) {
      shift *= 32;
      continue;
    }
    const magnitude = Math.floor(accumulator / 2);
    fields.push(accumulator % 2 === 1 ? -magnitude : magnitude);
    accumulator = 0;
    shift = 1;
  }
  return fields;
}

function encodeVlq(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = rest % 32;
    rest = Math.floor(rest / 32);
    if (rest > 0) digit += 32;
    out += B64[digit];
  } while (rest > 0);
  return out;
}
