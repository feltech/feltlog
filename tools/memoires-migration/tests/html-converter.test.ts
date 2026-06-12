import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  convertNoteToMarkdown,
  buildContent,
  DECRYPTION_ERROR_STRING,
} from '../src/html-converter.js';

describe('convertNoteToMarkdown', () => {
  it('returns empty string for NULL', () => {
    expect(convertNoteToMarkdown(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(convertNoteToMarkdown('')).toBe('');
  });

  it('passes plain text through unchanged', () => {
    const input = readFileSync(
      resolve('tests/fixtures', 'sample-plaintext-input.txt'),
      'utf-8',
    ).trim();
    // Turndown normalises multiple consecutive spaces, so we compare against
    // the normalised form rather than the raw fixture.
    expect(convertNoteToMarkdown(input)).toBe(input.replace(/  +/g, ' '));
  });

  it('converts HTML tags to markdown', () => {
    const html = '<b>Bold</b> and <i>italic</i>';
    // Turndown defaults to underscores for italics.
    expect(convertNoteToMarkdown(html)).toBe('**Bold** and _italic_');
  });

  it('decodes HTML entities', () => {
    expect(convertNoteToMarkdown('&#163;100')).toBe('£100');
    expect(convertNoteToMarkdown('A &amp; B')).toBe('A & B');
    expect(convertNoteToMarkdown('&quot;quote&quot;')).toBe('"quote"');
  });

  it('preserves telephone links', () => {
    const html = '<a href="tel:+441234567890">Call us</a>';
    expect(convertNoteToMarkdown(html)).toBe('[Call us](tel:+441234567890)');
  });

  it('converts mixed HTML + entities', () => {
    const html = '<p>Price: &#163;50 &amp; tax</p>';
    expect(convertNoteToMarkdown(html)).toBe('Price: £50 & tax');
  });

  it('unwraps nested anchor tags', () => {
    // Real data from memo _id = 405 in the source database.
    const html = '<a href="tel:0830"><a href="tel:0830">0830</a></a> handyman woke me up';
    expect(convertNoteToMarkdown(html)).toBe('[0830](tel:0830) handyman woke me up');
  });

  it('unwraps deeply nested anchor tags', () => {
    const html = '<a href="tel:1"><a href="tel:2"><a href="tel:3">Call</a></a></a>';
    expect(convertNoteToMarkdown(html)).toBe('[Call](tel:3)');
  });

  it('does not break single-level anchors', () => {
    const html = '<a href="tel:1234">One</a> and <a href="tel:5678">Two</a>';
    expect(convertNoteToMarkdown(html)).toBe('[One](tel:1234) and [Two](tel:5678)');
  });
});

describe('buildContent', () => {
  it('builds content from note only', () => {
    const result = buildContent('Some note', 0);
    expect(result).toBe('Some note');
  });

  it('ignores header and uses only note', () => {
    const result = buildContent('My Header', 0);
    expect(result).toBe('My Header');
    expect(result).not.toContain('#');
  });

  it('produces placeholder for decryption-error note', () => {
    const createdMs = 1278178441000;
    const result = buildContent(DECRYPTION_ERROR_STRING, createdMs);
    expect(result).toContain('(Unrecoverable entry)');
    expect(result).toContain(new Date(createdMs).toISOString());
  });

  it('converts HTML note without prepending header', () => {
    const result = buildContent('<b>Bold</b> text', 0);
    expect(result).toBe('**Bold** text');
    expect(result).not.toContain('#');
  });

  it('does not duplicate first-line header in content', () => {
    // In memoires the header was a preview of the note's first line(s). It
    // must not be prepended as an H1.
    const note = 'Morning run was good.\nBut I got tired.';
    const result = buildContent(note, 0);
    // Turndown collapses plain-text newlines, so the result is a single
    // line; the key assertion is that no header is prepended.
    expect(result).not.toMatch(/^# /);
    expect(result).toContain('Morning run was good.');
    expect(result).toContain('But I got tired.');
  });

  it('does not duplicate multi-line header prefix in content', () => {
    const note = 'Line one.\nLine two.\nLine three.\nMore body.';
    const result = buildContent(note, 0);
    // With the header removed, the content is just the converted note
    // without any duplicated prefix or markdown heading.
    expect(result).not.toMatch(/^# /);
    expect(result).toContain('Line one.');
    expect(result).toContain('Line two.');
    expect(result).toContain('More body.');
  });
});
