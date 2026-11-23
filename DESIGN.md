# Paycheck Calculator — Technical Design & Theory of Operation

This document is the in-depth architectural and domain reference for developers and AI agents modifying [paycheck_calculator.html](paycheck_calculator.html). For user instructions see [README.md](README.md); for day-to-day agent workflow and baseline check commands see [CLAUDE.md](CLAUDE.md).

---

## 1. Design Philosophy & File Layout

The application is intentionally delivered as a **single, self-contained HTML file** (`paycheck_calculator.html`, ~4,370 lines) with zero external dependencies, zero build step, and zero network calls. It must always open and function directly from a `file://` URL.

Inside `paycheck_calculator.html`:
1. **`<style>`** (lines 7–315):
   - Single-source theming via plain light-mode fallback variables on `:root`, upgraded to CSS `light-dark()` inside `@supports (color: light-dark(white, black))` (`:root { color-scheme: light dark; ... }`), overridden cleanly by `:root[data-theme="dark"]` / `:root[data-theme="light"]`.
   - Two-column CSS Grid (`.layout`: `minmax(300px, 440px) 1fr`, stacking at `<= 900px`), sticky detail table headers/footers/columns (`--stick1-w: 104px`), print stylesheet (`@media print`).
2. **`<body>` markup** (lines 317–729):
   - Left column (`.inputs-col`): static input controls + empty `<tbody>` placeholders for dynamic tables (bonuses, RSUs, NQDC payouts, mid-year changes, match tiers, tax brackets) + Scenario controls.
   - Right column (`#outputs`): `#notices`, `#validation` (not a live region; `#validation-status` announces only error/warning counts, debounced), At a Glance (`#kpis`, `#kpi-timeline`, `#compare-table`), two inline-SVG chart panels (`#pay-chart`, `#accum-chart`), Annual Summary cards, and `#detail-table`.
   - Floating furniture: `#summary-bar` (fixed bottom bar) and `<dialog id="maximize-dialog">`.
3. **`<script>`** (lines 730–4367):
   - Wrapped in a single strict-mode IIFE `(function () { "use strict"; ... })();` so nothing leaks to `window`.
   - Organized top-to-bottom into self-contained sections:
     1. **Defaults** (`TAX_YEAR`, `defaultInputs`, `defaultTaxTables`)
     2. **Pure Calculation Engine** (`computeAll`, `nqdcPayoutOccurrences`, date/bracket/match helpers)
     3. **Pure Validation** (`validateInputs`)
     4. **Pure Maximize Solver** (`planMaximize`)
     5. **State & Persistence** (`normalizeState`, `loadState`, `saveState`/`flushSaveState`, `updateToCurrentTaxYear`)
     6. **Formatting & Control Binding** (`SCALAR_BINDINGS`, `TAX_SCALAR_BINDINGS`, `makeMoneyInput`, `populateScalarBindings`)
     7. **Dynamic Input Tables** (`buildListTable`, `buildChangesTable`, `buildMatchTable`, `buildBracketTables`)
     8. **Output Renderers** (`renderKpis`, `renderSummaryBar`, `renderComparison`, `renderScenarios`, `renderSummary`, `renderDetailTable`, `detailCSV`, `renderAccumulationChart`, `bindChartDelegation`, `renderPaycheckBreakdownChart`, `renderHints`)
     9. **Notices, Validation UI, Maximize Dialog, Collapsible Sections & Theme**
     10. **Main Loop & Wiring** (`recalcAndRenderNow`, `recalcAndRender`, `populateAllControls`, `wireControls`, `init`)

**Verification harness (`test.js`):** A standalone zero-dependency script that reads `paycheck_calculator.html`, extracts `<script>...</script>`, replaces the final `DOMContentLoaded` line with an export hook (`globalThis.__PAYCALC`), evaluates it in either Node.js (`node test.js`) or macOS's built-in JavaScriptCore (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc test.js`), and runs unit/invariant tests. `testdata/paystubs-2026.json` is a paystub-derived test vector: an anonymized version of a real 2026 pay year (inputs changed by a few percent so no real pay is published, 2026 tax overrides, and the expected per-check and per-vest columns). The test compares every column to within half a cent and separately asserts the payroll rules the real stubs showed. Its expected rows are engine output, so regenerate them only when a change is meant to move those numbers, and don't put real paystub amounts in it (the repo is public).

---

## 2. Theory of Operation & Data Flow

Data flow is **strictly one-directional** with a clear separation between pure computation and DOM rendering:

