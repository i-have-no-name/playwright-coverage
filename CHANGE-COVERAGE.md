# Change coverage for Playwright tests

Notes from the design discussion, plus how to run the tool as it stands today.
Written 2026-11-15. Numbers come from runs on 2026-11-14 on this demo app.

## 1. Goal

Find the use cases a pull request changed that no Playwright test exercises.

Two questions the report answers:

- **Lines:** which changed lines did a test execute, and which tests?
- **Flows:** for every place that dispatches an action which becomes a socket command, did a test drive it all the way to the socket?

A flow is `component → handler → action → command → socket`, for example
`Footer › handleQuickReply → sendMessage → message.send → WebSocket`.

## 2. How to run

### First time

```sh
npm install
npx playwright install chromium
```

### Normal run: tests, then report

```sh
npm run test:e2e
open coverage-report/index.html
```

What that one command does, in order:

1. Starts the socket server (`server.mjs`, port 8787). An already running one is reused.
2. Builds the instrumented bundle into `dist-coverage` (`COVERAGE=true rspack build`) and serves it on port 5273.
3. Runs the Playwright tests. After each test the fixture saves that test's coverage and socket frames into `coverage-raw/`.
4. When the run ends, the reporter writes `coverage-report/index.html` and `coverage-report/summary.md`.

The diff is taken against `main` by default.

### Only uncommitted changes

```sh
npm run test:e2e:uncommitted
```

Same flow, but the diff is your working tree against `HEAD` (what `git status` shows, including untracked source files).

### Rebuild the report without running tests

```sh
npm run report                      # against main
DIFF_BASE=HEAD npm run report       # uncommitted only
DIFF_BASE=origin/release npm run report
```

This reuses whatever is in `coverage-raw/`. Use it to look at the same test run against a different base.

### Sharded run

```sh
npx playwright test --shard=1/3
npx playwright test --shard=2/3
npx playwright test --shard=3/3
npm run report
```

In a shard the reporter only collects. Shard 1 clears `coverage-raw/`, later shards add to it, and `npm run report` merges.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Socket server plus the Rspack dev server, no instrumentation |
| `npm run build` | Plain production bundle into `dist`, no coverage code |
| `npm run check:scan` | Asserts the static scan still finds the slice, saga, hook and bound-creator flows |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build-report` | Uncommitted run, then rebuilds the report. The second half repeats what the test run already did |

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `DIFF_BASE` | `main` | Git ref to diff against. `HEAD` means uncommitted changes only |
| `REPO_URL` | `origin` remote | GitHub repository URL (`https://github.com/<org>/<repo>`) for the GitHub button of source and test links |
| `COVERAGE` | unset | `true` makes `rspack build` instrument the code and write to `dist-coverage` |

Clicking a source or test link opens a toolbar: GitHub (`<REPO_URL>/blob/<HEAD sha>/<path>#L<line>`), VS Code, Cursor, Copy path (`path:line`). Without a remote or `REPO_URL` the GitHub button is disabled.

App-specific paths are constants at the top of `scripts/report.mjs`: the source folder, the commands file, the name of the mapping function, and the socket file.

## 3. What the report shows

Four tiles at the top: tests passed, changed lines executed, changed flows reaching the socket, all flows reaching the socket.

**Scan notes** appear under the tiles when the flow scan may be incomplete (see section 4).

Three tabs:

| Tab | Content |
|---|---|
| Diff coverage | The changed hunks per file. Each added line is marked ✓ covered, ◐ partly covered or ✕ not covered, and lines that no test fully runs are highlighted. Deleted lines are hidden; "Show as diff" brings them back with git colours. Click a line to see the tests, with links to `tests/file.spec.ts:line` |
| Diff flow coverage | Only the flows touched by the diff, with the reason each one is included |
| Flow coverage | Every flow in the app, changed or not |

Both flow tabs have a graph and a table.

- Click a node or an edge to select it. The rest of the graph is recoloured to count only the selected flows, and everything else is dimmed.
- The `+` on a node opens a popup with its source location, flows and tests.
- Source links are blue, test links are purple.

Flow status:

| Status | Meaning |
|---|---|
| ✓ Covered | At least one test drives the flow to the socket |
| ◐ Partly covered | A test reaches the handler, but no test gets the command onto the socket |
| ✕ Not covered | No test reaches the handler |

A flow shows up in the Diff flow tab for the first matching reason: call site changed, handler changed, command mapping changed, file changed.

## 4. How it works

### Collecting, per test

- The bundle is instrumented at build time by `swc-plugin-coverage-instrument` inside `builtin:swc-loader`. Counters are in original source lines, so no remapping is needed.
- The fixture in `tests/fixtures.ts` wraps `WebSocket.prototype.send` and records every sent frame with its stack trace.
- After the test, it reads the counters from the page and resolves each stack through the bundle's source map to source positions such as `src/components/Header.tsx:63`.
- Raw data on disk:
  - `coverage-raw/maps/<id>.json`: where each statement, function and branch is. Written once per source file.
  - `coverage-raw/<testId>.json`: the test's name and location, its non-zero counters, and its socket frames.

### Line status

