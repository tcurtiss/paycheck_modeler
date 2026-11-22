# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single self-contained HTML file, `paycheck_calculator.html`, that models a full-year
biweekly paycheck (401(k) regular/catch-up/after-tax, employer match, NQDC, HSA, ESPP,
quarterly RSU vesting, NQDC payouts, a year-end bonus, and federal/FICA/state withholding) entirely
client-side. There is no server, no build step, and no package.json — it's meant to be
opened directly as a `file://` URL in a browser.

`Paycheck_Model_2026_Template.gsheet` is **not** the data source for development — it's
just a Google Drive shortcut pointer (JSON with a `doc_id`), not the spreadsheet content.
The calculator's formulas were originally reverse-engineered from that external Google
Sheet's actual cells (via the Drive API, downloading as `.xlsx`, and parsing with
`openpyxl`) and validated line-by-line against its computed values. That source
spreadsheet lives outside this repo; don't expect to find its data here.

## Development

There is no build, lint, or test command — none of that tooling exists in this repo.
To "run" the app, open `paycheck_calculator.html` in a browser.

Since there's no automated test suite, use this workflow when changing the calculation
engine (inside the `<script>` block) to avoid silently breaking a formula:

1. Extract the `<script>...</script>` contents and run `node --check` on it for a quick
   syntax sanity check.
2. The whole script is wrapped in a single IIFE, so nothing inside it (`computeAll`,
   `state`, etc.) is reachable from outside. To exercise it from Node, either stub
   `document`/`localStorage` and inject test/assertion code *inside* the closure (e.g.
   right before the final `document.addEventListener("DOMContentLoaded", init);`), or
   drive the real page with a headless browser.
3. For real browser/DOM behavior (not just the pure calculation functions), use
   `puppeteer-core` pointed at the system Chrome
   (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS) and listen
   for `pageerror`/`console` events — a Node-only stub harness will not catch real
   runtime errors (e.g. a `TypeError` from `init()` on a malformed saved state).
4. Cross-check key outputs against known-correct dollar amounts. A reliable known-good
   scenario: with the current (tax year 2027) defaults, the default inputs should
   produce Net Pay `$83,648.96`, Gross Pay `$270,000.00`, Employer Match `$6,225.00`,
   and a $2,750.00 after-tax 401(k) cut on the Bonus check (flat 22% bonus
   withholding). Switching `bonusWithholding` to `"Aggregate"` should give the same
   net pay with a $2,471.62 cut instead. Re-baseline these as part of a tax-year
   update (and only then). The engine was originally validated against the source
   spreadsheet's cached values using the 2026 defaults (Net Pay `$80,511.44`, Match
   `$6,125.00`), which used the aggregate bonus method and had no take-home floor:
   the spreadsheet let the Bonus check net −$2,471.62. To reproduce spreadsheet
   figures, use the aggregate method and a scenario where no check gets cut.
5. `validateInputs()` and `normalizeState()` are pure too and worth exercising the
   same way (blank dates, out-of-range percentages, and old or garbage saves).

## Architecture

Everything lives in `paycheck_calculator.html`: a `<style>` block (CSS custom properties
drive light/dark theming, redefined under both `@media (prefers-color-scheme: dark)` and
`:root[data-theme="dark"]`), the HTML markup (inputs form on the left, output panels on
the right), and one `<script>` wrapped in an IIFE, organized top-to-bottom as:

- **Defaults** — `TAX_YEAR`, `defaultInputs()` and `defaultTaxTables()`. Every IRS/SSA
  figure (brackets, standard deductions, HSA/401(k)/catch-up/§415(c) limits, payroll tax
  constants, supplemental rates, the Roth catch-up wage threshold) lives in
  `defaultTaxTables()`, never in the inputs; it carries a `taxYear`. Brackets store only
  `{ over, rate }`; base tax is derived. The in-code comment block above it spells out
  exactly what to update for a new tax year (including the easy-to-miss default dates in
  `defaultInputs()`) — read that comment before touching tax constants rather than
  duplicating its guidance here.
