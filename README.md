# Paycheck Calculator

A single-file, in-browser model of a full-year biweekly paycheck. Nothing is sent anywhere: all calculation happens client-side, and there is no server, build step, or dependencies.

## Usage

Open `paycheck_calculator.html` directly in a browser (a `file://` URL works). Edit the inputs on the left; the summary, paycheck-by-paycheck table, and contribution chart on the right update on every change. Inputs are saved in your browser's `localStorage`, and "Reset to Example" restores the defaults.

Blue fields are your own information. Yellow fields are IRS/reference figures, editable under "Tax Year Settings (Advanced)" if a figure changes.

## What it models

- **Compensation:** annual salary, filing status, age, state/local tax rate, a year-end cash bonus (with its own NQDC and 401(k) percentages), and extra W-4 withholding
- **401(k):** traditional, Roth, catch-up (including the age 60–63 "super" limit and a Roth-only catch-up option), after-tax with optional spillover, and a tiered employer match
- **Other deductions:** NQDC deferral, HSA (plus employer contribution), pre-tax insurance, ESPP, and other post-tax items
- **RSUs:** quarterly vesting as off-cycle checks at flat supplemental withholding rates
- **Taxes:** federal withholding, Social Security, Medicare, additional Medicare, and state

The model assumes 26 biweekly pay periods: 25 regular checks, an off-cycle bonus check, then the final regular check. Other pay frequencies aren't supported.

## Outputs

- A summary of annual totals
- A per-paycheck detail table, grouped in the order deductions come out of gross pay. It shows essential columns by default; use "Show all columns" for the rest. The catch-up columns appear only when catch-up is contributed.
- A stacked chart of cumulative 401(k) and HSA contributions, with a hashed fill once a source reaches its annual maximum

## Updating for a new tax year

Tax constants (brackets, standard deductions, contribution limits, payroll tax figures) live in `defaultTaxTables()` in the script, with a comment block listing everything to update, including the default dates in `defaultInputs()`. Most limits can also be edited live in the app.

## Development

See [CLAUDE.md](CLAUDE.md) for the architecture and the workflow for checking calculation changes.

## Disclaimer

This is a planning model, not tax or financial advice. Actual withholding depends on your employer's payroll system and your full tax situation.
