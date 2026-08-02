import type { NumberingRuleConfigResponseDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 编号列表纯逻辑与页面组合契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildNumberingTableListQuery,
  canApplyNumberingRuleListResponse,
  formatNumberingRuleStructure,
  getNumberingListFailure,
  isNumberingAbortError,
  numberingResetPolicyLabel,
} from '../../src/views/system/basic-data/numbering/numbering-list.logic'
import {
  formatNumberingDecimal,
  numberingRuleStatusLabel,
} from '../../src/views/system/basic-data/numbering/numbering-management.logic'

const config: NumberingRuleConfigResponseDto = {
  maxOutputLength: 32,
  resetPolicy: 'DAILY',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    {
      type: 'SEQUENCE',
      startValue: '100',
      step: '5',
      width: 6,
    },
    {
      type: 'RANDOM',
      digitLength: 2,
      letterLength: 3,
      mode: 'SHUFFLED',
    },
  ],
  timezone: 'Asia/Shanghai',
}

function readPageSource(): string {
  return readFileSync(
    new URL('../../src/views/system/basic-data/numbering/index.vue', import.meta.url),
    'utf8',
  )
}

test('列表查询规范化搜索、状态、分页并只允许 updatedAt 排序', () => {
  assert.deepEqual(buildNumberingTableListQuery({
    filters: { status: 'ENABLED' },
    page: 2,
    pageSize: 50,
    search: '  销售　订单  ',
    sorting: [{ desc: false, id: 'updatedAt' }],
  }), {
    keyword: '销售 订单',
    page: 2,
    pageSize: 50,
    sortBy: 'updatedAt',
    sortOrder: 'asc',
    status: 'ENABLED',
  })

  assert.deepEqual(buildNumberingTableListQuery({
    filters: { status: 'UNKNOWN' },
    page: 0,
    pageSize: 200,
    search: '　 ',
    sorting: [{ desc: false, id: 'name' }],
  }), {
    page: 1,
    pageSize: 20,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  })
})

test('列表响应必须同时通过 Abort、权限、authEpoch 与 requestVersion 四重边界', () => {
  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 7,
    currentAuthEpoch: 7,
    latestRequestVersion: 12,
    requestVersion: 12,
  }

  assert.equal(canApplyNumberingRuleListResponse(current), true)
  assert.equal(canApplyNumberingRuleListResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyNumberingRuleListResponse({ ...current, authorized: false }), false)
  assert.equal(canApplyNumberingRuleListResponse({ ...current, currentAuthEpoch: 8 }), false)
  assert.equal(canApplyNumberingRuleListResponse({ ...current, latestRequestVersion: 13 }), false)
})

test('取消请求兼容原生 AbortError 与 Axios CanceledError', () => {
  assert.equal(isNumberingAbortError(new DOMException('aborted', 'AbortError')), true)
  assert.equal(isNumberingAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isNumberingAbortError({ name: 'CanceledError' }), true)
  assert.equal(isNumberingAbortError(new Error('network failed')), false)
})

test('列表失败只读取安全消息与 requestId，未知输入使用固定回退', () => {
  assert.deepEqual(getNumberingListFailure({
    body: {
      message: '服务暂时不可用',
      requestId: 'request-1',
    },
  }), {
    message: '服务暂时不可用',
    requestId: 'request-1',
  })
  assert.deepEqual(getNumberingListFailure('raw secret'), {
    message: '编号规则加载失败，请稍后重试',
    requestId: undefined,
  })
})

test('编号结构完整呈现固定、日期、分隔、自增和随机片段参数', () => {
  assert.equal(
    formatNumberingRuleStructure(config),
    'SO{YYYYMMDD}-{SEQ:6,start=100,step=5}{RND:A3,N2,SHUFFLED}',
  )
  assert.equal(numberingResetPolicyLabel(config.resetPolicy), '每日重置')
})

test('状态与大整数容量保持精确字符串展示且不转为 number', () => {
  assert.equal(numberingRuleStatusLabel('DRAFT'), '草稿')
  assert.equal(numberingRuleStatusLabel('ENABLED'), '已启用')
  assert.equal(numberingRuleStatusLabel('DISABLED'), '已停用')
  assert.equal(
    formatNumberingDecimal('900719925474099312345678'),
    '900,719,925,474,099,312,345,678',
  )
  assert.equal(formatNumberingDecimal('not-a-count'), '—')
})

test('编号页使用只读通用表格并显示规则、统计、下一编号和更新时间', () => {
  const source = readPageSource()
  const tableTag = source.match(/<QsGenericTable\b[\s\S]*?>/u)?.[0]

  assert.equal(source.match(/<FaPageMain\b/gu)?.length, 1)
  assert.match(source, /<FaPageHeader\b/u)
  assert.ok(tableTag)
  assert.match(tableTag, /v-model:page="page"/u)
  assert.match(tableTag, /v-model:page-size="pageSize"/u)
  assert.match(tableTag, /v-model:search="search"/u)
  assert.match(tableTag, /v-model:filters="filters"/u)
  assert.match(tableTag, /v-model:sorting="sorting"/u)
  assert.match(tableTag, /:addable="false"/u)
  assert.match(source, /id:\s*'rule'/u)
  assert.match(source, /id:\s*'structure'/u)
  assert.match(source, /id:\s*'status'/u)
  assert.match(source, /id:\s*'revision'/u)
  assert.match(source, /id:\s*'capacity'/u)
  assert.match(source, /id:\s*'usedCount'/u)
  assert.match(source, /id:\s*'remainingCount'/u)
  assert.match(source, /id:\s*'nextNumber'/u)
  assert.match(source, /id:\s*'updatedAt'/u)
  assert.doesNotMatch(source, /(?:risk|风险|percent|百分比)/iu)
})

test('编号页显式持有读取权限与跨身份请求防护，撤权立即清空数据', () => {
  const source = readPageSource()

  assert.match(source, /auth\('numbering-rules:read'\)/u)
  assert.match(source, /new AbortController\(\)/u)
  assert.match(source, /listRequestVersion/u)
  assert.match(source, /appAccountStore\.authEpoch/u)
  assert.match(source, /canApplyNumberingRuleListResponse/u)
  assert.match(source, /listAbortController\?\.abort\(\)/u)
  assert.match(source, /listDisposed/u)
  assert.match(
    source,
    /if \(identityChanged \|\| !nextCanRead\) \{[\s\S]*?clearListContext\(\)/u,
  )
  assert.match(
    source,
    /function clearListContext\(\): void \{[\s\S]*?rows\.value = \[\][\s\S]*?total\.value = 0/u,
  )
})

test('390px 自定义 mobile-row 使用可见列、单列统计与任意长编号换行', () => {
  const source = readPageSource()
  const mobileRow = source.match(
    /<template #mobile-row="\{ columns: visibleColumns, row: item, rowNumber \}">[\s\S]*?<\/template>/u,
  )?.[0]

  assert.ok(mobileRow)
  assert.match(mobileRow, /hasVisibleTableColumn\(visibleColumns,/u)
  assert.match(mobileRow, /max-\[390px\]:grid-cols-1/u)
  assert.match(mobileRow, /\[overflow-wrap:anywhere\]/u)
  assert.match(mobileRow, /min-w-0/u)
  assert.doesNotMatch(source, /<FaCard\b/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})