- **Calculation engine** — `computeAll(inputs, tax)` is a pure function (no DOM access)
  returning `{ rows, rsuRows, summary }`. Its inner `computeRow()` closure builds one
  paycheck at a time; its variable names (`C`, `D`, `E`, ... `AA`, `AB`, ... `AS`) are
  deliberately the literal column letters from the source spreadsheet's Paycheck Detail
  sheet, kept 1:1 so a value can be checked directly against a cell reference — there's a
  decoder comment immediately above `computeRow()` mapping every letter to its meaning.
  **Take-home floor:** a check's net pay (`AO`) is never negative. `buildRow()` computes
  a row given a set of `cuts`; `computeRow()` builds it uncut, and if `AO < 0` reduces
  deductions in `CUT_ORDER` (post-tax first, then pre-tax with taxes re-solved, then
  federal W/H as a last resort) until `AO` is $0. Cut rows carry `deductionCuts`, shown
  as a ⚠ in the detail table, in the chart tooltip, and as a summary line.
  Columns `AT` (state disability/leave tax), `AU` (health FSA) and `AV` (dependent-care
  FSA) were added after the spreadsheet; they have no source cell.
  **Elections by date:** `inputs.changes` holds dated election changes (raise, new %),
  restricted to the `CHANGEABLE` fields; `buildRow()` reads elections through
  `electionsAt(date)` (base inputs + changes up to that date), never `inputs.X` directly
  for those fields. `electionAt()` is the same lookup outside the engine.
  **Schedule:** every dated event in the year (26 or 27 biweekly paychecks — a 27-payday
  year adds a check, with salary ÷ 26 or ÷ 27 per `extraPayday` — each bonus, each
  RSU vest, each NQDC payout) is walked once in date order; on the same date the order
  is paycheck, bonus, RSU vest, payout. Running year-to-date totals live in `prev`,
  including `fica` (Social Security/Medicare wages from every source) and `supp`
  (supplemental wages, for the $1M threshold), so RSU and payroll FICA can't
  double-count. Bonuses are `computeRow()` rows (`kind: "bonus"`), payouts are
  `computePayoutRow()` rows (`isNqdcPayout`), and RSU vests go to `rsuRows`, not `rows`.
  So `rows` has a variable length: don't index it positionally (the accumulation chart
  is fed the non-payout rows only). `commit()` stamps each row with `milestones` (the
  YTD thresholds it crossed, see `MILESTONES`) and `limits` (which annual caps have been
  reached, used for the chart hatching). The summary also carries a tax-at-filing
  estimate (`est*`).
