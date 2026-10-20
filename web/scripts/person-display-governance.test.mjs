import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 人员展示治理使用 Node.js 内置 runner 扫描静态模板。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * 系统人员的展示位置必须以 QsPersonDisplay 为唯一出口。
 * 单据、打印、图片说明和表单只读字段属于已确认的纯文本例外，逐文件登记；
 * 新增例外应先更新设计决策，不允许在这里静默追加。
 */
const ALLOWED_PERSON_TEXT_FILES = new Map([
  ['views/operations/sales-orders/create.vue', '新建销售订单表单只读出单人'],
  ['views/operations/sales-orders/sales-order-create-review.vue', '新建销售订单确认摘要'],
  ['views/operations/purchase-orders/purchase-order-review-image.vue', '采购审核图片说明'],
  ['components/business/QsSalesOrderDesc/index.vue', '销售订单单据/打印预览'],
  ['components/business/QsPurchaseOrderDesc/index.vue', '采购订单单据/打印预览'],
])

const PERSON_FIELD_PATTERN = /\b(?:accountOwner|actorDisplayName|actorName|actorUserId|applicantName|changedBy|createdBy|createdByDisplayName|creatorName|displayName|issuer|loadedBy|owner|paidBy|receivedBy|reviewedBy|reviewerName|shippedBy|submittedBy|submitterName|updatedBy|warehouseReceivedBy)\b/u

const applicationRoot = fileURLToPath(new URL('../apps/qsmds-arco/src/', import.meta.url))

function collectVueFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.mimosa' || entry.name === 'component_library') {
      continue
    }
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(absolutePath))
    }
    else if (entry.name.endsWith('.vue')) {
      files.push(absolutePath)
    }
  }
  return files
}

function toRelativePath(absolutePath) {
  return path.relative(applicationRoot, absolutePath).split(path.sep).join('/')
}

function findInterpolations(source) {
  const matches = []
  const pattern = /\{\{([\s\S]*?)\}\}/gu
  let match = pattern.exec(source)
  while (match !== null) {
    const expression = match[1].trim()
    // 人员字段可能出现在翻译键名里（如 t('salesReceipt.owner')）；标签不是人员展示值。
    const isLabel = expression === '' || expression.startsWith('/*') || /^(?:\$?t|i18n\.t)\(/u.test(expression)
    if (!isLabel) {
      const line = source.slice(0, match.index).split('\n').length
      matches.push({ expression, line })
    }
    match = pattern.exec(source)
  }
  return matches
}

test('生产页面不得在模板插值中手写系统人员姓名或人员 ID', () => {
  const violations = []
  const scannedFiles = [
    ...collectVueFiles(path.join(applicationRoot, 'views')),
    ...collectVueFiles(path.join(applicationRoot, 'components/business')),
  ]

  for (const absolutePath of scannedFiles) {
    const relativePath = toRelativePath(absolutePath)
    if (ALLOWED_PERSON_TEXT_FILES.has(relativePath)) {
      continue
    }
    const source = readFileSync(absolutePath, 'utf8')
    for (const { expression, line } of findInterpolations(source)) {
      if (PERSON_FIELD_PATTERN.test(expression)) {
        violations.push(`${relativePath}:${line} → {{ ${expression} }}`)
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `以下位置必须改用 QsPersonDisplay（或登记为纯文本例外）：\n${violations.join('\n')}`,
  )
})

test('纯文本例外清单只包含仍然存在的文件与明确理由', () => {
  for (const [relativePath, reason] of ALLOWED_PERSON_TEXT_FILES) {
    assert.ok(reason.trim() !== '', `${relativePath} 缺少例外理由`)
    assert.doesNotThrow(
      () => readFileSync(path.join(applicationRoot, relativePath), 'utf8'),
      `${relativePath} 已不存在，请删除过期例外`,
    )
  }
})
