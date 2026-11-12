
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the image.'))
        return
      }

      resolve(reader.result.split(',')[1])
    }

    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function extractPatientFields(file, rule) {
  if (!file?.type.startsWith('image/')) {
    throw new Error('Select an image file.')
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image must be smaller than 10 MB.')
  }

  const image = await toBase64(file)

  const schema = {
    type: 'object',
    properties: Object.fromEntries(
      rule.inputs.map(field => [
        field.id,
        {
          type: field.type === 'number'
            ? ['number', 'null']
            : ['boolean', 'null']
        }
      ])
    ),
    required: rule.inputs.map(field => field.id),
    additionalProperties: false
  }

  const definitions = rule.inputs.map(field => ({
    id: field.id,
    label: field.label,
    type: field.type,
    unit: field.unit ?? null
  }))

  
alert(
  'Image type: ' + typeof image +
  '\nImage length: ' + image?.length +
  '\nImage prefix: ' + image?.substring(0, 30)
);

const response = await fetch('/api/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image,
    schema,
    prompt: `
Transcribe the medical findings in this image.

Extract ONLY these fields:
${JSON.stringify(definitions)}

Rules:
- Use only explicitly documented information.
- Do not infer diagnoses or clinical findings.
- For toggles, true means explicitly present.
- False means explicitly documented as absent.
- Null means missing, unclear, or unreadable.
- Convert numerical units only when unambiguous.
- Return no information outside the JSON schema.
`
  })
})


if (!response.ok) {
  const errorBody = await response.text();

  console.error('Ollama error response:', {
    status: response.status,
    body: errorBody
  });

  throw new Error(
    `Ollama request failed (${response.status}): ${errorBody}`
  );
}

  const data = await response.json()
  const raw = JSON.parse(data.message.content)

  const validated = {}

  for (const field of rule.inputs) {
    const value = raw[field.id]

    if (value === null || value === undefined) {
      validated[field.id] = null
    } else if (field.type === 'toggle') {
      validated[field.id] =
        typeof value === 'boolean' ? value : null
    } else if (field.type === 'number') {
      const valid =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (field.min == null || value >= field.min) &&
        (field.max == null || value <= field.max)

      validated[field.id] = valid ? value : null
    }
  }

  return validated
}
