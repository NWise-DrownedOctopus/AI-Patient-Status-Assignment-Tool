// Run from the frontend folder:  npm run test:engine
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluate, validateRule } from '../src/engine.js';
import { applyPayer, linkedExclusions, MEDICARE_EXCLUSIONS } from '../src/medicare.js';

const rulesDir = new URL('../src/rules/', import.meta.url);
const load = (url) => JSON.parse(readFileSync(url, 'utf8'));

const dyspnea = load(new URL('dyspnea.json', rulesDir));
const casesDir = new URL('../cases/', rulesDir);

// Every rule file, by id; every cases file in src/cases/ (named <rule id>-cases.json).
const ruleFiles = readdirSync(rulesDir).filter((f) => f.endsWith('.json'));
const rulesById = Object.fromEntries(ruleFiles.map((f) => {
  const r = load(new URL(f, rulesDir));
  return [r.id, r];
}));
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith('-cases.json'));

const sorted = (list) => [...list].sort();

// A case with a "payer" key also goes through the Medicare layer; without one, clinical only.
function run(c, rule = dyspnea) {
  const clinical = evaluate(rule, c.inputs);
  if (!('payer' in c)) return clinical;
  return applyPayer(clinical, { payer: c.payer, medicare: c.medicare ?? {}, rule, inputs: c.inputs });
}

// ------------------------------------------------------------------ rule files

describe('rule files', () => {
  // Covers every file in src/rules, including ones added later.
  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.json'))) {
    test(`${file} is valid`, () => {
      assert.deepEqual(validateRule(load(new URL(file, rulesDir))), []);
    });
  }

  test('validator catches common mistakes', () => {
    const bad = {
      id: 'bad',
      label: 'Bad',
      inputs: [{ id: 'a', label: 'A', type: 'toggle' }],
      inpatient: {
        any: [
          { field: 'nope', op: 'is', value: true },
          { field: 'a', op: '~~', value: true },
          { at_least_n: 5, of: [{ field: 'a', op: 'is', value: true }] },
        ],
      },
    };
    const errors = validateRule(bad);
    assert.equal(errors.length, 3);
  });
});

// ------------------------------------------------------------------ dyspnea cases

// ------------------------------------------------------------------ every condition's cases

describe('every condition has cases', () => {
  for (const id of Object.keys(rulesById)) {
    test(`${id}: cases file exists with an inpatient case and a non-inpatient case`, () => {
      assert.ok(caseFiles.includes(`${id}-cases.json`), `src/cases/${id}-cases.json is missing`);
      const cases = load(new URL(`${id}-cases.json`, casesDir));
      assert.ok(cases.some((c) => c.expect.status === 'inpatient'), 'no inpatient case');
      assert.ok(cases.some((c) => c.expect.status !== 'inpatient'), 'no observation/review case');
    });
  }

  test('every cases file belongs to a rule', () => {
    for (const f of caseFiles) {
      const id = f.replace(/-cases\.json$/, '');
      assert.ok(rulesById[id], `${f} has no matching rule file`);
    }
  });

  test('an empty form never produces a recommendation, for any condition', () => {
    for (const rule of Object.values(rulesById)) {
      const r = evaluate(rule, {});
      assert.equal(r.status, 'review', `${rule.id} returned ${r.status} for an empty form`);
    }
  });

  test('a blank number or an off switch is the same as nothing entered', () => {
    for (const rule of Object.values(rulesById)) {
      const blanks = {};
      for (const i of rule.inputs) blanks[i.id] = i.type === 'toggle' && !i.required ? false : '';
      assert.equal(evaluate(rule, blanks).status, 'review', `${rule.id}`);
    }
  });
});

for (const file of caseFiles) {
  const id = file.replace(/-cases\.json$/, '');
  const rule = rulesById[id];
  if (!rule) continue;
  describe(`${id} cases (src/cases/${file})`, () => {
    for (const c of load(new URL(file, casesDir))) {
      test(c.name, () => {
        const result = run(c, rule);
        assert.equal(result.status, c.expect.status);
        if (c.expect.matched) {
          assert.deepEqual(sorted(result.matched.map((m) => m.field)), sorted(c.expect.matched));
        }
        if (c.expect.missing) {
          assert.deepEqual(sorted(result.missing.map((m) => m.field)), sorted(c.expect.missing));
        }
        if (c.expect.notMet) {
          assert.deepEqual(sorted(result.notMet.map((m) => m.field)), sorted(c.expect.notMet));
        }
        if (c.expect.supports) {
          assert.deepEqual(sorted(result.supports.map((m) => m.field)), sorted(c.expect.supports));
        }
        if (c.expect.reasonIncludes) {
          assert.ok(result.reasons.some((r) => r.includes(c.expect.reasonIncludes)),
            `no reason contains "${c.expect.reasonIncludes}": ${JSON.stringify(result.reasons)}`);
        }
        if (c.expect.notesInclude) {
          assert.ok(result.notes.some((n) => n.includes(c.expect.notesInclude)),
            `no note contains "${c.expect.notesInclude}"`);
        }
      });
    }
  });
}

