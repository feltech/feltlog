import { generateTagId, generateEntryId, NAMESPACE } from '../src/id-generator.js';
import { v5 as uuidv5 } from 'uuid';

describe('generateTagId', () => {
  it('is deterministic', () => {
    const id1 = generateTagId(1);
    const id2 = generateTagId(1);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces different IDs for different inputs', () => {
    expect(generateTagId(1)).not.toBe(generateTagId(2));
  });

  it('uses the correct namespace', () => {
    const expected = uuidv5('1', NAMESPACE.tag);
    expect(generateTagId(1)).toBe(expected);
  });
});

describe('generateEntryId', () => {
  it('is deterministic', () => {
    const id1 = generateEntryId(42);
    const id2 = generateEntryId(42);
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different inputs', () => {
    expect(generateEntryId(1)).not.toBe(generateEntryId(2));
  });

  it('uses the correct namespace', () => {
    const expected = uuidv5('42', NAMESPACE.entry);
    expect(generateEntryId(42)).toBe(expected);
  });
});

describe('NAMESPACE constants', () => {
  it('tag namespace is stable', () => {
    expect(NAMESPACE.tag).toBe(uuidv5('memoires-tag', uuidv5.DNS));
  });

  it('entry namespace is stable', () => {
    expect(NAMESPACE.entry).toBe(uuidv5('memoires-entry', uuidv5.DNS));
  });
});
