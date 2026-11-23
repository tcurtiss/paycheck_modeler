# Paycheck Modeling Calculator

A single-file, in-browser calculator that models a full year of biweekly paychecks — take-home pay, 401(k) (Traditional, Roth, catch-up, after-tax, and employer match), NQDC deferrals and payouts, HSA, FSAs, ESPP, RSU vests, cash bonuses, and federal, FICA, state, and state disability/family-leave withholding.

Everything runs locally in your browser. There is no server, no account, no build step, and nothing you enter is sent anywhere.

---

## Getting Started

1. **Open the app:** Double-click `paycheck_calculator.html` (or open it directly via a `file://` URL in Chrome, Safari, Edge, or Firefox).
2. **Edit your inputs on the left:** Results on the right recalculate automatically as you type.
   - **Blue fields** are your personal pay, deduction, and plan settings.
   - **Yellow fields** (under **Tax Year Settings (Advanced)**) are IRS and Social Security figures for the model year (currently **2027**).
3. **Navigate quickly:**
   - Use the **pill bar** at the top of the inputs column to jump directly to any section (on small screens it also includes a **Results ↓** jump link).
   - Click any section heading to **collapse or expand** it (your collapsed sections are remembered).
   - While scrolled down through inputs, a slim **sticky summary bar** appears at the bottom of the window to keep headline numbers in view.
   - Use **Undo**, **Redo**, and **Theme: Auto / Light / Dark** in the top-right corner at any time.
4. **Auto-save & Privacy:** Inputs save automatically to your browser's `localStorage` by default. If you share a browser profile (note that Chrome shares one `localStorage` area across all local `file://` pages), uncheck **Auto-save inputs in this browser** under **Scenario** to turn auto-save off and clear stored inputs.

---

## Entering Your Information

### Compensation
- **Filing status & State taxes:** Choose your federal filing status and enter your flat state + local income tax rate. Toggle whether your state taxes Traditional 401(k) deferrals (e.g., PA) or HSA contributions (e.g., CA, NJ). If your state has a disability or paid family-leave payroll tax (e.g., CA SDI), enter the rate, optional annual wage cap (`0` = uncapped), and whether SDI/leave also taxes HSA contributions (e.g., CA).
- **Salary & Pay schedule:** Enter your annual salary and the **first pay date of the year**. Pay is modeled biweekly (every 14 days) — 26 checks normally, or **27 checks** when the calendar has 27 biweekly paydays (in which case you can choose whether each check is `salary ÷ 26` or `salary ÷ 27`).
- **Ages:** Employee age (as of Dec 31) determines 401(k) catch-up eligibility (50–59 / 64+, or the 60–63 "super" catch-up), HSA age 55+ catch-up, and age 65+ filing deductions. For Married Filing Jointly, spouse's age is also used for age 65+ deductions in the tax-at-filing estimate.
- **Cash bonuses:** Add any number of dated bonuses. Each bonus is modeled as its own off-cycle paycheck with shared NQDC, 401(k), and after-tax percentages and either **Flat rate** (default supplemental withholding, 22% up to $1M cumulative / 37% above) or **Aggregate** withholding.
- **Form W-4:** Supports Step 2(c) (multiple jobs checkbox), Step 3 (annual credits), Step 4(a) (other income), Step 4(b) (extra deductions), and Step 4(c) (extra federal withholding per check). Steps 3, 4(a), and 4(b) also feed into the tax-at-filing estimate.

### Deductions per Paycheck
- **NQDC deferral:** Percentage of gross pay deferred (pre-tax for federal/state; subject to FICA at deferral).
- **HSA:** Coverage type (Self-only or Family), per-paycheck employee contribution, and any annual employer/wellness contribution. Employee contributions stop automatically when the IRS limit (including the age 55+ catch-up) is reached.
- **Pre-tax insurance & FSAs:** Per-paycheck pre-tax health/dental/vision premiums, Health FSA, and Dependent-care FSA (automatically capped at the annual IRS limits, halved for Married Filing Separately on dependent-care FSA).
- **Other post-tax deductions:** Any fixed per-check post-tax amount (e.g., supplemental life or legal insurance).

