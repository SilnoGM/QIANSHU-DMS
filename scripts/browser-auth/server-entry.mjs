import { createRequire } from 'node:module'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const require = createRequire(import.meta.url)

function readErrorField(error, field) {
  try {
    return error?.[field]
  }
  catch {
    return undefined
  }
}

function stackContains(stack, unixPath, windowsPath) {
  return typeof stack === 'string'
    && (stack.includes(unixPath) || stack.includes(windowsPath))
}

/** 诊断只能返回固定类别，底层 Error message、cause 和连接信息一律不进入日志。 */
export function classifyServerStartupError(error) {
  const code = readErrorField(error, 'code')
  const message = readErrorField(error, 'message')
  const name = readErrorField(error, 'name')
  const stack = readErrorField(error, 'stack')

  if (code === 'EADDRINUSE') {
    return 'PORT_UNAVAILABLE'
  }
  if (message === 'Database initialization failed') {
    return 'DATABASE_INITIALIZATION_FAILED'
  }
  if (
    message === 'Authentication configuration is incomplete'
    || message === 'Authentication subject HMAC configuration is invalid'
    || message === 'Unsupported session cookie environment'
  ) {
    return 'AUTH_CONFIGURATION_INVALID'
  }
  if (
    typeof message === 'string'
    && /^Environment validation failed: [A-Z_]+ /u.test(message)
  ) {
    return 'ENVIRONMENT_VALIDATION_FAILED'
  }
  if (name === 'UnknownDependenciesException') {
    return 'NEST_DEPENDENCY_RESOLUTION_FAILED'
  }
  if (message === 'Unsupported security header environment') {
    return 'APPLICATION_SETUP_FAILED'
  }
  if (
    stackContains(
      stack,
      '/server/dist/infrastructure/database/',
      '\\server\\dist\\infrastructure\\database\\',
    )
  ) {
    return 'DATABASE_MODULE_FAILED'
  }
  if (
    stackContains(
      stack,
      '/server/dist/infrastructure/observability/',
      '\\server\\dist\\infrastructure\\observability\\',
    )
  ) {
    return 'OBSERVABILITY_MODULE_FAILED'
  }
  if (
    stackContains(
      stack,
      '/server/dist/modules/auth/',
      '\\server\\dist\\modules\\auth\\',
    )
  ) {
    return 'AUTH_MODULE_FAILED'
  }
  if (
    stackContains(
      stack,
      '/server/dist/app.setup.',
      '\\server\\dist\\app.setup.',
    )
  ) {
    return 'APPLICATION_SETUP_FAILED'
  }
  if (
    stackContains(
      stack,
      '/server/dist/config/',
      '\\server\\dist\\config\\',
    )
  ) {
    return 'CONFIGURATION_MODULE_FAILED'
  }
  if (
    stackContains(
      stack,
      '/node_modules/@nestjs/',
      '\\node_modules\\@nestjs\\',
    )
  ) {
    return 'NEST_RUNTIME_FAILED'
  }
  return 'UNKNOWN'
}

export async function startBuiltServer() {
  const { bootstrap } = require('../../server/dist/main.js')
  await bootstrap()
}

if (isDirectEntry(import.meta.url)) {
  startBuiltServer().catch((error) => {
    const category = classifyServerStartupError(error)
    console.error(`Browser auth Server failed to start (${category})`)
    process.exitCode = 1
  })
}
