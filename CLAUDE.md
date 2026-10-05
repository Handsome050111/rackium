# Rackium — working rules

## Definition of done
Before reporting any step as complete:
1. Run lint, build, all unit tests, API tests and the full Playwright suite; all must pass.
2. Check the changed screens in a real browser at 1440/1024/768/390 with no console errors.
3. Look for bugs in the changed areas AND regressions in existing areas; fix them before reporting.
4. Every bug fixed gets a test that would have caught it.
5. In the report, list: bugs found and fixed, anything found but not fixed (with reason), and test counts.

Never report a step as complete with failing or newly skipped tests.
