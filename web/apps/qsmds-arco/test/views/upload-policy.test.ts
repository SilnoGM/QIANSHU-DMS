import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 纯策略与源码治理检查使用 Node.js 内置 runner。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  IMAGE_ONLY_ACCEPT,
  policyAccept,
  PRODUCT_MEDIA_ACCEPT,
  UPLOAD_POLICIES,
  uploadAccept,
  validateUploadFile,
  XLSX_ACCEPT,
} from '../../src/utils/upload-policy'

test('accept 只包含服务端支持的 MIME 与扩展名', () => {
  assert.equal(
    IMAGE_ONLY_ACCEPT,
    '.jpeg,.jpg,.png,.webp,image/jpeg,image/png,image/webp',
  )
  assert.match(PRODUCT_MEDIA_ACCEPT, /video\/mp4/u)
  assert.match(PRODUCT_MEDIA_ACCEPT, /\.webm/u)
  assert.equal(XLSX_ACCEPT, '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(uploadAccept(UPLOAD_POLICIES.IMAGE_ONLY), IMAGE_ONLY_ACCEPT)
  assert.equal(policyAccept('IMAGE_ONLY'), IMAGE_ONLY_ACCEPT)
})

test('图片策略拒绝文档、空文件与超限文件', () => {
  assert.equal(validateUploadFile({ name: 'photo.jpg', size: 20, type: 'image/jpeg' }), null)
  assert.equal(validateUploadFile({ name: 'photo.jpeg', size: 20, type: 'image/jpeg' }), null)
  assert.equal(validateUploadFile({ name: 'photo.png', size: 20, type: 'image/png' }), null)
  assert.equal(validateUploadFile({ name: 'photo.webp', size: 20, type: 'image/webp' }), null)
  assert.equal(validateUploadFile({ name: 'photo.gif', size: 20, type: 'image/gif' }), 'type')
  assert.equal(validateUploadFile({ name: 'photo.pdf', size: 20, type: 'application/pdf' }), 'type')
  assert.equal(validateUploadFile({ name: 'photo.png', size: 0, type: 'image/png' }), 'empty')
  assert.equal(
    validateUploadFile({ name: 'photo.png', size: 10 * 1024 * 1024 + 1, type: 'image/png' }),
    'too-large',
  )
})

test('业务凭证策略不再包含 PDF/DOCX 等文档格式', () => {
  for (const policy of Object.values(UPLOAD_POLICIES)) {
    const accept = uploadAccept(policy)
    assert.doesNotMatch(accept, /application\/pdf|application\/msword|\.docx/u)
  }
  assert.equal(
    validateUploadFile(
      { name: 'voucher.pdf', size: 20, type: 'application/pdf' },
      UPLOAD_POLICIES.IMAGE_ONLY,
    ),
    'type',
  )
})

test('业务源码不再手写宽泛 accept 或已不支持的 MIME', () => {
  const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url))
  const files = readdirSync(sourceRoot, { recursive: true })
    .filter((file): file is string => typeof file === 'string')
    .filter(file => /\.(?:ts|vue)$/u.test(file))
    .filter(file => !file.split(/[\\/]/u).includes('generated'))
    .filter(file => !file.split(/[\\/]/u).includes('locales'))

  const violations: string[] = []
  for (const file of files) {
    const source = readFileSync(join(sourceRoot, file), 'utf8')
    if (/application\/msword/u.test(source)) {
      violations.push(`${file}: application/msword`)
    }
    if (/accept="image\/\*/u.test(source)) {
      violations.push(`${file}: accept=image/*`)
    }
    if (/accept="[^"]*\.doc[",]/u.test(source)) {
      violations.push(`${file}: accept=.doc`)
    }
    if (/(?<!:)accept="/u.test(source)) {
      violations.push(`${file}: literal accept attribute`)
    }
    for (const match of source.matchAll(/<Fa(?:Image|File)Upload\b[\s\S]*?>/gu)) {
      if (!/:accept="/u.test(match[0])) {
        violations.push(`${file}: upload component without accept`)
      }
    }
  }

  assert.deepEqual(violations, [])
})
