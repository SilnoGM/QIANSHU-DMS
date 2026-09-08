import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const MANAGEMENT_MAIN_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVQokWOoIBEwjGogAjAQowgZjGogBtA+lABjWWgQrlQ/lQAAAABJRU5ErkJggg=='

/**
 * 只允许写入 Browser runner 在当前用户目录创建的 0700 一次性媒体根，避免测试
 * 夹具环境变量被误配后覆盖仓库、用户目录或其他持久化媒体目录。
 */
export function resolveManagementMainImageFixturePath(mediaStorageRoot) {
  if (typeof mediaStorageRoot !== 'string' || mediaStorageRoot.length === 0) {
    throw new Error('Browser auth media fixture root is invalid')
  }
  const resolvedRoot = path.resolve(mediaStorageRoot)
  if (
    resolvedRoot !== mediaStorageRoot
    || path.dirname(resolvedRoot) !== os.homedir()
    || !path.basename(resolvedRoot).startsWith('.qianshu-browser-media-e2e-')
  ) {
    throw new Error('Browser auth media fixture root is invalid')
  }
  return path.join(
    resolvedRoot,
    'assets',
    '2026',
    '08',
    '11111111-1111-4111-8111-111111111111.png',
  )
}

export async function provisionMediaFixtures(environment = process.env) {
  const fixturePath = resolveManagementMainImageFixturePath(
    environment.QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT,
  )
  await mkdir(path.dirname(fixturePath), { mode: 0o700, recursive: true })
  await writeFile(
    fixturePath,
    Buffer.from(MANAGEMENT_MAIN_IMAGE_BASE64, 'base64'),
    { flag: 'wx', mode: 0o600 },
  )
}

if (isDirectEntry(import.meta.url)) {
  provisionMediaFixtures().catch(() => {
    console.error('Browser auth media fixture failed')
    process.exitCode = 1
  })
}