```
User input event (oninput / onchange / click)
  │
  ├─► Mutates in-memory `state = { inputs, tax }`
  │
  ├─► `recalcAndRender()`
  │     ├─► `saveState()` (debounced 250ms → `localStorage` when auto-save is on; flushed on `pagehide`, `visibilitychange`, and discrete actions)
  │     ├─► `scheduleHistory()` (debounced 600ms snapshot onto multi-level Undo/Redo stack)
  │     └─► Coalesced via `requestAnimationFrame` → `recalcAndRenderNow()`
  │           ├─► `renderHeader()`      (tax-year chip + "(edited)" detection)
  │           ├─► `renderNotices()`     (older-year prompt + dismissible flash notices / Undo)
  │           ├─► `renderHints()`       (inline limit hints, conditional field visibility, changes step sync)
  │           ├─► `validateInputs(state.inputs, state.tax)` → `{ errors, warnings }`
  │           ├─► If `errors.length === 0`:
  │           │     ├─► `computeAll(state.inputs, state.tax)` → `{ rows, rsuRows, nqdcPayoutRows, summary }`
  │           │     ├─► If `summary.s415cCrowdDate`, appends a §415(c) crowding warning to `v.warnings`
  │           │     ├─► `renderKpis(result)` → also calls `renderSummaryBar(s)` & `renderComparison(result)`
  │           │     ├─► `renderSummary(result.summary, result)`
  │           │     ├─► `renderDetailTable(result.rows)`
  │           │     ├─► `renderAccumulationChart(payRows)`
  │           │     ├─► `renderPaycheckBreakdownChart(result.rows)`
  │           │     └─► updates `#match-max-hint`
  │           ├─► `renderValidation(v)` (banner + `aria-invalid` / `.has-warning` classes)
  │           └─► `lastResult = result`; toggles `#outputs.is-stale` and `#btn-maximize.disabled`
