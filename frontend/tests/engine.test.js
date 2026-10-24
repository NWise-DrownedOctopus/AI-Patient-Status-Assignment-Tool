// Run from the frontend folder:  npm run test:engine
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluate, validateRule } from '../src/engine.js';

const rulesDir = new URL('../src/rules/', import.meta.url);
const load = (url) => JSON.parse(readFileSync(url, 'utf8'));

const dyspnea = load(new URL('dyspnea.json', rulesDir));
const dyspneaCases = load(new URL('../cases/dyspnea.json', rulesDir));

const sorted = (list) => [...list].sort();

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

describe('dyspnea cases (src/cases/dyspnea.json)', () => {
    for (const c of dyspneaCases) {
        test(c.name, () => {
            const result = evaluate(dyspnea, c.inputs);
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
        });
    }

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