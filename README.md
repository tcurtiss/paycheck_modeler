# Paycheck Calculator

A single-file, in-browser model of a full-year biweekly paycheck. Nothing is sent anywhere: all calculation happens client-side, and there is no server, build step, or dependencies.

## Usage

Open `paycheck_calculator.html` directly in a browser (a `file://` URL works). Edit the inputs on the left; everything on the right updates on every change. Inputs are saved in your browser's `localStorage`. Under "Scenario" you can export the inputs to a `.json` file, import one, or reset to the built-in example (each of those can be undone). Invalid inputs are listed above the results, which dim until they're fixed.

Blue fields are your own information. Yellow fields are IRS/reference figures, editable under "Tax Year Settings (Advanced)" if a figure changes.

## What it models

- **Compensation:** annual salary, filing status, age, state/local tax rate (optionally taxing 401(k) deferrals or HSA contributions, as PA, CA and NJ do), and the full Form W-4 (Step 2 checkbox, Step 3 credits, Step 4(a)–(c))
- **Cash bonuses:** any number of dated bonuses, each its own off-cycle check, with shared NQDC/401(k)/after-tax percentages and either the flat supplemental rate (default) or aggregate withholding
- **401(k):** traditional, Roth, catch-up (including the age 60–63 "super" limit, with the Roth-only rule applied automatically from prior-year wages), after-tax with optional spillover, and a tiered employer match
- **Other deductions:** NQDC deferral, HSA (capped at the IRS limit, net of any employer contribution), health and dependent-care FSAs (capped), pre-tax insurance, ESPP (capped per offering period and by the IRS $25,000 annual purchase limit, counted by purchase date), and other post-tax items
- **Changes during the year:** a raise or new election (401(k), after-tax, HSA, FSA, ESPP, insurance, extra withholding) effective from any date
- **State payroll taxes:** a state disability / family-leave tax (like CA SDI) with an optional wage cap
- **Plan rules:** the 401(k) plan's maximum percentage (traditional + Roth + after-tax) and allowed election steps, and the same for ESPP; elections outside them get a warning
- **RSUs:** any number of vests, withheld at flat supplemental rates
- **NQDC payouts:** distribution elections (fixed amount, annual date, number of years); payments landing in the model year are withheld as supplemental wages plus state, with no FICA
- **Taxes:** federal withholding, Social Security, Medicare, additional Medicare, and state. Bonuses, RSU vests and NQDC payouts share the $1M supplemental-wage threshold. The tax-at-filing estimate includes the age-65 additional standard deduction and the 2025–2028 senior deduction.

Pay is biweekly: 26 checks, or 27 when the year has 27 paydays (salary ÷ 26 per check, or spread ÷ 27). Bonuses, RSU vests and payouts are placed among the checks by date. Other pay frequencies aren't supported.

## Outputs

- **At a Glance:** take-home pay, typical paycheck (and the dates it changes), amount saved, effective tax rate, and estimated tax due or refund at filing. Pin a baseline to compare a change against.
- **Maximize…:** works out the 401(k), after-tax 401(k), HSA, FSA and ESPP elections that reach each annual limit, either spread evenly over the year (default) or as soon as possible while keeping a minimum take-home per check, for the whole year or starting from a chosen payday. It previews the new elections and their effect on take-home, savings, match and tax before applying (undoable). Each capped field also has its own "Max" shortcut.
- **Scenarios:** save named scenarios in the browser, load them, and compare one side by side with the current inputs. A slim bar at the bottom of the window keeps the key results in view while you edit.
- **Where Each Paycheck Goes:** a stacked bar per check splitting gross pay into taxes, retirement, NQDC, ESPP/other, and take-home
- **Annual Summary cards:** annual paycheck breakdown, a tax-at-filing estimate, estimated W-2 boxes (including RSUs), retirement and HSA totals against their limits, bonuses, RSU vests, NQDC payouts, ESPP, and total withholding
- **Paycheck-by-paycheck table:** Compact, Standard or All columns, grouped in the order deductions come out of gross pay, with a sticky header and Period/Date columns, a Notes column marking when limits are reached or deductions were reduced, and CSV download. Clicking a bar in either chart jumps to that check's row.
- **Cumulative 401(k) and HSA chart,** hatched once a source reaches its annual limit

## Updating for a new tax year

Tax constants (brackets, standard deductions, contribution limits, payroll tax figures, supplemental rates) live in `defaultTaxTables()` in the script, with a comment block listing everything to update, including `TAX_YEAR` and the default dates in `defaultInputs()`. They can also be edited live under "Tax Year Settings". Returning visitors whose saved settings are from an older year get a one-click prompt to update.

## Development

See [CLAUDE.md](CLAUDE.md) for the architecture and the workflow for checking calculation changes.

## Disclaimer

This is a planning model, not tax or financial advice. Actual withholding depends on your employer's payroll system and your full tax situation.
