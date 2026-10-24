<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { evaluate } from './engine.js'
import { rules } from './rules.js'
import SegmentedControl from './components/SegmentedControl.vue'
import ConditionPicker from './components/ConditionPicker.vue'
import ConditionForm from './components/ConditionForm.vue'
import ResultBar from './components/ResultBar.vue'

// Everything the physician has chosen lives here.
const payer = ref(null) // 'medicare' | 'other' | null  (used by the Medicare layer in the next step)
const selectedId = ref(null)
const inputs = reactive({}) // { fieldId: value } for the selected condition

const PAYERS = [
  { value: 'medicare', label: 'Medicare' },
  { value: 'other', label: 'Other' },
]

const selected = computed(() => rules.find((r) => r.id === selectedId.value) ?? null)

// The result is recomputed automatically whenever any input changes: no submit button.
const result = computed(() => (selected.value ? evaluate(selected.value, inputs) : null))

// Switching condition starts a fresh form.
watch(selectedId, () => {
  for (const key of Object.keys(inputs)) delete inputs[key]
})

// A blank value removes the field, so "not answered" is truly "not answered".
function setInput(id, value) {
  if (value === undefined || value === null || value === '') delete inputs[id]
  else inputs[id] = value
}
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
    </main>

    <ResultBar :result="result" />
  </div>
</template>