# Adding or changing a condition

Everything clinical lives in two JSON files per condition. No code changes.

| File | Purpose |
| --- | --- |
| `frontend/src/rules/<id>.json` | the rule: inputs, criteria, wording |
| `frontend/src/cases/<id>-cases.json` | test cases: patients and the answer we expect |

The `<id>` is lowercase with underscores (`chest_pain`). It must match the `"id"` inside the rule.

## Five steps

1. Copy a similar rule file as a starting point (`hypertension.json` is the simplest).
2. Change `id`, `label`, `source`, the `inputs` and the `inpatient` criteria.
3. Copy a cases file, rename it `<id>-cases.json`, and write cases (see below).
4. Run `npm run test:engine` from `frontend/`. A typo in a rule fails the "is valid" test with a plain message.
5. Run `npm run dev`, open the app: the condition is already in the picker. Try it on your phone.

## Rule file reference

```json
{
  "id": "cellulitis",
  "label": "Cellulitis",
  "source": "Where in the guide this comes from",
  "inputs": [ ... ],
  "prerequisites": [ ... ],
  "inpatient": { ... },
  "observation": { ... },
  "reviewWhen": [ ... ],
  "notes": [ ... ],
  "noteName": "...",
  "medicare": { "exclusions": { ... } },
  "observationText": "..."
}
```

Required: `id`, `label`, `inputs`, `inpatient`. Everything else is optional.

### inputs: the form

Each input becomes a field. Two types:

```json
{ "id": "stable", "label": "Hemodynamically stable", "type": "toggle", "required": true }
{ "id": "o2sat", "label": "O2 saturation", "type": "number", "unit": "%",
  "min": 50, "max": 100, "step": 1, "start": 95, "required": true }
```

- `id`: unique within the file; criteria refer to it.
- `required: true`: the physician must answer. A required Yes/No shows as a **Yes / No** pair;
  a required number shows first. Until answered, the result is **Needs review** and names it.
- Not required (the default): a toggle is a switch that is off unless present; a blank number
  counts as **not present**. Use this for findings that only matter when they exist.
- `start` is the value the first tap on **+** jumps to (use a normal value, e.g. 95 for oxygen saturation).
- `min`/`max`/`step` shape the number stepper. `step` can be `0.01`, `0.1`, `1`...

**Rule of thumb:** make an input `required` only if the guide's decision truly depends on it being
known (a stem condition like "hemodynamically stable", or a screening question like suicidal ideation).

### criteria: the `inpatient` block

A **leaf** tests one input:

```json
{ "field": "o2sat", "op": "<", "value": 90, "text": "O2 saturation {value}% is below 90%" }
```

- `op`: `<  <=  >  >=  ==  !=  is  between`. Use `is` with `true`/`false` for toggles.
  `between` takes `[low, high]` and includes both ends.
- `text`: what the physician sees when it is met. `{value}` is replaced by what they entered.
  Leave `text` out and the input's label is used.
- If the criterion is **not** met and the value was a number, the tool automatically writes
  "O2 saturation 94%: not met (needs below 90%)" from the operator and unit. Nothing to write.

A **group** combines criteria and can be nested:

| Group | Meaning | Guide wording |
| --- | --- | --- |
| `{ "any": [...] }` | at least one is true | "one or more of the following" |
| `{ "all": [...] }` | every one is true | "and", "both" |
| `{ "at_least_n": 2, "of": [...] }` | at least N are true | "2 or more of the following" |
| `{ "not": <criteria> }` | true when the inner criteria are false | "unless", "without" |

Example: "BUN over 45 **or** creatinine over 3" counts as ONE finding toward "2 or more", so it
is an `any` group nested inside the `at_least_n` list (see `vomiting_diarrhea.json`).

### How blanks work

- Required input blank: criteria using it are **unknown**. If nothing else is true, the result is
  **Needs review**, naming the blank field.
- Optional input blank: counts as **not present** (false).
- **A criterion that is met always wins**, even if other fields are blank.
- If the physician has entered nothing the criteria can use, the result is Needs review
  ("Enter the patient's findings"), never Observation on an empty form.

