#!/usr/bin/env node
// Zero-dependency verification suite for paycheck_calculator.html.
// Runs under either Node.js (`node test.js`) or macOS built-in JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc test.js

const isNode = typeof require === "function" && typeof process !== "undefined";
const log = isNode ? console.log.bind(console) : print;
const failExit = () => {
  if (isNode) process.exit(1);
  throw new Error("Test suite failed");
};

const html = isNode
  ? require("fs").readFileSync("paycheck_calculator.html", "utf8")
  : readFile("paycheck_calculator.html");

const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  log("FAIL: Could not find <script> block in paycheck_calculator.html");
  failExit();
}

const injected = match[1].replace(
  'document.addEventListener("DOMContentLoaded", init);',
  `globalThis.__PAYCALC = {
    TAX_YEAR, PAY_PERIODS, EPS, SCHEMA_VERSION,
    defaultInputs, defaultTaxTables,
    computeAll, validateInputs, normalizeState, planMaximize,
    nqdcPayoutOccurrences, detailCSV, paydaysInYear, addMonths,
    taxIsModified, isNewerSchema, electionAt,
    getState: () => state,
    setState: s => { state = s; },
    updateToCurrentTaxYear,
  };`
);

// Syntax + load check
new Function(injected)();
const pc = globalThis.__PAYCALC;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertClose(actual, expected, msg, tol = 0.01) {
  if (typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}
function test(name, fn) {
  try {
    fn();
    passed++;
    log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function checkRowInvariants(res, tax, label) {
  const lim415 = res.summary.limit415c;
  for (const r of res.rows) {
    const deductions = r.F + r.G + r.K + r.L + r.Q + r.S + r.T + r.U + r.AU + r.AV + r.AJ + r.AM;
    const expectedNet = r.C - deductions - r.AI;
    assertClose(r.AO, expectedNet, `${label} row ${r.label} net pay identity`, 0.01);
    assert(r.AO >= -0.01, `${label} row ${r.label} negative net AO=${r.AO}`);
    assert(r.R <= lim415 + 0.01, `${label} row ${r.label} §415(c) R=${r.R} exceeded ${lim415}`);
    assert(r.H <= tax.electiveLimit + 0.01, `${label} row ${r.label} 402(g) H=${r.H} exceeded ${tax.electiveLimit}`);
    for (const k of ["C", "F", "G", "K", "L", "O", "Q", "R", "S", "T", "U", "AU", "AV", "AI", "AO", "AC", "AM"]) {
      assert(Number.isFinite(r[k]), `${label} row ${r.label} ${k} is not finite (${r[k]})`);
      assert(r[k] >= -1e-6, `${label} row ${r.label} ${k} negative (${r[k]})`);
    }
    // Paycheck chart buckets sum to gross pay C
    const chartSum = r.AI + (r.F + r.G + r.K + r.L + r.Q + r.T) + r.S + (r.AM + r.U + r.AU + r.AV + r.AJ) + r.AO;
    assertClose(chartSum, r.C, `${label} row ${r.label} chart sum`, 0.01);
  }
}

// 1. 2027 Baseline (Flat & Aggregate)
test("2027 baseline (Flat bonus withholding)", () => {
  const inp = pc.defaultInputs();
  const tax = pc.defaultTaxTables();
  const v = pc.validateInputs(inp, tax);
  assert(v.errors.length === 0, `unexpected errors: ${JSON.stringify(v.errors)}`);
  const res = pc.computeAll(inp, tax);
  assertClose(res.summary.grossPay, 270000.00, "grossPay");
  assertClose(res.summary.netPay, 83648.96, "netPay");
  assertClose(res.summary.totalMatch, 6225.00, "totalMatch");
  const bonusRow = res.rows.find(r => r.isBonus);
  assert(bonusRow && bonusRow.deductionCuts, "expected cut on bonus row");
  assertClose(bonusRow.deductionCuts.Q, 2750.00, "bonus after-tax cut");
  checkRowInvariants(res, tax, "baseline-flat");
});

test("2027 baseline (Aggregate bonus withholding)", () => {
  const inp = pc.defaultInputs();
  inp.bonusWithholding = "Aggregate";
  const tax = pc.defaultTaxTables();
  const res = pc.computeAll(inp, tax);
  assertClose(res.summary.netPay, 83648.96, "netPay");
  const bonusRow = res.rows.find(r => r.isBonus);
  assertClose(bonusRow.deductionCuts.Q, 4021.37, "bonus after-tax cut (aggregate)");
  checkRowInvariants(res, tax, "baseline-agg");
});

// 2. §415(c) ceiling enforced on regular 401(k), match, and 100% compensation cap
test("§415(c) ceiling caps regular 401(k) and employer match & reports crowding date", () => {
  const inp = pc.defaultInputs();
  inp.bonuses = [{ amount: 100000, date: "2027-02-01" }];
  inp.bonusAfterTaxPct = 0.70;
  inp.trad401kPct = 0.10;
  const tax = pc.defaultTaxTables();
  const res = pc.computeAll(inp, tax);
  assert(res.summary.room415cRemaining >= -0.01, `room415cRemaining negative: ${res.summary.room415cRemaining}`);
  assertClose(res.summary.totalTradRoth + res.summary.totalMatch + res.summary.afterTax401k, tax.limit415c, "total 415(c) additions");
  assert(res.summary.s415cCrowdDate !== null, "expected s415cCrowdDate to be set when 401(k)/match is cut off");
  checkRowInvariants(res, tax, "415c-cap");
});

test("§415(c) respects 100% of compensation cap for lower earners", () => {
  const inp = pc.defaultInputs();
  inp.annualSalary = 40000;
  inp.nqdcPct = 0;
  inp.bonuses = [];
  inp.rsuVests = [];
  inp.trad401kPct = 0.50;
  inp.afterTax401kPct = 0.35;
  inp.hsaPerPaycheck = 0;
  inp.esppPct = 0;
  inp.otherPostTax = 0;
  const tax = pc.defaultTaxTables();
  const res = pc.computeAll(inp, tax);
  assertClose(res.summary.limit415c, 40000, "effective §415(c) limit should cap at 100% of compensation");
  checkRowInvariants(res, tax, "415c-100pct");
});

// 3. CUT_ORDER does not resurrect exhausted Q when later G/F is cut
test("CUT_ORDER keeps exhausted Q at $0 when G is later cut", () => {
  const inp = pc.defaultInputs();
  inp.annualSalary = 100000;
  inp.nqdcPct = 0;
  inp.trad401kPct = 0;
  inp.roth401kPct = 0.90;
  inp.afterTax401kPct = 0.30;
  inp.esppPct = 0;
  inp.hsaPerPaycheck = 0;
  inp.otherPostTax = 0;
  inp.bonuses = [];
  const tax = pc.defaultTaxTables();
  tax.limit415c = 6000;
  const res = pc.computeAll(inp, tax);
  const r0 = res.rows[0];
  assertClose(r0.Q, 0, "Q should stay at 0 after being cut");
  assertClose(r0.AO, 0, "AO should floor at 0");
  assert(r0.deductionCuts && r0.deductionCuts.Q > 0 && r0.deductionCuts.G > 0, "both Q and G should be recorded in deductionCuts");
  checkRowInvariants(res, tax, "cut-order-q");
});

// 4. Maximize tests (high initial after-tax, fromDate Bug A, asap Bug B, removedChanges Bug F)
test("planMaximize handles high initial after-tax without starving 401(k)", () => {
  const inp = pc.defaultInputs();
  inp.nqdcPct = 0;
  inp.trad401kPct = 0.05;
  inp.afterTax401kPct = 0.80;
  inp.bonuses = [];
  const tax = pc.defaultTaxTables();
  const plan = pc.planMaximize(inp, tax, {
    items: { k401: true, afterTax: true, hsa: false, healthFsa: false, dcFsa: false, espp: false },
    strategy: "even", minNet: 0, newSplit: "Traditional", from: ""
  });
  const k401 = plan.items.find(i => i.item === "k401");
  const at = plan.items.find(i => i.item === "afterTax");
  assert(k401.status === "ok", `expected k401 ok, got ${k401.status}`);
  assertClose(k401.achieved, tax.electiveLimit, "k401 achieved");
  assert(at.status === "ok", `expected afterTax ok, got ${at.status}`);
  assertClose(at.achieved, tax.limit415c, "afterTax achieved");
  assert(plan.after.summary.totalMatch > 0, "match should be captured");
});

test("planMaximize with fromDate does not restore old after-tax % when solved to 0%", () => {
  const inp = pc.defaultInputs();
  inp.trad401kPct = 0.06;
  inp.afterTax401kPct = 0.42;
  const tax = pc.defaultTaxTables();
  const plan = pc.planMaximize(inp, tax, {
    items: { hsa: true, healthFsa: false, dcFsa: false, k401: true, afterTax: true, espp: true },
    strategy: "even", minNet: 1500, newSplit: "Traditional", from: "2027-06-18"
  });
  const v = pc.validateInputs(plan.inputs, tax);
  const planWarn = v.warnings.filter(w => /plan's .* maximum/.test(w.msg));
  assert(planWarn.length === 0, `unexpected plan-max warning: ${JSON.stringify(planWarn)}`);
  const d = new Date(2027, 5, 18);
  const tot401 = pc.electionAt(plan.inputs, "trad401kPct", d) + pc.electionAt(plan.inputs, "roth401kPct", d) + pc.electionAt(plan.inputs, "afterTax401kPct", d);
  assert(tot401 <= inp.plan401kMaxPct + 1e-9, `combined 401k ${tot401} exceeded plan max ${inp.plan401kMaxPct}`);
});

test("planMaximize asap with fromDate never lets after-tax crowd out 401(k) or match", () => {
  const inp = pc.defaultInputs();
  inp.annualSalary = 249000;
  inp.nqdcPct = 0.1;
  const tax = pc.defaultTaxTables();
  const plan = pc.planMaximize(inp, tax, {
    items: { hsa: true, healthFsa: false, dcFsa: false, k401: true, afterTax: true, espp: false },
    strategy: "asap", minNet: 1500, newSplit: "Traditional", from: "2027-06-18"
  });
  const k401 = plan.items.find(i => i.item === "k401");
  assert(k401.status !== "ok" || k401.achieved >= tax.electiveLimit - 0.01,
    `k401 reported ok but only achieved ${k401.achieved}`);
  assertClose(k401.achieved, tax.electiveLimit, "k401 should reach full elective limit");
  assertClose(plan.after.summary.totalMatch, plan.after.summary.maxPossibleMatchThisYear, "match should not be crowded out");
});

test("planMaximize whole-year clears stale mid-year changes and reports removedChanges", () => {
  const inp = pc.defaultInputs();
  inp.changes = [
    { date: "2027-07-01", field: "trad401kPct", value: 0.01 },
    { date: "2027-07-01", field: "annualSalary", value: 260000 },
  ];
  const plan = pc.planMaximize(inp, pc.defaultTaxTables(), {
    items: { k401: true, afterTax: false, hsa: false, healthFsa: false, dcFsa: false, espp: false },
    strategy: "even", minNet: 0, newSplit: "Traditional", from: ""
  });
  assert(!plan.inputs.changes.some(c => c.field === "trad401kPct"), "trad401kPct change should be cleared");
  assert(plan.inputs.changes.some(c => c.field === "annualSalary"), "unrelated annualSalary change should remain");
  assert(plan.removedChanges.length === 1 && plan.removedChanges[0].field === "trad401kPct", "removedChanges should list dropped change");
});

// 5. 27-payday year (Extra & Spread) and mid-year HSA change validation
test("27-payday year HSA warning uses 27 checks & Spread divides salary by 27", () => {
  const inp = pc.defaultInputs();
  inp.firstPayDate = "2027-01-01";
  inp.hsaPerPaycheck = 340;
  inp.bonuses = [];
  const tax = pc.defaultTaxTables();
  const v = pc.validateInputs(inp, tax);
  assert(v.warnings.some(w => w.id === "in-hsaPerPaycheck"), "expected HSA over-limit warning for 27 checks");
  inp.extraPayday = "Extra";
  const resExtra = pc.computeAll(inp, tax);
  assert(resExtra.summary.regularChecks === 27, "expected 27 regularChecks");
  assertClose(resExtra.summary.grossPay, 250000 * 27 / 26, "Extra grossPay");
  inp.extraPayday = "Spread";
  const resSpread = pc.computeAll(inp, tax);
  assertClose(resSpread.summary.grossPay, 250000, "Spread grossPay equals annualSalary");
  assertClose(resSpread.summary.hsaAnnual, 9000, "HSA capped at 9000");
  checkRowInvariants(resSpread, tax, "27-payday-spread");
});

test("HSA over-limit warning respects mid-year HSA change", () => {
  const inp = pc.defaultInputs();
  inp.hsaPerPaycheck = 200; // $5,200/yr alone
  inp.changes = [{ date: "2027-05-01", field: "hsaPerPaycheck", value: 600 }]; // pushes over $9,000
  const v = pc.validateInputs(inp, pc.defaultTaxTables());
  assert(v.warnings.some(w => w.id === "in-hsaPerPaycheck"), "expected HSA warning when mid-year change pushes annual election over limit");
});

// 6. ESPP offering crossing Dec 31
test("ESPP offering crossing Dec 31 does not consume current year IRS $25k limit", () => {
  const inp = pc.defaultInputs();
  inp.esppStart = "2027-03-01"; // periods: Mar 1-Aug 31 (purchased Aug 31 2027) and Sep 1-Feb 29 2028 (purchased 2028!)
  inp.esppMonths = 6;
  inp.esppCap = 10625;
  inp.esppPct = 0.15;
  inp.bonuses = [];
  const res = pc.computeAll(inp, pc.defaultTaxTables());
  // Period 0 (Jan-Feb 2027, purchased Feb 28 2027) + Period 1 (Mar-Aug 2027, purchased Aug 31 2027) + Period 2 (Sep-Dec 2027, purchased Feb 2028)
  assert(res.summary.esppPeriodsThisYear < res.summary.esppOfferingPeriods, "expected an offering period purchasing next year");
  assert(res.summary.esppTotal > res.summary.esppAnnualCap - 1000, "contributions toward next year's purchase should not be blocked by this year's IRS cap");
  checkRowInvariants(res, pc.defaultTaxTables(), "espp-straddle");
});

// 7. Automatic Roth catch-up (age 50-59 vs 60-63 super catch-up)
test("Auto Roth catch-up rule and age 60-63 super catch-up limit", () => {
  const tax = pc.defaultTaxTables();
  const inp = pc.defaultInputs();
  inp.employeeAge = 61;
  inp.nqdcPct = 0;
  inp.trad401kPct = 0.30;
  inp.roth401kPct = 0;
  inp.catchupRoth = "Auto";
  inp.priorYearFicaWages = tax.rothCatchupWageThreshold + 1000;
  const resHigh = pc.computeAll(inp, tax);
  assert(resHigh.summary.catchupMustBeRoth === true, "expected Roth catch-up above prior-year threshold");
  assertClose(resHigh.summary.catchupRoth, tax.catchup6063, "super catch-up Roth amount");
  assertClose(resHigh.summary.catchupTrad, 0, "no Traditional catch-up when forced Roth");

  inp.priorYearFicaWages = tax.rothCatchupWageThreshold - 1000;
  const resLow = pc.computeAll(inp, tax);
  assert(resLow.summary.catchupMustBeRoth === false, "expected Traditional catch-up at/below threshold");
  assertClose(resLow.summary.catchupTrad, tax.catchup6063, "super catch-up Traditional amount");
});

// 8. W-4 Step 2(c) multiple-jobs checkbox increases withholding
test("W-4 Step 2(c) multiple-jobs checkbox uses half standard deduction and brackets", () => {
  const tax = pc.defaultTaxTables();
  const inp = pc.defaultInputs();
  inp.bonuses = [];
  inp.w4MultipleJobs = false;
  const rOff = pc.computeAll(inp, tax);
  inp.w4MultipleJobs = true;
  const rOn = pc.computeAll(inp, tax);
  assert(rOn.summary.fedBase > rOff.summary.fedBase + 5000, "Step 2(c) checkbox should substantially increase federal withholding");
});

// 9. Crossing $1M cumulative supplemental wages + RSU crossing SS wage base
test("Supplemental wages over $1M switch to 37% and RSU vest tracks SS wage base", () => {
  const tax = pc.defaultTaxTables();
  const inp = pc.defaultInputs();
  inp.bonuses = [{ amount: 600000, date: "2027-02-15" }];
  inp.bonusAfterTaxPct = 0;
  inp.rsuVests = [{ value: 600000, date: "2027-03-02" }];
  const res = pc.computeAll(inp, tax);
  assert(res.summary.suppOver1M === true, "expected suppOver1M true");
  // $1M at 22% + $200k at 37%
  assertClose(res.summary.bonusFed + res.summary.rsuFed, 1000000 * tax.suppRate + 200000 * tax.suppRateHigh, "blended 22%/37% supplemental tax");
  // RSU vest crosses SS wage base? Bonus on Feb 15 is $600k > $192,300 so bonus crosses SS; test RSU crossing when no bonus:
  inp.bonuses = [];
  inp.rsuVests = [{ value: 250000, date: "2027-02-01" }];
  const res2 = pc.computeAll(inp, tax);
  assert(res2.rsuRows[0].milestones.includes("ss"), "RSU vest should record ss milestone");
  assertClose(res2.summary.totalSSAllSources, tax.ssWageBase * tax.ssRate, "total SS tax equals wage base * rate");
});

// 10. Feb 29 NQDC payout clamps to Feb 28 in non-leap year
test("NQDC payout on Feb 29 clamps to Feb 28 in non-leap year", () => {
  const occ = pc.nqdcPayoutOccurrences([{ amount: 10000, firstDate: "2024-02-29", years: 5 }], 2027);
  assert(occ.length === 1, "expected 1 occurrence");
  assert(occ[0].date.getMonth() === 1 && occ[0].date.getDate() === 28,
    `expected Feb 28, got ${occ[0].date.toISOString()}`);
});

// 11. normalizeState migrations, strict key stripping, nested tax validation, future schemaVersion
test("normalizeState migrates legacy saves, strips unknown keys, and flags future schema", () => {
  const legacy = {
    schemaVersion: pc.SCHEMA_VERSION + 5,
    inputs: {
      firstPayDate: "2026-01-09",
      bonusAmount: 15000,
      catchupMustBeRoth: true,
      matchBoundaries: [1000, 2000, 3000],
      electiveLimit: 24500,
      suppRateUnder1M: 0.22,
      staleUnknownInput: "drop-me",
    },
    tax: {
      ssWageBase: 184500,
      standardDeduction: { "Married Filing Jointly": "oops", "Single": null },
      hsaLimit: { "Family": NaN },
      brackets: { "Married Filing Jointly": [{ over: null, rate: "" }] },
      staleUnknownTax: 42,
    },
  };
  assert(pc.isNewerSchema(legacy) === true, "expected isNewerSchema true");
  const norm = pc.normalizeState(legacy);
  const dt = pc.defaultTaxTables();
  assert(!("staleUnknownInput" in norm.inputs), "stale input key should be stripped");
  assert(!("staleUnknownTax" in norm.tax), "stale tax key should be stripped");
  assert(norm.inputs.bonuses.length === 1 && norm.inputs.bonuses[0].amount === 15000, "bonusAmount should migrate to bonuses[]");
  assert(norm.inputs.catchupRoth === "Yes", "catchupMustBeRoth should migrate to catchupRoth");
  assert(norm.inputs.matchBracketWidths[0] === 1000, "matchBoundaries should migrate to matchBracketWidths");
  assert(norm.tax.electiveLimit === 24500, "moved electiveLimit should migrate into tax");
  assert(norm.tax.taxYear === 2026, `expected inferred taxYear 2026, got ${norm.tax.taxYear}`);
  assert(norm.tax.standardDeduction["Married Filing Jointly"] === dt.standardDeduction["Married Filing Jointly"], "stdDed MFJ fallback");
  assert(norm.tax.hsaLimit["Family"] === dt.hsaLimit["Family"], "hsaLimit Family fallback");
  assert(norm.tax.brackets["Married Filing Jointly"].length === dt.brackets["Married Filing Jointly"].length, "brackets MFJ fallback");
  const res = pc.computeAll(norm.inputs, norm.tax);
  assert(Number.isFinite(res.summary.fedBase) && res.summary.fedBase > 0, "fedBase should be finite and positive");
});

// 12. taxIsModified tolerance & stale-key immunity
test("taxIsModified ignores floating-point noise and detects real edits", () => {
  const t = pc.defaultTaxTables();
  assert(pc.taxIsModified(t) === false, "default tax tables should not be modified");
  t.medicareRate = 1.45 / 100;
  t.addlMedicareRate = 0.9 / 100;
  t.ssRate = 6.2 / 100;
  assert(pc.taxIsModified(t) === false, "re-typing exact % values should not trigger modified");
  t.electiveLimit += 500;
  assert(pc.taxIsModified(t) === true, "real edit should trigger modified");
});

// 13. updateToCurrentTaxYear shifts mid-year changes too
test("updateToCurrentTaxYear shifts mid-year changes into current tax year", () => {
  const old = { inputs: pc.defaultInputs(), tax: pc.defaultTaxTables() };
  old.inputs.firstPayDate = "2026-01-09";
  old.inputs.changes = [{ date: "2026-07-01", field: "annualSalary", value: 265000 }];
  old.tax.taxYear = 2026;
  pc.setState(old);
  pc.updateToCurrentTaxYear();
  const updated = pc.getState();
  assert(updated.inputs.changes[0].date === `${pc.TAX_YEAR}-07-01`,
    `expected ${pc.TAX_YEAR}-07-01, got ${updated.inputs.changes[0].date}`);
});

// 14. ESPP offeringPeriodsCovered ignores off-cycle bonuses
test("esppOfferingPeriodsCovered ignores bonus outside regular paycheck offering periods", () => {
  const inp = pc.defaultInputs();
  inp.firstPayDate = "2027-01-08";
  inp.esppStart = "2027-01-01";
  inp.esppMonths = 6;
  inp.bonuses = [{ amount: 5000, date: "2027-12-31" }];
  const res = pc.computeAll(inp, pc.defaultTaxTables());
  assert(res.summary.esppOfferingPeriodsCovered === res.summary.esppOfferingPeriods,
    `mismatch: covered=${res.summary.esppOfferingPeriodsCovered} vs periods=${res.summary.esppOfferingPeriods}`);
});

// 15. Validation targets real focusable inputs for match, brackets, and mid-year plan rules
test("validateInputs checks tax settings, match brackets, and mid-year plan rules with focusable IDs", () => {
  const inp = pc.defaultInputs();
  inp.matchBracketWidths = [-100, 1500, 7500];
  inp.changes = [{ date: "2027-07-01", field: "trad401kPct", value: 0.90 }];
  const tax = pc.defaultTaxTables();
  tax.ssRate = -0.05;
  tax.standardDeduction["Married Filing Jointly"] = -1;
  tax.brackets["Married Filing Jointly"][0].rate = 1.5;
  const v = pc.validateInputs(inp, tax);
  assert(v.errors.some(e => e.id === "match-w-0"), "expected match-w-0 error");
  assert(v.errors.some(e => e.id === "in-ssRate"), "expected ssRate error");
  assert(v.errors.some(e => e.id === "in-stdDedMFJ"), "expected stdDedMFJ error");
  assert(v.errors.some(e => e.id === "brk-MFJ-0-rate"), "expected brk-MFJ-0-rate error");
  assert(v.warnings.some(w => w.id === "chg-0-value"), "expected mid-year change plan-max warning");
});

// 16. Separate stateSdiTaxesHsa switch (independent of stateTaxesHsa)
test("state SDI taxes HSA only when stateSdiTaxesHsa is enabled (independent of stateTaxesHsa)", () => {
  const inp = pc.defaultInputs();
  inp.stateSdiRate = 0.012;
  inp.stateSdiWageCap = 0;
  inp.stateTaxesHsa = true;
  inp.stateSdiTaxesHsa = false;
  const resOff = pc.computeAll(inp, pc.defaultTaxTables());
  inp.stateSdiTaxesHsa = true;
  const resOn = pc.computeAll(inp, pc.defaultTaxTables());
  assertClose(resOn.summary.sdi - resOff.summary.sdi, resOn.summary.hsaAnnual * 0.012, "SDI difference equals HSA * SDI rate");
});

// 17. CSV content & RFC 4180 quoting verification
test("detailCSV generates valid RFC 4180 CSV with accurate headers, values, and quoted notes", () => {
  const res = pc.computeAll(pc.defaultInputs(), pc.defaultTaxTables());
  const csv = pc.detailCSV(res.rows);
  const lines = csv.trim().split("\r\n");
  assert(lines.length === res.rows.length + 1, `expected ${res.rows.length + 1} lines, got ${lines.length}`);
  assert(lines[0].startsWith("Period,Pay Date,Gross Pay,"), `unexpected header: ${lines[0].slice(0, 40)}`);
  assert(lines[0].endsWith(",Notes"), "header should end with Notes");
  const bonusLine = lines.find(l => l.startsWith("Bonus,"));
  assert(bonusLine && bonusLine.includes("20000.00"), "bonus CSV line should contain 20000.00 gross");
  assert(bonusLine.includes('"'), "bonus line with comma-containing reduction notes should be RFC-4180 quoted");
});

// Paystub-derived test vector: an anonymized version of a real 2026 pay year
// (see the notes in testdata/paystubs-2026.json). Checks every check's amounts
// against the stored rows, and the payroll rules the real stubs showed.
test("2026 paystub vector: every check matches, and the rules seen on real stubs hold", () => {
  const vec = JSON.parse(isNode
    ? require("fs").readFileSync("testdata/paystubs-2026.json", "utf8")
    : readFile("testdata/paystubs-2026.json"));
  const tax = pc.defaultTaxTables();
  for (const [k, v] of Object.entries(vec.taxOverrides)) {
    tax[k] = v && typeof v === "object" && !Array.isArray(v) ? Object.assign({}, tax[k], v) : v;
  }
  const inp = Object.assign(pc.defaultInputs(), JSON.parse(JSON.stringify(vec.inputs)));
  const v = pc.validateInputs(inp, tax);
  assert(v.errors.length === 0, `vector inputs should validate: ${v.errors.map(e => e.msg).join("; ")}`);
  const res = pc.computeAll(inp, tax);
  const iso = d => d.toISOString().slice(0, 10);

  const compare = (actualRows, expectedRows, cols, rowKey, label) => {
    assert(actualRows.length === expectedRows.length, `${label}: expected ${expectedRows.length} rows, got ${actualRows.length}`);
    expectedRows.forEach((exp, i) => {
      const r = actualRows[i];
      cols.forEach((col, j) => {
        if (col === "kind") assert(r.kind === exp[j], `${label} row ${i}: kind ${r.kind} != ${exp[j]}`);
        else if (col === "date") assert(iso(r.date) === exp[j], `${label} row ${i}: date ${iso(r.date)} != ${exp[j]}`);
        else assertClose(r[col], exp[j], `${label} ${rowKey(exp)} ${col}`, 0.006);
      });
    });
  };
  compare(res.rows, vec.rows, vec.rowColumns, e => `${e[0]} ${e[1]}`, "check");
  compare(res.rsuRows, vec.rsuRows, vec.rsuColumns, e => `RSU ${e[0]}`, "vest");

  // Rules the real stubs showed, independent of the stored numbers.
  const pay = res.rows.filter(r => r.kind === "pay");
  const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
  const perCheck = inp.annualSalary / 26;
  for (const r of pay) {
    assertClose(r.S, perCheck * inp.nqdcPct, `${iso(r.date)} NQDC is a % of gross`);
    if (r.F > 0 && sum(pay.filter(p => p.date <= r.date), p => p.F) < tax.electiveLimit - 0.01) {
      assertClose(r.F, (perCheck - r.S) * inp.trad401kPct, `${iso(r.date)} 401(k) is a % of gross − NQDC`);
    }
    if (r.Q > 0) assert(sum(pay.filter(p => p.date <= r.date), p => p.L) >= tax.catchup5059 - 0.01,
      `${iso(r.date)} after-tax spillover only after catch-up is full`);
    if (r.F + r.G + r.K + r.L === 0) assert(r.O === 0, `${iso(r.date)} no match on after-tax spillover`);
  }
  assertClose(sum(pay, r => r.F), tax.electiveLimit, "pre-tax 401(k) reaches the limit");
  assert(sum(pay, r => r.K) === 0, "catch-up is forced to Roth (prior-year wages over the threshold)");
  assertClose(sum(pay, r => r.L), tax.catchup5059, "Roth catch-up reaches its limit");
  assert(pay.some(r => r.F > 0 && r.L > 0), "the 401(k) limit is reached partway through a check");
  assertClose(sum(pay, r => r.T), tax.hsaLimit.Family + tax.hsaCatchup55 - inp.employerHsaAnnual,
    "HSA stops at the family limit + 55 catch-up, less employer money");
  assertClose(sum(res.rows, r => r.AE) + sum(res.rsuRows, r => r.F), tax.ssWageBase * tax.ssRate,
    "Social Security stops at the wage base across checks and vests");
  const firstAddl = pay.find(r => r.AG > 0);
  assert(firstAddl && firstAddl.AG < firstAddl.W * tax.addlMedicareRate, "Additional Medicare starts partway through a check");
  checkRowInvariants(res, tax, "paystubs-2026");
});

// 18. Deterministic randomized fuzz suite (engine + Maximize)
test("Aggregate bonus uses the IRS Pub. 15 aggregate method and skips W-4 Step 4(c)", () => {
  const tax = pc.defaultTaxTables();
  const status = "Married Filing Jointly";
  const brackets = tax.brackets[status];
  // Independent Pub. 15-T biweekly withholding on W (no other W-4 entries).
  const wh = W => {
    const taxable = Math.max(0, W * 26 - tax.standardDeduction[status]);
    let t = 0;
    for (let i = 0; i < brackets.length; i++) {
      const lo = brackets[i].over, hi = i + 1 < brackets.length ? brackets[i + 1].over : Infinity;
      if (taxable > lo) t += (Math.min(taxable, hi) - lo) * brackets[i].rate;
    }
    return t / 26;
  };
  const inp = pc.defaultInputs();
  inp.bonusWithholding = "Aggregate";
  inp.bonusAfterTaxPct = 0;
  inp.bonuses = [{ amount: 3000, date: "2027-06-11" }, { amount: 5000, date: "2027-01-05" }];
  inp.addlFedWithholding = 100;
  const res = pc.computeAll(inp, tax);
  const juneBonus = res.rows.find(r => r.isBonus && r.date.getMonth() === 5);
  const lastPay = res.rows.filter(r => r.kind === "pay" && r.date <= juneBonus.date).pop();
  assertClose(juneBonus.AC, wh(lastPay.W + juneBonus.W) - wh(lastPay.W), "June bonus aggregate withholding");
  assert(juneBonus.AD === 0, "Step 4(c) extra withholding must not repeat on a bonus check");
  assert(lastPay.AD === 100, "Step 4(c) still applies to the regular check");
  // A bonus before the first payday has no regular check to combine with.
  const janBonus = res.rows.find(r => r.isBonus && r.date.getMonth() === 0);
  assertClose(janBonus.AC, wh(janBonus.W), "bonus before the first payday");
  checkRowInvariants(res, tax, "aggregate-irs");
});

test("ESPP setup is validated when only a mid-year change turns ESPP on, and Maximize won't plan without it", () => {
  const tax = pc.defaultTaxTables();
  const inp = pc.defaultInputs();
  inp.esppPct = 0;
  inp.esppStart = "";
  inp.changes = [{ date: "2027-07-02", field: "esppPct", value: 0.05 }];
  const v = pc.validateInputs(inp, tax);
  assert(v.errors.some(e => e.id === "in-esppStart"), "missing ESPP start must be an error when a change enables ESPP");
  inp.changes = [];
  assert(!pc.validateInputs(inp, tax).errors.some(e => e.id === "in-esppStart"), "no error when ESPP is never used");
  const plan = pc.planMaximize(inp, tax, { items: { espp: true }, strategy: "even", minNet: 0, from: "" });
  assert(plan.items[0].status === "na", `Maximize ESPP without a start date should be N/A, got ${plan.items[0].status}`);
  assert(plan.inputs.esppPct === 0, "Maximize must not set an ESPP % it can't apply");
  inp.esppStart = "2027-01-01";
  inp.esppMonths = 0;
  assert(pc.planMaximize(inp, tax, { items: { espp: true }, strategy: "even", minNet: 0, from: "" }).items[0].status === "na",
    "Maximize ESPP with a 0-month offering period should be N/A");
});

test("normalizeState resets election steps that aren't dropdown choices", () => {
  const st = pc.normalizeState({ inputs: { ...pc.defaultInputs(), plan401kStep: 0.005, esppStep: 0.0001 }, tax: pc.defaultTaxTables() });
  assert(st.inputs.plan401kStep === 0.01 && st.inputs.esppStep === 0.01, "unsupported steps fall back to 1%");
  const ok = pc.normalizeState({ inputs: { ...pc.defaultInputs(), plan401kStep: 0.0001, esppStep: 0.001 }, tax: pc.defaultTaxTables() });
  assert(ok.inputs.plan401kStep === 0.0001 && ok.inputs.esppStep === 0.001, "supported steps are kept");
});

test("fuzz: 500 randomized engine scenarios satisfy all invariants", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const r2 = (lo, hi, step) => Math.round((lo + rnd() * (hi - lo)) / step) * step;

  for (let i = 0; i < 500; i++) {
    const inp = pc.defaultInputs();
    const tax = pc.defaultTaxTables();
    inp.filingStatus = pick(["Single", "Married Filing Jointly", "Head of Household", "Married Filing Separately"]);
    inp.annualSalary = r2(20000, 900000, 1000);
    inp.firstPayDate = pick(["2027-01-01", "2027-01-08", "2027-01-14"]);
    inp.extraPayday = pick(["Extra", "Spread"]);
    inp.employeeAge = pick([30, 50, 55, 61, 64, 66]);
    inp.nqdcPct = pick([0, 0, 0.1, 0.25, 0.5]);
    inp.trad401kPct = r2(0, 0.6, 0.01);
    inp.roth401kPct = r2(0, 0.4, 0.01);
    inp.afterTax401kPct = r2(0, 0.5, 0.01);
    inp.esppPct = r2(0, 0.15, 0.01);
    inp.hsaPerPaycheck = r2(0, 500, 1);
    inp.healthFsaPerPaycheck = r2(0, 200, 1);
    inp.dcFsaPerPaycheck = r2(0, 400, 1);
    inp.preTaxInsurance = r2(0, 600, 1);
    inp.otherPostTax = r2(0, 300, 1);
    inp.addlFedWithholding = pick([0, 0, 100, 2000]);
    inp.w4MultipleJobs = rnd() < 0.3;
    inp.stateTaxRate = r2(0, 0.13, 0.001);
    inp.stateSdiRate = pick([0, 0.012]);
    inp.stateSdiTaxesHsa = rnd() < 0.3;
    inp.stateTaxesHsa = rnd() < 0.3;
    inp.stateTaxes401k = rnd() < 0.2;
    inp.spillover = rnd() < 0.7;
    inp.catchupRoth = pick(["Auto", "Yes", "No"]);
    inp.bonusWithholding = pick(["Flat", "Aggregate"]);
    inp.bonusAfterTaxPct = r2(0, 0.85, 0.01);
    inp.bonusTradPct = r2(0, 0.5, 0.01);
    inp.bonuses = rnd() < 0.5 ? [{ amount: r2(1000, 2000000, 1000), date: pick(["2027-02-15", "2027-06-30", "2027-12-10"]) }] : [];
    inp.rsuVests = rnd() < 0.5 ? [{ value: r2(1000, 1500000, 1000), date: "2027-03-02" }] : [];
    inp.nqdcPayouts = rnd() < 0.3 ? [{ amount: r2(1000, 500000, 1000), firstDate: "2025-04-15", years: 5 }] : [];
    const res = pc.computeAll(inp, tax);
    checkRowInvariants(res, tax, `fuzz-${i}`);
    const expectedSS = Math.min(res.summary.ficaWagesAll, tax.ssWageBase) * tax.ssRate;
    assertClose(res.summary.totalSSAllSources, expectedSS, `fuzz-${i} SS total`, 0.05);
  }
});

test("fuzz: 100 randomized Maximize scenarios preserve plan rules and status accuracy", () => {
  let seed = 999;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const r2 = (lo, hi, step) => Math.round((lo + rnd() * (hi - lo)) / step) * step;
  const tax = pc.defaultTaxTables();

  for (let i = 0; i < 100; i++) {
    const inp = pc.defaultInputs();
    inp.annualSalary = r2(60000, 600000, 1000);
    inp.nqdcPct = pick([0, 0.1]);
    inp.afterTax401kPct = r2(0, 0.5, 0.01);
    inp.trad401kPct = r2(0, 0.3, 0.01);
    inp.plan401kStep = pick([0.01, 0.001]);
    const opts = {
      items: { hsa: rnd() < 0.5, healthFsa: false, dcFsa: false, k401: true, afterTax: rnd() < 0.6, espp: rnd() < 0.5 },
      strategy: pick(["even", "asap"]), minNet: pick([0, 1500]), newSplit: "Traditional", from: pick(["", "2027-06-18"])
    };
    const plan = pc.planMaximize(inp, tax, opts);
    for (const it of plan.items) {
      if (it.status === "ok") {
        assert(it.achieved >= it.target - 0.05, `mx-${i} ${it.item} marked ok but achieved ${it.achieved} < ${it.target}`);
      }
    }
    const v = pc.validateInputs(plan.inputs, tax);
    const planWarn = v.warnings.filter(w => /plan's .* maximum|steps your plan/.test(w.msg));
    assert(planWarn.length === 0, `mx-${i} produced plan warning: ${planWarn[0] && planWarn[0].msg}`);
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) failExit();