For a changed line, in this order:

1. Statements and branch arms that start on the line: all hit is ✓, some hit is ◐, none is ✕.
2. Otherwise a function that starts on the line (so an inline handler nobody clicked is ✕).
3. Otherwise the innermost statement around the line, then the enclosing function.

Blank lines, comments, brackets, imports and type declarations are neutral.

### The diff

`git merge-base <DIFF_BASE> HEAD`, then `git diff` from that commit to the working tree for the source folder. Untracked source files are added as fully new. There is no GitHub involved.

### The flow scan

The scan uses the TypeScript type checker to follow names across files.

- **Action creators:** `createAction(...)` and every reducer in `createSlice({ reducers })`.
- **Commands:** `if (<creator>.match(action)) { return { topic: '...' } }` branches inside `actionToCommand`.
- **Call sites:** every call that resolves to a creator with a command. This follows renamed imports, `slice.actions.x`, destructured exports and `bindActionCreators`. A hand-built action such as `{ type: 'leaveRoom' }` or `{ type: creator.type }` also counts.
- **Ways into a handler**, one flow each:
  - right where it is defined
  - from a child component that received it as a callback prop and calls it
  - from another function that calls it (a thunk, a function returned by a hook, a helper)

### Flow stages

| Stage | Reached when a test |
|---|---|
| component | executes the outermost function around the call site |
| handler | executes the handler, and for a triggered flow also the triggering call |
| action | executes the call-site statement |
| command | executes the `return` of the mapping branch |
| socket | sends a frame with that topic whose stack passes through the call site's function, and through the trigger if there is one |

A frame with no call site of its action on the stack (a saga `put`, a timer) counts for every call site of that action the test executed.

### Scan notes

These make blind spots visible. They are raised for:

- a branch or `switch` in `actionToCommand` the scan cannot read
- an action with a command but no call site found
- an action creator passed around as a value
- a socket frame sent in a test from outside every known call site
- a socket topic with no readable mapping
- socket frames with no source positions at all (source maps missing)

## 5. CI

Nothing here has been run on GitHub; there is no GitHub repository yet.

### Is it worth running in CI?

Yes, as a report first and not as a gate. It answers "what did this PR change that no test touches", which a line-percentage tool does not. Add a failing threshold only once false positives are near zero. The report has no exit code today.

### Shards

```yaml
# each shard job
- run: npx playwright test --shard=${{ matrix.shard }}/4
- uses: actions/upload-artifact@v4
  with: { name: coverage-raw-${{ matrix.shard }}, path: coverage-raw }

# merge job (needs full git history and npm ci)
- uses: actions/download-artifact@v4
  with: { pattern: coverage-raw-*, path: coverage-raw, merge-multiple: true }
- run: DIFF_BASE=origin/main npm run report
```

The merge job needs the base branch in its git history, so a shallow clone will not do.

### Getting the report into the PR

A live, clickable page needs a host. GitHub never runs custom JavaScript inside its own pages.

With a host:

1. Upload `coverage-report/index.html` to `pr-<number>/index.html` on a static host (a bucket, GitHub Pages, GitLab Pages).
2. Set `REPO_URL` if the `origin` remote is not the GitHub repository.
3. Put the link and `summary.md` into the PR, either as a marked block in the description or as a sticky comment. A comment cannot overwrite a human edit made at the same moment.

The report contains source lines, so a public page for a private repository leaks code.

Without any external storage:

- Keep `index.html` as a workflow artifact. Readers download it and open it; it works offline.
- Write `summary.md` to the job summary and to a PR comment. It is plain markdown: tables and collapsible sections, no scripts.
- GitHub markdown renders Mermaid, so the flow graph could be added there as a static diagram.
- Warnings on uncovered lines in "Files changed" are possible, but GitHub caps how many annotations a step can show.

## 6. Measurements

### Time, median of 5 rounds

| Variant | Per test |
|---|---|
| Plain bundle, no collection | 439 ms |
| Instrumented bundle, no collection | 434 ms |
| Instrumented bundle with collection (the real setup) | 435 ms |

- Collection cost per test is inside the run-to-run noise.
- The instrumented build adds about 0.9 s once per run.
- The report step takes 1.0 s. About half is the type checker.

An earlier measurement on the Vite dev server gave the same picture: 454, 435 and 464 ms per test, and 0.55 s for the report before the type checker was added.

This app has about 16 source files. On a large app three costs will grow and are not measured here: reading counters out of the browser, the size of the bundle's source map, and the type-checker scan.

### Raw data size

| | Before | After |
|---|---|---|
| Per test | 47 KB | 2.4 KB |
| Maps | repeated in every test | 33 KB, once |

### State of the demo at the last run

16 tests pass. 33 flows: 19 covered, 4 partly covered, 10 not covered. No scan notes.

## 7. Questions that came up

**What does "test selection" mean?**
The same line → tests map that powers the report can be read the other way: given a diff, which tests touch those lines? Those are the tests worth running first, or the only ones to run for a quick check. Not built.

