import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 音效映射与节流使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createUiSoundGate,
  resolveSwitchChecked,
  resolveToastSound,
  shouldPlayUiSound,
} from '../../src/utils/ui-sound.logic'

test('轻提示按视觉类型映射到四种交互音效', () => {
  assert.equal(resolveToastSound('success'), 'success')
  assert.equal(resolveToastSound('error'), 'error')
  assert.equal(resolveToastSound('warning'), 'warning')
  assert.equal(resolveToastSound('info'), 'notify')
})

test('加载、默认和未知类型保持静音', () => {
  assert.equal(resolveToastSound('loading'), null)
  assert.equal(resolveToastSound('default'), null)
})

test('提示音在最小间隔内不叠加，同类提示保留更长冷却', () => {
  let now = 0
  const gate = createUiSoundGate({
    now: () => now,
    minGapMs: 150,
    repeatGapMs: 300,
  })

  assert.equal(gate.tryAcquire('notify'), true)
  now = 100
  assert.equal(gate.tryAcquire('notify'), false)
  now = 200
  assert.equal(gate.tryAcquire('notify'), false)
  now = 320
  assert.equal(gate.tryAcquire('notify'), true)
  now = 400
  assert.equal(gate.tryAcquire('error'), false)
  now = 480
  assert.equal(gate.tryAcquire('error'), true)
})

test('开关音只要求最小间隔，不套用同类提示冷却', () => {
  let now = 0
  const gate = createUiSoundGate({
    now: () => now,
    minGapMs: 150,
    repeatGapMs: 300,
  })

  assert.equal(gate.tryAcquire('toggle'), true)
  now = 100
  assert.equal(gate.tryAcquire('toggle'), false)
  now = 160
  assert.equal(gate.tryAcquire('toggle'), true)
})

test('开关旧状态从 aria-checked 读取，缺失时回退 data-state', () => {
  assert.equal(resolveSwitchChecked('true', null), true)
  assert.equal(resolveSwitchChecked('false', null), false)
  assert.equal(resolveSwitchChecked(null, 'checked'), true)
  assert.equal(resolveSwitchChecked(null, 'unchecked'), false)
  assert.equal(resolveSwitchChecked(null, null), null)
})

test('页面隐藏或窗口失焦时不播放音效', () => {
  assert.equal(shouldPlayUiSound('visible', true), true)
  assert.equal(shouldPlayUiSound('hidden', true), false)
  assert.equal(shouldPlayUiSound('visible', false), false)
})
