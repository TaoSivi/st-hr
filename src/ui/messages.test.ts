import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [join(dir, d.name)] : []));

describe('blocking messages are strings, not lists', () => {
  // `...someBlock(...)` would spread a string into single letters ("ແ · ພ · ັ · ກ"): wrap it in asList() first. Found by hand once; this keeps it found.
  it('no *Block(...) result is spread directly', () => {
    const bad = files(join(__dirname, '..')).filter(f => /\.\.\.\(?\s*\w*Block\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
