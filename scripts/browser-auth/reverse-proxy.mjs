import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
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
const internalMediaPrefix = '/_qianshu_internal_media/'

function invalidInternalMediaPath() {
  return new Error('Browser auth internal media path is invalid')
}

/**
 * Browser E2E 代理只模拟生产 Nginx 的 internal alias，不接受任意 URL、编码路径
 * 或 traversal。返回值只用于本次隔离媒体根，绝不写入响应或日志。
 */
export function resolveInternalMediaPath(storageRoot, internalRedirect) {
  if (
    typeof storageRoot !== 'string'
    || !isAbsolute(storageRoot)
    || resolve(storageRoot) === resolve('/')
    || typeof internalRedirect !== 'string'
    || !internalRedirect.startsWith(`${internalMediaPrefix}assets/`)
    || internalRedirect.includes('%')
    || internalRedirect.includes('\\')
    || internalRedirect.includes('//')
    || internalRedirect.includes('?')
    || internalRedirect.includes('#')
  ) {
    throw invalidInternalMediaPath()
  }
  const objectKey = internalRedirect.slice(internalMediaPrefix.length)
  const segments = objectKey.split('/')
  if (
    segments.length < 2
    || segments.some(segment => (
      segment === ''
      || segment === '.'
      || segment === '..'
      || !/^[A-Za-z0-9._-]+$/u.test(segment)
    ))
  ) {
    throw invalidInternalMediaPath()
  }
  const root = resolve(storageRoot)
  const target = resolve(join(root, ...segments))
  const fromRoot = relative(root, target)
  if (
    fromRoot === ''
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw invalidInternalMediaPath()
  }
  return target
}

export function parseSingleByteRange(value, size) {
  if (value === undefined) return null
  if (!Number.isSafeInteger(size) || size < 1 || typeof value !== 'string') {
    throw new Error('Browser auth media range is invalid')
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value)
  if (match === null || (match[1] === '' && match[2] === '')) {
    throw new Error('Browser auth media range is invalid')
  }
  let start
  let end
  if (match[1] === '') {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      throw new Error('Browser auth media range is invalid')
    }
    start = Math.max(0, size - suffixLength)
    end = size - 1
  }
  else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
  }
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= size
    || end < start
  ) {
    throw new Error('Browser auth media range is invalid')
  }
  return { end: Math.min(end, size - 1), start }
}

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

function copyResponseHeaders(upstreamHeaders) {
  const responseHeaders = {}
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    if (
      !hopByHopHeaders.has(name.toLowerCase())
      && name.toLowerCase() !== 'x-accel-redirect'
      && value !== undefined
    ) {
      responseHeaders[name] = value
    }
  }
  return responseHeaders
}

async function serveInternalMedia(
  configuration,
  clientRequest,
  clientResponse,
  upstreamResponse,
) {
  const internalRedirect = upstreamResponse.headers['x-accel-redirect']
  const filePath = resolveInternalMediaPath(
    configuration.mediaStorageRoot,
    internalRedirect,
  )
  const metadata = await stat(filePath)
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size < 1) {
    throw invalidInternalMediaPath()
  }
  let range
  try {
    range = parseSingleByteRange(clientRequest.headers.range, metadata.size)
  }
  catch {
    upstreamResponse.resume()
    clientResponse.writeHead(416, {
      'Cache-Control': 'no-store',
      'Content-Range': `bytes */${metadata.size}`,
    })
    clientResponse.end()
    return
  }
  upstreamResponse.resume()
  const responseHeaders = copyResponseHeaders(upstreamResponse.headers)
  delete responseHeaders['content-length']
  delete responseHeaders['content-range']
  responseHeaders['accept-ranges'] = 'bytes'
  const start = range?.start ?? 0
  const end = range?.end ?? metadata.size - 1
  responseHeaders['content-length'] = String(end - start + 1)
  if (range !== null) {
    responseHeaders['content-range'] = `bytes ${start}-${end}/${metadata.size}`
  }
  clientResponse.writeHead(range === null ? 200 : 206, responseHeaders)
  if (clientRequest.method === 'HEAD') {
    clientResponse.end()
    return
  }
  if (clientRequest.method !== 'GET') {
    clientResponse.end()
    return
  }
  const stream = createReadStream(filePath, { end, start })
  stream.once('error', () => clientResponse.destroy())
  stream.pipe(clientResponse)
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
      if (
        configuration.mediaStorageRoot !== undefined
        && typeof upstreamResponse.headers['x-accel-redirect'] === 'string'
      ) {
        void serveInternalMedia(
          configuration,
          clientRequest,
          clientResponse,
          upstreamResponse,
        ).catch(() => {
          upstreamResponse.resume()
          if (!clientResponse.headersSent) {
            clientResponse.writeHead(502, {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain; charset=utf-8',
            })
          }
          clientResponse.end()
        })
        return
      }
      const responseHeaders = copyResponseHeaders(upstreamResponse.headers)
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
    mediaStorageRoot: (() => {
      const candidate = environment.QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT
      if (candidate === undefined) return undefined
      if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
        throw new Error('Browser auth proxy media configuration is invalid')
      }
      return resolve(candidate)
    })(),
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