// ------------------------------------------------------------------ dyspnea details

describe('dyspnea details', () => {
  test('inpatient result explains itself in plain language with the value', () => {
    const result = evaluate(dyspnea, { stable: true, o2sat: 88 });
    assert.deepEqual(result.matched, [
      { field: 'o2sat', text: 'O2 saturation 88% is below 90%' },
    ]);
  });

  test('the same sat is not listed twice when two rules would match it', () => {
    const result = evaluate(dyspnea, { stable: true, o2sat: 85, copd: true });
    const satLines = result.matched.filter((m) => m.field === 'o2sat');
    assert.equal(satLines.length, 1);
  });

  test('numbers typed into a form arrive as strings and still work', () => {
    assert.equal(evaluate(dyspnea, { stable: true, o2sat: '88' }).status, 'inpatient');
    assert.equal(evaluate(dyspnea, { stable: true, o2sat: '94' }).status, 'observation');
  });

  test('a blank or junk sat counts as missing, not as zero', () => {
    for (const o2sat of ['', null, undefined, 'abc', NaN]) {
      const r = evaluate(dyspnea, { stable: true, o2sat });
      assert.equal(r.status, 'review', `o2sat=${String(o2sat)}`);
      assert.deepEqual(r.missing.map((m) => m.field), ['o2sat']);
    }
  });

  test('review result names the missing field by its label', () => {
    const r = evaluate(dyspnea, { stable: true });
    assert.deepEqual(r.missing, [{ field: 'o2sat', label: 'O2 saturation' }]);
    assert.match(r.reasons[0], /O2 saturation/);
  });

  test('an unanswered prerequisite does not hide other missing required fields', () => {
    const r = evaluate(dyspnea, {});
    assert.equal(r.status, 'review');
    assert.deepEqual(sorted(r.missing.map((m) => m.field)), ['o2sat', 'stable']);
  });

  test('a met criterion wins even if the sat is blank', () => {
    const r = evaluate(dyspnea, { stable: true, ventilation: true });
    assert.equal(r.status, 'inpatient');
  });
});

// ------------------------------------------------------------------ Medicare layer

