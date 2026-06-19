/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Global fail-on-unexpected-warnings mechanism.
 *
 * This file is registered in `setupFilesAfterEnv` (not `setupFiles`) because it uses
 * `beforeEach`/`afterEach`, which are only available after the test framework has been
 * loaded.
 *
 * Each test gets fresh spies on console.warn and console.error that suppress output
 * (keeping the test runner's "● Console" section clean). In afterEach, if our spy is
 * still in place (i.e. the test did not install its own spy to intentionally assert on
 * warnings) and it was called, the test fails with a message listing the unexpected
 * calls.
 *
 * Tests that intentionally verify warnings install their own spy via
 * `jest.spyOn(console, 'warn')`, which replaces our spy reference. The `console.warn
 * !== globalWarnSpy` check detects this and skips the failure, letting the test manage
 * its own assertions.
 *
 * The spies are always restored in afterEach, even when overridden, so the next test
 * starts from the original console methods.
 *
 * Override-detection rule: if you replace the global spy, you own the assertions —
 * tests that install their own spy take responsibility for asserting on the calls they
 * expect, since the global unexpected-warning check is skipped for them.
 */
let globalWarnSpy;
let globalErrorSpy;

beforeEach(() => {
  globalWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  globalErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // If the test replaced our spies with its own, it is intentionally managing
  // warnings — skip the unexpected-warning check.
  if (console.warn === globalWarnSpy && globalWarnSpy.mock.calls.length > 0) {
    const calls = globalWarnSpy.mock.calls
      .map(args => args.map(a => String(a)).join(' '))
      .join('\n  - ');
    throw new Error(`Test produced unexpected console.warn calls:\n  - ${calls}`);
  }
  if (console.error === globalErrorSpy && globalErrorSpy.mock.calls.length > 0) {
    const calls = globalErrorSpy.mock.calls
      .map(args => args.map(a => String(a)).join(' '))
      .join('\n  - ');
    throw new Error(`Test produced unexpected console.error calls:\n  - ${calls}`);
  }

  // Always restore so the next test starts fresh. mockRestore works even if
  // the spy was already restored by the test (it is a no-op in that case).
  if (globalWarnSpy) globalWarnSpy.mockRestore();
  if (globalErrorSpy) globalErrorSpy.mockRestore();
});
