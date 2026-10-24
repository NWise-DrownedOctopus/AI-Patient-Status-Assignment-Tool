<script setup>
import { computed } from 'vue'
import SegmentedControl from './SegmentedControl.vue'
import NumberStepper from './NumberStepper.vue'

// Builds the whole form from the condition's "inputs" list. Nothing here is
// specific to dyspnea: a new rule file gets a form for free.
const props = defineProps({
  rule: { type: Object, required: true },
  inputs: { type: Object, required: true }, // the shared { fieldId: value } object
})
const emit = defineEmits(['update'])

const YES_NO = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
]

const requiredFields = computed(() => props.rule.inputs.filter((f) => f.required))
const otherFields = computed(() => props.rule.inputs.filter((f) => !f.required))
</script>

<template>
  <div class="form">
    <!-- Required: the result stays "Needs review" until these are answered. -->
    <template v-for="field in requiredFields" :key="field.id">
      <div v-if="field.type === 'toggle'" class="field">
        <span class="field-label req">{{ field.label }}</span>
        <SegmentedControl
          :model-value="inputs[field.id]"
          :options="YES_NO"
          :label="field.label"
          allow-clear
          @update:model-value="emit('update', field.id, $event)"
        />
      </div>
      <NumberStepper
        v-else-if="field.type === 'number'"
        v-bind="field"
        :model-value="inputs[field.id]"
        @update:model-value="emit('update', field.id, $event)"
      />
    </template>

    <!-- Everything else: leave blank or off when it does not apply. -->
    <h3 v-if="otherFields.length" class="subhead">Other findings (leave off if not present)</h3>
    <template v-for="field in otherFields" :key="field.id">
      <label v-if="field.type === 'toggle'" class="switch-row">
        <span>{{ field.label }}</span>
        <input
          type="checkbox"
          role="switch"
          :checked="inputs[field.id] === true"
          @change="emit('update', field.id, $event.target.checked ? true : undefined)"
        />
      </label>
      <NumberStepper
        v-else-if="field.type === 'number'"
        v-bind="field"
        :model-value="inputs[field.id]"
        @update:model-value="emit('update', field.id, $event)"
      />
    </template>
  </div>
</template>
