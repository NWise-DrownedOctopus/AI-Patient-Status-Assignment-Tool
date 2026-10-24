// Level-of-care rules engine.
//
// Plain JavaScript: no Vue, no Vite, no browser APIs. Rules + inputs in, result out.
// The Medicare 2-midnight layer is NOT here; it wraps this result in its own module.
//
// Three-valued logic. Every criterion is true, false, or unknown (null):
//   - A REQUIRED input that is blank makes any criterion reading it unknown.
//   - An OPTIONAL input that is blank counts as "not present": the criterion is false.
//
// Result status:
//   inpatient   - the inpatient criteria group is true (even if other fields are blank)
//   observation - the inpatient criteria group is false
//   review      - a prerequisite failed, or required answers are missing

const COMPARE_OPS = ['<', '<=', '>', '>=', '==', '!=', 'is', 'between'];
const NUMERIC_OPS = ['<', '<=', '>', '>=', 'between'];
const INPUT_TYPES = ['toggle', 'number'];
const GROUP_KEYS = ['any', 'all', 'at_least_n'];

const isBlank = (v) => v === undefined || v === null || v === '';
const findInput = (rule, id) => rule.inputs.find((i) => i.id === id);
const unique = (list) => [...new Set(list)];

// ---------------------------------------------------------------- criteria

function compare(op, actual, expected) {
    switch (op) {
        case '<': return actual < expected;
        case '<=': return actual <= expected;
        case '>': return actual > expected;
        case '>=': return actual >= expected;
        case 'between': return actual >= expected[0] && actual <= expected[1];
        case '==':
        case 'is': return actual === expected;
        case '!=': return actual !== expected;
        default: throw new Error(`Unknown operator: ${op}`);
    }
}

// A leaf is { field, op, value, text }. Returns { kind:'leaf', leaf, state, value }.
function evalLeaf(leaf, rule, inputs) {
    const def = findInput(rule, leaf.field);
    let actual = inputs[leaf.field];

    // Number inputs often arrive as strings from a form; coerce, and treat junk as blank.
    const numeric = NUMERIC_OPS.includes(leaf.op) || typeof leaf.value === 'number';
    if (!isBlank(actual) && numeric) {
        actual = Number(actual);
        if (Number.isNaN(actual)) actual = undefined;
    }

    if (isBlank(actual)) {
        return { kind: 'leaf', leaf, state: def && def.required ? null : false };
    }
    return { kind: 'leaf', leaf, state: compare(leaf.op, actual, leaf.value), value: actual };
}

const groupKind = (node) => GROUP_KEYS.find((k) => k in node);
const groupChildren = (node) =>
    node.at_least_n !== undefined ? node.of : node[groupKind(node)];

// A group is { any: [...] }, { all: [...] } or { at_least_n: 2, of: [...] }.
// Children can be leaves or more groups.
function evalNode(node, rule, inputs) {
    if (node.field !== undefined) return evalLeaf(node, rule, inputs);

    const kind = groupKind(node);
    const children = groupChildren(node).map((c) => evalNode(c, rule, inputs));
    const yes = children.filter((c) => c.state === true).length;
    const unknown = children.filter((c) => c.state === null).length;

    let state;
    if (kind === 'any') {
        state = yes > 0 ? true : unknown > 0 ? null : false;
    } else if (kind === 'all') {
        state = children.some((c) => c.state === false) ? false : unknown > 0 ? null : true;
    } else {
        const n = node.at_least_n;
        state = yes >= n ? true : yes + unknown >= n ? null : false;
    }
    return { kind: 'group', state, children };
}

// ---------------------------------------------------------------- explaining

function describe(res, rule) {
    const { leaf, value } = res;
    if (leaf.text) return leaf.text.replaceAll('{value}', String(value));
    const def = findInput(rule, leaf.field);
    const label = def ? def.label : leaf.field;
    if (typeof value === 'boolean') return label;
    const target = Array.isArray(leaf.value) ? leaf.value.join('-') : leaf.value;
    return `${label}: ${value} (${leaf.op} ${target})`;
}

