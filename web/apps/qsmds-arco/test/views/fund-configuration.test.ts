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
const drawerSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-configuration-drawer.vue',
)
const typeFormSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-posting-type-form-modal.vue',
)
const ruleFormSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-posting-rule-modal.vue',
)
const sourceFormSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-business-source-form-modal.vue',
)
const postingTypePanelSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-posting-type-panel.vue',
)
const businessSourcePanelSource = readSource(
  '../../src/views/admin/fund-account-management/list/fund-business-source-panel.vue',
)

test('账户页以两个独立配置权限展示同一个业务配置 Drawer 入口', () => {
  assert.match(pageSource, /auth\('fund-posting-types:manage'\)/u)
  assert.match(pageSource, /auth\('fund-business-sources:manage'\)/u)
  assert.match(pageSource, /FundConfigurationDrawer/u)
  assert.match(pageSource, /业务配置/u)
  assert.doesNotMatch(pageSource, /name: 'adminFundConfiguration'/u)
})

test('配置 Drawer 组合类型和来源区域且 GET 受身份、权限、版本和 Abort 守卫', () => {
  assert.match(drawerSource, /import QsGenericDrawer/u)
  assert.match(drawerSource, /<FaTabs/u)
  assert.match(drawerSource, /fundAccountsApi\.postingTypes\.list/u)
  assert.match(drawerSource, /fundAccountsApi\.businessSources\.list/u)
  assert.match(drawerSource, /AbortController/u)
  assert.match(drawerSource, /appAccountStore\.authEpoch/u)
  assert.match(drawerSource, /canApplyFundResponse/u)
  assert.match(drawerSource, /clearConfigurationState/u)
  assert.match(drawerSource, /FundPostingTypePanel/u)
  assert.match(drawerSource, /FundBusinessSourcePanel/u)
  assert.match(postingTypePanelSource, /data-testid="fund-posting-type-list"/u)
  assert.match(businessSourcePanelSource, /data-testid="fund-business-source-list"/u)
})

test('类型交互覆盖只读身份、受控规则草稿、发布和危险状态确认', () => {
  for (const text of [
    '业务分类',
    '金额策略',
    '账户目标',
    '生效版本',
    '草稿版本',
  ]) {
    assert.match(postingTypePanelSource, new RegExp(text, 'u'))
  }
  assert.match(typeFormSource, /创建后编码和业务分类不可修改/u)
  assert.match(typeFormSource, /ADMIN_MANUAL_ADJUSTMENT/u)
  assert.match(ruleFormSource, /accountTarget/u)
  assert.match(ruleFormSource, /directionPolicy/u)
  assert.match(ruleFormSource, /amountStrategy/u)
  assert.match(ruleFormSource, /最多两条标准分录/u)
  assert.match(drawerSource, /publish/u)
  assert.match(drawerSource, /FundConfigurationConfirmModal/u)
})

test('来源交互维护允许类型范围且稳定编码只在创建时录入', () => {
  assert.match(sourceFormSource, /allowedPostingTypeIds/u)
  assert.match(sourceFormSource, /FaCheckboxGroup/u)
  assert.match(sourceFormSource, /mode === 'create'/u)
  assert.match(sourceFormSource, /来源编码创建后不可修改/u)
  assert.match(businessSourcePanelSource, /allowedPostingTypes/u)
})

test('配置 mutation 禁止自动重试，结果未知时重新读取核对而不重放', () => {
  assert.match(drawerSource, /unknownResult/u)
  assert.match(drawerSource, /reconcileUnknownMutation/u)
  assert.match(drawerSource, /重新读取/u)
  assert.doesNotMatch(drawerSource, /retryUnknownMutation/u)
})

test('Drawer 和配置卡片保持窄屏触控与稳定操作区', () => {
  assert.match(drawerSource, /size="xl"/u)
  assert.match(postingTypePanelSource, /min-h-11 sm:min-h-9/u)
  assert.match(postingTypePanelSource, /max-\[479px\]:grid-cols-1/u)
  assert.doesNotMatch(drawerSource, /overflow-y-(auto|scroll)/u)
})
