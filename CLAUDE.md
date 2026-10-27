# Rackium — working rules

## Core rule
Configuration over hardcoding — nothing client-specific in code; client-specific
values (roles, codes, vocabularies, field names, state labels like CMO/IMO/FMO)
are configuration data; store Rackium's canonical values and map at
import/export; external IDs we didn't create are stored and returned unchanged.

## Definition of done
Before reporting any step as complete:
1. Run lint, build, all unit tests, API tests and the full Playwright suite; all must pass.
2. Check the changed screens in a real browser at 1440/1024/768/390 with no console errors.
3. Look for bugs in the changed areas AND regressions in existing areas; fix them before reporting.
4. Every bug fixed gets a test that would have caught it.
5. In the report, list: bugs found and fixed, anything found but not fixed (with reason), and test counts.

Never report a step as complete with failing or newly skipped tests.

Never pipe a test, lint or build command through grep/head/tail (or anything
else) in a way that hides its exit code: keep the full output in a log file
and filter that, or use `set -o pipefail` / `${PIPESTATUS[0]}`. Always report
the command's real exit code.
