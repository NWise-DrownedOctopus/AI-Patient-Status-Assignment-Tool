<script setup>
// A row of big buttons where one can be selected (Medicare / Other, Yes / No).
// Tap the selected one again to clear it when allow-clear is set.
const props = defineProps({
  modelValue: { default: undefined },
  options: { type: Array, required: true }, // [{ value, label }]
  label: String,
  allowClear: Boolean,
})
const emit = defineEmits(['update:modelValue'])

function pick(value) {
  const clearing = props.allowClear && props.modelValue === value
  emit('update:modelValue', clearing ? undefined : value)
}
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :class="{ on: modelValue === option.value }"
      @click="pick(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
