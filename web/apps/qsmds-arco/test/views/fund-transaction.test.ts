import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- View 合约使用 Node.js 内置 runner。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const pageSource = readSource(
  '../../src/views/admin/fund-account-management/transactions/index.vue',
)
const filterSource = readSource(
  '../../src/views/admin/fund-account-management/transactions/fund-transaction-filters.vue',
)
const tableSource = readSource(
  '../../src/views/admin/fund-account-management/transactions/fund-transaction-table.vue',
)
const detailSource = readSource(
  '../../src/views/admin/fund-account-management/transactions/fund-batch-detail-drawer.vue',
)
const reversalSource = readSource(
  '../../src/views/admin/fund-account-management/transactions/fund-reversal-modal.vue',
)

test('流水页面复用通用表格且一行绑定一条 FundTransactionDto', () => {
  assert.match(tableSource, /import QsGenericTable/u)
  assert.match(tableSource, /QsGenericTableColumn<FundTransactionDto>/u)
  assert.match(tableSource, /row-key="entryId"/u)
  assert.match(pageSource, /fundAccountsApi\.transactions\.list/u)
  assert.match(pageSource, /FundTransactionTable/u)
  assert.match(tableSource, /data-testid="fund-transaction-table"/u)
})

test('流水列覆盖批次、主体、业务快照、方向金额、余额、比例和时间', () => {
  for (const text of [
    '批次',
    '账户主体',
    '类型 / 分类',
    '业务来源',
    '方向 / 金额',
    '动账前后余额',
    '比例快照',
    '业务单号',
    '发生时间',
  ]) {
    assert.match(tableSource, new RegExp(text, 'u'))
  }
  assert.match(tableSource, /AmountDisplay/u)
  assert.match(tableSource, /DateTimeDisplay/u)
  assert.match(tableSource, /getFundDirectionState/u)
})

test('桌面方向金额列加宽且方向、符号与金额保持同一行', () => {
  const amountColumnStart = tableSource.indexOf('accessorKey: \'amount\'')
  const amountColumnEnd = tableSource.indexOf('accessorKey: \'balanceAfter\'')
  const amountCellStart = tableSource.indexOf('<template #cell-amount')
  const amountCellEnd = tableSource.indexOf('<template #cell-balance')

  assert.ok(amountColumnStart >= 0 && amountColumnEnd > amountColumnStart)
  assert.ok(amountCellStart >= 0 && amountCellEnd > amountCellStart)
  assert.match(tableSource.slice(amountColumnStart, amountColumnEnd), /minWidth: 300/u)
  assert.match(tableSource, /table-class="min-w-\[2030px\]"/u)
  assert.match(tableSource.slice(amountCellStart, amountCellEnd), /flex-nowrap/u)
  assert.doesNotMatch(tableSource.slice(amountCellStart, amountCellEnd), /flex-wrap/u)
})

test('页面筛选完整映射九种服务端条件且只在应用时查询', () => {
  for (const field of [
    'accountId',
    'userId',
    'postingTypeId',
    'businessCategory',
    'businessSourceId',
    'direction',
    'businessNo',
    'occurredFrom',
    'occurredTo',
    'reversalStatus',
  ]) {
    assert.match(filterSource, new RegExp(field, 'u'))
  }
  assert.match(filterSource, /应用筛选/u)
  assert.match(filterSource, /重置/u)
  assert.match(pageSource, /buildFundTransactionQuery/u)
})

test('异步账户目录回填后只按主体名称回显既有账户筛选', () => {
  assert.match(filterSource, /const accountSelectionValue = computed/u)
  assert.match(
    filterSource,
    /props\.accountOptions\.some\(option => option\.value === draft\.value\.accountId\)/u,
  )
  assert.match(filterSource, /:model-value="accountSelectionValue"/u)
  assert.doesNotMatch(filterSource, /:model-value="draft\.accountId"/u)
})

test('业务类型、业务来源与收支方向下拉只展示中文名称', () => {
  for (const labelExpression of [
    'label: type.name',
    'label: transaction.postingTypeName',
    'label: source.name',
    'label: transaction.businessSourceName',
  ]) {
    assert.ok(pageSource.includes(labelExpression))
  }

  assert.match(filterSource, /\{ label: '入账', value: 'CREDIT' \}/u)
  assert.match(filterSource, /\{ label: '出账', value: 'DEBIT' \}/u)
  assert.match(filterSource, /placeholder="搜索类型名称"/u)
  assert.match(filterSource, /placeholder="搜索来源名称"/u)
  assert.doesNotMatch(filterSource, /入账（CREDIT）|出账（DEBIT）|名称或编码/u)
})

test('列表和详情 GET 具有 Abort、请求版本、身份与读取权限守卫', () => {
  assert.match(pageSource, /AbortController/u)
  assert.match(pageSource, /appAccountStore\.authEpoch/u)
  assert.match(pageSource, /canApplyFundResponse/u)
  assert.match(pageSource, /fund-accounts:read/u)
  assert.match(pageSource, /clearTransactionPageState/u)
  assert.match(pageSource, /fundAccountsApi\.batches\.get/u)
})

test('批次详情展示完整快照、全部分录与冲账链且冲账只从详情进入', () => {
  assert.match(detailSource, /import QsGenericDrawer/u)
  for (const text of [
    '业务基本信息',
    '规则与比例快照',
    '账户分录',
    '冲账链',
    '业务元数据',
  ]) {
    assert.match(detailSource, new RegExp(text, 'u'))
  }
  assert.match(detailSource, /entries/u)
  assert.match(detailSource, /reversalChain/u)
  assert.match(detailSource, /canReverse/u)
  assert.doesNotMatch(tableSource, />\s*冲账\s*</u)
})

test('冲账 Modal 显示累计额度和预计反向分录并冻结未知结果', () => {
  assert.match(reversalSource, /import QsGenericModal/u)
  assert.match(reversalSource, /buildFundReversalRequest/u)
  assert.match(reversalSource, /calculateFundReversalPreview/u)
  for (const text of [
    '原始业务金额',
    '累计已冲',
    '剩余额度',
    '本次冲账额度',
    '预计反向分录',
    '冲账原因',
    '提交结果未知',
  ]) {
    assert.match(reversalSource, new RegExp(text, 'u'))
  }
  assert.match(reversalSource, /unknownResult/u)
  assert.match(reversalSource, /emit\('retry'\)/u)
  assert.match(reversalSource, /emit\('abandon'\)/u)
  assert.match(pageSource, /fund-transactions:reverse/u)
})

test('流水只读边界、窄屏卡片和触控目标保持明确', () => {
  assert.match(tableSource, /data-testid="fund-transaction-card"/u)
  assert.match(tableSource, /max-\[479px\]:grid-cols-1/u)
  assert.match(tableSource, /min-h-11 sm:min-h-9/u)
  assert.doesNotMatch(tableSource, /删除流水|编辑流水|直接修改余额/u)
  assert.doesNotMatch(detailSource, /删除批次|编辑批次|直接修改余额/u)
})

test('页面使用主题语义、Reduced Motion 和原生键盘提交边界', () => {
  const allViewSource = [
    pageSource,
    filterSource,
    tableSource,
    detailSource,
    reversalSource,
  ].join('\n')

  assert.match(pageSource, /overflow-x-hidden/u)
  assert.match(detailSource, /motion-reduce:animate-none/u)
  assert.match(filterSource, /@keydown\.enter\.prevent="submit"/u)
  assert.match(reversalSource, /<FaForm[^>]*@submit="submit"/u)
  assert.doesNotMatch(allViewSource, /#[\da-f]{3,8}\b/iu)
})
