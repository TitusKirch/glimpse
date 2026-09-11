import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Driven through `node` rather than by importing the module, because the
// interface CI uses IS the command line — and running the TypeScript file with
// no loader is also the only thing that can prove it stayed within Node's
// erasable-syntax subset. An `enum` or a parameter property would type-check
// perfectly and fail here, which is where it should fail.
const SCRIPT = fileURLToPath(
  new URL('./check-bundle-globals.ts', import.meta.url)
);

let bundleDir: string;

beforeEach(() => {
  bundleDir = mkdtempSync(join(tmpdir(), 'glimpse-bundle-'));
});

afterEach(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

function chunk(name: string, code: string) {
  writeFileSync(join(bundleDir, name), code, 'utf8');
}

function scan(dir = bundleDir) {
  const result = spawnSync(process.execPath, [SCRIPT, dir], {
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

describe('check-bundle-globals', () => {
  it('passes a chunk that imports the Vue API it calls', () => {
    chunk('entry.js', `import{r as ref}from"./vue.js";const a=ref(1);\n`);

    const result = scan();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no free Vue-API references');
  });

  it('reports a free call and names the chunk and identifier', () => {
    chunk('entry.js', `const a=ref(1);\n`);

    const result = scan();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('entry.js');
    expect(result.stderr).toContain('ref()');
  });

  it('does not read a Vue API name out of a string literal', () => {
    // The app's own translations carry "ref(...)" prose; masking is what keeps
    // that out of the report.
    chunk('entry.js', `const a="branch or ref(optional)";\n`);

    const result = scan();

    expect(result.status).toBe(0);
  });

  it('fails rather than passing when there is no bundle to scan', () => {
    const result = scan(join(bundleDir, 'missing'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('build it first');
  });

  it('fails rather than passing when the bundle holds no JavaScript', () => {
    writeFileSync(join(bundleDir, 'index.html'), '<!doctype html>', 'utf8');

    const result = scan();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to');
  });
});
