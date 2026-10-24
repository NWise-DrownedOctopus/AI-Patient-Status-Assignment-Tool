<script setup>
import { onBeforeUnmount, ref } from 'vue'

// The chart note, ready to paste. Shown only when there is a recommendation to document.
const props = defineProps({
  note: { type: String, required: true },
})

const state = ref('idle') // 'idle' | 'copied' | 'failed'
let timer = null

async function copy() {
  let ok = false
  try {
    await navigator.clipboard.writeText(props.note)
    ok = true
  } catch {
    // Older browsers, or a page without clipboard permission: fall back to a hidden textarea.
    try {
      const box = document.createElement('textarea')
      box.value = props.note
      box.setAttribute('readonly', '')
      box.style.position = 'fixed'
      box.style.opacity = '0'
      document.body.appendChild(box)
      box.select()
      ok = document.execCommand('copy')
      document.body.removeChild(box)
    } catch {
      ok = false
    }
  }
  state.value = ok ? 'copied' : 'failed'
  clearTimeout(timer)
  timer = setTimeout(() => (state.value = 'idle'), 2500)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <section class="card note-card">
    <h2 class="section-title">Chart note</h2>
    <pre class="note-text">{{ note }}</pre>
    <button type="button" class="copy-btn" :class="{ done: state === 'copied' }" @click="copy">
      {{ state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed: select the text above' : 'Copy note' }}
    </button>
  </section>
</template>
