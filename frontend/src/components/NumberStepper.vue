<script setup>
import { computed } from 'vue'

// ConditionForm hands over the whole field definition from the rule file, which
// includes a "type" entry this component doesn't need. This keeps it from leaking
// onto the page as a stray HTML attribute.
defineOptions({ inheritAttrs: false })

// A number field with big minus / plus buttons for phones.
// First tap on an empty field jumps to `start` (a typical normal value from the rule file).
const props = defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  unit: String,
  min: Number,
  max: Number,
  step: { type: Number, default: 1 },
  start: Number,
  required: Boolean,
  modelValue: { default: undefined }, // number, or the text typed so far
})
const emit = defineEmits(['update:modelValue'])

// How many decimals the step has (0.01 -> 2), so 7.35 + 0.01 doesn't become 7.360000001.
const decimals = computed(() => {
  const text = String(props.step)
  return text.includes('.') ? text.split('.')[1].length : 0
})

// The current number, or null if blank / not a number.
const current = computed(() => {
  if (props.modelValue === undefined || props.modelValue === '') return null
  const n = Number(props.modelValue)
  return Number.isNaN(n) ? null : n
})

function bump(direction) {
  let next =
    current.value === null
      ? (props.start ?? props.min ?? 0)
      : Number((current.value + direction * props.step).toFixed(decimals.value))
  if (props.max !== undefined) next = Math.min(next, props.max)
  if (props.min !== undefined) next = Math.max(next, props.min)
  emit('update:modelValue', next)
}

function onInput(event) {
  const text = event.target.value.trim()
  emit('update:modelValue', text === '' ? undefined : text)
}
</script>

<template>
  <div class="field">
    <label :for="id" class="field-label" :class="{ req: required }">
      {{ label }}<span v-if="unit" class="unit"> ({{ unit }})</span>
    </label>
    <div class="stepper">
      <button type="button" class="step-btn" :aria-label="`Decrease ${label}`" @click="bump(-1)">−</button>
      <input
        :id="id"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder="—"
        :value="modelValue ?? ''"
        @input="onInput"
      />
      <button type="button" class="step-btn" :aria-label="`Increase ${label}`" @click="bump(1)">+</button>
      <button
        type="button"
        class="clear-btn"
        :aria-label="`Clear ${label}`"
        :disabled="current === null && (modelValue === undefined || modelValue === '')"
        @click="emit('update:modelValue', undefined)"
      >
        ×
      </button>
    </div>
  </div>
</template>
