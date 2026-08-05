import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 页面编排边界使用纯函数与静态源码契约验证。
import test from 'node:test'

import {
  canApplySupplierMutationResult,
  createSupplierCreateIntentFromPayload,
  isSupplierAbortError,
} from '../../src/views/system/service-provider/suppliers/supplier-management.logic'

const PAGE_URL = new URL(
  '../../src/views/system/service-provider/suppliers/index.vue',
  import.meta.url,
)

function readPageSource(): string {
  return readFileSync(PAGE_URL, 'utf8')
}

test('mutation 结果只能回写发起身份、操作代次和目标上下文', () => {
  const current = {
    authorized: true,
    authEpoch: 4,
    currentAuthEpoch: 4,
    currentGeneration: 2,
    currentTargetId: 'supplier-1',
    generation: 2,
    targetId: 'supplier-1',
  }
  assert.equal(canApplySupplierMutationResult(current), true)
  assert.equal(canApplySupplierMutationResult({ ...current, authorized: false }), false)
  assert.equal(canApplySupplierMutationResult({ ...current, currentAuthEpoch: 5 }), false)
  assert.equal(canApplySupplierMutationResult({ ...current, currentGeneration: 3 }), false)
  assert.equal(canApplySupplierMutationResult({ ...current, currentTargetId: 'supplier-2' }), false)
})

test('创建 payload 直接形成冻结意图且取消错误兼容 Axios 与 DOM', () => {
  const intent = createSupplierCreateIntentFromPayload({
    entityType: 'ORGANIZATION',
    legalName: '示例供方',
  }, '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(Object.isFrozen(intent), true)
  assert.equal(Object.isFrozen(intent.payload), true)
  assert.equal(isSupplierAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isSupplierAbortError(new DOMException('aborted', 'AbortError')), true)
})

test('页面持有五项权限、六个 API 与三个领域维护上下文', () => {
  const source = readPageSource()

  for (const permission of [
    'suppliers:read',
    'suppliers:create',
    'suppliers:update',
    'suppliers:enable',
    'suppliers:disable',
  ]) {
    assert.match(source, new RegExp(`auth\\('${permission}'\\)`, 'u'))
  }
  for (const method of ['list', 'get', 'create', 'update', 'enable', 'disable']) {
    assert.match(source, new RegExp(`suppliersApi\\.${method}\\(`, 'u'))
  }
  assert.match(source, /<SupplierFormDrawer\b/u)
  assert.match(source, /<SupplierDetailDrawer\b/u)
  assert.match(source, /<SupplierStatusChangeModal\b/u)
  assert.doesNotMatch(source, /suppliersApi\.(?:delete|catalog|generate)\(/u)
})

test('列表与详情 GET 使用 AbortController、authEpoch 和单调 request version', () => {
  const source = readPageSource()

  assert.match(source, /listAbortController\?\.abort\(\)/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.match(source, /listRequestVersion/u)
  assert.match(source, /detailRequestVersion/u)
  assert.match(source, /appAccountStore\.authEpoch/u)
  assert.match(source, /canApplySupplierQueryResponse/u)
})

test('创建结果未知后保留同一冻结意图且只由人工按钮重放', () => {
  const source = readPageSource()

  assert.match(source, /createSupplierCreateIntentFromPayload/u)
  assert.match(source, /markSupplierCreateIntentUnknown/u)
  assert.match(source, /retrySupplierCreateIntent/u)
  assert.match(source, /createResultUnknown/u)
  assert.match(source, /@retry-create="retryUnknownCreate"/u)
  assert.match(source, /使用原请求确认结果/u)
  assert.doesNotMatch(
    source,
    /unknownResult[\s\S]{0,260}createSupplierCreateIntentFromPayload/u,
  )
})

test('动态撤权和身份切换中止请求、清空数据并关闭维护上下文', () => {
  const source = readPageSource()

  assert.match(source, /watch\([\s\S]*?appAccountStore\.authEpoch/u)
  assert.match(source, /closeForAuthorityLoss/u)
  assert.match(source, /clearProtectedContexts/u)
  assert.match(source, /rows\.value = \[\]/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.match(source, /mutationGeneration \+= 1/u)
})

test('页面使用标准管理骨架、桌面表格、390px 卡片和底部操作 Drawer', () => {
  const source = readPageSource()

  assert.match(source, /<FaPageHeader\b/u)
  assert.match(source, /<FaPageMain\b/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.match(source, /data-testid="supplier-mobile-row"/u)
  assert.match(source, /data-testid="supplier-actions-drawer"/u)
  assert.match(source, /side="bottom"/u)
  assert.match(source, /max-\[390px\]:grid-cols-1/u)
  assert.match(source, /min-h-11/u)
  assert.match(source, /prefers-reduced-motion: reduce/u)
  assert.doesNotMatch(source, /overflow-x:\s*auto/u)
})

test('状态文字、可访问名称和敏感字段最小化保持在页面边界', () => {
  const source = readPageSource()

  assert.match(source, /已启用|已停用/u)
  assert.match(source, /:aria-label="`查看供应商/u)
  assert.match(source, /:aria-label="`供应商操作/u)
  assert.match(source, /hasPrimaryContactPhone/u)
  assert.match(source, /hasPrimaryContactWechatId/u)
  assert.doesNotMatch(source, /registration\.number|primaryContact\.phone|primaryContact\.wechatId/u)
  assert.doesNotMatch(source, /网站|website|删除供应商/u)
})
