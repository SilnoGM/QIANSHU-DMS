import type { OceanChangeLine } from '../../src/views/operations/ocean-containers/change-logic'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证修改确认、剪贴板内容、撤销与未知结果重试。
import test from 'node:test'
import { effectScope } from 'vue'
import { buildOceanChangeText, normalizeOceanChange, oceanChangeDiff } from '../../src/views/operations/ocean-containers/change-logic'
import { useOceanLineChange } from '../../src/views/operations/ocean-containers/change-session'

const source = () => ({ id: 'line-1', version: 3, oceanShippingMarkText: 'L-091726-01', recipientName: '客户', recipientPhone: '123', recipientAddress: '原地址', remark: '原备注', codAmountTwd: '120.00' } as OceanChangeLine)
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup(kind: 'RECIPIENT' | 'COD' = 'RECIPIENT') {
  const saves: unknown[] = []
  const undos: { changeId: string, input: unknown }[] = []
  const copies: string[] = []
  const closes: (OceanChangeLine | null)[] = []
  const timers = new Set<() => void>()
  let copyFailure = false
  let saveFailure: unknown = null
  let undoFailure: unknown = null
  let saveResult: ReturnType<typeof deferred<{ data: { line: OceanChangeLine, changeId: string } }>> | null = null
  let undoResult: ReturnType<typeof deferred<{ data: { line: OceanChangeLine, changeId: string } }>> | null = null
  let key = 0
  const scope = effectScope()
  const state = scope.run(() => useOceanLineChange({
    containerId: 'container-1',
    lineId: 'line-1',
    containerName: '0917柜',
    kind,
    createKey: () => `key-${++key}`,
    onClose: line => closes.push(line),
    scheduleTick: (callback) => {
      timers.add(callback)
      return () => timers.delete(callback)
    },
    copyText: async (value) => {
      if (copyFailure) {
        throw new Error('denied')
      }
      copies.push(value)
    },
    api: {
      item: async () => ({ data: source() }),
      changeItem: async (_container, _line, input) => {
        saves.push(input)
        if (saveFailure) {
          throw saveFailure
        }
        return saveResult ? saveResult.promise : { data: { line: { ...source(), version: 4 }, changeId: 'change-1' } }
      },
      undoChange: async (_container, _line, changeId, input) => {
        undos.push({ changeId, input })
        if (undoFailure) {
          throw undoFailure
        }
        return undoResult ? undoResult.promise : { data: { line: { ...source(), version: 5 }, changeId } }
      },
    },
  }))!
  function tick() {
    const current = [...timers]
    timers.clear()
    current.forEach(callback => callback())
  }
  return {
    state,
    saves,
    undos,
    copies,
    closes,
    timers,
    tick,
    stop: () => scope.stop(),
    failCopy: (value: boolean) => { copyFailure = value },
    failSave: (value: unknown) => { saveFailure = value },
    failUndo: (value: unknown) => { undoFailure = value },
    delaySave: () => saveResult = deferred(),
    delayUndo: () => undoResult = deferred(),
  }
}

async function prepare(s: ReturnType<typeof setup>) {
  await s.state.load()
  s.state.draft.value.recipientAddress = '新地址'
  s.state.draft.value.codAmountTwd = '300'
  assert.equal(s.state.review(), true)
  assert.equal(await s.state.copy(), true)
}

test('修改值规范化保留空值和零的区别，严格校验两位非负金额', () => {
  const recipient = normalizeOceanChange('RECIPIENT', { ...source(), recipientName: ' 新客户 ', recipientPhone: ' ', remark: '\n内容\n' })
  assert.deepEqual(recipient, { value: { kind: 'RECIPIENT', recipientName: '新客户', recipientPhone: null, recipientAddress: '原地址', remark: '内容' } })
  assert.deepEqual(normalizeOceanChange('COD', { ...source(), codAmountTwd: '0' }), { value: { kind: 'COD', codAmountTwd: '0.00' } })
  assert.deepEqual(normalizeOceanChange('COD', { ...source(), codAmountTwd: null }), { value: { kind: 'COD', codAmountTwd: null } })
  for (const amount of ['-1', '1.001', '1e2', ' 2 ']) {
    assert.equal(normalizeOceanChange('COD', { ...source(), codAmountTwd: amount }).error, 'invalidAmount')
  }
})

