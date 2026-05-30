// Compute the expected backup filename prefix based on the current UTC time.
// The backup file is named: feltlog-{dbName}-{timestamp}Z-v{version}.db
// where timestamp = YYYY-MM-DDTHH-MM-SS (ISO 8601 with hyphens instead of colons).
// The "Z" suffix means the timestamp is in UTC, so we must use UTC methods.
//
// We compute at minute-level precision and produce a regex that matches
// any seconds value within the current minute. This avoids flaky failures
// when the backup runs a few seconds after the prefix is computed.
//
// IMPORTANT: This script runs on the host (GraalJS), not the device.
// The e2e:sync-time script in package.json must sync the device clock to
// the host clock before running tests, otherwise clock skew can cause
// the regex to miss the actual backup file.

/* global output */

var now = new Date();

/**
 * Pads a number to two digits with a leading zero if needed.
 *
 * @param n - The number to pad.
 *
 * @returns The zero-padded string.
 */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

var year = now.getUTCFullYear();
var month = pad2(now.getUTCMonth() + 1);
var day = pad2(now.getUTCDate());
var hours = pad2(now.getUTCHours());
var minutes = pad2(now.getUTCMinutes());

// The app includes the dbName as-is in the backup filename, so we must not
// strip .db.
var dbName = output.dbName || '';

var prefix = dbName ? 'feltlog-' + dbName + '-' : 'feltlog-';
output.backupFilePrefix =
  prefix + year + '-' + month + '-' + day + 'T' + hours + '-' + minutes + '-';
output.backupFileRegex = output.backupFilePrefix + '.*';