- **Maximize** — `planMaximize(inputs, tax, opts)` (pure) finds the elections that reach
  each annual cap: HSA, 401(k) (+ catch-up), after-tax 401(k) (§415(c) room), ESPP
  (offering-period caps and the IRS $25k limit), solved in that dependency order. It
  doesn't re-derive engine rules: it binary-searches each election over the plan's
  allowed steps (`plan401kStep`, `esppStep`, up to `plan401kMaxPct` / `esppMaxPct`),
  running `computeAll()` per candidate. "even" = smallest election that reaches the cap;
  "asap" = even first, then raise 401(k) → after-tax → ESPP as far as the plan max and
  take-home floor allow without leaving any other chosen item below its even result.
  The take-home guard is relative to that item at 0, so reductions caused by *other*
  elections don't block it (status `guardPre`). With `opts.from` (a payday), the new
  elections are written as dated `changes` instead of replacing the base inputs. HSA
  and FSAs are always spread evenly, in cents. The match uses year-to-date dollar tiers
  (the user's plan), so timing never changes the match.
  The dialog UI (`openMaximize()` / `refreshMaximizePreview()`) applies via
  `replaceState()`, so it's undoable.
- **Validation** — `validateInputs()` returns `{ errors, warnings }`, each with the id of
  the field to focus. Errors stop the calculation (results dim, previous ones stay);
  warnings don't. `computeAll()` assumes a validated, valid first pay date.
- **State** — a single mutable `state = { inputs, tax }` object. `normalizeState()` (used
  by `loadState()` and scenario import) merges a saved state onto fresh defaults rather
  than trusting it wholesale, runs the migrations for renamed/moved fields
  (`bonusAmount` → `bonuses`, IRS figures moved from inputs to tax, `catchupMustBeRoth`
  → `catchupRoth`, …), and resets anything of the wrong type to its default. This
  matters: a prior field rename that skipped this step once crashed `init()` for anyone
  with old saved state. Add a migration there whenever an input field is renamed or
  removed. `init()` also falls back to the defaults if loading or the first render
  throws. `updateToCurrentTaxYear()` backs the "saved settings are from an older year"
  prompt. Reset, Import and that update go through `replaceState()`, which keeps one
  Undo snapshot.
- **Binding** — `SCALAR_BINDINGS`/`TAX_SCALAR_BINDINGS` declaratively map input element
  IDs to `state` keys (including dotted/array paths via `getVal`/`setVal`), wired up by
  `populateScalarBindings()`. It assigns `el.oninput = fn` (not `addEventListener`) so
  that re-calling it — e.g. on "Reset to example" — replaces the handler instead of
  stacking a duplicate. Dollar fields are text inputs with thousands separators
  (`makeMoneyInput()`, `parseMoney()`/`formatMoney()`); "number" bindings are dollars
  unless listed in `NOT_MONEY`.
- **Dynamic tables** — `buildChangesTable()` (dated changes: field select + a % or $
  value), `buildRSUInputTable()`, `buildBonusTable()` and
  `buildNqdcPayoutTable()` (all via the add/remove helper `buildListTable()`, whose
  input ids `rsu-0-date` etc. are what validation messages point at), plus
  `buildMatchTable()` and `buildBracketTables()`.
- **Page furniture** — `setupSections()` makes input panels collapsible (remembered)
  and adds the jump menu; `addMaxLinks()` adds the per-field "Max" buttons;
  `watchSummaryBar()` shows the bottom results bar while At a Glance is off-screen;
  saved scenarios live in `localStorage` (`paycheckCalc.scenarios.v1`) with
  `renderScenarios()` / `renderComparison()`.
- **Rendering** — `renderKpis()` (the At a Glance tiles, with optional baseline deltas,
  plus the "take-home changes when" timeline),
  `renderSummary()`, `renderDetailTable()` (the paycheck-by-paycheck
  table, with columns grouped left-to-right in the actual order deductions are taken
  against gross pay: Gross → NQDC → Regular 401(k) → Catch-Up 401(k) → After-Tax 401(k) &
  Match → HSA, FSA & Insurance → Wages → Taxes → Other Deductions → Net Pay → Notes, in
  Compact / Standard / All views (`detailView`; Compact uses summed `compactOnly`
  columns; `onlyIf` hides unused ones); also exported by `detailCSV()`; chart bars
  link to rows via `focusDetailRow()`), and
  `renderAccumulationChart()` (an inline-SVG stacked bar chart of cumulative 401(k)/HSA
  contributions, with a hashed fill pattern once a series hits its annual IRS/plan max), and
  `renderPaycheckBreakdownChart()` (one stacked bar per check, including Bonus and NQDC
  payout rows, splitting gross pay into taxes / retirement / NQDC / ESPP & other, with
  hatched take-home on top; see the comment on `PAYCHECK_SERIES` before changing its
  order or colors). Both charts share `attachChartTooltip()`, and both fit their bars to
  the available width (`chartGeometry()`, with `xAxisLabels()` thinning labels to fit),
  redrawn on resize by `watchChartWidth()`; they only scroll sideways below `MIN_BAND`
  px per bar.
- **Main** — `recalcAndRender()` is the single entry point: it saves, validates, calls
  `computeAll()` and re-renders every output panel. It's re-invoked on every input change
  and on load.

Data flow is one-directional and synchronous: an input's `oninput` handler mutates
`state`, calls `recalcAndRender()`, which validates and calls `computeAll(state.inputs, state.tax)` and
feeds the result to the render functions — there's no caching or incremental update, the
whole output side rebuilds from scratch on every change.