### 401(k)
- **Employee elections:** Traditional, Roth, and After-tax percentages of `(gross − NQDC)`. Regular deferrals stop at the IRS elective limit, roll into age 50+ catch-up if eligible, and optionally **spill over** into after-tax 401(k) up to the §415(c) annual additions limit.
- **Plan rules:** Set your plan's combined maximum percentage (Traditional + Roth + after-tax) and allowed step size (`1%`, `0.1%`, or `0.01%`). Elections outside these rules trigger a warning and are respected by the **Maximize…** planner.
- **Roth catch-up rule:** Set to **Auto** to apply the SECURE 2.0 rule automatically based on your prior-year Social Security wages from this employer, or override with **Yes** / **No**.
- **Employer match (tiered):** Expand **Employer match (tiered)** to configure up to four cumulative dollar-width brackets and match rates (applied to combined Traditional + Roth regular and catch-up contributions, capped by §415(c)).

### Employee Stock Purchase Plan (ESPP)
- Enter your contribution percentage of gross pay, offering-period dollar cap, offering-period length (1–27 months), offering start date, plan max/step, and purchase discount (up to 15%).
- Contributions stop at the offering-period cap and at the IRS §423 `$25,000` annual purchase limit (counted by offering periods whose purchase date falls in the model year).

### RSU Vesting Schedule & NQDC Payouts
- **RSU vests:** Add dated vests within the model year. Each vest is taxed at flat supplemental federal rates (sharing the `$1M` cumulative threshold with bonuses and NQDC payouts), plus FICA, state, and SDI, with no paycheck deductions.
- **NQDC payouts (distributions):** Add one row per distribution election (amount per payment, first payment date, and number of annual installments). Payments landing in the model year appear as off-cycle rows withheld at supplemental federal + state rates, with no FICA.

### Changes During the Year
- Model a mid-year raise or a new 401(k), after-tax, HSA, FSA, ESPP, insurance, or extra-withholding election starting from any effective date. Rows sort chronologically when you finish editing a date, and every paycheck on or after that date uses the new value.

### Tax Year Settings (Advanced)
- Expand this section if any IRS or SSA constant changes (supplemental rates, FICA wage base/rates, 401(k)/HSA/FSA/ESPP limits, standard deductions, age 65+ / senior deductions, or federal brackets).
- The chip next to the page title shows **`Tax year 2027`** (or **`Tax year 2027 (edited)`** if you customize any figure). Click **Restore built-in 2027 figures** inside Tax Year Settings to revert.
- If you return with saved data from an older tax year, a banner offers a one-click **Update to 2027** (which refreshes IRS figures and shifts your pay, ESPP, RSU, bonus, and mid-year change dates forward while keeping amounts and elections) or **Keep my figures**.

---

## Using the Planning Tools

### At a Glance & Pinning a Baseline
- The top tiles show **Take-home pay**, **Typical paycheck** (median regular check + range), **Saved this year**, **Effective tax rate** (as % of W-2 wages, with % of total gross in the subtitle), and **Federal tax at filing** (estimated balance due or refund, with a per-check W-4 Step 4(c) suggestion if you owe — divided across remaining checks when partway through the year).
- Below the tiles, **Take-home changes when** lists the exact dates your paycheck changes as you hit Social Security, Additional Medicare, 401(k), HSA, FSA, SDI, or ESPP thresholds — click any pill to jump straight to that paycheck or RSU card.
- Click **Pin as baseline** before experimenting with an input — every tile then shows `▲ / ▼` deltas against your pinned snapshot.

### Maximize… (Contribution Optimizer)
Click **Maximize…** under At a Glance (or click the **Max** button next to any capped input) to calculate the exact elections needed to reach annual caps for **401(k)**, **After-tax 401(k)**, **HSA**, **ESPP**, **Health FSA**, and **Dependent-care FSA**:
- **Spread evenly:** Finds the smallest elections that still reach each limit by year-end (or offering-period end).
- **As soon as possible:** Reaches every selected limit first, then front-loads 401(k) → after-tax → ESPP as far as your plan maximum and take-home floor allow (HSA and FSAs remain evenly spread).
- **Start date:** Optimize for the **whole year** (replacing base elections and clearing older mid-year changes on those fields) or **starting from a chosen payday** (adding dated entries under Changes During the Year so past checks stay untouched).
- **Take-home floor:** Keep at least a minimum dollar take-home on every affected regular paycheck.
- Review the live preview of election changes, any mid-year changes that will be removed, and cash-flow impact before clicking **Apply changes** (which can be undone with one click).