```

Key architectural properties:
- **Synchronous initialization & state replacements:** `init()`, `replaceState()` (Reset / Import / Load / Apply Maximize / Update Year / Restore Tax), undo, and row add/delete call `recalcAndRenderNow()` directly (and `flushSaveState()`) so there is no frame delay or lost persistence.
- **No partial DOM patching for outputs:** Every valid render rebuilds the output panels from scratch from `{ rows, rsuRows, nqdcPayoutRows, summary }`. `setHTML(id, html)` memoizes markup for live regions (`#notices`, `#validation`, `#kpi-timeline`, `#compare-table`, `#tax-year-note`) to prevent screen readers from re-announcing unchanged notices on every keystroke.
- **Error resilience:** When `validateInputs()` reports errors (or `computeAll()` throws), `lastResult` becomes `null`, `#outputs` and `#summary-bar` get `.is-stale` (dimmed at 40% opacity, keeping the previous valid numbers visible as reference; the bar also says it's out of date), and `#btn-maximize` disables until errors are resolved.
- **Blank number fields:** `trackBlank()` records number/money inputs left blank or holding non-numbers (`blankFields`); the model reads them as `0`, but `recalcAndRenderNow()` prepends `blankFieldErrors()` to the validation errors so results go stale instead of silently using `$0`. `populateAllControls()` and table rebuilds clear the entries they refill.
- **Notices:** `flashNotices` entries are `{ kind, html, actions?: [{ label, action }] }`; action buttons carry `data-notice` so the handler finds their notice. `replaceState()` notices store `undo: { before, after }`; `undoNotice()` does a plain Undo when nothing changed since, otherwise restores `before` as a new history step (so Undo recovers the later edits). Deleting a saved scenario flashes an Undo (`restore-scenario`).

---

## 3. State Schema, Persistence & Migrations

### In-memory state
`state` has two top-level objects:
- **`state.inputs`**: User-specific compensation, deductions, plan rules, lists (`rsuVests`, `bonuses`, `nqdcPayouts`, `changes`), and UI-backed solver preference (`maximizeMinNet`).
- **`state.tax`**: All IRS/SSA constants for a tax year (`taxYear`, `brackets`, `standardDeduction`, `hsaLimit`, `hsaCatchup55`, `ssWageBase`, `ssRate`, `medicareRate`, `addlMedicareRate`, `addlMedicareThreshold`, `addlMedicareFilingThreshold`, `electiveLimit`, `catchup5059`, `catchup6063`, `limit415c`, `rothCatchupWageThreshold`, `suppRate`, `suppRateHigh`, `suppThreshold`, `esppIrsLimit`, `healthFsaLimit`, `dcFsaLimit`, `addlStdDeduction65`, `seniorDeduction`, `seniorDeductionPhaseout`, `seniorDeductionPhaseoutStart`, `seniorDeductionLastYear`, plus optional `keptTaxYearFor`).

**Rule:** Never store IRS/SSA constants in `inputs`; they always belong in `tax`.

### `localStorage` keys
| Key | Contents |
|---|---|
| `paycheckCalc.state.v1` | `{ schemaVersion: 1, inputs, tax }` (omitted/cleared when auto-save is off) |
| `paycheckCalc.noSave` | `"1"` when the user turns off auto-save |
| `paycheckCalc.state.unreadable` | Raw copy of a save `init()` couldn't load (offered for download in the error notice; cleared when auto-save is turned off) |
| `paycheckCalc.scenarios.v1` | `[{ name, savedAt, state: { schemaVersion, inputs, tax } }, ...]` |
| `paycheckCalc.baseline.v1` | `{ values: { takeHome, typical, saved, effRate, due }, at }` |
| `paycheckCalc.collapsed` | Array of collapsed input panel title strings |
| `paycheckCalc.theme` | `"auto"` \| `"light"` \| `"dark"` |
| `paycheckCalc.view` | `"compact"` \| `"standard"` \| `"all"` |

### `normalizeState(parsed)` contract
Every external load (`loadState()`, JSON file import, saved scenario load, and comparison scenario load) passes through `normalizeState()`. It:
1. Validates top-level `{ inputs, tax }` shape (throws on invalid JSON/files); `isNewerSchema(parsed)` warns if `schemaVersion > SCHEMA_VERSION`.
2. Copies **only known keys** from `defaultInputs()` and `defaultTaxTables()` (plus `keptTaxYearFor` on `tax` and known subkeys of per-status/coverage maps), stripping obsolete or unknown keys so they aren't re-persisted forever or misread as tax edits.
3. Runs backwards-compatible migrations:
   - `matchBoundaries` → `matchBracketWidths`
   - IRS constants moved from `inputs` → `tax` (`electiveLimit`, `suppRateUnder1M`, `suppRateOver1M`, `suppThreshold`)
   - Legacy scalar `bonusAmount` → `bonuses: [{ amount, date }]`
   - Legacy boolean `catchupMustBeRoth` → `catchupRoth: "Yes" | "No"`
   - Pre-`taxYear` saves: infers `taxYear` from `ssWageBase` / `firstPayDate`
   - Drops deprecated `base` property from bracket rows (derived dynamically now)
4. Enforces strict types using `isNum = v => typeof v === "number" && Number.isFinite(v)` (never global `isFinite()`, because `isFinite(null) === true` and `isFinite("") === true`!). Validates scalars, all 5 nested numeric `tax` maps, enum strings, fixed-length match arrays, variable-length lists (`rsuVests`, `bonuses`, `nqdcPayouts`, `changes`), and every bracket `{ over, rate }`.

---

## 4. Calculation Engine (`computeAll`)

`computeAll(raw, tax)` is a **pure function** (zero DOM/global access) returning `{ rows, rsuRows, nqdcPayoutRows, summary }`.

### 4.1 Event Schedule & Chronological Walk
1. `year = firstPayDate.getFullYear()`. Any RSU vest or bonus outside `year` (or with `<= 0` amount / invalid date) is filtered out.
2. **Regular paydays:** Biweekly (`+14` days per check). `paydaysInYear(firstPayDate)` returns `27` if `addDays(firstPayDate, 14 * 26)` still lands in `year`, else `26`.
   - `salaryDivisor`: `27` when `regularChecks === 27 && extraPayday === "Spread"`, otherwise `26` (so `"Extra"` gives a 27th check at `salary / 26`).
3. **NQDC payouts:** `nqdcPayoutOccurrences(elections, year)` expands each multi-year election `{ amount, firstDate, years }` into the single occurrence landing in `year` (if `0 <= year - firstYear < years`), clamping Feb 29 to Feb 28 in non-leap years.
4. **Combined schedule:** All events (`pay`, `bonus`, `rsu`, `payout`) are merged into one `schedule` array and sorted by `(date, KIND_ORDER[kind])` where `KIND_ORDER = { pay: 0, bonus: 1, rsu: 2, payout: 3 }`.
5. **Single chronological pass:** Each event updates a single shared YTD accumulator `prev`:
   ```js
   prev = {
     H,      // YTD regular 401(k) elective (F + G)
     M,      // YTD 401(k) catch-up (K + L)
     R,      // YTD §415(c) annual additions (F + G + O + Q; excludes catch-up)
     X,      // YTD federal taxable W-2 Box 1 wages (payroll + RSU + NQDC payouts)
     Z,      // YTD payroll-only FICA wages (for detail table display)
     AN,     // ESPP contributed within current offering period AK
     AK,     // Current ESPP offering period number (null initially)
     hsa,    // YTD employee HSA contributions (T)
     fica,   // YTD FICA wages across ALL sources (payroll + RSU; NOT NQDC payouts)
     supp,   // YTD cumulative supplemental wages (bonus W + RSU + NQDC payouts)
     espp,   // YTD ESPP contributions toward offering periods purchased in `year`
     hfsa,   // YTD Health FSA (AU)
     dcfsa,  // YTD Dependent-care FSA (AV)
     sdi,    // YTD state disability/leave taxable wages (payroll sdiWages + RSU)
   }
   ```

### 4.2 Mid-Year Election Changes (`CHANGEABLE`)
`CHANGEABLE` defines the 11 fields that may vary by date (`annualSalary`, `trad401kPct`, `roth401kPct`, `afterTax401kPct`, `hsaPerPaycheck`, `healthFsaPerPaycheck`, `dcFsaPerPaycheck`, `preTaxInsurance`, `esppPct`, `otherPostTax`, `addlFedWithholding`). NQDC deferral is intentionally excluded (irrevocable for the tax year).

Inside `computeAll()`, `electionsAt(date)` caches the effective election object per timestamp by starting from base `inputs` and applying every valid `change` with `c.date <= date` in chronological order (later changes override earlier ones). **`buildRow()` must always read `CHANGEABLE` fields from `ei = electionsAt(date)`, never from `inputs`.**

### 4.3 Row Anatomy & Spreadsheet Column Decoder (`buildRow`)
Variable names `C`–`AS` intentionally match the column letters of the original reference Google Sheet (`AT`, `AU`, `AV` were added afterwards). Within `buildRow(e, cuts, zeroed)`, calculations execute in strict dependency order:

| Step | Vars | Rule / Formula |
|---|---|---|
| **1. Gross & Bonus base** | `AP`, `C`, `AQ`, `AR`, `AS` | Regular check: `C = ei.annualSalary / salaryDivisor`, `AP = 0`. Bonus check: `C = AP = e.amount`. Bonus elections apply to `AP` (NQDC `AQ`) and `AP - AQ` (401k `AR`, after-tax `AS`). |
| **2. Regular 401(k)** | `room415c`, `D`, `E0`, `F`, `G`, `E`, `H` | `eff415cLimit = min(tax.limit415c, totalComp415)` (IRC §415(c)(1)(B) 100%-of-comp cap). `room415c = max(0, eff415cLimit - prev.R)`. Desired `D = (regularGross * (1 - nqdcPct)) * (trad + roth) + AR`. Capped `E0 = min(D, max(0, electiveLimit - prev.H), room415c)`. Split by `fraction` into Traditional `F` and Roth `G` (each subject to `cut`). If `room415c` cuts short regular 401(k) or match, `s415cCrowded` flags a warning with `summary.s415cCrowdDate`. |
| **3. Catch-Up 401(k)** | `I`, `J0`, `K`, `L`, `J`, `M`, `N` | Overflow `I = D - E0` (computed from *uncut* `E0`, so cutting `F`/`G` never pushes money into catch-up!). `J0 = min(I, max(0, catchLimit - prev.M))`. Catch-up is exempt from §415(c) per IRC §414(v). If `catchupMustBeRoth` (`"Yes"`, or `"Auto"` with `priorYearFicaWages > rothCatchupWageThreshold`), `K = 0, L = J0`; else split by `fraction`. Remaining overflow `N = I - J0`. |
| **4. Employer Match** | `O` | Tiered YTD match `tierMatch(prev.H + prev.M, H + M, matchBoundaries, matchRates)`, capped at `max(0, room415c - (F + G))`. `matchBoundaries` is monotonic and clamped to `electiveLimit + catchLimit`. |
| **5. After-Tax 401(k)** | `P`, `Q`, `R` | Elected `P = (regularGross * (1 - nqdcPct)) * ei.afterTax401kPct + AS`. Contributed `Q = cut("Q", min(P + (spillover ? N : 0), max(0, room415c - (F + G + O))))`. `R = prev.R + F + G + O + Q` (guaranteed `<= eff415cLimit`). |
| **6. Pre-Tax Deductions & Wages** | `S`, `T`, `U`, `AU`, `AV`, `V`, `W`, `X`, `Y`, `Z` | NQDC `S` applies on regular & bonus; HSA `T`, pre-tax insurance `U`, Health FSA `AU`, and Dep.-Care FSA `AV` apply only on regular checks (`0` on bonus) and cap at remaining annual room (`hsaEmployeeRoom`, `healthFsaLimit`, `dcFsaLimit`). Federal pre-tax `V = F + K + S + T + U + AU + AV`; Box 1 wages `W = C - V`. Section 125 FICA-exempt items give FICA wages `Y = C - T - U - AU - AV` (401(k) and NQDC remain FICA-taxable). |
| **7. Federal Withholding** | `AA`, `AB`, `AC`, `AD` | **Flat bonus** (`isBonus && bonusWithholding !== "Aggregate"`): `AC = suppFedTax(W, prev.supp)` (blending `suppRate` below `$1M` cumulative and `suppRateHigh` above), `AD = 0`. **Regular check**: IRS Pub. 15-T percentage method (`regularFedWithholding(W)`), always annualizing over **`PAY_PERIODS = 26`** (even in a 27-payday year): `AA = max(0, W * 26 + w4OtherIncome - w4Deductions - stdDed)`, where Step 2(c) halves both `stdDed` and bracket widths; `AB = max(0, bracketTax(AA) - w4Credits)`; `AC = AB / 26`; `AD = ei.addlFedWithholding`. **Aggregate bonus** (Pub. 15 aggregate method for supplemental wages paid separately): `AC = wh(lastPayRow.W + W) - wh(lastPayRow.W)`, where `wh` is `regularFedWithholding(...).AC` and `lastPayRow` is the most recent regular check (`W = 0` if the bonus precedes the first payday); `AA`/`AB` show the combined calculation; `AD = 0` (Step 4(c) is per pay period and already came out of the regular check). |
| **8. FICA, State & SDI** | `AE`, `AF`, `AG`, `stateWages`, `AH`, `AT`, `AI` | `AE` (Social Security) taxes the slice of `[prev.fica, prev.fica + Y]` up to `ssWageBase`. `AF` (Medicare) = `Y * medicareRate`. `AG` (Additional Medicare) taxes the slice above `addlMedicareThreshold` (`$200k` for all filers at withholding time). `stateWages = W + (stateTaxes401k ? F + K : 0) + (stateTaxesHsa ? T : 0)`; `AH = stateWages * stateTaxRate`. `sdiWages = Y + (stateSdiTaxesHsa ? T : 0)` (controlled independently from income-tax HSA conformity); `AT = sdiTax(sdiWages, prev.sdi)`. Total taxes `AI = AC + AD + AE + AF + AG + AH + AT`. |
| **9. Post-Tax & ESPP** | `AJ`, `AK`, `AL`, `AM`, `AN` | `AJ = isBonus ? 0 : ei.otherPostTax`. Offering period `AK = Math.floor(datedifMonths(esppStart, date) / esppMonths) + 1` (works for dates both before and after `esppStart`). Purchase date is the day before the next period starts: `addDays(addMonths(esppStart, AK * esppMonths), -1)`. `AM` is capped by both the offering-period cap (`esppCap`) and, if purchased in `year`, the IRS §423 annual contribution cap `esppIrsLimit * (1 - esppDiscount)`. |
| **10. Net Pay** | `AO` | `AO = C - (F + G + K + L + Q + S + T + U + AU + AV) - AI - AJ - AM`. |

### 4.4 Take-Home Floor & `CUT_ORDER` (`computeRow`)
Real payroll never issues a negative paycheck. If uncut `row.AO < -1e-9`, `computeRow()` walks `CUT_ORDER`:
```js
const CUT_ORDER = [
  "AM", "Q", "L", "G", "AJ",           // Post-tax (1:1 net pay relief)
  "S", "K", "F", "T", "AU", "AV", "U", // Pre-tax (raises taxable wages & tax; re-solved iteratively)
  "AD", "AC"                           // Federal withholding (last resort)
];
```
- For each `key`, an inner loop (up to 200 passes) increases `cuts[key]` by `min(row[key], -row.AO)` and re-runs `buildRow(e, cuts, zeroed)`. For post-tax keys this converges in 1 pass; for pre-tax keys it converges geometrically because each pass's marginal tax rate is `< 100%`.
- **Non-resurrection invariant (`zeroed`):** When a bucket hits `0` and `row.AO < NEG` still holds, `zeroed[key] = true` pins that bucket at `$0` for all subsequent passes. Without `zeroed`, cutting `G` or `F` later would lower `F + G + O`, expand `room415c - (F + G + O)`, and cause an already-cut `Q` to spring back to life.
- Only sub-cent convergence residue (`-EPS <= row.AO < 0`) is clamped to `0`. Truly impossible tax rates (`state + SDI + FICA > 100%`) preserve the accounting identity `C - deductions - AI === AO` and trigger a validation warning.

### 4.5 Off-Cycle Rows: NQDC Payouts & RSU Vests
- **`computePayoutRow(payout)`**: Appended to `rows` (`kind: "payout", isNqdcPayout: true`). Contributes to `X` (Box 1) and `supp` (`$1M` supplemental tracker); withheld at `suppFedTax(C, prev.supp)` + `stateTaxRate`; **no FICA, no SDI, no deductions**. Leaves `prev.AK` / `prev.AN` untouched so ESPP offering tracking stays owned by paychecks.
- **`computeRsuVest(vest)`**: Appended to `rsuRows` (not `rows`, since RSUs are share vests, not cash paychecks). Contributes to `X`, `fica`, `supp`, and `sdi`; withheld at `suppFedTax`, SS, Medicare, Additional Medicare, state, and SDI.

### 4.6 Tax-at-Filing Estimate
Computed at the end of `computeAll()`:
- `over65`: `1` for employee ≥ 65, plus `1` for spouse ≥ 65 when `MFJ`.
- `estStdDeduction = stdDeduction + over65 * addlStdDeduction65[status]`.
- `estSeniorDeduction` (tax years `<= seniorDeductionLastYear`, excluding MFS): per eligible 65+ individual, `max(0, seniorDeduction - seniorDeductionPhaseout * max(0, estMagi - seniorDeductionPhaseoutStart[status]))`, where `estMagi = totalW2AllSources + w4OtherIncome`.
- `estTaxable = max(0, totalW2AllSources + w4OtherIncome - estStdDeduction - estSeniorDeduction - w4Deductions)`.
- `estIncomeTax = max(0, bracketTax(estTaxable, brackets) - w4Credits)`.
- `estAddlMedicare = max(0, ficaWagesAll - addlMedicareFilingThreshold[status]) * addlMedicareRate` (reconciles the `$200k` withholding threshold against the filing-status liability threshold: `$250k` MFJ, `$200k` Single/HoH, `$125k` MFS).
- `estBalanceDue = estIncomeTax + estAddlMedicare - (totalFedAllSources + totalAddlMedAllSources)`.

---

## 5. Validation (`validateInputs`)

`validateInputs(inp, tax)` is pure and returns `{ errors: [{ id, msg }], warnings: [{ id, msg }] }`:
- **Errors** block `computeAll()` (missing/invalid `firstPayDate`, negative dollar amounts, out-of-`[0, 1]` percentages, invalid ESPP months/discount, `plan401kMaxPct <= 0`, negative match widths/rates, invalid Tax Year Settings rates/limits/brackets, invalid mid-year change values).
- **Warnings** allow calculation (payday calendar sanity, tax-year vs pay-date year mismatch, out-of-year bonuses/RSUs/changes, HSA/FSA over-election summing `electionAt()` across `paydaysInYear(fp)` paydays so mid-year changes are included, 401(k)/ESPP plan maximum and step violations on both base inputs and mid-year `changes`, combined election % > 100%, combined tax rates ≥ 100%). In addition, `recalcAndRenderNow()` appends a warning after `computeAll()` if `summary.s415cCrowdDate` is set (after-tax filled §415(c) early and cut off 401(k)/match).
- **Focus contract:** Every `id` in an error or warning must match a real DOM element ID so clicking the message calls `focusField(id)`, which expands both `<details>` and `.panel.collapsed` ancestors before focusing and scrolling.

---

## 6. Maximize Solver (`planMaximize`)

`planMaximize(raw, tax, opts)` is pure and never duplicates payroll formulas — it treats `computeAll()` as a black-box oracle and binary-searches integer step indices (`firstTrue` / `lastTrue`) over the plan's allowed step sizes (`plan401kStep`, `esppStep`, or cents `$0.01` for HSA/FSAs).

### Algorithm
1. **Capture original 401(k) split:** Read `k401TradShare` from `base` at `fromDate` (falling back to `opts.newSplit` if both Traditional and Roth are `0%`).
2. **Pre-zero selected items:** Check `defFor(item, base, before).na` for each selected item. For every non-N/A selected item, zero its election on the working copy `cur` via `withElections()`. This prevents a stale high lower-priority election (e.g., `80%` after-tax 401(k)) from choking `k401` via `plan401kMaxPct` or take-home guards.
3. **Writing elections (`withElections`):**
   - If `!fromDate` (whole year): sets top-level fields on `inp` **and strips any entries in `inp.changes` for those fields**.
   - If `fromDate` is set: removes `inp.changes` entries for those fields with `date >= fromDate`, then compares `value` against `electionAt({ ...inp, changes }, field, fromDate)` (the **post-strip** change list!) so setting a field to `0%` never skips writing the dated change and accidentally re-exposes an older non-zero base value.
4. **Pass 1 (`even`, in `MAXIMIZE_ORDER`):** `hsa → healthFsa → dcFsa → k401 → afterTax → espp`.
   - `maxK` for `k401` and `afterTax` respects `plan401kMaxPct - maxEffectiveSum(otherBucket)` across all affected paydays; `afterTax` targets `curRes.summary.limit415c`.
   - Every item's `solve()` requires that previously solved items stay at or above their Pass 1 achievements (and `totalMatch` stays `>= pass1MatchFloor` once `k401` is solved), preventing after-tax from filling §415(c) early and crowding out 401(k) or match.
   - `solve()` evaluates `res0 = sim(0)` and defines `guard(res)`: on every affected regular paycheck, `cutTotal(r) <= base0[i].cut + EPS` AND `(r.AO >= minNet - EPS || r.AO >= base0[i].net - EPS)`. Comparing against `sim(0)` ensures preexisting shortfalls from *unselected* deductions don't falsely block a valid item (producing status `guardPre` vs `guard` when short).
   - Picks `k = kNeed` if `kNeed <= kSafe` (`status: "ok"`), else `k = kSafe` (`"noPay"` | `"planMax"` | `"guardPre"` | `"guard"`).
5. **Pass 2 (`asap` only):** Records Pass 1 achievements as `floorOf[item]` (and `matchFloor`), then raises `k401 → afterTax → espp` to the highest `kSafe >= kEven` such that `guard` holds AND no other selected item or `totalMatch` drops below Pass 1.
6. **Final status & `removedChanges`:** Re-checks each item against the final `after` result (downgrading `"ok"` to `"guard"` if short) and collects `removedChanges` (any mid-year changes dropped by the plan, shown in the preview). Returns `{ items, inputs: cur, before, after, from: fromDate, minNet, removedChanges }`. The dialog only persists `minNet` into `state.inputs.maximizeMinNet` inside `applyMaximize()`, never on preview/Cancel.

---

## 7. UI & Rendering Architecture

- **Scalar bindings (`SCALAR_BINDINGS`, `TAX_SCALAR_BINDINGS`):** Declarative `{ id, key, kind }` arrays wired via `el.oninput = ...` (assignment, never `addEventListener`, so `populateAllControls()` can re-run cleanly on Reset/Import/Undo without stacking duplicate listeners). Dollar fields (everything with `kind: "money"` or `kind: "number"` not in `NOT_MONEY`) are converted by `makeMoneyInput()` to `type="text" inputmode="decimal" data-money="1"` and auto-formatted with commas on `focusout`.
- **Dynamic tables:** `buildListTable()` handles RSUs, bonuses, and NQDC payouts with deterministic input IDs (`rsu-0-value`, `bonus-0-date`, `nqdc-0-firstDate`) that match `validateInputs()`; match (`match-w-0`..`2`, `match-r-0`..`2`) and bracket (`brk-<SFX>-<i>-over`/`rate`) inputs carry focusable IDs too. `buildChangesTable()` dynamically matches percent `step` attributes to `plan401kStep` / `esppStep` and sorts changes by date whenever it rebuilds, plus when focus leaves `#changes-table` for another control (`focusout` with a non-null `relatedTarget` outside the table) — never on `blur` inside the table, which would drop keyboard focus or swallow a click.
- **Detail table (`DETAIL_COLS`):** Columns are ordered left-to-right in payroll deduction order. Three views (`compact`, `standard`, `all`) filter by `compact`, `compactOnly`, `essential`, and `onlyIf` (auto-hiding unused columns like FSA/SDI and the entire Catch-Up group when `$0`). `CUMULATIVE_COLS` (`H, M, R, X, Z`) display the final row's YTD value in `<tfoot>` instead of summing them.
- **Comparison caching (`compareCache`):** `renderComparison()` caches `{ name, savedAt, summary, error }` for the active saved scenario and invalidates only in `storeScenarios()` or when `compareWith` changes.
- **Inline-SVG charts & delegated interaction:**
  - Both legends are static and rendered once in `init()`.
  - `chartGeometry()` computes responsive band/bar widths between `MIN_BAND = 12` and `MAX_BAND = 48` and redraws on width changes via `watchChartWidth()` (`ResizeObserver` + `resize`).
  - `bindChartDelegation()` binds pointer, focus, click, and keyboard listeners **once per `<svg>`** in `wireControls()`. Each render updates only `chartCallbacks[svgId]`.
  - **Keyboard & screen-reader ergonomics:** Each chart uses roving `tabindex` (`0` on the active bar, `-1` on others — 1 Tab stop per chart) with `ArrowLeft`/`ArrowRight`/`Home`/`End` navigation. Hover tooltips are non-live so mouse movement doesn't spam screen readers (each bar's `aria-label` announces on focus).
  - Tooltips measure their real `offsetWidth` / `offsetHeight` and clamp within `wrapRect` on all four sides. Touch pointers ignore `pointerleave` (which fires right after `touchend` before `click`) so tap 1 previews the tooltip, tap 2 on the same bar jumps to the detail table, and tapping outside dismisses.
  - Both charts compute `topK` (the topmost non-empty stacked segment) for rounded top corners and 2px inter-segment gaps.
  - **CVD palette note:** `PAYCHECK_SERIES` slot order `(2, 1, 3, 4, 6)` was validated for adjacent-pair color-vision-deficiency contrast; in dark mode the top pair relies on take-home's diagonal hatch pattern — re-validate if reordering or recoloring.
