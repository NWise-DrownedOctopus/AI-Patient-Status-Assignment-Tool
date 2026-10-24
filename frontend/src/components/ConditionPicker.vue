<script setup>
// One button per condition file found in src/rules/.
defineProps({
  rules: { type: Array, required: true },
  modelValue: { default: null },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="chips">
    <button
      v-for="rule in rules"
      :key="rule.id"
      type="button"
      class="chip"
      :class="{ on: rule.id === modelValue }"
      :aria-pressed="rule.id === modelValue"
      @click="emit('update:modelValue', rule.id)"
    >
      {{ rule.label }}
    </button>
  </div>
</template>
