// Localhost and Intranet HTTP Fetcher MCP tool (local_fetch).
// Enables AI to test local backend APIs and LAN services safely from remote interfaces (Claude Web, ChatGPT).
// Defense-in-depth against SSRF: validates every redirect hop, blocks cloud metadata/link-local targets,
// enforces a real 512KB streaming response cap, and enforces strict timeout bounds.
import dns from 'node:dns/promises';
import net from 'node:net';
import { z } from 'zod';
import { ok, fail } from './mcp-tool.js';

const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./, // AWS / GCP / Azure IMDS Link-Local
  /^metadata\.google\.internal$/i,
  /^fd[0-9a-f]{2}:/i, // IPv6 Unique Local (legacy policy retained)
  /^fe8[0-9a-f]:/i,
  /^fe9[0-9a-f]:/i,
  /^fea[0-9a-f]:/i,
  /^feb[0-9a-f]:/i, // IPv6 Link-Local fe80::/10
];

const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB cap
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

function normalizedHostname(hostname) {
  // URL.hostname includes brackets for IPv6 in some Node versions.
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function isBlockedHost(hostname) {
  const host = normalizedHostname(hostname);
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(host));
}

async function assertSafeTarget(parsedUrl) {
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Forbidden protocol "${parsedUrl.protocol}". Only http: and https: are allowed.`);
  }
  if (isBlockedHost(parsedUrl.hostname)) {
    throw new Error(`Access to link-local/cloud-metadata host "${parsedUrl.hostname}" is blocked for security.`);
  }

  // Hostname checks alone are bypassable by DNS names resolving to metadata/link-local addresses.
  // Resolve before every hop and apply the same policy to every returned address.
  const host = normalizedHostname(parsedUrl.hostname);
  const literalFamily = net.isIP(host);
  const addresses = literalFamily ? [{ address: host, family: literalFamily }] : await dns.lookup(host, { all: true, verbatim: true });
  for (const { address } of addresses) {
    if (isBlockedHost(address)) {
      throw new Error(`Access to link-local/cloud-metadata address "${address}" resolved from "${parsedUrl.hostname}" is blocked for security.`);
    }
  }
}

function redirectHeaders(headers, fromUrl, toUrl) {
  if (fromUrl.origin === toUrl.origin) return headers;
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

async function readCappedText(res) {
  if (!res.body) return { text: '', truncated: false, bytesReceived: 0 };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_RESPONSE_BYTES - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const take = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      total += take.byteLength;
      text += decoder.decode(take, { stream: true });
      if (take.byteLength < value.byteLength) {
        truncated = true;
        break;
      }
    }
    text += decoder.decode();
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { text, truncated, bytesReceived: total };
}

export async function executeFetch({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 5000,
}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }

  const safeTimeout = Math.min(Math.max(timeoutMs || 5000, 500), 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), safeTimeout);

  try {
    let currentUrl = parsedUrl;
    let currentMethod = method.toUpperCase();
    let currentHeaders = {
      'User-Agent': 'Aki-MCP-LocalFetch/2.0',
      ...headers,
    };
    let currentBody;
    if (body && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
      currentBody = typeof body === 'object' ? JSON.stringify(body) : String(body);
      if (!currentHeaders['Content-Type'] && !currentHeaders['content-type']) {
        currentHeaders['Content-Type'] = 'application/json';
      }
    }

    let res;
    for (let redirects = 0; ; redirects++) {
      await assertSafeTarget(currentUrl);
      res = await fetch(currentUrl.toString(), {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (!REDIRECT_STATUS.has(res.status)) break;
      const location = res.headers.get('location');
      if (!location) break;
      if (redirects >= MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);

      const nextUrl = new URL(location, currentUrl);
      await assertSafeTarget(nextUrl);
      currentHeaders = redirectHeaders(currentHeaders, currentUrl, nextUrl);

      // Match normal fetch/browser redirect semantics closely: 303 always becomes GET (except HEAD),
      // and 301/302 turn POST into GET. 307/308 preserve method/body.
      if (res.status === 303 && currentMethod !== 'HEAD' || (res.status === 301 || res.status === 302) && currentMethod === 'POST') {
        currentMethod = 'GET';
        currentBody = undefined;
        for (const key of Object.keys(currentHeaders)) {
          if (key.toLowerCase() === 'content-type' || key.toLowerCase() === 'content-length') delete currentHeaders[key];
        }
      }
      currentUrl = nextUrl;
    }

    const contentType = res.headers.get('content-type') || '';
    const { text: bodyText, truncated, bytesReceived } = await readCappedText(res);

    let data = bodyText;
    let isJson = false;
    if (!truncated && (contentType.includes('application/json') || contentType.includes('+json'))) {
      try {
        data = JSON.parse(bodyText);
        isJson = true;
      } catch {}
    }

    const responseHeaders = {};
    for (const [k, v] of res.headers.entries()) {
      responseHeaders[k] = v;
    }

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      url: res.url || currentUrl.toString(),
      headers: responseHeaders,
      isJson,
      data,
      truncated,
      bytesReceived,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function register(server) {
  server.registerTool(
    'local_fetch',
    {
      title: 'Localhost & Intranet HTTP Fetcher',
      description:
        'Make HTTP/HTTPS requests to localhost, local dev servers, or internal LAN services with SSRF protection (validates redirects/DNS, blocks cloud metadata/link-local addresses, enforces a 512KB streaming cap and max 15s timeout).',
      inputSchema: {
        url: z.string().describe('full HTTP/HTTPS URL (e.g. "http://localhost:3000/api/health")'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional().describe('HTTP method (default GET)'),
        headers: z.record(z.string()).optional().describe('optional HTTP request headers'),
        body: z.union([z.string(), z.record(z.any())]).optional().describe('request body (string or JSON object)'),
        timeoutMs: z.number().int().min(500).max(15000).optional().describe('timeout in ms (default 5000, max 15000)'),
      },
    },
    async (args) => {
      try {
        const result = await executeFetch(args);
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

export default { register, executeFetch, isBlockedHost };
