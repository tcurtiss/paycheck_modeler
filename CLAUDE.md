# CLAUDE.md

This file provides quick operational guidance for AI coding agents working in this repository. For the complete technical architecture, calculation rules, invariants, and landmines, read [DESIGN.md](DESIGN.md). For user-facing documentation, see [README.md](README.md).

## What this is

A single self-contained HTML file, `paycheck_calculator.html`, that models a full-year biweekly paycheck (401(k) regular/catch-up/after-tax, employer match, NQDC deferrals & payouts, HSA, FSAs, ESPP, RSU vesting, cash bonuses, mid-year changes, and federal/FICA/state/SDI withholding) entirely client-side. There is no server, no build step, and no `package.json` — it opens directly as a `file://` URL in a browser.

`Paycheck_Model_2026_Template.gsheet` is **not** the data source for development — it's just a Google Drive shortcut pointer (JSON with a `doc_id`), not spreadsheet content. The original formulas were reverse-engineered from that external Google Sheet and validated cell-by-cell; the source spreadsheet lives outside this repo.

## Development & Verification

There is no build or lint step — open `paycheck_calculator.html` in a browser to run the app.

Run `test.js` after any calculation, validation, state, or Maximize change (zero dependencies; works with either Node.js or macOS's built-in JavaScriptCore):

```bash
node test.js
# or on macOS without Node:
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc test.js
```

Workflow when editing `paycheck_calculator.html`:

1. **Run `test.js`** (25 tests, including deterministic 500-run engine and 100-run Maximize fuzz suites) to verify syntax, 2027 baselines (Flat and Aggregate), per-row accounting invariants (`C - deductions - AI === AO`, `R <= eff415cLimit`), `CUT_ORDER` non-resurrection, `planMaximize()` invariants, 27-payday years, `validateInputs()`, `normalizeState()`, `taxIsModified()`, `updateToCurrentTaxYear()`, and CSV export. Add new test cases to `test.js` whenever fixing a bug or adding a rule.
2. **How `test.js` hooks into the IIFE:** `test.js` extracts `<script>...</script>` and replaces the final `document.addEventListener("DOMContentLoaded", init);` line with an export shim (`globalThis.__PAYCALC`). Do not remove or alter that final listener line.
3. **Browser/DOM verification:** For UI/DOM changes, test in a real browser (or headless Chrome / `puppeteer-core` listening for `pageerror`/`console` events) — `test.js` only exercises pure JS functions, not DOM wiring.
4. **2027 baseline invariants:** With the default 2027 inputs:
   - **Flat bonus withholding (default):** Gross Pay `$270,000.00`, Net Pay `$83,648.96`, Employer Match `$6,225.00`, Bonus check after-tax 401(k) cut `$2,750.00`.
   - **Aggregate bonus withholding:** Same Net Pay (`$83,648.96`), Bonus check after-tax 401(k) cut `$2,471.62`.
   - Re-baseline these **only** when updating to a new tax year.

## Architecture Quick Map

Everything lives in `paycheck_calculator.html` (`<style>` with light fallback + `@supports` CSS `light-dark()` theme tokens, HTML inputs/outputs + `<dialog id="maximize-dialog">`, and one `<script>` IIFE). Key subsystems (see [DESIGN.md](DESIGN.md) for full details):

- **Defaults:** `TAX_YEAR`, `defaultInputs()`, `defaultTaxTables()` (all IRS/SSA constants live here, never in `inputs`; read the comment block above `defaultTaxTables()` before a tax-year update).
- **Engine (`computeAll`):** Pure function returning `{ rows, rsuRows, nqdcPayoutRows, summary }`. Walks all events (`pay`, `bonus`, `rsu`, `payout`) chronologically with shared YTD `prev`. Variable names `C`–`AS` inside `buildRow()` map 1:1 to the source spreadsheet (plus `AT` SDI with independent `stateSdiTaxesHsa`, `AU` Health FSA, `AV` Dep.-Care FSA). Enforces `eff415cLimit` (`min(tax.limit415c, totalComp415)`) on regular 401(k), match, and after-tax (flagging `s415cCrowdDate` if 401(k)/match is cut off); enforces `$0` take-home floor via `CUT_ORDER` with `zeroed` non-resurrection tracking; reads `CHANGEABLE` fields exclusively via `electionsAt(date)`.
- **Validation (`validateInputs`):** Pure `{ errors, warnings }` covering user inputs, match tiers, Tax Year Settings, 27-payday & mid-year HSA/FSA limits (`paydaysInYear` + `electionAt`), and mid-year plan rules. Every message `id` targets a real focusable element (`focusField()` expands collapsed `.panel` and `<details>` ancestors).
- **Maximize (`planMaximize`):** Pure binary search over plan steps calling `computeAll()`. Pre-zeroes selected non-N/A items before Pass 1 (preserving original Traditional/Roth ratio), compares against post-strip elections in `withElections()`, protects earlier items and employer match across Pass 1 (`even`) and Pass 2 (`asap`), clears stale mid-year changes on whole-year runs (reported in `removedChanges`), and supports `from` payday dates.
- **State (`normalizeState`):** Copies only known keys onto fresh defaults (stripping stale keys), validates all scalars and nested `tax` maps with `Number.isFinite`, tracks `SCHEMA_VERSION` (`isNewerSchema()` warns on future versions), and runs backwards-compatible migrations. Always add a migration here when renaming/removing fields. `saveState()` respects the auto-save toggle (`paycheckCalc.noSave`), debounces 250 ms, and flushes on `pagehide`, `visibilitychange`, and discrete actions.
- **UI & Main Loop:** `SCALAR_BINDINGS` / `TAX_SCALAR_BINDINGS` bind via `.oninput = fn` (no duplicate listeners on re-populate). `recalcAndRender()` coalesces rapid typing with `requestAnimationFrame` + debounced multi-level Undo/Redo (`history`, 30 steps); `recalcAndRenderNow()` runs synchronously for `init()`, `replaceState()`, undo/redo, and row add/delete. `taxIsModified()` compares numerically (`1e-9` tolerance), comparison scenarios are cached (`compareCache`), static chart legends render once on `init()`, and chart interaction uses delegated SVG listeners (`bindChartDelegation`) with roving `tabindex` + arrow keys, quiet hover tooltips, and touch tap-to-preview / double-tap-to-jump.