test('收件修改按模板只复制变化字段，唛头使用海运唛头', () => {
  const line = { ...source(), shippingMark: '货件唛头不可复制' }
  const nameOnly = normalizeOceanChange('RECIPIENT', { ...line, recipientName: '謝崑滄1' }).value!
  assert.equal(buildOceanChangeText('0917柜', line, nameOnly), '【收件人信息修改】\n柜次：0917柜\n唛头：L-091726-01\n\n客户姓名改为：謝崑滄1')
  const after = normalizeOceanChange('RECIPIENT', { ...source(), recipientAddress: '新地址', remark: '第一行\n第二行' }).value!
  assert.equal(buildOceanChangeText('0917柜', source(), after), '【收件人信息修改】\n柜次：0917柜\n唛头：L-091726-01\n\n收件地址改为：新地址\n备注改为：第一行\n第二行')
})

test('收件修改忽略空白和换行格式差异，清空字段明确说明', () => {
  const line = { ...source(), recipientName: ' 客户 ', recipientPhone: null, recipientAddress: '原地址\r\n第二行' }
  const after = normalizeOceanChange('RECIPIENT', { ...line, recipientName: '客户', recipientPhone: '', recipientAddress: '原地址\n第二行', remark: '' }).value!
  assert.equal(buildOceanChangeText('0917柜', line, after), '【收件人信息修改】\n柜次：0917柜\n唛头：L-091726-01\n\n备注改为：清空')
})

test('核对与发送摘要只展示实际修改字段，草稿标记忽略首尾空白和换行格式', () => {
  const line = { ...source(), recipientName: ' 客户 ', recipientPhone: null, recipientAddress: '原地址\r\n第二行' }
  const draft = { ...line, kind: 'RECIPIENT' as const, recipientName: '客户', recipientPhone: '', recipientAddress: '原地址\n第二行', remark: ' ' }
  assert.deepEqual(oceanChangeDiff(line, draft), [{ key: 'remark', before: '原备注', after: null }])
  assert.deepEqual(oceanChangeDiff(line, { ...draft, remark: '原备注' }), [])
  assert.deepEqual(oceanChangeDiff(line, { ...draft, recipientName: ' 新客户 ' }), [
    { key: 'recipientName', before: '客户', after: '新客户' },
    { key: 'remark', before: '原备注', after: null },
  ])
})

test('代收核对区保留零与取消代收，等值金额不产生修改摘要', () => {
  const line = { ...source(), codAmountTwd: '0' }
  assert.deepEqual(oceanChangeDiff(line, { kind: 'COD', codAmountTwd: '0.00' }), [])
  assert.deepEqual(oceanChangeDiff(line, { kind: 'COD', codAmountTwd: null }), [{ key: 'codAmountTwd', before: '0.00', after: null }])
  assert.deepEqual(oceanChangeDiff({ ...line, codAmountTwd: null }, { kind: 'COD', codAmountTwd: '0.00' }), [{ key: 'codAmountTwd', before: null, after: '0.00' }])
})

test('代收修改使用原代收和新代收模板，零与取消代收不混淆', () => {
  const line = { ...source(), shippingMark: '货件唛头不可复制' }
  assert.equal(buildOceanChangeText('0917柜', line, { kind: 'COD', codAmountTwd: '300.00' }), '【代收款修改】\n柜次：0917柜\n唛头：L-091726-01\n\n原代收：NT$ 120\n新代收改为：NT$ 300')
  assert.match(buildOceanChangeText('0917柜', line, { kind: 'COD', codAmountTwd: '0.00' }), /原代收：NT\$ 120\n新代收改为：NT\$ 0$/u)
  assert.match(buildOceanChangeText('0917柜', line, { kind: 'COD', codAmountTwd: null }), /原代收：NT\$ 120\n新代收改为：取消代收$/u)
  assert.match(buildOceanChangeText('0917柜', { ...line, codAmountTwd: null }, { kind: 'COD', codAmountTwd: '9007199254740993.01' }), /原代收：无代收\n新代收改为：NT\$ 9007199254740993\.01$/u)
})

