#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ERROR_MESSAGE = 'This project requires pnpm.'

export function isPnpmUserAgent(userAgent) {
  return typeof userAgent === 'string' && /^pnpm\/\S+/.test(userAgent)
}

export function ensurePnpm(userAgent = process.env.npm_config_user_agent, writeError = console.error) {
  if (isPnpmUserAgent(userAgent)) {
    return true
  }

  // 错误固定且不拼接环境变量，避免安装失败时把调用环境写入日志。
  writeError(ERROR_MESSAGE)
  return false
}

function isDirectEntry(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) {
    return false
  }

  return pathToFileURL(path.resolve(entryPath)).href === moduleUrl
}

if (isDirectEntry(import.meta.url) && !ensurePnpm()) {
  process.exitCode = 1
}