// Leaves that made a TRUE group true, in plain language.
function collectMatched(res, rule) {
    if (res.state !== true) return [];
    if (res.kind === 'leaf') return [{ field: res.leaf.field, text: describe(res, rule) }];
    return res.children
        .filter((c) => c.state === true)
        .flatMap((c) => collectMatched(c, rule));
}

// Fields behind every unknown leaf.
function collectUnknownFields(res) {
    if (res.state !== null) return [];
    if (res.kind === 'leaf') return [res.leaf.field];
    return res.children.flatMap(collectUnknownFields);
}

function dedupeByText(list) {
    const seen = new Set();
    return list.filter((m) => !seen.has(m.text) && seen.add(m.text));
}

// ---- "checked, not met": entered numbers that fell short of a threshold ----
// The wording is built from the rule's operator and the input's unit, so rule files
// need nothing extra. Example: "Hemoptysis volume 50 mL: not met (needs more than 50 mL)".

// "%" hugs the number ("90%"); other units get a space ("50 mL").
function withUnit(value, def) {
    if (!def || !def.unit) return String(value);
    return def.unit === '%' ? `${value}%` : `${value} ${def.unit}`;
}

function thresholdPhrase(leaf, def) {
    const v = (n) => withUnit(n, def);
    switch (leaf.op) {
        case '<': return `below ${v(leaf.value)}`;
        case '<=': return `${v(leaf.value)} or below`;
        case '>': return `more than ${v(leaf.value)}`;
        case '>=': return `${v(leaf.value)} or more`;
        case 'between': return `${leaf.value[0]}-${v(leaf.value[1])}`;
        case '==':
        case 'is': return `exactly ${v(leaf.value)}`;
        case '!=': return `a value other than ${v(leaf.value)}`;
        default: return String(leaf.value);
    }
}

function describeNotMet(res, rule) {
    const { leaf, value } = res;
    const def = findInput(rule, leaf.field);
    const label = def ? def.label : leaf.field;
    return `${label} ${withUnit(value, def)}: not met (needs ${thresholdPhrase(leaf, def)})`;
}

// Looks at every criterion in the tree, whether or not its group came out true: a number
// that missed its threshold is worth explaining even when something else decided the result.
// Blank fields and switches left off are not listed (nothing was entered to explain).
function collectNotMet(res, rule) {
    if (res.kind === 'leaf') {
        return res.state === false && typeof res.value === 'number'
            ? [{ field: res.leaf.field, text: describeNotMet(res, rule) }]
            : [];
    }
    return res.children.flatMap((c) => collectNotMet(c, rule));
}

function toMissing(fields, rule) {
    return unique(fields).map((field) => {
        const def = findInput(rule, field);
        return { field, label: def ? def.label : field };
    });
}

const missingReason = (missing) =>
    `Answer needed: ${missing.map((m) => m.label).join(', ')}`;

// ---------------------------------------------------------------- main entry

/**
 * @param {object} rule    a parsed condition JSON file
 * @param {object} inputs  { fieldId: value } as entered by the physician
 * @returns {{ruleId:string,label:string,status:'inpatient'|'observation'|'review',
 *            matched:{field:string,text:string}[],   // criteria that were met
 *            notMet:{field:string,text:string}[],    // entered numbers that missed a threshold
 *            missing:{field:string,label:string}[],  // required answers still needed
 *            reasons:string[]}}
 */