test('代收复制金额带币种和空格，整数省略小数，非整数保留两位且大金额不丢精度', () => {
  const integer = buildOceanChangeText('0917柜', { ...source(), codAmountTwd: '210000.00' }, { kind: 'COD', codAmountTwd: '200000.00' })
  assert.equal(integer, '【代收款修改】\n柜次：0917柜\n唛头：L-091726-01\n\n原代收：NT$ 210000\n新代收改为：NT$ 200000')
  const decimal = buildOceanChangeText('0917柜', { ...source(), codAmountTwd: '210000.50' }, { kind: 'COD', codAmountTwd: '200000.01' })
  assert.ok(decimal.endsWith('原代收：NT$ 210000.50\n新代收改为：NT$ 200000.01'))
  const large = buildOceanChangeText('0917柜', { ...source(), codAmountTwd: '9999999999999999999999999999.00' }, { kind: 'COD', codAmountTwd: '9999999999999999999999999999.99' })
  assert.ok(large.endsWith('原代收：NT$ 9999999999999999999999999999\n新代收改为：NT$ 9999999999999999999999999999.99'))
})

test('金额完整支持 Decimal(30,2)，文本以 code point 限长并归一换行', () => {
  const maxAmount = '9999999999999999999999999999.99'
  assert.deepEqual(normalizeOceanChange('COD', { ...source(), codAmountTwd: maxAmount }), { value: { kind: 'COD', codAmountTwd: maxAmount } })
  assert.equal(normalizeOceanChange('COD', { ...source(), codAmountTwd: '10000000000000000000000000000' }).error, 'invalidAmount')
  const normalized = normalizeOceanChange('RECIPIENT', { ...source(), recipientName: '😀'.repeat(128), recipientAddress: '台灣\r\n地址\r第二行', remark: '記錄'.repeat(1000) })
  assert.equal(normalized.value?.kind, 'RECIPIENT')
  assert.equal(normalized.value && 'recipientAddress' in normalized.value && normalized.value.recipientAddress, '台灣\n地址\n第二行')
  assert.equal(normalizeOceanChange('RECIPIENT', { ...source(), recipientName: '😀'.repeat(129) }).error, 'textTooLong')
  assert.equal(normalizeOceanChange('RECIPIENT', { ...source(), recipientName: `姓名${String.fromCharCode(1)}` }).error, 'invalidText')
  assert.equal(normalizeOceanChange('RECIPIENT', { ...source(), recipientAddress: '地址\n第二行\t门号' }).error, undefined)
})

test('无变更不可继续，复制失败不能确认，未发送取消不写库', async () => {
  const s = setup()
  await s.state.load()
  assert.equal(s.state.review(), false)
  s.state.draft.value.recipientAddress = '新地址'
  assert.equal(s.state.review(), true)
  assert.equal(await s.state.save(), null)
  s.failCopy(true)
  assert.equal(await s.state.copy(), false)
  assert.equal(s.state.step.value, 1)
  assert.equal(await s.state.save(), null)
  s.failCopy(false)
  assert.equal(await s.state.copy(), true)
  assert.equal(s.state.step.value, 2)
  s.state.close()
  assert.equal(s.saves.length, 0)
  assert.deepEqual(s.closes, [null])
  s.stop()
})

test('返回修改使复制确认失效，重新复制后才可保存', async () => {
  const s = setup('COD')
  await prepare(s)
  s.state.edit()
  assert.equal(s.state.step.value, 0)
  assert.equal(s.state.canSave.value, false)
  s.state.draft.value.codAmountTwd = '400'
  s.state.review()
  assert.equal(await s.state.save(), null)
  await s.state.copy()
  await s.state.save()
  assert.deepEqual(s.saves[0], { kind: 'COD', codAmountTwd: '400.00', requestKey: 'key-3', expectedVersion: 3, notificationConfirmed: true })
  s.stop()
})

