/**
 * Regex matching SQLCipher errors that indicate the encryption key is wrong (or the
 * database is otherwise unreadable). These messages are misleading — SQLCipher returns
 * them when key derivation produces a valid-looking but wrong key. Map them to
 * user-friendly messages.
 */
export const SQLCIPHER_WRONG_KEY_ERROR_RE =
  /out of memory|file is not a database|database disk image is malformed/i;
