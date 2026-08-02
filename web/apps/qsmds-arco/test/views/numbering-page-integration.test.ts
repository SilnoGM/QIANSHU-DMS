import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面编排边界是无浏览器依赖的纯函数与静态组合契约。
import test from 'node:test'

import {
  canApplyNumberingContextResponse,
  canApplyNumberingMutationResult,
  shouldCloseNumberingEditor,
  shouldLoadNumberingIssuances,
} from '../../src/views/system/basic-data/numbering/numbering-page.logic'

const allPermissions = {
  canCreate: true,
  canDisable: true,
  canEnable: true,
  canPublish: true,
  canRead: true,
  canReadIssuances: true,
  canUpdate: true,
}

function readPageSource(): string {
  return [
    'index.vue',
    'use-numbering-maintenance.ts',
    'numbering-management.logic.ts',
  ].map(fileName => readFileSync(
    new URL(
      `../../src/views/system/basic-data/numbering/${fileName}`,
      import.meta.url,
    ),
    'utf8',
  )).join('\n')
}

test('详情与预览响应只能跨过未取消、未换身份且仍有权的最新请求边界', () => {
  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 9,
    currentAuthEpoch: 9,
    latestRequestVersion: 4,
    requestVersion: 4,
  }

  assert.equal(canApplyNumberingContextResponse(current), true)
  assert.equal(canApplyNumberingContextResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyNumberingContextResponse({ ...current, authorized: false }), false)
  assert.equal(canApplyNumberingContextResponse({ ...current, currentAuthEpoch: 10 }), false)
  assert.equal(canApplyNumberingContextResponse({ ...current, latestRequestVersion: 5 }), false)
})

test('mutation 结果只能回写发起它的身份、操作代次与目标上下文', () => {
  const current = {
    authorized: true,
    authEpoch: 9,
    currentAuthEpoch: 9,
    currentGeneration: 4,
    currentTargetId: 'rule-1',
    generation: 4,
    targetId: 'rule-1',
  }

  assert.equal(canApplyNumberingMutationResult(current), true)
  assert.equal(canApplyNumberingMutationResult({ ...current, authorized: false }), false)
  assert.equal(canApplyNumberingMutationResult({ ...current, currentAuthEpoch: 10 }), false)
  assert.equal(canApplyNumberingMutationResult({ ...current, currentGeneration: 5 }), false)
  assert.equal(canApplyNumberingMutationResult({ ...current, currentTargetId: 'rule-2' }), false)
})

test('编辑器在 read 或当前操作权限被撤销时立即关闭', () => {
  assert.equal(shouldCloseNumberingEditor('create', allPermissions), false)
  assert.equal(shouldCloseNumberingEditor('edit', allPermissions), false)
  assert.equal(shouldCloseNumberingEditor('clone', allPermissions), false)
  assert.equal(shouldCloseNumberingEditor('create', {
    ...allPermissions,
    canCreate: false,
  }), true)
  assert.equal(shouldCloseNumberingEditor('clone', {
    ...allPermissions,
    canRead: false,
  }), true)
  assert.equal(shouldCloseNumberingEditor('edit', {
    ...allPermissions,
    canUpdate: false,
  }), true)
})

test('发号记录只在 read 与 read-issuances 同时存在时加载', () => {
  assert.equal(shouldLoadNumberingIssuances(allPermissions), true)
  assert.equal(shouldLoadNumberingIssuances({
    ...allPermissions,
    canRead: false,
  }), false)
  assert.equal(shouldLoadNumberingIssuances({
    ...allPermissions,
    canReadIssuances: false,
  }), false)
})

test('页面持有七项权限、所有 API 副作用与同级 Drawer/Modal 上下文', () => {
  const source = readPageSource()

  for (const permission of [
    'numbering-rules:read',
    'numbering-rules:create',
    'numbering-rules:update',
    'numbering-rules:publish',
    'numbering-rules:enable',
    'numbering-rules:disable',
    'numbering-rules:read-issuances',
  ]) {
    assert.match(source, new RegExp(`auth\\('${permission}'\\)`, 'u'))
  }
  for (const method of [
    'get',
    'versions',
    'issuances',
    'preview',
    'create',
    'update',
    'clone',
    'publish',
    'enable',
    'disable',
  ]) {
    assert.match(source, new RegExp(`numberingApi\\.rules\\.${method}\\(`, 'u'))
  }
  assert.match(source, /<NumberingRuleEditorDrawer\b/u)
  assert.match(source, /<NumberingRuleDetailDrawer\b/u)
  assert.match(source, /<NumberingLifecycleModal\b/u)
  assert.match(source, /data-testid="numbering-actions-drawer"/u)
  assert.match(source, /function clearMaintenanceContexts\(\): void/u)
  assert.match(source, /closeForAuthorityLoss/u)
  assert.match(source, /shouldCloseNumberingEditor/u)
  assert.match(source, /shouldLoadNumberingIssuances/u)
  assert.match(source, /NUMBERING_RULE_STATE_CHANGED/u)
  assert.doesNotMatch(source, />\s*(?:正式)?发号\s*</u)
})

test('预览与 GET 均使用 AbortController 和单调 request version，mutation 结果未知不自动重放', () => {
  const source = readPageSource()

  assert.match(source, /previewAbortController\?\.abort\(\)/u)
  assert.match(source, /previewRequestVersion/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.match(source, /detailRequestVersion/u)
  assert.match(source, /unknownResult/u)
  assert.match(source, /操作结果未知/u)
  assert.doesNotMatch(source, /unknownResult[\s\S]{0,240}numberingApi\.rules\.(?:create|update|clone|publish|enable|disable)\(/u)
})

test('冲突与未知结果只刷新规则快照，不把未保存表单重置为基线', () => {
  const source = readPageSource()

  assert.match(source, /replaceFormModel\?:\s*boolean/u)
  assert.match(source, /replaceFormModel\s*=\s*true/u)
  assert.match(
    source,
    /fetchRuleForEditor\(current\.id, editorMode\.value,\s*\{\s*replaceFormModel:\s*false,?\s*\}\)/u,
  )
  assert.doesNotMatch(
    source,
    /function refreshEditorRuleContext[\s\S]{0,400}editorFormModel\.value\s*=/u,
  )
})

test('页头只保留响应式主操作且放弃流程不依赖动画回调', () => {
  const source = readPageSource()

  assert.match(
    source,
    /data-testid="numbering-create-rule"[\s\S]{0,120}class="min-h-11 md:min-h-9"/u,
  )
  assert.doesNotMatch(
    source,
    /<FaButton[\s\S]{0,180}@click="loadNumberingRules"[\s\S]{0,120}>[\s\S]{0,80}刷新/u,
  )
  assert.doesNotMatch(source, /i-lucide:refresh-cw/u)
  assert.match(source, /async function loadNumberingRules/u)
  assert.match(
    source,
    /async function discardEditorChanges[\s\S]{0,500}await nextTick\(\)[\s\S]{0,160}closeWithoutDirtyGuard\(\)/u,
  )
  assert.doesNotMatch(
    source,
    /data-testid="numbering-discard-confirm"[\s\S]{0,180}@closed=/u,
  )
})
