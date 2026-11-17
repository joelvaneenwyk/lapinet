---
mode: agent
description: "Run release validation and regenerate the SHA256SUMS manifest"
---

Prepare the Lapinet working tree for a release snapshot.

1. Run `npm test` and record pass/fail counts.
2. Run `npm run check`. On Windows, use `npm run check --script-shell="C:\Program Files\Git\bin\bash.exe"`.
3. If `deno` and a GPU adapter are available, run the WebGPU validators listed in `AGENTS.md`. Otherwise, list them as **not run**.
4. Check that `src/version.js` `LAPINET_BUILD_VERSION` matches both `?v=` tokens in `index.html`.
5. Regenerate the manifest of every tracked file except itself. Run this in a POSIX shell (Git Bash on Windows):
   ```sh
   git ls-files | grep -vx SHA256SUMS | LC_ALL=C sort | xargs sha256sum > SHA256SUMS
   sha256sum -c SHA256SUMS
   ```
   New files must be `git add`-ed first so `git ls-files` includes them.
6. Propose (do not silently apply) an update to `docs/RELEASE_VALIDATION.md` with today's date and only the results actually observed.
7. Summarize: tests, check, GPU validators (run / not run / inconclusive), manifest status, and anything that blocks the release.