describe('Medicare layer', () => {
  const sat88 = { stable: true, o2sat: 88 };
  const apply = (inputs, payer, medicare = {}, rule = dyspnea) =>
    applyPayer(evaluate(rule, inputs), { payer, medicare, rule, inputs });

  test('there are exactly five exclusions', () => {
    assert.deepEqual(
      MEDICARE_EXCLUSIONS.map((e) => e.id),
      ['transfer', 'expired', 'left_ama', 'ventilation', 'improved_faster'],
    );
  });

  test('every exclusion alone satisfies Medicare for an inpatient result', () => {
    for (const { id, label } of MEDICARE_EXCLUSIONS) {
      const r = apply(sat88, 'medicare', { midnights: false, [id]: true });
      assert.equal(r.status, 'inpatient', id);
      assert.deepEqual(r.medicare.lines, [`Medicare exclusion: ${label}`]);
    }
  });

  test('2+ midnights satisfies Medicare and says so', () => {
    const r = apply(sat88, 'medicare', { midnights: true });
    assert.equal(r.status, 'inpatient');
    assert.deepEqual(r.medicare.lines, ['Medicare: 2 or more midnights of hospital care expected']);
  });

  test('midnights and an exclusion together are both listed', () => {
    const r = apply(sat88, 'medicare', { midnights: true, transfer: true });
    assert.equal(r.medicare.lines.length, 2);
  });

  test('unanswered midnights asks for the answer and keeps the clinical criteria visible', () => {
    const r = apply(sat88, 'medicare');
    assert.equal(r.status, 'review');
    assert.deepEqual(r.missing, [{ field: 'midnights', label: 'Expected 2+ midnights (Medicare)' }]);
    assert.deepEqual(r.matched.map((m) => m.field), ['o2sat']);
    assert.match(r.reasons[0], /Expected 2\+ midnights/);
  });

  test('"No" to midnights with no exclusion is Needs review, never a silent downgrade', () => {
    const r = apply(sat88, 'medicare', { midnights: false });
    assert.equal(r.status, 'review');
    assert.deepEqual(r.missing, []);
    assert.match(r.reasons[0], /fewer than 2 midnights/);
  });

  test('the ventilation finding counts as the ventilation exclusion without asking twice', () => {
    const inputs = { stable: true, o2sat: 96, ventilation: true };
    assert.deepEqual(linkedExclusions(dyspnea, inputs), ['ventilation']);
    const r = apply(inputs, 'medicare');
    assert.equal(r.status, 'inpatient');
    assert.deepEqual(r.medicare.lines, ['Medicare exclusion: Requires ventilation']);
  });

  test('a condition with no linked exclusions links nothing', () => {
    assert.deepEqual(linkedExclusions({ id: 'x', inputs: [] }, { ventilation: true }), []);
  });

  test('other payer: inpatient straight away, no Medicare lines', () => {
    const r = apply(sat88, 'other');
    assert.equal(r.status, 'inpatient');
    assert.equal(r.medicare, null);
  });

  test('payer not chosen: an inpatient result needs the payer, observation does not', () => {
    const r = apply(sat88, null);
    assert.equal(r.status, 'review');
    assert.deepEqual(r.missing, [{ field: 'payer', label: 'Payer' }]);
    assert.equal(apply({ stable: true, o2sat: 94 }, null).status, 'observation');
  });

  test('Medicare never changes an observation or a review result', () => {
    assert.equal(apply({ stable: true, o2sat: 94 }, 'medicare').status, 'observation');
    const review = apply({ stable: true }, 'medicare');
    assert.equal(review.status, 'review');
    assert.deepEqual(review.missing.map((m) => m.field), ['o2sat']);
  });

  test('the clinical result is not mutated', () => {
    const clinical = evaluate(dyspnea, sat88);
    const before = JSON.stringify(clinical);
    applyPayer(clinical, { payer: 'medicare', medicare: {}, rule: dyspnea, inputs: sat88 });
    assert.equal(JSON.stringify(clinical), before);
  });

  test('the validator checks the medicare mapping in a rule file', () => {
    const base = {
      id: 'm',
      label: 'M',
      inputs: [
        { id: 'a', label: 'A', type: 'toggle' },
        { id: 'n', label: 'N', type: 'number' },
      ],
      inpatient: { any: [{ field: 'a', op: 'is', value: true }] },
    };
    assert.deepEqual(validateRule({ ...base, medicare: { exclusions: { ventilation: 'a' } } }), []);
    assert.equal(validateRule({ ...base, medicare: { exclusions: { bogus: 'a' } } }).length, 1);
    assert.equal(validateRule({ ...base, medicare: { exclusions: { ventilation: 'zzz' } } }).length, 1);
    assert.equal(validateRule({ ...base, medicare: { exclusions: { ventilation: 'n' } } }).length, 1);
  });
});

// ------------------------------------------------------------------ "checked, not met"