### Scenarios, Export, Import & Undo
Under **Scenario** (bottom of the inputs column):
- **Save scenario:** Save named snapshots in your browser (saving with an existing name updates it).
- **Load / Compare / Export / Delete:** Load a saved scenario, compare it **side by side** against your current inputs in the At a Glance panel, or export it as `.json`.
- **Export / Import scenario:** Save your current inputs and tax settings to a `.json` file for backup or sharing across browsers/devices.
- **Reset to example:** Restores the built-in example inputs.
- **Undo & Redo:** Multi-level **Undo** and **Redo** buttons in the header and under **Scenario** (plus `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, and `Ctrl+Y` outside text fields) work for ordinary edits as well as Reset, Import, Load, Maximize, and Tax-Year Update.
- **Auto-save toggle:** Uncheck **Auto-save inputs in this browser** to keep your data strictly in memory and erase any previously stored inputs from `localStorage`.

---

## Reading the Charts, Summary & Detail Table

- **Where Each Paycheck Goes:** Stacked bar chart of every check's gross pay (including bonuses and NQDC payouts, with a **Regular checks only** toggle to hide bonus/payout spikes), split into taxes, retirement, NQDC, ESPP/other, and take-home pay (hatched on top). Diamonds (`◆`) mark checks where a limit or wage base is reached.
- **Cumulative 401(k) & HSA Through the Year:** Stacked running total of each 401(k) source, employer match, and HSA. Segments switch to a **hatched fill** once that source hits its annual limit.
- **Chart interaction:** Hover over any bar — or Tab into a chart and use **Left / Right / Home / End** arrow keys — to inspect exact dollar breakdowns. Click (or press Enter/Space; on touch screens, tap once to preview and tap again to jump) to scroll straight to that paycheck in the detail table.
- **Annual Summary cards:** Full-year paycheck breakdown, federal tax-at-filing estimate, estimated **W-2 boxes** (Boxes 1–6, 10, 11, 12 D/AA/W, 14, 16, 17), Retirement/HSA/FSA limits, Bonuses, RSU vests, NQDC payouts, ESPP purchases, and Total Tax Withheld.
- **Paycheck-by-Paycheck Detail:**
  - Switch between **Compact** (high-level overview), **Standard** (essential columns), and **All columns** (every intermediate calculation).
  - The **Notes** column flags milestones and any **`⚠ Reduced`** cuts (when a check's gross pay after taxes can't cover every elected deduction, deductions are automatically trimmed in priority order so net pay never goes negative).
  - Click **Download CSV** to export every column and note to a spreadsheet, or use your browser's **Print** dialog for a clean print layout.

---

## Validation Messages

- **⛔ Red errors** block recalculation (results dim while staying visible) until fixed. Click any error message to jump directly to — and automatically expand — the section containing that field.
- **⚠ Yellow warnings** highlight potential issues (such as exceeding plan max %, off-step elections, over-electing HSA/FSA, dates outside the model year, or early after-tax contributions filling §415(c) and cutting off regular 401(k) and employer match) without blocking results.

---

## Scope & Disclaimer

**Not modeled:** non-biweekly pay frequencies (weekly, semi-monthly, monthly), progressive state income tax brackets, state-specific rules for NQDC payouts after moving states, capital gains/AMT on ESPP or RSU sales, itemized deductions/credits beyond W-4 entries, or spouse income on joint returns.

This is a personal planning model, **not tax or financial advice**. Always verify against your actual pay stubs, plan documents, and a qualified tax professional.

---

## Development

See [DESIGN.md](DESIGN.md) for the full technical design, calculation rules, invariants, and landmines, and [CLAUDE.md](CLAUDE.md) for quick developer/agent workflow instructions and running `test.js`.
