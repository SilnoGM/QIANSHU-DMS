import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function normalizeLoopbackOrigin(value) {
  let parsed
  try {
    parsed = new URL(value)
  }
  catch {
    throw new Error('Browser auth proxy upstream is invalid')
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !/^\d{1,5}$/u.test(parsed.port)
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.username !== ''
    || parsed.password !== ''
  ) {
    throw new Error('Browser auth proxy upstream is invalid')
  }
  return parsed.origin
}

export function createUpstreamRequest(input) {
  const requestUrl = typeof input.requestUrl === 'string'
    ? input.requestUrl
    : '/'
  const pathname = requestUrl.split('?', 1)[0]
  const origin = pathname === '/api' || pathname.startsWith('/api/')
    ? normalizeLoopbackOrigin(input.apiOrigin)
    : normalizeLoopbackOrigin(input.webOrigin)
  const upstream = new URL(origin)
  const headers = {}
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!hopByHopHeaders.has(name.toLowerCase())) headers[name] = value
  }
  headers.host = upstream.host
  return {
    headers,
    method: input.method ?? 'GET',
    origin,
    path: requestUrl,
  }
}

function proxyRequest(configuration, clientRequest, clientResponse) {
  let upstreamDefinition
  try {
    upstreamDefinition = createUpstreamRequest({
      apiOrigin: configuration.apiOrigin,
      headers: clientRequest.headers,
      method: clientRequest.method,
      requestUrl: clientRequest.url,
      webOrigin: configuration.webOrigin,
    })
  }
  catch {
    clientResponse.writeHead(400)
    clientResponse.end()
    return
  }

  const upstreamRequest = httpRequest(
    new URL(upstreamDefinition.path, upstreamDefinition.origin),
    {
      headers: upstreamDefinition.headers,
      method: upstreamDefinition.method,
    },
    (upstreamResponse) => {
      const responseHeaders = {}
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) {
          responseHeaders[name] = value
        }
      }
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(clientResponse)
    },
  )
  upstreamRequest.once('error', () => {
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
    }
    clientResponse.end('Bad Gateway')
  })
  clientRequest.once('aborted', () => upstreamRequest.destroy())
  clientRequest.pipe(upstreamRequest)
}

function readRuntimeConfiguration(environment) {
  const host = environment.QIANSHU_BROWSER_AUTH_HOST
  const port = Number(environment.QIANSHU_BROWSER_AUTH_PORT)
  if (
    host !== '127.0.0.1'
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error('Browser auth proxy configuration is invalid')
  }
  return {
    apiOrigin: normalizeLoopbackOrigin(
      environment.QIANSHU_BROWSER_AUTH_API_ORIGIN,
    ),
    certificatePath: environment.QIANSHU_BROWSER_AUTH_TLS_CERT,
    host,
    keyPath: environment.QIANSHU_BROWSER_AUTH_TLS_KEY,
    port,
    webOrigin: normalizeLoopbackOrigin(
      environment.QIANSHU_BROWSER_AUTH_WEB_ORIGIN,
    ),
  }
}

export async function startReverseProxy(environment = process.env) {
  const configuration = readRuntimeConfiguration(environment)
  const hasTls =
    typeof configuration.certificatePath === 'string'
    && typeof configuration.keyPath === 'string'
  if (
    hasTls !== (
      configuration.certificatePath !== undefined
      && configuration.keyPath !== undefined
    )
  ) {
    throw new Error('Browser auth proxy TLS configuration is invalid')
  }

  const handler = (request, response) => {
    proxyRequest(configuration, request, response)
  }
  const server = hasTls
    ? createHttpsServer({
        cert: await readFile(configuration.certificatePath),
        key: await readFile(configuration.keyPath),
      }, handler)
    : createHttpServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(configuration.port, configuration.host, resolve)
  })
  return server
}

if (isDirectEntry(import.meta.url)) {
  startReverseProxy().then((server) => {
    const shutdown = () => server.close(() => process.exit(0))
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }).catch(() => {
    console.error('Browser auth reverse proxy failed')
    process.exitCode = 1
  })
}
