<script setup>
import { ref, watch } from 'vue'
import { extractPatientFields } from '../services/vision.js'

const props = defineProps({
  rule: { type: Object, required: true }
})

const emit = defineEmits(['apply'])

const file = ref(null)
const extracted = ref(null)
const loading = ref(false)
const error = ref('')
const generation = ref(0)

watch(() => props.rule.id, () => {
  generation.value++
  file.value = null
  extracted.value = null
  error.value = ''
  loading.value = false
})

function selectFile(event) {
  file.value = event.target.files?.[0] ?? null
  extracted.value = null
  error.value = ''
}

async function extract() {
  if (!file.value || loading.value) return

  const requestGeneration = ++generation.value
  const rule = props.rule

  loading.value = true
  error.value = ''
  extracted.value = null

  try {
    const result = await extractPatientFields(file.value, rule)

    // Ignore a result from a previous condition/request.
    if (requestGeneration !== generation.value ||
        props.rule.id !== rule.id) return

    extracted.value = result
  } catch (err) {
    if (requestGeneration === generation.value) {
      error.value = err.message
    }
  } finally {
    if (requestGeneration === generation.value) {
      loading.value = false
    }
  }
}

function editNumber(id, event) {
  const value = event.target.value
  extracted.value[id] = value === '' ? null : Number(value)
}

function editToggle(id, event) {
  const value = event.target.value

  extracted.value[id] =
    value === 'unknown' ? null : value === 'true'
}

function apply() {
  if (!extracted.value) return

  for (const field of props.rule.inputs) {
    const value = extracted.value[field.id]

    if (field.type === 'number' && value !== null) {
      if (!Number.isFinite(value) ||
          (field.min != null && value < field.min) ||
          (field.max != null && value > field.max)) {
        error.value = `Invalid value for ${field.label}.`
        return
      }
    }
  }

  emit('apply', {
    ruleId: props.rule.id,
    values: { ...extracted.value }
  })

  extracted.value = null
}
</script>

<template>
  <div class="image-import">
    <h3>Import findings from image</h3>

    <label for="intake-image">
      Patient document image
    </label>

    <input
      id="intake-image"
      type="file"
      accept="image/*"
      @change="selectFile"
    />

    <button
      type="button"
      class="copy-btn"
      :disabled="!file || loading"
      @click="extract"
    >
      {{ loading ? 'Extracting...' : 'Extract findings' }}
    </button>

    <p v-if="loading" role="status">
      Analyzing image locally. This may take a moment.
    </p>

    <p v-if="error" role="alert">
      {{ error }}
    </p>

    <div v-if="extracted" class="extraction-review">
      <h3>Review extracted findings</h3>

      <p>
        Confirm or correct every finding before applying.
        Unknown means the document did not provide a
        reliable value.
      </p>

      <div
        v-for="field in rule.inputs"
        :key="field.id"
        class="field"
      >
        <label :for="'extracted-' + field.id">
          {{ field.label }}
          <span v-if="field.unit">({{ field.unit }})</span>
        </label>

        <select
          v-if="field.type === 'toggle'"
          :id="'extracted-' + field.id"
          :value="extracted[field.id] === null
            ? 'unknown'
            : String(extracted[field.id])"
          @change="editToggle(field.id, $event)"
        >
          <option value="unknown">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>

        <input
          v-else
          :id="'extracted-' + field.id"
          type="number"
          :value="extracted[field.id] ?? ''"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? 'any'"
          placeholder="Unknown"
          @input="editNumber(field.id, $event)"
        />
      </div>

      <button
        type="button"
        class="copy-btn"
        @click="apply"
      >
        Apply reviewed findings
      </button>
    </div>
  </div>
</template>