describe('checked, not met', () => {
  const texts = (r) => r.notMet.map((m) => m.text);

  test('50 mL explains itself; 60 mL does not need to', () => {
    const at50 = evaluate(dyspnea, { stable: true, o2sat: 95, hemoptysis_ml: 50 });
    assert.equal(at50.status, 'observation');
    assert.ok(texts(at50).includes('Hemoptysis volume 50 mL: not met (needs more than 50 mL)'));

    const at60 = evaluate(dyspnea, { stable: true, o2sat: 95, hemoptysis_ml: 60 });
    assert.equal(at60.status, 'inpatient');
    assert.ok(!texts(at60).some((t) => t.startsWith('Hemoptysis')));
  });

  test('percent hugs the number, other units get a space', () => {
    const r = evaluate(dyspnea, { stable: true, o2sat: 90, pao2: 60 });
    assert.deepEqual(texts(r), [
      'O2 saturation 90%: not met (needs below 90%)',
      'Arterial PO2 60 mmHg: not met (needs below 57 mmHg)',
    ]);
  });

  test('ranges name both ends', () => {
    const r = evaluate(dyspnea, { stable: true, o2sat: 88, paco2: 50, ph: 7.4 });
    assert.deepEqual(texts(r), ['Arterial pH 7.4: not met (needs 7.31-7.35)']);
  });

  test('still shown when another criterion decided the result', () => {
    const r = evaluate(dyspnea, { stable: true, o2sat: 88, hemoptysis_ml: 50 });
    assert.equal(r.status, 'inpatient');
    assert.deepEqual(texts(r), ['Hemoptysis volume 50 mL: not met (needs more than 50 mL)']);
  });

  test('a value that appears in two criteria is listed once', () => {
    const r = evaluate(dyspnea, { stable: true, o2sat: 94, copd: true });
    assert.equal(texts(r).filter((t) => t.startsWith('O2 saturation')).length, 1);
  });

  test('blank fields and switches left off are not listed', () => {
    assert.deepEqual(texts(evaluate(dyspnea, { stable: true })), []);
    assert.deepEqual(texts(evaluate(dyspnea, { stable: true, o2sat: 95, stridor: false })), [
      'O2 saturation 95%: not met (needs below 90%)',
    ]);
  });

  test('typed-as-text numbers are explained too, junk is not', () => {
    assert.deepEqual(texts(evaluate(dyspnea, { stable: true, o2sat: '94' })), [
      'O2 saturation 94%: not met (needs below 90%)',
    ]);
    assert.deepEqual(texts(evaluate(dyspnea, { stable: true, o2sat: 'abc' })), []);
  });

  test('nothing is explained when a prerequisite failed', () => {
    assert.deepEqual(evaluate(dyspnea, { stable: false, o2sat: 95 }).notMet, []);
  });

  test('every operator gets readable wording', () => {
    const phrase = (leaf, x) => {
      const rule = {
        id: 'n',
        label: 'N',
        inputs: [{ id: 'x', label: 'X', type: 'number' }],
        inpatient: { any: [{ field: 'x', ...leaf }] },
      };
      return evaluate(rule, { x }).notMet[0].text;
    };
    assert.equal(phrase({ op: '<', value: 5 }, 5), 'X 5: not met (needs below 5)');
    assert.equal(phrase({ op: '<=', value: 5 }, 6), 'X 6: not met (needs 5 or below)');
    assert.equal(phrase({ op: '>', value: 5 }, 5), 'X 5: not met (needs more than 5)');
    assert.equal(phrase({ op: '>=', value: 5 }, 4), 'X 4: not met (needs 5 or more)');
    assert.equal(phrase({ op: 'between', value: [1, 3] }, 4), 'X 4: not met (needs 1-3)');
    assert.equal(phrase({ op: '==', value: 3 }, 4), 'X 4: not met (needs exactly 3)');
    assert.equal(phrase({ op: '!=', value: 3 }, 3), 'X 3: not met (needs a value other than 3)');
  });
});

// ------------------------------------------------------------------ group operators

const toggle = (id, required = false) => ({ id, label: id.toUpperCase(), type: 'toggle', required });
const yes = (field) => ({ field, op: 'is', value: true, text: field.toUpperCase() });

const makeRule = (inpatient, required = false) => ({
  id: 't',
  label: 'T',
  inputs: [toggle('a', required), toggle('b', required), toggle('c', required)],
  inpatient,
});

describe('any', () => {
  const rule = makeRule({ any: [yes('a'), yes('b')] }, true);
  test('one true is enough, even with the other unknown', () => {
    assert.equal(evaluate(rule, { a: true }).status, 'inpatient');
  });
  test('all false -> observation', () => {
    assert.equal(evaluate(rule, { a: false, b: false }).status, 'observation');
  });
  test('false + unknown -> review naming the unknown', () => {
    const r = evaluate(rule, { a: false });
    assert.equal(r.status, 'review');
    assert.deepEqual(r.missing.map((m) => m.field), ['b']);
  });
});

describe('all', () => {
  const rule = makeRule({ all: [yes('a'), yes('b')] }, true);
  test('all true -> inpatient', () => {
    assert.equal(evaluate(rule, { a: true, b: true }).status, 'inpatient');
  });
  test('one false decides it, even with the other unknown', () => {
    assert.equal(evaluate(rule, { a: false }).status, 'observation');
  });
  test('true + unknown -> review', () => {
    assert.equal(evaluate(rule, { a: true }).status, 'review');
  });
});

