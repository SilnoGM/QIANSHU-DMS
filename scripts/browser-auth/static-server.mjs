import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const HTML_CACHE_CONTROL = 'no-cache, must-revalidate'
const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const SHORT_ASSET_CACHE_CONTROL = 'public, max-age=300'
const HASHED_ASSET_PATTERN = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[^/]+$/u

const mimeTypes = new Map([
  ['.br', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

export function cacheControlForPath(publicPath) {
  if (publicPath === '/index.html') return HTML_CACHE_CONTROL
  if (HASHED_ASSET_PATTERN.test(publicPath)) return HASHED_ASSET_CACHE_CONTROL
  return SHORT_ASSET_CACHE_CONTROL
}

export function resolveStaticRequest(rootDirectory, requestUrl) {
  if (
    typeof rootDirectory !== 'string'
    || !path.isAbsolute(rootDirectory)
    || typeof requestUrl !== 'string'
    || !requestUrl.startsWith('/')
    || requestUrl.includes('\0')
    || requestUrl.includes('\\')
  ) {
    throw new Error('Browser auth static request path is invalid')
  }

  const rawPath = requestUrl.split(/[?#]/u, 1)[0]
  let decodedPath
  try {
    decodedPath = decodeURIComponent(rawPath)
  }
  catch {
    throw new Error('Browser auth static request path is invalid')
  }
  if (
    decodedPath.includes('\0')
    || decodedPath.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new Error('Browser auth static request path is invalid')
  }

  const publicPath = decodedPath === '/' || path.posix.extname(decodedPath) === ''
    ? '/index.html'
    : decodedPath
  const absolutePath = path.resolve(rootDirectory, `.${publicPath}`)
  const rootPrefix = `${path.resolve(rootDirectory)}${path.sep}`
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new Error('Browser auth static request path is invalid')
  }
  return { absolutePath, publicPath }
}

async function sendStaticFile(response, rootDirectory, requestUrl) {
  let resolved
  try {
    resolved = resolveStaticRequest(rootDirectory, requestUrl)
    const [fileStats, canonicalPath] = await Promise.all([
      lstat(resolved.absolutePath),
      realpath(resolved.absolutePath),
    ])
    const rootPrefix = `${rootDirectory}${path.sep}`
    if (
      !fileStats.isFile()
      || fileStats.isSymbolicLink()
      || !canonicalPath.startsWith(rootPrefix)
    ) {
      throw new Error('invalid static file')
    }
  }
  catch {
    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end('Not Found')
    return
  }

  const extension = path.extname(resolved.absolutePath).toLowerCase()
  response.writeHead(200, {
    'Cache-Control': cacheControlForPath(resolved.publicPath),
    'Content-Type': mimeTypes.get(extension) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  const stream = createReadStream(resolved.absolutePath)
  stream.once('error', () => response.destroy())
  stream.pipe(response)
}

function readRuntimeConfiguration(environment) {
  const host = environment.QIANSHU_BROWSER_AUTH_HOST
  const port = Number(environment.QIANSHU_BROWSER_AUTH_PORT)
  const webRoot = environment.QIANSHU_BROWSER_AUTH_WEB_ROOT
  if (
    host !== '127.0.0.1'
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || typeof webRoot !== 'string'
    || !path.isAbsolute(webRoot)
  ) {
    throw new Error('Browser auth static server configuration is invalid')
  }
  return { host, port, webRoot }
}

export async function startStaticServer(environment = process.env) {
  const configuration = readRuntimeConfiguration(environment)
  const canonicalRoot = await realpath(configuration.webRoot)
  const rootStats = await lstat(canonicalRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Browser auth static server root is invalid')
  }
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }
    void sendStaticFile(response, canonicalRoot, request.url ?? '/').catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(configuration.port, configuration.host, resolve)
  })
  return server
}

if (isDirectEntry(import.meta.url)) {
  startStaticServer().then((server) => {
    const shutdown = () => server.close(() => process.exit(0))
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }).catch(() => {
    console.error('Browser auth static server failed')
    process.exitCode = 1
  })
}