- **Undo/Redo, auto-save & input guards:** Multi-level `history` stack (`HISTORY_MAX = 30`, debounced 600 ms for typing, immediate for discrete actions) backs `#btn-undo`/`#btn-redo`, `Ctrl/Cmd+Z` / `Shift+Z`, and flash-banner Undo buttons. `taxIsModified()` compares against `DEFAULT_TAX` with `1e-9` numeric tolerance (no JSON serialization on redraw). A `wheel` guard blocks accidental scroll-wheel changes on focused `<input type="number">` fields.
- **Collapsible sections & jump nav (`setupSections`):** Wraps each `.panel`'s content in `.panel-body`, injects a sticky `.jump-nav` (with a mobile-only `Results ↓` link), and observes `.jump-nav` height via `ResizeObserver` to update `--jump-nav-h` for `scroll-margin-top`.

---

## 8. Caveats, Invariants & Landmines

Read this checklist before changing any formula, input, or UI flow:

1. **Never bypass `normalizeState()` on external/saved data:** Adding, renaming, or removing any field in `defaultInputs()` or `defaultTaxTables()` requires verifying `normalizeState()` handles older saves (missing keys, renamed keys, wrong types) — a prior un-migrated rename once crashed `init()` for returning users.
2. **Never use global `isFinite()` for type validation:** `isFinite(null)`, `isFinite("")`, and `isFinite(false)` are all `true` in JS. Always use `typeof v === "number" && Number.isFinite(v)`.
3. **Never index `result.rows` positionally:** `rows` has variable length (26 or 27 regular paychecks + N bonuses + M NQDC payouts, interleaved chronologically). Always filter by `r.kind` (`"pay"`, `"bonus"`, `"payout"`) or `r.isBonus` / `r.isNqdcPayout`. Remember RSU vests live in `rsuRows`, not `rows`, and the accumulation chart excludes NQDC payout rows.
4. **Never read `CHANGEABLE` fields from `inputs` inside `buildRow()`:** Always read `ei = electionsAt(date)`. Reading `inputs.trad401kPct` directly silently breaks mid-year changes.
5. **Keep `PAY_PERIODS = 26` vs `regularChecks` (26 or 27) distinct:**
   - IRS Pub. 15-T biweekly withholding (`regularFedWithholding`) **must** keep `PAY_PERIODS = 26` even in a 27-payday year.
   - Annual election math (HSA/FSA hints & warnings, salary divisor when `"Spread"`, per-check W-4 balance-due suggestion) **must** use `regularChecks` / `paydaysInYear(fp)`.
