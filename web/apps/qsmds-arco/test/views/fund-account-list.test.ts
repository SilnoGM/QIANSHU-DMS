import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- View 合约使用 Node.js 内置 runner。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const pageSource = readSource(
  '../../src/views/admin/fund-account-management/list/index.vue',
)

test('账户列表组合现有页框架、通用表格和资金展示组件', () => {
  assert.match(pageSource, /<FaPageHeader/u)
  assert.match(pageSource, /<FaPageMain/u)
  assert.match(pageSource, /<QsGenericTable/u)
  assert.match(pageSource, /import AmountDisplay/u)
  assert.match(pageSource, /import DateTimeDisplay/u)
  assert.match(pageSource, /data-testid="fund-account-list-table"/u)
  assert.match(pageSource, /table-class="min-w-\[/u)
  assert.match(pageSource, /class="min-w-0 overflow-x-hidden"/u)
})

test('页面显式约束读取与三个写权限且撤权时清理请求和领域 Modal', () => {
  for (const permission of [
    'fund-accounts:read',
    'fund-accounts:create',
    'fund-accounts:update-share-rate',
    'fund-accounts:manual-adjust',
  ]) {
    assert.match(pageSource, new RegExp(`auth\\('${permission}'\\)`, 'u'))
  }
  assert.match(pageSource, /appAccountStore\.authEpoch/u)
  assert.match(pageSource, /AbortController/u)
  assert.match(pageSource, /canApplyFundResponse/u)
  assert.match(pageSource, /clearFundPageState/u)
})

test('表格展示主体、余额、比例、时间和公司标识但不暴露版本列', () => {
  for (const title of ['账户主体', '实时余额', '用户分成', '公司分成', '比例更新时间', '更新时间']) {
    assert.match(pageSource, new RegExp(`title: '${title}'`, 'u'))
  }
  assert.match(pageSource, /公司账户/u)
  assert.match(pageSource, /负余额/u)
  assert.match(pageSource, /text-green-600 dark:text-green-400/u)
  assert.match(pageSource, /text-destructive/u)
  assert.doesNotMatch(pageSource, /title: '版本'/u)
})

test('余额使用半粗体且更新时间列位于创建时间列之前', () => {
  assert.equal(pageSource.match(/class="!font-semibold"/gu)?.length, 2)
  assert.ok(
    pageSource.indexOf('accessorKey: \'updatedAt\'')
    < pageSource.indexOf('accessorKey: \'createdAt\''),
  )
})

test('页面组合开户、比例修改、手动调账 Modal 和账户流水跳转', () => {
  for (const component of [
    'FundAccountCreateModal',
    'FundShareRateModal',
    'FundManualAdjustmentModal',
  ]) {
    assert.match(pageSource, new RegExp(component, 'u'))
  }
  assert.match(pageSource, /row\.ownerType === 'USER'/u)
  assert.match(pageSource, /name: 'adminFundAccountTransactions'/u)
  assert.match(pageSource, /query: \{ accountId: account\.id \}/u)
  assert.doesNotMatch(pageSource, /全部用户/u)
})

test('桌面操作列使用三个两字按钮并保持紧凑单行展示', () => {
  assert.match(
    pageSource,
    /:action-column="\{ fixed: 'right', minWidth: 260, width: 260 \}"/u,
  )
  assert.match(pageSource, /<FaIcon name="i-lucide:percent" \/>比例/u)
  assert.match(pageSource, /<FaIcon name="i-lucide:circle-dollar-sign" \/>调账/u)
  assert.match(pageSource, /<FaIcon name="i-lucide:scroll-text" \/>流水/u)
  assert.equal(
    pageSource.match(/class="shrink-0 min-h-11 whitespace-nowrap sm:min-h-9"/gu)?.length,
    3,
  )
})

test('三个领域 Modal 固定业务输入、预计余额和移动端可触达操作', () => {
  const createSource = readSource(
    '../../src/views/admin/fund-account-management/list/fund-account-create-modal.vue',
  )
  const shareSource = readSource(
    '../../src/views/admin/fund-account-management/list/fund-share-rate-modal.vue',
  )
  const adjustmentSource = readSource(
    '../../src/views/admin/fund-account-management/list/fund-manual-adjustment-modal.vue',
  )

  for (const source of [createSource, shareSource, adjustmentSource]) {
    assert.match(source, /import QsGenericModal/u)
    assert.match(source, /min-h-11 w-full sm:min-h-9 sm:w-auto/u)
  }
  assert.match(createSource, /未开户用户/u)
  assert.match(createSource, /初始用户分成比例/u)
  assert.match(shareSource, /只影响未来动账/u)
  assert.match(shareSource, /修改原因/u)
  assert.match(shareSource, /props\.account\.version/u)
  assert.match(adjustmentSource, /USER_ONLY/u)
  assert.match(adjustmentSource, /USER_AND_COMPANY_BY_SHARE/u)
  assert.match(adjustmentSource, /allow-negative/u)
  assert.match(adjustmentSource, /用户当前余额/u)
  assert.match(adjustmentSource, /公司当前余额/u)
  assert.match(adjustmentSource, /用户预计余额/u)
  assert.match(adjustmentSource, /公司预计余额/u)
  assert.match(adjustmentSource, /calculateFundAdjustmentPreview/u)
})

test('窄屏使用单份 mobile-row 卡片且操作仍由通用表格 actions 插槽提供', () => {
  assert.match(pageSource, /#mobile-row/u)
  assert.match(pageSource, /max-\[479px\]:grid-cols-1/u)
  assert.match(pageSource, /min-h-11 sm:min-h-9/u)
  assert.equal(pageSource.match(/#actions="\{ row, rowNumber \}"/g)?.length, 1)
  assert.doesNotMatch(pageSource, /transition-all/u)
})