describe('at_least_n (2 of 3)', () => {
  const required = makeRule({ at_least_n: 2, of: [yes('a'), yes('b'), yes('c')] }, true);
  const optional = makeRule({ at_least_n: 2, of: [yes('a'), yes('b'), yes('c')] }, false);

  test('two true -> inpatient', () => {
    assert.equal(evaluate(required, { a: true, c: true }).status, 'inpatient');
  });
  test('only one true and the rest answered -> observation', () => {
    assert.equal(evaluate(required, { a: true, b: false, c: false }).status, 'observation');
  });
  test('one true, two unknown -> review naming both', () => {
    const r = evaluate(required, { a: true });
    assert.equal(r.status, 'review');
    assert.deepEqual(sorted(r.missing.map((m) => m.field)), ['b', 'c']);
  });
  test('one true, one false, one unknown -> review naming the unknown', () => {
    const r = evaluate(required, { a: true, b: false });
    assert.equal(r.status, 'review');
    assert.deepEqual(r.missing.map((m) => m.field), ['c']);
  });
  test('zero true, one unknown -> already impossible, so observation', () => {
    assert.equal(evaluate(required, { a: false, b: false }).status, 'observation');
  });
  test('optional fields left blank count as not present', () => {
    assert.equal(evaluate(optional, { a: true }).status, 'observation');
    assert.equal(evaluate(optional, { a: true, b: true }).status, 'inpatient');
  });
  test('matched lists only the criteria that were true', () => {
    const r = evaluate(optional, { a: true, b: true, c: false });
    assert.deepEqual(sorted(r.matched.map((m) => m.field)), ['a', 'b']);
  });
});

describe('nesting and prerequisites', () => {
  test('groups can contain groups', () => {
    const rule = makeRule({ any: [yes('a'), { all: [yes('b'), yes('c')] }] });
    assert.equal(evaluate(rule, { b: true, c: true }).status, 'inpatient');
    assert.equal(evaluate(rule, { b: true }).status, 'observation');
  });

  test('a failed prerequisite gives review with its message, never a recommendation', () => {
    const rule = {
      ...makeRule({ any: [yes('a')] }),
      prerequisites: [{ ...yes('b'), failText: 'B must be true' }],
    };
    const r = evaluate(rule, { a: true, b: false });
    assert.equal(r.status, 'review');
    assert.deepEqual(r.reasons, ['B must be true']);
  });
});

describe('comparison operators', () => {
  const numRule = (leaf) => ({
    id: 'n',
    label: 'N',
    inputs: [{ id: 'x', label: 'X', type: 'number' }],
    inpatient: { any: [{ field: 'x', ...leaf }] },
  });
  const status = (leaf, x) => evaluate(numRule(leaf), { x }).status;

  test('< <= > >=', () => {
    assert.equal(status({ op: '<', value: 5 }, 5), 'observation');
    assert.equal(status({ op: '<=', value: 5 }, 5), 'inpatient');
    assert.equal(status({ op: '>', value: 5 }, 5), 'observation');
    assert.equal(status({ op: '>=', value: 5 }, 5), 'inpatient');
  });
  test('between is inclusive at both ends', () => {
    assert.equal(status({ op: 'between', value: [45, 54] }, 45), 'inpatient');
    assert.equal(status({ op: 'between', value: [45, 54] }, 54), 'inpatient');
    assert.equal(status({ op: 'between', value: [45, 54] }, 55), 'observation');
  });
  test('0 is a real value, not blank', () => {
    assert.equal(status({ op: '<', value: 5 }, 0), 'inpatient');
  });
});

// ------------------------------------------------------------------ newer rule features