6. **Preserve the `CUT_ORDER` / `zeroed` invariant:** Cutting a deduction must never push overflow into catch-up/spillover (`I`, `J0`, `N` derive from uncut `E0`), and must never resurrect a previously exhausted earlier bucket (`zeroed[key] = true`). Every row must maintain `C - deductions - AI === AO` (within `EPS`) and `R <= summary.limit415c` (`eff415cLimit`).
7. **Always use `addMonths()` / month-end clamping for date arithmetic:** `new Date(y, m, d)` silently overflows Feb 29 → Mar 1 or Nov 31 → Dec 1. Use `parseISODate()` (local date, never `new Date("YYYY-MM-DD")` which parses as UTC and shifts by a day in US timezones!).
8. **Use `.oninput = ...` (not `addEventListener`) in `populateScalarBindings()` and list builders:** `populateAllControls()` is called repeatedly on Reset, Import, Load, Undo, and Maximize Apply.
9. **Keep `focusField()` and `validateInputs()` IDs in sync:** Any new validation error/warning ID must exist in the DOM (and `focusField()` handles opening both `<details>` and `.panel.collapsed`).
10. **Keep `saveState()` / `flushSaveState()` and `recalcAndRender()` / `recalcAndRenderNow()` semantics clear:** Use `recalcAndRender()` for live typing (rAF-coalesced + debounced save & history); use `recalcAndRenderNow()` + `flushSaveState()` + `pushHistory()` for discrete state transitions (`init`, `replaceState`, undo/redo, row add/delete).
11. **Don't break the `test.js` extraction hook:** `test.js` locates `'document.addEventListener("DOMContentLoaded", init);'` inside the `<script>` tag to inject its export shim. Keep that line intact at the end of the IIFE.

