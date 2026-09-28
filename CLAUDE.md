# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single self-contained HTML file, `paycheck_calculator.html`, that models a full-year
biweekly paycheck (401(k) regular/catch-up/after-tax, employer match, NQDC, HSA, ESPP,
quarterly RSU vesting, a year-end bonus, and federal/FICA/state withholding) entirely
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
   scenario: the default inputs should always produce Net Pay `$80,511.44`, Gross Pay
   `$270,000.00`, and Employer Match `$6,125.00` — these were validated against the
   source spreadsheet's own cached values and are a fast regression check after any
   engine change.

## Architecture

Everything lives in `paycheck_calculator.html`: a `<style>` block (CSS custom properties
drive light/dark theming, redefined under both `@media (prefers-color-scheme: dark)` and
`:root[data-theme="dark"]`), the HTML markup (inputs form on the left, output panels on
the right), and one `<script>` wrapped in an IIFE, organized top-to-bottom as:

- **Defaults** — `defaultInputs()` and `defaultTaxTables()`. Tax-year constants (federal
  brackets, standard deductions, HSA/catch-up limits, payroll tax constants) live in
  `defaultTaxTables()`, which has an in-code comment block spelling out exactly what to
  update for a new tax year (including the easy-to-miss default dates in
  `defaultInputs()`) — read that comment before touching tax constants rather than
  duplicating its guidance here.
- **Calculation engine** — `computeAll(inputs, tax)` is a pure function (no DOM access)
  returning `{ rows, rsuRows, summary }`. Its inner `computeRow()` closure builds one
  paycheck at a time; its variable names (`C`, `D`, `E`, ... `AA`, `AB`, ... `AS`) are
  deliberately the literal column letters from the source spreadsheet's Paycheck Detail
  sheet, kept 1:1 so a value can be checked directly against a cell reference — there's a
  decoder comment immediately above `computeRow()` mapping every letter to its meaning.
  `PAY_PERIODS = 26` (biweekly) is not just a constant: the row-generation loop
  structurally assumes it (25 regular periods + one off-cycle bonus check inserted after
  period 25 + period 26), so changing pay frequency requires reworking that loop, not
  just the constant.
- **State** — a single mutable `state = { inputs, tax }` object. `loadState()` merges
  anything found in `localStorage` (key `paycheckCalc.state.v1`) onto fresh defaults
  rather than trusting it wholesale, and includes a one-time migration for at least one
  renamed field. This matters: a prior field rename that skipped this merge/migration
  step once crashed `init()` for anyone with old saved state. Follow the same
  merge-plus-migrate pattern in `loadState()` whenever an input field is renamed or
  removed.
- **Binding** — `SCALAR_BINDINGS`/`TAX_SCALAR_BINDINGS` declaratively map input element
  IDs to `state` keys (including dotted/array paths via `getVal`/`setVal`), wired up by
  `populateScalarBindings()`. It assigns `el.oninput = fn` (not `addEventListener`) so
  that re-calling it — e.g. on "Reset to Example" — replaces the handler instead of
  stacking a duplicate.
- **Dynamic tables** — `buildRSUInputTable()`, `buildMatchTable()`, `buildBracketTables()`
  render the variable-length inputs (RSU vests, match brackets, federal brackets per
  filing status) that don't fit the flat scalar-binding model.
- **Rendering** — `renderSummary()`, `renderDetailTable()` (the paycheck-by-paycheck
  table, with columns grouped left-to-right in the actual order deductions are taken
  against gross pay: Gross → NQDC → Regular 401(k) → Catch-Up 401(k) → After-Tax 401(k) &
  Match → HSA & Insurance → Wages → Taxes → Other Deductions → Net Pay), and
  `renderAccumulationChart()` (an inline-SVG stacked bar chart of cumulative 401(k)/HSA
  contributions, with a hashed fill pattern once a series hits its annual IRS/plan max).
- **Main** — `recalcAndRender()` is the single entry point: it calls `computeAll()` and
  re-renders every output panel. It's re-invoked on every input change and on load.

Data flow is one-directional and synchronous: an input's `oninput` handler mutates
`state`, calls `recalcAndRender()`, which calls `computeAll(state.inputs, state.tax)` and
feeds the result to the render functions — there's no caching or incremental update, the
whole output side rebuilds from scratch on every change.
