<script setup>
import { computed, ref } from 'vue'

// The bar stuck to the bottom of the screen. It shows the recommendation at a glance;
// tap it to see every criterion behind it.
const props = defineProps({
  result: { type: Object, default: null }, // output of evaluate(), or null before a condition is chosen
})

const open = ref(false)

const LABELS = {
  inpatient: 'Inpatient',
  observation: 'Observation',
  review: 'Needs review',
}

const status = computed(() => props.result?.status ?? 'idle')
const label = computed(() => LABELS[status.value] ?? '')

// One line that stays visible when the bar is collapsed.
const summary = computed(() => {
  const r = props.result
  if (!r) return 'Choose a condition to begin'
  if (r.status === 'inpatient') {
    const more = r.matched.length - 1
    return r.matched[0].text + (more > 0 ? ` (+${more} more)` : '')
  }
  return r.reasons[0] ?? ''
})

const canExpand = computed(() => props.result !== null)
</script>

<template>
  <footer class="result" :class="status">
    <button
      type="button"
      class="result-head"
      :aria-expanded="canExpand ? open : undefined"
      :disabled="!canExpand"
      @click="open = !open"
    >
      <span v-if="label" class="badge">{{ label }}</span>
      <span class="summary" aria-live="polite">{{ summary }}</span>
      <span v-if="canExpand" class="chevron" :class="{ flipped: open }" aria-hidden="true">▲</span>
    </button>

    <div v-if="open && result" class="result-body">
      <template v-if="result.matched.length">
        <h3>Criteria met</h3>
        <ul>
          <li v-for="m in result.matched" :key="m.text">{{ m.text }}</li>
        </ul>
      </template>

      <template v-if="result.missing.length">
        <h3>Still needed</h3>
        <ul>
          <li v-for="m in result.missing" :key="m.field">{{ m.label }}</li>
        </ul>
      </template>

      <!-- Numbers that were entered but fell short of a threshold, so a value like
           "50 mL" never leaves the physician wondering why it didn't count. -->
      <template v-if="result.notMet.length">
        <h3>Checked, not met</h3>
        <ul>
          <li v-for="m in result.notMet" :key="m.text">{{ m.text }}</li>
        </ul>
        <p v-if="result.status !== 'inpatient'" class="note">
          Not meeting a threshold does not by itself rule out inpatient care. The decision rests on
          physician judgment.
        </p>
      </template>

      <template v-if="result.reasons.length">
        <h3>Why</h3>
        <ul>
          <li v-for="reason in result.reasons" :key="reason">{{ reason }}</li>
        </ul>
      </template>
    </div>
  </footer>
</template>