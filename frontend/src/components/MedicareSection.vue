<script setup>
import { computed } from 'vue'
import SegmentedControl from './SegmentedControl.vue'
import { MEDICARE_EXCLUSIONS } from '../medicare.js'

// The extra questions for Medicare patients: how long the stay is expected to be, and
// whether one of the five exclusions applies. Shown only when the payer is Medicare.
const props = defineProps({
  medicare: { type: Object, required: true }, // { midnights, transfer, expired, ... }
  linked: { type: Set, required: true }, // exclusions already answered in the findings above
})
const emit = defineEmits(['update'])

const YES_NO = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
]

const isOn = (id) => props.linked.has(id) || props.medicare[id] === true
const activeCount = computed(() => MEDICARE_EXCLUSIONS.filter((e) => isOn(e.id)).length)
</script>

<template>
  <div class="medicare">
    <div class="field">
      <span class="field-label">Expect 2 or more midnights of hospital care?</span>
      <SegmentedControl
        :model-value="medicare.midnights"
        :options="YES_NO"
        label="Expect 2 or more midnights of hospital care"
        allow-clear
        @update:model-value="emit('update', 'midnights', $event)"
      />
      <p class="hint">
        Needed when the clinical criteria point to inpatient. A Medicare exclusion below can stand
        in for it.
      </p>
    </div>

    <details class="exclusions">
      <summary>
        <span class="summary-label">Medicare exclusions</span>
        <span v-if="activeCount" class="count">{{ activeCount }} selected</span>
      </summary>
      <label v-for="exclusion in MEDICARE_EXCLUSIONS" :key="exclusion.id" class="switch-row">
        <span class="switch-label">
          {{ exclusion.label }}
          <span v-if="linked.has(exclusion.id)" class="hint">From the findings above</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          :checked="isOn(exclusion.id)"
          :disabled="linked.has(exclusion.id)"
          @change="emit('update', exclusion.id, $event.target.checked ? true : undefined)"
        />
      </label>
    </details>
  </div>
</template>