describe('not, observation findings, reviewWhen, notes', () => {
  const tiny = (extra = {}) => ({
    id: 'tiny',
    label: 'Tiny',
    inputs: [
      { id: 'a', label: 'A', type: 'toggle' },
      { id: 'b', label: 'B', type: 'toggle' },
      { id: 'n', label: 'N', type: 'number', unit: 'mg' },
      { id: 'req', label: 'Req', type: 'toggle', required: true },
    ],
    inpatient: { all: [{ field: 'a', op: 'is', value: true }, { not: { field: 'b', op: 'is', value: true } }] },
    ...extra,
  });

  test('"not" flips its inner criteria: a and not b', () => {
    assert.equal(evaluate(tiny(), { a: true }).status, 'inpatient');
    assert.equal(evaluate(tiny(), { a: true, b: true }).status, 'observation');
  });

  test('"not" keeps unknown as unknown', () => {
    const rule = tiny({ inpatient: { not: { field: 'req', op: 'is', value: true } } });
    assert.equal(evaluate(rule, { a: true }).status, 'review');
    assert.equal(evaluate(rule, { req: false }).status, 'inpatient');
    assert.equal(evaluate(rule, { req: true }).status, 'observation');
  });

  test('"not" never adds a line to the criteria met or to checked-not-met', () => {
    const rule = tiny({
      inpatient: { all: [{ field: 'a', op: 'is', value: true }, { not: { field: 'n', op: '>', value: 5 } }] },
    });
    const r = evaluate(rule, { a: true, n: 3 });
    assert.equal(r.status, 'inpatient');
    assert.deepEqual(r.matched.map((m) => m.field), ['a']);
    assert.deepEqual(r.notMet, []);
  });

  test('validator accepts "not" and rejects a malformed one', () => {
    assert.deepEqual(validateRule(tiny()), []);
    const bad = tiny({ inpatient: { not: { field: 'nope', op: 'is', value: true } } });
    assert.equal(validateRule(bad).length, 1);
    const mixed = tiny({ inpatient: { not: { field: 'a', op: 'is', value: true }, any: [] } });
    assert.ok(validateRule(mixed).length >= 1);
  });

  test('an empty form is Needs review, not Observation', () => {
    const r = evaluate(tiny({ inpatient: { any: [{ field: 'a', op: 'is', value: true }] } }), {});
    assert.equal(r.status, 'review');
    assert.match(r.reasons[0], /Enter the patient/);
    assert.deepEqual(r.missing, []);
  });

  test('a required Yes/No answered "No" counts as entered; an optional switch off does not', () => {
    const rule = tiny({ inpatient: { any: [{ field: 'req', op: 'is', value: true }, { field: 'a', op: 'is', value: true }] } });
    assert.equal(evaluate(rule, { req: false }).status, 'observation');
    assert.equal(evaluate(rule, { req: false, a: false }).status, 'observation');
    assert.equal(evaluate({ ...rule, inputs: rule.inputs.map((i) => ({ ...i, required: false })) }, { a: false }).status, 'review');
  });

  test('observation findings are listed with an Observation result only', () => {
    const rule = tiny({
      inpatient: { any: [{ field: 'a', op: 'is', value: true }] },
      observation: { any: [{ field: 'b', op: 'is', value: true, text: 'B is present' }] },
    });
    assert.deepEqual(evaluate(rule, { b: true }).supports, [{ field: 'b', text: 'B is present' }]);
    assert.deepEqual(evaluate(rule, { a: true, b: true }).supports, []);
  });

  test('reviewWhen turns a default Observation into Needs review, but never overrides Inpatient', () => {
    const rule = tiny({
      inpatient: { any: [{ field: 'a', op: 'is', value: true }, { field: 'n', op: '>', value: 5 }] },
      reviewWhen: [{ when: { field: 'b', op: 'is', value: true }, text: 'B needs a human' }],
    });
    const r = evaluate(rule, { b: true });
    assert.equal(r.status, 'review');
    assert.deepEqual(r.reasons, ['B needs a human']);
    assert.equal(evaluate(rule, { a: true, b: true }).status, 'inpatient');
    assert.equal(evaluate(rule, { n: 1 }).status, 'observation');
  });

  test('notes come back with every result', () => {
    const rule = tiny({ notes: ['Check often'] });
    for (const inputs of [{}, { a: true }, { a: true, b: true }]) {
      assert.deepEqual(evaluate(rule, inputs).notes, ['Check often']);
    }
  });

  test('validator checks reviewWhen and notes', () => {
    assert.equal(validateRule(tiny({ reviewWhen: [{ when: { field: 'a', op: 'is', value: true } }] })).length, 1);
    assert.equal(validateRule(tiny({ reviewWhen: 'x' })).length, 1);
    assert.equal(validateRule(tiny({ notes: [1] })).length, 1);
    assert.equal(validateRule(tiny({ observation: { any: [{ field: 'zzz', op: 'is', value: true }] } })).length, 1);
  });
});

describe('guide wording', () => {
  // The guide asks for "admit to inpatient" and "place in observation". Nothing the tool
  // says should use the phrasings it warns about.
  const banned = [/admit to observation/i, /admitted to observation/i, /observe (the patient )?overnight/i, /\bobserving\b/i];

  test('no rule text uses wording the guide warns against', () => {
    for (const rule of Object.values(rulesById)) {
      const text = JSON.stringify(rule);
      for (const re of banned) assert.doesNotMatch(text, re, `${rule.id} matches ${re}`);
    }
  });
});
