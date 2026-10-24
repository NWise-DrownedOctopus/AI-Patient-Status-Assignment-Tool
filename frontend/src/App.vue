<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { evaluate } from './engine.js'
import { applyPayer, linkedExclusions } from './medicare.js'
import { rules } from './rules.js'
import SegmentedControl from './components/SegmentedControl.vue'
import ConditionPicker from './components/ConditionPicker.vue'
import ConditionForm from './components/ConditionForm.vue'
import MedicareSection from './components/MedicareSection.vue'
import ResultBar from './components/ResultBar.vue'

// Everything the physician has chosen lives here.
const payer = ref(null) // 'medicare' | 'other' | null
const selectedId = ref(null)
const inputs = reactive({}) // { fieldId: value } for the selected condition
const medicare = reactive({}) // { midnights, transfer, expired, ... } for Medicare patients

const PAYERS = [
  { value: 'medicare', label: 'Medicare' },
  { value: 'other', label: 'Other' },
]

const selected = computed(() => rules.find((r) => r.id === selectedId.value) ?? null)

// Medicare exclusions the physician already answered in the findings (e.g. ventilation).
const linked = computed(() => new Set(selected.value ? linkedExclusions(selected.value, inputs) : []))

// Two steps, both recomputed automatically on any change (no submit button):
// 1. the clinical result from the condition's rules, 2. adjusted for the payer.
const clinical = computed(() => (selected.value ? evaluate(selected.value, inputs) : null))
const result = computed(() =>
  clinical.value
    ? applyPayer(clinical.value, {
        payer: payer.value,
        medicare,
        rule: selected.value,
        inputs,
      })
    : null,
)

// Switching condition starts a fresh form. The Medicare answers stay: they describe the
// patient's stay, not the condition.
watch(selectedId, () => {
  for (const key of Object.keys(inputs)) delete inputs[key]
})

// A blank value removes the field, so "not answered" is truly "not answered".
function setValue(target, id, value) {
  if (value === undefined || value === null || value === '') delete target[id]
  else target[id] = value
}
const setInput = (id, value) => setValue(inputs, id, value)
const setMedicare = (id, value) => setValue(medicare, id, value)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Level of Care</h1>
      <p>Inpatient vs. observation, based on the hospital guide</p>
    </header>

    <main class="content">
      <section class="card">
        <h2 class="section-title">Payer</h2>
        <SegmentedControl v-model="payer" :options="PAYERS" label="Payer" allow-clear />
      </section>

      <section class="card">
        <h2 class="section-title">Condition</h2>
        <ConditionPicker v-model="selectedId" :rules="rules" />
      </section>

      <section v-if="selected" class="card">
        <h2 class="section-title">Findings</h2>
        <ConditionForm :key="selected.id" :rule="selected" :inputs="inputs" @update="setInput" />
      </section>

      <section v-if="selected && payer === 'medicare'" class="card">
        <h2 class="section-title">Medicare</h2>
        <MedicareSection :medicare="medicare" :linked="linked" @update="setMedicare" />
      </section>
    </main>

    <ResultBar :result="result" />
  </div>
</template>