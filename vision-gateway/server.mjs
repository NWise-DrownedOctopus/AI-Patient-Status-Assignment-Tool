
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = 3001;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'qwen2.5vl:3b';

const TOKEN = process.env.VISION_GATEWAY_TOKEN;

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

if (!TOKEN || TOKEN.length < 32) {
  console.error('Set VISION_GATEWAY_TOKEN (32+ characters).');
  process.exit(1);
}

let busy = false;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function authorized(header) {
  if (typeof header !== 'string') return false;

  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const actual = Buffer.from(header);

  return actual.length === expected.length &&
    timingSafeEqual(actual, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/extract' || req.method !== 'POST') {
    return send(res, 404, { error: 'Not found' });
  }

  if (!authorized(req.headers.authorization)) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  if (busy) {
    return send(res, 429, { error: 'The vision model is currently processing another document. Please try again in a moment.' });
  }

  const contentLength = Number(req.headers['content-length']);

  if (
    req.headers['content-type']?.split(';')[0] !== 'application/json' ||
    (req.headers['content-length'] &&
      (!Number.isFinite(contentLength) ||
       contentLength > MAX_BODY_BYTES))
  ) {
    return send(res, 413, { error: 'Invalid or oversized request' });
  }

  busy = true;

  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw);

    const { image, prompt, schema } = payload;

    if (
      typeof image !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image) ||
      image.length > 2_800_000 ||
      typeof prompt !== 'string' ||
      prompt.length > 12_000 ||
      !schema ||
      typeof schema !== 'object' ||
      Array.isArray(schema) ||
      JSON.stringify(schema).length > 15_000
    ) {
      return send(res, 400, { error: 'Invalid extraction request' });
    }

    const ollamaResponse = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: prompt,
          images: [image]
        }],
        format: schema,
        stream: false,
        options: {
          temperature: 0,
          num_ctx: 8192,
          num_predict: 1024
        }
      })
    });

    if (!ollamaResponse.ok) {
      const detail = (await ollamaResponse.text()).slice(0, 1000);
      console.error('Ollama error:', ollamaResponse.status, detail);

      return send(res, 502, {
        error: 'Local model inference failed'
      });
    }

    const result = await ollamaResponse.json();

    return send(res, 200, {
      message: {
        content: result.message?.content ?? ''
      }
    });

  } catch (error) {
    console.error('Gateway error:', error.message);

    if (!res.headersSent) {
      return send(res, 502, {
        error: 'Vision gateway request failed'
      });
    }
  } finally {
    busy = false;
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(PORT, HOST, () => {
  console.log(`Vision gateway listening on http://${HOST}:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
