import TurndownService from 'turndown';
import { decodeHTML } from 'entities';

/**
 * The exact decryption-error placeholder string that memoires stores when an encrypted
 * note cannot be recovered. Any entry whose `note` matches this string exactly is
 * treated as a placeholder.
 */
export const DECRYPTION_ERROR_STRING =
  'Oops! Error occurred during decryption. Please, read first the ' +
  'Troubleshooting Guide at http://goo.gl/Swx7f or ' +
  'http://sites.google.com/site/drodiary/documentation/troubleshooting-' +
  'decryption-error or contact support via drosoft.support@googlemail.com ' +
  'and DO NOT change password anymore!';

/** Turndown instance configured for plain-text-friendly markdown. */
const turndown = new TurndownService({ headingStyle: 'atx' });

/**
 * Unwrap nested anchor tags that appear in some memoires entries.
 *
 * A row-by-row audit of the source database revealed occasional malformed HTML where an
 * outer `<a>` wraps an inner `<a>` with identical (or similar) attributes, e.g.: `<a
 * href="tel:0830"><a href="tel:0830">0830</a></a>`. Turndown converts this to an empty
 * link followed by a nested link, which is unreadable.
 *
 * The fix is to strip the useless outer anchor, keeping only the inner one. The loop
 * handles arbitrarily deep nesting (though the source data only shows one level).
 *
 * @param html - Raw HTML string, possibly containing nested anchors.
 *
 * @returns HTML with nested anchors collapsed to the innermost anchor.
 */
function unwrapNestedAnchors(html: string): string {
  let prev: string;
  do {
    prev = html;
    html = html.replace(/<a\b[^>]*>\s*(<a\b[^>]*>[\s\S]*?<\/a>)\s*<\/a>/gi, '$1');
  } while (html !== prev);
  return html;
}

/**
 * Convert a memoires `note` (which is either HTML or plain text) into markdown.
 *
 * The conversion pipeline is:
 *
 * 1. Nested anchor tags are normalised so turndown does not produce broken markdown.
 * 2. `turndown` converts HTML tags to markdown syntax.
 * 3. `entities.decode` resolves any remaining numeric or named HTML entities (e.g.
 *    `&#163;` → `£`, `&amp;` → `&`).
 *
 * We run turndown _before_ entity decoding because Turndown may escape ampersands that
 * are part of markdown syntax; decoding afterwards cleans up the remnants without
 * breaking the markdown structure.
 *
 * @param note - The raw note string from the memoires DB. May be NULL in pathological
 *   cases, although the schema says `NOT NULL`.
 *
 * @returns The cleaned markdown string, or empty string for NULL input.
 */
export function convertNoteToMarkdown(note: string | null): string {
  if (note === null) {
    return '';
  }

  const cleanedHtml = unwrapNestedAnchors(note);
  const markdown = turndown.turndown(cleanedHtml);
  return decodeHTML(markdown);
}

/**
 * Build the final `content` field for a journal entry.
 *
 * Rules:
 *
 * - If the note is the decryption-error placeholder, emit a fixed markdown explanation
 *   that includes the original date.
 * - Otherwise, return only the converted note. The memoires `header` column is ignored
 *   because it was a list-preview fragment auto-generated from the note, never a
 *   genuine separate title. Prepending it produced duplicated text in 99 % of entries.
 *
 * @param note - The memoires `note` column.
 * @param createdMs - The `created` timestamp in milliseconds, used only for the
 *   placeholder text.
 *
 * @returns The assembled content string.
 */
export function buildContent(note: string | null, createdMs: number): string {
  if (note === DECRYPTION_ERROR_STRING) {
    const isoDate = new Date(createdMs).toISOString();
    return (
      `# (Unrecoverable entry)\n\n` +
      `This entry could not be migrated from the source database because the ` +
      `original app stored an encrypted copy of it and the encryption key is ` +
      `no longer available. The entry was originally dated ${isoDate}.`
    );
  }

  return convertNoteToMarkdown(note);
}
