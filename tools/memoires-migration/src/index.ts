import { parseArgs } from 'node:util';
import { realpathSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { readSourceDatabase } from './db-reader.js';
import { transformAll } from './transformer.js';
import { writeDatabase } from './db-writer.js';

/**
 * CLI entry point for the memoires-to-FeltLog migration script.
 *
 * Reads an old Memoires SQLite database, transforms every memo and tag into the FeltLog
 * SQLite schema, and writes a ready-to-use database file to disk.
 *
 * Usage: npm run migrate -- [--source <path>] [--output <path>]
 */

const DEFAULT_SOURCE = '/home/dave/workspace/feltlog/memoires_backup/memories.db3';

/**
 * Derive the default output path from the source path.
 *
 * @param sourcePath - The source database path.
 *
 * @returns The output path with `.db3.migrated` or `.migrated` appended.
 */
function deriveDefaultOutput(sourcePath: string): string {
  if (sourcePath.toLowerCase().endsWith('.db3')) {
    return `${sourcePath.slice(0, -4)}.db3.migrated`;
  }
  return `${sourcePath}.migrated`;
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source: { type: 'string', default: DEFAULT_SOURCE },
    output: { type: 'string' },
  },
});

const sourcePath = values.source ?? DEFAULT_SOURCE;
const outputPath = values.output ?? deriveDefaultOutput(sourcePath);

// Resolve symlinks before comparing, so a symlink that points to the source is
// caught.  If the output file does not exist yet, resolve its parent directory.
const resolvedSource = realpathSync(sourcePath);
const resolvedOutput = existsSync(outputPath)
  ? realpathSync(outputPath)
  : join(realpathSync(dirname(outputPath)), basename(outputPath));

if (resolvedSource === resolvedOutput) {
  console.error('Error: output path must not be the same as the source path.');
  process.exit(1);
}

// Ensure the output parent directory exists before writing.
mkdirSync(dirname(outputPath), { recursive: true });

/* eslint-disable no-console */
console.error('Reading source DB...');

const { memos, tags, tagEarliestCreated } = readSourceDatabase(sourcePath);
console.error(`Parsed ${memos.length} entries`);
console.error(`Read ${tags.length} tag rows`);

const {
  entries,
  tags: transformedTags,
  entryTags,
} = transformAll(memos, tags, tagEarliestCreated);
console.error(`Generated ${transformedTags.length} tags`);
console.error(`Generated ${entries.length} entries`);
console.error(`Generated ${entryTags.length} entry-tag junctions`);

writeDatabase(outputPath, transformedTags, entries, entryTags);
console.error(`Wrote database to ${outputPath}`);

console.log(outputPath);
/* eslint-enable no-console */