export function evaluate(rule, inputs = {}) {
    const base = { ruleId: rule.id, label: rule.label };

    // Prerequisites must pass before any criterion is checked.
    const failed = [];
    const unknownPrereq = [];
    for (const p of rule.prerequisites ?? []) {
        const r = evalLeaf(p, rule, inputs);
        if (r.state === false) {
            failed.push(p.failText ?? `Requirement not met: ${p.text ?? p.field}`);
        } else if (r.state === null) {
            unknownPrereq.push(p.field);
        }
    }
    // If a prerequisite failed, the criteria don't apply, so there is nothing to explain.
    if (failed.length) {
        return { ...base, status: 'review', matched: [], notMet: [], missing: [], reasons: failed };
    }

    const res = evalNode(rule.inpatient, rule, inputs);
    const notMet = dedupeByText(collectNotMet(res, rule));

    // An unanswered prerequisite sends the physician to Needs review, but we still list
    // every other missing required answer too, so one look shows everything that is needed.
    if (unknownPrereq.length) {
        const missing = toMissing([...unknownPrereq, ...collectUnknownFields(res)], rule);
        return {
            ...base,
            status: 'review',
            matched: [],
            notMet,
            missing,
            reasons: [missingReason(missing)],
        };
    }

    if (res.state === true) {
        return {
            ...base,
            status: 'inpatient',
            matched: dedupeByText(collectMatched(res, rule)),
            notMet,
            missing: [],
            reasons: [],
        };
    }
    if (res.state === false) {
        return {
            ...base,
            status: 'observation',
            matched: [],
            notMet,
            missing: [],
            reasons: [rule.observationText ?? 'No inpatient criteria met.'],
        };
    }
    const missing = toMissing(collectUnknownFields(res), rule);
    return {
        ...base,
        status: 'review',
        matched: [],
        notMet,
        missing,
        reasons: [missingReason(missing)],
    };
}

// ---------------------------------------------------------------- validation

/** Returns a list of problems with a condition file (empty list = valid). */
export function validateRule(rule) {
    if (!rule || typeof rule !== 'object') return ['rule is not an object'];
    const errors = [];
    const err = (m) => errors.push(`${rule.id ?? '(no id)'}: ${m}`);

    if (!rule.id || typeof rule.id !== 'string') err('missing "id"');
    if (!rule.label) err('missing "label"');
    if (!Array.isArray(rule.inputs) || rule.inputs.length === 0) {
        err('"inputs" must be a non-empty array');
        return errors;
    }

    const ids = new Set();
    for (const i of rule.inputs) {
        if (!i.id) err('an input has no "id"');
        else if (ids.has(i.id)) err(`duplicate input id "${i.id}"`);
        ids.add(i.id);
        if (!INPUT_TYPES.includes(i.type)) err(`input "${i.id}" has unknown type "${i.type}"`);
        if (!i.label) err(`input "${i.id}" has no "label"`);
    }

    const checkLeaf = (leaf, where) => {
        if (!ids.has(leaf.field)) err(`${where}: unknown field "${leaf.field}"`);
        if (!COMPARE_OPS.includes(leaf.op)) {
            err(`${where}: unknown op "${leaf.op}"`);
        } else if (leaf.op === 'between') {
            const ok = Array.isArray(leaf.value) && leaf.value.length === 2 &&
                leaf.value.every((v) => typeof v === 'number');
            if (!ok) err(`${where}: "between" needs value [low, high]`);
        } else if (NUMERIC_OPS.includes(leaf.op)) {
            if (typeof leaf.value !== 'number') err(`${where}: "${leaf.op}" needs a numeric value`);
        } else if (leaf.value === undefined) {
            err(`${where}: missing "value"`);
        }
    };

    const checkNode = (node, where) => {
        if (!node || typeof node !== 'object') return err(`${where}: not an object`);
        if (node.field !== undefined) return checkLeaf(node, where);

        const kinds = GROUP_KEYS.filter((k) => k in node);
        if (kinds.length !== 1) {
            return err(`${where}: a group needs exactly one of any / all / at_least_n`);
        }
        const kids = groupChildren(node);
        if (!Array.isArray(kids) || kids.length === 0) {
            return err(`${where}: group has no criteria` +
                (kinds[0] === 'at_least_n' ? ' (at_least_n needs an "of" list)' : ''));
        }
        if (kinds[0] === 'at_least_n') {
            const n = node.at_least_n;
            if (!Number.isInteger(n) || n < 1 || n > kids.length) {
                err(`${where}: at_least_n must be a whole number from 1 to ${kids.length}`);
            }
        }
        kids.forEach((k, idx) => checkNode(k, `${where}[${idx}]`));
    };

    (rule.prerequisites ?? []).forEach((p, idx) => checkLeaf(p, `prerequisites[${idx}]`));
    if (!rule.inpatient) err('missing "inpatient" criteria');
    else checkNode(rule.inpatient, 'inpatient');

    return errors;
}