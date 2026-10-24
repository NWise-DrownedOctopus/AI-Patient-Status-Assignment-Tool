// Payer layer: sits on top of the clinical result from engine.js.
//
// Plain JavaScript, like engine.js: no Vue, no browser APIs.
//
// What the hospital guide says for Medicare patients admitted as inpatient: the condition
// must be expected to need at least 2 midnights to treat and stabilize, OR one of five
// exclusions applies. The clinical rules of thumb (engine.js) apply to every payer; this
// layer only ever restricts an Inpatient result for Medicare.
//
//   clinical result      payer        what happens
//   -------------------  -----------  ------------------------------------------------------
//   Observation / Review (any)        unchanged
//   Inpatient            not chosen   Needs review: payer is needed
//   Inpatient            other        Inpatient
//   Inpatient            Medicare     Inpatient if 2+ midnights expected or an exclusion applies;
//                                     otherwise Needs review (the tool never downgrades by itself)

export const MEDICARE_EXCLUSIONS = [
  { id: 'transfer', label: 'Needs to be transferred' },
  { id: 'expired', label: 'Expired' },
  { id: 'left_ama', label: 'Left against medical advice (AMA)' },
  { id: 'ventilation', label: 'Requires ventilation' },
  { id: 'improved_faster', label: 'Got better faster than expected (documented by physician)' },
];

// A condition file can say "my input X is the same fact as exclusion Y", so the physician
// is never asked twice. Example in dyspnea.json:
//   "medicare": { "exclusions": { "ventilation": "ventilation" } }
// meaning: if the "ventilation" finding is on, the ventilation exclusion is met.
export function linkedExclusions(rule, inputs = {}) {
  const map = rule?.medicare?.exclusions ?? {};
  return MEDICARE_EXCLUSIONS.filter((e) => map[e.id] && inputs[map[e.id]] === true).map(
    (e) => e.id,
  );
}

// Exclusions that apply: ticked in the Medicare card, or already answered in the findings.
export function activeExclusions(rule, inputs = {}, medicare = {}) {
  const linked = new Set(linkedExclusions(rule, inputs));
  return MEDICARE_EXCLUSIONS.filter((e) => linked.has(e.id) || medicare[e.id] === true);
}

/**
 * @param {object} clinical  result of evaluate()
 * @param {object} context   { payer: 'medicare'|'other'|null, medicare: { midnights, ...exclusion ids },
 *                             rule, inputs }
 * @returns the clinical result, adjusted for the payer, plus
 *          medicare: { lines: string[] } | null   (what satisfied the Medicare requirement)
 */
export function applyPayer(clinical, { payer, medicare = {}, rule, inputs = {} }) {
  // Only an Inpatient result can be restricted by the payer.
  if (clinical.status !== 'inpatient') return { ...clinical, medicare: null };

  if (payer === 'other') return { ...clinical, medicare: null };

  if (payer !== 'medicare') {
    return {
      ...clinical,
      status: 'review',
      missing: [{ field: 'payer', label: 'Payer' }],
      reasons: ['Answer needed: Payer (Medicare adds a 2-midnight requirement)'],
      medicare: null,
    };
  }

  const lines = [];
  if (medicare.midnights === true) {
    lines.push('Medicare: 2 or more midnights of hospital care expected');
  }
  for (const exclusion of activeExclusions(rule, inputs, medicare)) {
    lines.push(`Medicare exclusion: ${exclusion.label}`);
  }
  if (lines.length) return { ...clinical, medicare: { lines } };

  if (medicare.midnights === false) {
    return {
      ...clinical,
      status: 'review',
      missing: [],
      reasons: [
        'Medicare: clinical criteria are met, but fewer than 2 midnights are expected and no exclusion applies.',
        'Reassess the expected length of stay, check the exclusions, or use physician judgment (observation may fit).',
      ],
      medicare: null,
    };
  }

  return {
    ...clinical,
    status: 'review',
    missing: [{ field: 'midnights', label: 'Expected 2+ midnights (Medicare)' }],
    reasons: [
      'Answer needed: Expected 2+ midnights (Medicare)',
      'Medicare inpatient care needs 2 or more expected midnights, or one of the 5 exclusions.',
    ],
    medicare: null,
  };
}