**How would mutation testing help, and does it mean running tests twice?**
"Covered" only means a line ran. Mutation testing changes a covered line on purpose (flip a condition, drop a call) and checks that some test fails. If none does, the line is executed but not asserted. It does mean extra runs: one normal run to learn which tests cover each changed line, then one short run per mutant using only those tests. The recommendation was a small own mutator limited to changed lines; no existing Playwright runner for Stryker was known. Not built.

**Does flow coverage work on the diff or on everything?**
Both. "Flow coverage" shows every flow; "Diff flow coverage" shows only the flows the diff touches.

**How is the diff calculated?**
See section 4: merge-base with `DIFF_BASE`, then the working tree against it, plus untracked files.

**Can the diff be limited to files in `git status`?**
Yes: `DIFF_BASE=HEAD`, or `npm run test:e2e:uncommitted`.

**Why were `leaveRoom` and `room.leave` yellow for a path that is fully tested?**
A node's colour counted every flow through it, and other flows through those shared nodes were not covered. Now, when you select a path, the graph is recoloured for the selected flows only. Selecting a root can still show yellow, because some of its flows are not covered.

**Why does the Diff flow tab show flows from files I did not touch?**
A flow is included when its call site, its handler, its command mapping or its file changed. A change to one branch of `actionToCommand` therefore pulls in every flow of that action, wherever it is dispatched.

**A child component with two buttons calls the same callback prop. Why was it one flow?**
It was merged. Now every place in the child that calls the prop is its own flow.

**Was a custom UI design used for the report?**
No. The report has its own neutral light and dark styling. Applying a design system was raised and left undecided.

**What is "shrink raw coverage"?**
Each test used to save the full coverage object, of which about 78% was location data identical in every test. Now that part is stored once.

**What is the "deleted lines" idea?**
A deleted line is not in the running app, so it gets no status, and a deleted handler just disappears from the flow list. Two ways to close the gap: scan the base commit as well and list removed flows (cheap), and reuse coverage from the base branch to show which tests used to run each deleted line (needs the base branch's coverage, so it fits CI). Not built.

## 8. Limits

- Covered means executed, not asserted.
- Following a callback prop or a wrapper is one level deep. A prop forwarded again, or a wrapper called by another wrapper, stays one flow.
- The mapping reader only understands `if (<creator>.match(action))` with a literal topic. A `switch` or a lookup table gets a scan note, not flows.
- Two asynchronous call sites of one action executed in the same test cannot be told apart.
- A creator or handler passed through a function parameter, an array or a computed key is not followed. It gets a scan note where that can be detected.
- One handler placed on two plain elements is still one flow.
- A full page reload in the middle of a test loses the counters collected before it.
- A failed test still counts as covering what it ran.
- Tests run against the instrumented bundle, not the production one.
- Stack positions are read from Rspack/webpack style source names. Another bundler needs its own rule in `tests/fixtures.ts`.
- An instrumenter that reports positions in transformed code is rejected with an error.
- No document confirms that `swc-plugin-coverage-instrument` 0.0.33 is compatible with Rspack 2.3.2. It works here; pin both versions.
- It was never confirmed which Redux patterns the real application uses. Sagas, slices and wrapped dispatch are all supported as a default.

## 9. Ideas not built

1. Mutation check on changed lines ("covered but not asserted").
2. Do not count failed tests as coverage.
3. Removed flows and deleted lines, using the base commit.
4. Test selection from the line → tests map.
5. A CI gate with an exit code, and a trend over time.
6. A switch in the Diff flow tab to hide flows that are included only because the command mapping changed.
7. A script that replaces a marked block in a PR description with the link and summary.
8. A dispatch id passed along with each action, to tell asynchronous call sites apart.

## 10. Where things are

| Path | Role |
|---|---|
| `rspack.config.mjs` | Build config; instruments when `COVERAGE=true` |
| `playwright.config.ts` | Starts the socket server and the instrumented bundle, registers the reporter |
| `tests/fixtures.ts` | Per-test collection of counters and socket frames |
| `scripts/report.mjs` | Loader, diff, static scan, flow stages, report and summary output, Playwright reporter |
| `scripts/report-template.html` | The report page; data is embedded as JSON |
| `scripts/scan.check.mjs` | Self-check for the static scan |
| `server.mjs` | Demo socket server that acknowledges every command |
| `src/` | Demo app. The reactions feature (slice, saga, hook, bound creators) exists to prove those patterns |
| `coverage-raw/` | Raw data of the last run (ignored by git) |
| `coverage-report/` | `index.html` and `summary.md` (ignored by git) |

## 11. History

Committed on `feature/quick-reply`:

- `82b974b` Rooms app with the first change-coverage report
- `3f3188f` feature changes used as the demo diff
- `7a32b8f` branch coverage per line, node status by end-to-end flows
- `a398661` SubHeader that triggers a refresh through a callback prop
- `eb12f5d` Diff flow tab, linked test and source locations

Not committed yet:

- uncommitted-only mode, selection recolouring, node popup, callback-prop flow splitting, link colours, layout-shift fix
- the move from Vite to Rspack with a build-time instrumented bundle
- compact raw coverage and shard support
- the type-checker based scan, scan notes and the reactions demo feature
