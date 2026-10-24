// Loads every condition file in src/rules/.
// Drop a new JSON file into that folder and it appears in the condition picker,
// with no code changes. (This file uses a Vite feature, so it is kept apart from
// engine.js, which has to run in plain Node for the tests.)

import { validateRule } from './engine.js'

const modules = import.meta.glob('./rules/*.json', { eager: true })

const loaded = Object.values(modules).map((m) => m.default ?? m)

// A contributor's typo should never crash the app: skip the bad file and say why.
export const rules = loaded
  .filter((rule) => {
    const problems = validateRule(rule)
    if (problems.length) console.error('Skipping rule file:', problems)
    return problems.length === 0
  })
  .sort((a, b) => a.label.localeCompare(b.label))