test('保存成功进入第四步，倒计时从响应返回后完整运行五秒且只关闭一次', async () => {
  const s = setup()
  await prepare(s)
  const result = s.delaySave()
  const save = s.state.save()
  s.tick()
  s.tick()
  assert.equal(s.timers.size, 0)
  s.state.close()
  assert.equal(s.closes.length, 0)
  result.resolve({ data: { line: { ...source(), version: 4 }, changeId: 'change-1' } })
  await save
  assert.equal(s.state.step.value, 3)
  assert.equal(s.state.countdown.value, 5)
  assert.equal(s.closes.length, 0)
  for (let seconds = 4; seconds >= 1; seconds--) {
    s.tick()
    assert.equal(s.state.countdown.value, seconds)
    assert.equal(s.closes.length, 0)
  }
  s.tick()
  assert.equal(s.closes.length, 1)
  assert.equal(s.closes[0]?.version, 4)
  s.state.close()
  s.tick()
  assert.equal(s.closes.length, 1)
  assert.equal(s.timers.size, 0)
  s.stop()
})

test('未知保存结果保留同一请求确认发送与版本，不允许返回改变意图', async () => {
  const s = setup('COD')
  await prepare(s)
  s.failSave({ kind: 'network' })
  assert.equal(await s.state.save(), null)
  assert.equal(s.state.pending.value, true)
  s.state.close()
  assert.equal(s.closes.length, 0)
  s.state.edit()
  assert.equal(s.state.step.value, 2)
  s.state.draft.value.codAmountTwd = '999'
  s.failSave(null)
  assert.equal((await s.state.save())?.line.version, 4)
  assert.equal(s.saves[0], s.saves[1])
  assert.equal((s.saves[1] as { codAmountTwd: string }).codAmountTwd, '300.00')
  s.stop()
})

test('撤销立即停止倒计时，未知结果保持页面并使用同一撤销键重试', async () => {
  const s = setup('COD')
  await prepare(s)
  await s.state.save()
  s.tick()
  s.failUndo({ kind: 'network' })
  assert.equal(await s.state.undo(), null)
  assert.equal(s.state.undoPending.value, true)
  s.state.close()
  assert.equal(s.closes.length, 0)
  assert.equal(s.state.countdown.value, null)
  assert.equal(s.timers.size, 0)
  for (let index = 0; index < 10; index++) {
    s.tick()
  }
  assert.equal(s.closes.length, 0)
  s.failUndo(null)
  assert.equal((await s.state.undo())?.line.version, 5)
  assert.equal(s.undos[0].input, s.undos[1].input)
  assert.equal(s.undos[0].changeId, 'change-1')
  assert.equal((s.undos[0].input as { expectedVersion: number }).expectedVersion, 4)
  s.state.close()
  assert.equal(s.closes[0]?.version, 5)
  s.stop()
})

test('撤销冲突不会覆盖后来修改，失败后不自动关闭，保留手动关闭', async () => {
  const s = setup()
  await prepare(s)
  await s.state.save()
  s.failUndo({ status: 409 })
  await s.state.undo()
  assert.equal(s.state.undoConflict.value, true)
  assert.equal(s.state.canUndo.value, false)
  assert.equal(s.state.countdown.value, null)
  assert.equal(await s.state.undo(), null)
  assert.equal(s.undos.length, 1)
  s.state.close()
  assert.equal(s.closes[0]?.version, 4)
  s.stop()
})

test('保存冲突必须重读，卸载取消所有计时器及在途撤销回写', async () => {
  const s = setup()
  await prepare(s)
  s.failSave({ status: 409 })
  await s.state.save()
  assert.equal(s.state.needsReload.value, true)
  assert.equal(s.state.canSave.value, false)
  await s.state.load()
  assert.equal(s.state.step.value, 0)
  s.failSave(null)
  await prepare(s)
  await s.state.save()
  const delayed = s.delayUndo()
  const work = s.state.undo()
  assert.equal(s.state.busy.value, true)
  s.state.close()
  assert.equal(s.closes.length, 0)
  s.stop()
  assert.equal(s.timers.size, 0)
  delayed.resolve({ data: { line: { ...source(), version: 5 }, changeId: 'change-1' } })
  assert.equal(await work, null)
  s.tick()
  assert.equal(s.closes.length, 0)
})
