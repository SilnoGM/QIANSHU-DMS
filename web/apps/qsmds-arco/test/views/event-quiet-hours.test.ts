import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 静默草稿纯函数与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  DEFAULT_EVENT_QUIET_HOURS,
  quietHoursDraftFromDto,
  quietHoursPayload,
  quietHoursValidationError,
} from '../../src/views/system/notifications/events/event-quiet-hours'

const detailSource = readFileSync(
  new URL('../../src/views/system/notifications/events/detail.vue', import.meta.url),
  'utf8',
)

test('事件未配置静默时回落为开启 23:00–08:45', () => {
  assert.deepEqual(DEFAULT_EVENT_QUIET_HOURS, {
    enabled: true,
    start: '23:00',
    end: '08:45',
    timezone: 'Asia/Shanghai',
  })
  assert.deepEqual(quietHoursDraftFromDto(null), {
    enabled: true,
    start: '23:00',
    end: '08:45',
  })
})

test('旧配置缺少 enabled 时按开启处理并保留自定义时间', () => {
  assert.deepEqual(quietHoursDraftFromDto({
    start: '20:00',
    end: '08:00',
    timezone: 'Asia/Shanghai',
  }), {
    enabled: true,
    start: '20:00',
    end: '08:00',
  })
})

test('显式关闭时保留时间，缺失时间回填默认值', () => {
  assert.deepEqual(quietHoursDraftFromDto({
    enabled: false,
    start: '21:30',
    end: '07:15',
    timezone: 'Asia/Shanghai',
  }), {
    enabled: false,
    start: '21:30',
    end: '07:15',
  })

  assert.deepEqual(quietHoursDraftFromDto({ enabled: false }), {
    enabled: false,
    start: '23:00',
    end: '08:45',
  })
})

test('保存 payload 始终带 enabled，关闭时也提交时间', () => {
  assert.deepEqual(quietHoursPayload({
    enabled: false,
    start: '21:30',
    end: '07:15',
  }), {
    enabled: false,
    start: '21:30',
    end: '07:15',
    timezone: 'Asia/Shanghai',
  })

  assert.deepEqual(quietHoursPayload({
    enabled: true,
    start: '',
    end: '',
  }), {
    enabled: true,
    start: '23:00',
    end: '08:45',
    timezone: 'Asia/Shanghai',
  })
})

test('开启静默必须填写有效时间，关闭时不校验', () => {
  assert.equal(quietHoursValidationError({ enabled: false, start: '', end: '' }), null)
  assert.equal(quietHoursValidationError({ enabled: true, start: '23:00', end: '08:45' }), null)
  assert.match(
    quietHoursValidationError({ enabled: true, start: '', end: '08:45' }) ?? '',
    /必须设置有效的开始和结束时间/u,
  )
  assert.match(
    quietHoursValidationError({ enabled: true, start: '23:60', end: '08:45' }) ?? '',
    /必须设置有效的开始和结束时间/u,
  )
})

test('详情页使用开关控制静默并复用同一套草稿函数', () => {
  assert.match(detailSource, /quietHoursDraftFromDto/u)
  assert.match(detailSource, /quietHoursPayload/u)
  assert.match(detailSource, /quietHoursValidationError/u)
  assert.match(detailSource, /quietEnabled/u)
  assert.match(detailSource, /<FaSwitch/u)
  assert.match(detailSource, /关闭后不静默/u)
})
