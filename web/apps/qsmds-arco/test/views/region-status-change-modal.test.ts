import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 地区启停确认框与纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createRegionStatusChangeRequest,
  formatRegionStatusPath,
  regionStatusChangeCopy,
} from '../../src/views/system/basic-data/regions/region-status.logic'

const country = {
  code: 'CN',
  id: 'country-cn',
  name: '中国',
}
const province = {
  code: 'CN-44',
  id: 'province-guangdong',
  name: '广东省',
}
const city = {
  code: 'CN-4401',
  id: 'city-guangzhou',
  name: '广州市',
}

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('启停确认纯逻辑生成完整路径且提交只携带动作与目标 ID', () => {
  assert.equal(
    formatRegionStatusPath([country, province], city),
    '中国 / 广东省 / 广州市',
  )
  assert.equal(formatRegionStatusPath([], country), '中国')
  assert.deepEqual(
    createRegionStatusChangeRequest('disable', city, false),
    {
      action: 'disable',
      regionId: 'city-guangzhou',
    },
  )
  assert.equal(createRegionStatusChangeRequest('disable', city, true), null)
  assert.equal(createRegionStatusChangeRequest('enable', null, false), null)
})

test('启停确认文案分别解释后代、历史数据与祖先停用边界', () => {
  const disable = regionStatusChangeCopy('disable')
  const enable = regionStatusChangeCopy('enable')

  assert.equal(disable.title, '确认停用地区')
  assert.equal(disable.confirmLabel, '确认停用')
  assert.match(disable.consequence, /全部后代.*业务地区选择器/u)
  assert.match(disable.consequence, /历史数据不会删除/u)

  assert.equal(enable.title, '确认启用地区')
  assert.equal(enable.confirmLabel, '确认启用')
  assert.match(enable.consequence, /重新计算.*有效状态/u)
  assert.match(enable.consequence, /祖先.*停用.*仍不可用于业务选择/u)
})

test('启停确认框复用 QsGenericModal 且保持纯展示事件边界', () => {
  const source = readSource(
    '../../src/views/system/basic-data/regions/region-status-change-modal.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'RegionStatusChangeModal' \}\)/u)
  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(source, /<QsGenericModal\b/u)
  assert.match(source, /:submitting="interactionLocked"/u)
  assert.match(source, /@update:model-value="handleVisibilityChange"/u)
  assert.match(source, /emit\('submit', request\)/u)
  assert.match(source, /emit\('cancel'\)/u)
  assert.match(source, /requestId:/u)
  assert.match(source, /完整路径/u)
  assert.match(source, /当前操作对象/u)
  assert.match(source, /:variant="isDisable \? 'destructive' : 'default'"/u)
  assert.equal(
    source.match(/class="min-h-\[44px\] w-full sm:w-auto"/gu)?.length,
    2,
  )
  assert.doesNotMatch(
    source,
    /@\/api|useApp\w*Store|managementApi|regionsApi|RegionSelectorProvider|provider/u,
  )
})

test('提交与关闭处理均使用本地提交锁，防止父级状态回写前重复触发', () => {
  const source = readSource(
    '../../src/views/system/basic-data/regions/region-status-change-modal.vue',
  )

  assert.match(
    source,
    /if \(interactionLocked\.value\) \{\s*return\s*\}/u,
  )
  assert.match(source, /submitRequested\.value = true/u)
  assert.match(
    source,
    /if \(value \|\| interactionLocked\.value\) \{\s*return\s*\}[\s\S]*?emit\('cancel'\)/u,
  )
  assert.match(
    source,
    /watch\(\s*\(\) => props\.submitting,[\s\S]*?submitRequested\.value = false/u,
  )
})

test('启停操作区保留在默认内容中，避免二次 footer slot 丢失交互', () => {
  const source = readSource(
    '../../src/views/system/basic-data/regions/region-status-change-modal.vue',
  )

  assert.doesNotMatch(source, /<template #footer>/u)
  assert.match(
    source,
    /data-slot="region-status-actions"[\s\S]*?@click="handleStatusActionClick"[\s\S]*?data-region-status-action="cancel"[\s\S]*?data-region-status-action="submit"/u,
  )
})
