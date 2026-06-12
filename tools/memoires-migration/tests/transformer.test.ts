import { transformAll } from '../src/transformer.js';
import { MemoRow, SourceTagRow } from '../src/types.js';
import { DECRYPTION_ERROR_STRING } from '../src/html-converter.js';

describe('transformAll', () => {
  const baseMemo: MemoRow = {
    _id: 1,
    header: null,
    note: 'Plain text entry',
    created: 1204909459000,
    modified: 1204909459000,
    tags: null,
    locality: null,
    address: null,
  };

  const tags: SourceTagRow[] = [
    { _id: 1, name: 'Diary' },
    { _id: 2, name: 'Blessings' },
  ];

  it('transforms a normal entry', () => {
    const { entries } = transformAll([baseMemo], tags, new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('Plain text entry');
    expect(entries[0].datetime).toBe(new Date(baseMemo.created).toISOString());
    expect(entries[0].modified_at).toBe(new Date(baseMemo.modified!).toISOString());
    expect(entries[0].location_address).toBeNull();
    expect(entries[0].location_latitude).toBeNull();
  });

  it('transforms an entry with a header but does not prepend it', () => {
    const memo: MemoRow = { ...baseMemo, header: 'My Title' };
    const { entries } = transformAll([memo], tags, new Map());
    expect(entries[0].content).toBe('Plain text entry');
    expect(entries[0].content).not.toContain('#');
  });

  it('transforms an entry with an HTML header but does not prepend it', () => {
    const memo: MemoRow = {
      ...baseMemo,
      header: '<p dir=ltr>Evening Struggled to get up...</p>',
    };
    const { entries } = transformAll([memo], tags, new Map());
    expect(entries[0].content).toBe('Plain text entry');
    expect(entries[0].content).not.toContain('#');
  });

  it('transforms an entry without a header', () => {
    const memo: MemoRow = { ...baseMemo, header: null };
    const { entries } = transformAll([memo], tags, new Map());
    expect(entries[0].content).toBe('Plain text entry');
  });

  it('transforms the decryption-error placeholder entry', () => {
    const memo: MemoRow = {
      ...baseMemo,
      _id: 244,
      note: DECRYPTION_ERROR_STRING,
      header: 'Corrupted',
    };
    const { entries } = transformAll([memo], tags, new Map());
    expect(entries[0].content).toContain('Unrecoverable entry');
    expect(entries[0].content).toContain(new Date(baseMemo.created).toISOString());
    expect(entries[0].content).not.toContain('Corrupted');
  });

  it('falls back modified_at to created when modified equals bulk sentinel', () => {
    const sentinel = 1377990519249;
    const memo: MemoRow = {
      ...baseMemo,
      modified: sentinel,
    };
    const secondMemo: MemoRow = {
      ...baseMemo,
      _id: 2,
      modified: sentinel,
    };
    const thirdMemo: MemoRow = {
      ...baseMemo,
      _id: 3,
      modified: 999,
    };
    // 2 out of 3 share the sentinel (66%), so it IS a sentinel.
    const { entries } = transformAll([memo, secondMemo, thirdMemo], tags, new Map());

    // Order is preserved: memo (1), secondMemo (2), thirdMemo (3)
    expect(entries[0].modified_at).toBe(entries[0].created_at);
    expect(entries[1].modified_at).toBe(entries[1].created_at);
    expect(entries[2].modified_at).toBe(new Date(999).toISOString());
  });

  it('does not treat a common value as sentinel when it is not majority', () => {
    const memo1: MemoRow = { ...baseMemo, _id: 1, modified: 100 };
    const memo2: MemoRow = { ...baseMemo, _id: 2, modified: 100 };
    const memo3: MemoRow = { ...baseMemo, _id: 3, modified: 200 };
    // 2 out of 4 share 100, but 50% is not > 50%.
    const memo4: MemoRow = { ...baseMemo, _id: 4, modified: 300 };
    const { entries } = transformAll([memo1, memo2, memo3, memo4], tags, new Map());

    expect(entries[0].modified_at).toBe(new Date(100).toISOString());
  });

  it('handles NULL modified by falling back to created', () => {
    const memo: MemoRow = { ...baseMemo, modified: null };
    const { entries } = transformAll([memo], tags, new Map());
    expect(entries[0].modified_at).toBe(entries[0].created_at);
  });

  it('creates entry-tag junctions for tagged entries', () => {
    const memo: MemoRow = { ...baseMemo, tags: 'Diary' };
    const result = transformAll([memo], tags, new Map());
    expect(result.entryTags).toHaveLength(1);
    expect(result.entryTags[0].entry_id).toBe(result.entries[0].id);
    expect(result.entryTags[0].tag_id).toBeTruthy();
  });

  it('skips entry-tag junction for empty tag', () => {
    const memo: MemoRow = { ...baseMemo, tags: '   ' };
    const { entryTags } = transformAll([memo], tags, new Map());
    expect(entryTags).toHaveLength(0);
  });

  it('skips entry-tag junction for unknown tag', () => {
    const memo: MemoRow = { ...baseMemo, tags: 'Unknown' };
    const { entryTags } = transformAll([memo], tags, new Map());
    expect(entryTags).toHaveLength(0);
  });

  it('sets tag created_at to earliest memo created timestamp', () => {
    const earliest = new Map<string, number>([['Diary', 1204909459000]]);
    const { tags: transformed } = transformAll([baseMemo], tags, earliest);
    const diary = transformed.find(t => t.name === 'Diary');
    expect(diary!.created_at).toBe(new Date(1204909459000).toISOString());
  });

  it('falls back tag created_at to epoch when unused', () => {
    // Pass a Map that has other keys but not the queried tag, to make the
    // "key missing" case explicit.
    const tagMap = new Map([['OtherTag', 1234]]);
    const { tags: transformed } = transformAll([baseMemo], tags, tagMap);
    const blessings = transformed.find(t => t.name === 'Blessings');
    expect(blessings!.created_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('returns empty arrays when given empty memos', () => {
    const result = transformAll([], tags, new Map());
    expect(result.entries).toHaveLength(0);
    expect(result.tags).toHaveLength(2);
    expect(result.entryTags).toHaveLength(0);
  });
});
