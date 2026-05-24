/**
 * Commitlint configuration — conventional commits with required body.
 *
 * Extends @commitlint/config-conventional for standard conventional commit format
 * (type(scope): subject), and requires every commit to include a body explaining the
 * "why" behind the change.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Every commit must include a body explaining the rationale.
    'body-empty': [2, 'never'],
  },
};