### prerequisites

Conditions that must hold before the criteria apply (the guide's "and is hemodynamically stable").
Each is a leaf plus a `failText`. If one fails, the result is Needs review showing `failText`;
if unanswered, it is listed as missing.

```json
"prerequisites": [
  { "field": "stable", "op": "is", "value": true, "text": "Patient is hemodynamically stable",
    "failText": "Patient is not hemodynamically stable. Use clinical judgment." }
]
```

### observation (optional)

Findings the guide says point toward observation. They never change the result; they are listed
under "Findings that fit observation" so the physician sees why. Same format as `inpatient`.

### reviewWhen (optional)

For "do not default to Observation in this situation". If the patient is not inpatient and `when`
is true, the result is **Needs review** with `text`. It never overrides an Inpatient result.

```json
"reviewWhen": [
  { "when": { "all": [ { "field": "stone", "op": "is", "value": true },
                       { "not": { "field": "temp_f", "op": "<", "value": 99.4 } } ] },
    "text": "Renal stone is observation-level only without fever. Enter the temperature or use judgment." }
]
```

### notes, noteName, observationText

- `notes`: reminders shown with every result for this condition (e.g. "Neuro checks every 4 hours").
- `noteName`: how the condition reads in the chart note. Default is the label in lowercase
  ("...treatment of dyspnea."). Set it when that reads badly ("a high-risk condition").
- `observationText`: the "Why" line when the result is Observation. If the guide gives no
  observation criteria for the condition, say so and defer to judgment.

### medicare.exclusions (optional)

Medicare inpatient needs 2+ midnights expected **or** one of five exclusions (transfer, expired,
left AMA, ventilation, improved faster than expected). If one of your inputs *is* an exclusion,
link it so the physician is not asked twice:

```json
"medicare": { "exclusions": { "ventilation": "ventilation" } }
```

The left side is the exclusion id (`transfer`, `expired`, `left_ama`, `ventilation`,
`improved_faster`); the right side is the id of a **toggle** input in this file. When that toggle is
on, the Medicare card shows the exclusion as already ticked. Most conditions need none.

## Cases file reference

A list of patients and the answer we expect. This is what makes a rule trustworthy; write cases
when you write the rule.

```json
{
  "name": "Temperature 101 is not over 101 -> observation",
  "inputs": { "failed_op": true, "temp_f": 101 },
  "expect": { "status": "observation", "notMet": ["temp_f"] }
}
```

`expect` keys (only `status` is required; add the others to be precise):

| Key | Checks |
| --- | --- |
| `status` | `inpatient`, `observation` or `review` |
| `matched` | input ids behind "criteria met" |
| `notMet` | input ids in "checked, not met" |
| `missing` | input ids named as still needed |
| `supports` | input ids in "findings that fit observation" |
| `reasonIncludes` | text that must appear in "Why" |
| `notesInclude` | text that must appear in the reminders |

For Medicare, add `"payer": "medicare"` and `"medicare": { "midnights": true }` (or an exclusion
such as `"left_ama": true`). A case without a `payer` key tests the clinical rule only.

**Always include:** a case on each side of every threshold (`> 100`: test 100 and 101), a case with
nothing entered, a case with a required answer missing, and one Medicare case.

The test suite also checks automatically that every condition has an inpatient case and a
non-inpatient case, that an empty form never gives a recommendation, and that no chart note ever
contains "admit to observation" or "observe overnight".

## Wording rules (from the guide; payers care)

- Inpatient: "Admit to inpatient for monitoring and/or treatment of ..."
- Observation is a noun: "Place the patient in observation." Never "admit to observation".
- We monitor patients overnight; we do not "observe" them overnight.

Keep `text` and `observationText` free of those phrasings; a test fails if they slip in.

## Things the tool deliberately does not do

- It never changes a clinical result by itself beyond the Medicare check, and never downgrades
  an Inpatient recommendation to Observation. Unclear situations become **Needs review**.
- It is advisory. Do not word anything as an order or a final determination.
