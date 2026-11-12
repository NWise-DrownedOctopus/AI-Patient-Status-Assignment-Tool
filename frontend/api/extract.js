
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const url = process.env.VISION_SERVER_URL;
  const token = process.env.VISION_SERVER_TOKEN;

  if (!url || !token) {
    return res.status(503).json({
      error: 'Vision service not configured'
    });
  }

  const { image, prompt, schema } = req.body ?? {};

  if (
    typeof image !== 'string' ||
    image.length > 2_800_000 ||
    typeof prompt !== 'string' ||
    prompt.length > 12_000 ||
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema)
  ) {
    return res.status(400).json({
      error: 'Invalid extraction request'
    });
  }

  try {
    const response = await fetch(
      `${url.replace(/\/$/, '')}/extract`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image,
          prompt,
          schema
        }),
        signal: AbortSignal.timeout(125_000)
      }
    );

    const result = await response.json();

    return res.status(response.status).json(result);

  } catch (error) {
    console.error('Vision forwarding failed:', error.message);

    return res.status(502).json({
      error: 'Vision service unavailable'
    });
  }
}