---

## 9. Common Change Cookbooks

### Updating for a New Tax Year
1. Follow the checklist comment above `defaultTaxTables()` in `paycheck_calculator.html`:
   - Bump `TAX_YEAR` and `defaultTaxTables().taxYear`.
   - Update all IRS/SSA figures in `defaultTaxTables()` (brackets, standard deductions, age-65/senior deductions, HSA/FSA/401(k)/catch-up/§415(c)/Roth-catch-up limits, SS wage base).
   - Update default year dates in `defaultInputs()` (`firstPayDate`, `esppStart`, `rsuVests`, `bonuses`).
2. Re-baseline the expected 2027 dollar assertions in [test.js](test.js) and [CLAUDE.md](CLAUDE.md) (and only during a tax-year update).
3. Run `test.js` and verify `updateToCurrentTaxYear()` shifts a prior-year save cleanly.

### Adding a New Input Field
1. Add the default to `defaultInputs()` (and if renamed/moved, add a migration in `normalizeState()`).
2. Add the HTML control in `.inputs-col` (`.field` + `<label>` + `<input id="in-...">`; `associateLabels()` wires `for`/`id` automatically).
3. Register it in `SCALAR_BINDINGS` (and add its ID to `NOT_MONEY` if it's a count rather than dollars).
4. Add validation rules in `validateInputs()`.
5. If it can change mid-year, add it to `CHANGEABLE` and read it via `ei.<field>` in `buildRow()`.
6. Add a regression test in [test.js](test.js).

### Adding a New Deduction or Tax Column
1. Compute it in `buildRow()` (and `computePayoutRow()` / `computeRsuVest()` if applicable), include it in `V` / `Y` / `AI` / `AO` as appropriate, and add its YTD accumulator to `prev`, `milestonesBetween()`, and `MILESTONES`.
2. If reducible on short checks, insert its key in the right priority slot of `CUT_ORDER` and `CUT_LABELS`.
3. Expose totals in `summary`, add a line in `renderSummary()`, add a column in `DETAIL_COLS` (with `onlyIf` if optional), and include it in the appropriate `PAYCHECK_SERIES` bucket so bars still sum to `C`.
4. Verify the row accounting invariant in [test.js](test.js) still holds.
