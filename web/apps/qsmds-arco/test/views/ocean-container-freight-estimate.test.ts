import type { FreightEstimateInput } from '../../src/views/operations/ocean-containers/freight-estimate.logic'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验运费预估的计费材积、取大值与固定费用口径。
import test from 'node:test'
import { calculateChargeableVolume, calculateFreightEstimate } from '../../src/views/operations/ocean-containers/freight-estimate.logic'

function input(overrides: Partial<FreightEstimateInput> = {}): FreightEstimateInput {
  return {
    grossWeightKg: '180',
    lengthCm: '128',
    widthCm: '19',
    heightCm: '15',
    packageCount: 10,
    codAmountTwd: '20000.00',
    ...overrides,
  }
}

test('计费材积按 28316 向上取整', () => {
  assert.equal(calculateChargeableVolume(input()), 13)
  // 14157×2×1×1 = 28314 → 0.9999 材，向上取整为 1。
  assert.equal(calculateChargeableVolume(input({ lengthCm: '14157', widthCm: '2', heightCm: '1', packageCount: 1 })), 1)
  // 14158×2×1×1 = 28316 → 正好 1 材。
  assert.equal(calculateChargeableVolume(input({ lengthCm: '14158', widthCm: '2', heightCm: '1', packageCount: 1 })), 1)
  // 14159×2×1×1 = 28318 → 超过 1 材一点，向上取整为 2。
  assert.equal(calculateChargeableVolume(input({ lengthCm: '14159', widthCm: '2', heightCm: '1', packageCount: 1 })), 2)
})

test('尺寸或箱数缺失时不产生计费材积', () => {
  assert.equal(calculateChargeableVolume(input({ lengthCm: null })), null)
  assert.equal(calculateChargeableVolume(input({ widthCm: null })), null)
  assert.equal(calculateChargeableVolume(input({ heightCm: null })), null)
  assert.equal(calculateChargeableVolume(input({ packageCount: 0 })), null)
  assert.equal(calculateChargeableVolume(input({ packageCount: -1 })), null)
  assert.equal(calculateChargeableVolume(input({ lengthCm: 'abc' })), null)
})

test('按材积与按重量取较大值，并叠加 150kg 附加费与代收手续费', () => {
  assert.deepEqual(calculateFreightEstimate(input()), {
    volumeCai: 13,
    weightKg: '180',
    byVolume: '390.00',
    byWeight: '900.00',
    freight: '900.00',
    freightBasis: 'BOTH',
    surcharge: '100.00',
    codHandling: '30.00',
    total: '1030.00',
  })
})

test('材积与重量金额相等时仍标记为两侧比较，取该金额', () => {
  // 14158×2×1×30 = 849480 → 30 材；30 材 × 30 元 = 900 元，与 180kg × 5 元相等。
  const result = calculateFreightEstimate(input({ lengthCm: '14158', widthCm: '2', heightCm: '1', packageCount: 30 }))
  assert.equal(result.byVolume, '900.00')
  assert.equal(result.byWeight, '900.00')
  assert.equal(result.freight, '900.00')
  assert.equal(result.freightBasis, 'BOTH')
  assert.equal(result.total, '1030.00')
})

test('重量 150kg 是附加费边界，140kg 不计附加费', () => {
  const boundary = calculateFreightEstimate(input({ grossWeightKg: '150' }))
  assert.equal(boundary.surcharge, '100.00')
  assert.equal(boundary.total, '880.00')

  const below = calculateFreightEstimate(input({ grossWeightKg: '140' }))
  assert.equal(below.surcharge, null)
  assert.equal(below.total, '730.00')
})

test('毛重缺失时仅按材积，省略重量与附加费', () => {
  const result = calculateFreightEstimate(input({ grossWeightKg: null }))
  assert.equal(result.volumeCai, 13)
  assert.equal(result.weightKg, null)
  assert.equal(result.byVolume, '390.00')
  assert.equal(result.byWeight, null)
  assert.equal(result.freight, '390.00')
  assert.equal(result.freightBasis, 'VOLUME')
  assert.equal(result.surcharge, null)
  assert.equal(result.codHandling, '30.00')
  assert.equal(result.total, '420.00')
})

test('尺寸缺失时仅按重量，附加费照常按毛重判断', () => {
  const result = calculateFreightEstimate(input({ lengthCm: null }))
  assert.equal(result.volumeCai, null)
  assert.equal(result.byVolume, null)
  assert.equal(result.byWeight, '900.00')
  assert.equal(result.freight, '900.00')
  assert.equal(result.freightBasis, 'WEIGHT')
  assert.equal(result.surcharge, '100.00')
  assert.equal(result.codHandling, '30.00')
  assert.equal(result.total, '1030.00')
})

test('两侧运费都无法计算时不产生合计，也不单独显示费用', () => {
  const result = calculateFreightEstimate(input({ grossWeightKg: null, lengthCm: null }))
  assert.equal(result.freight, null)
  assert.equal(result.freightBasis, null)
  assert.equal(result.surcharge, null)
  assert.equal(result.codHandling, null)
  assert.equal(result.total, null)
})

test('代收为 0 或缺失时不产生代收手续费', () => {
  const zero = calculateFreightEstimate(input({ codAmountTwd: '0.00' }))
  assert.equal(zero.codHandling, null)
  assert.equal(zero.total, '1000.00')

  const missing = calculateFreightEstimate(input({ codAmountTwd: null }))
  assert.equal(missing.codHandling, null)
  assert.equal(missing.total, '1000.00')

  const invalid = calculateFreightEstimate(input({ codAmountTwd: 'abc' }))
  assert.equal(invalid.codHandling, null)
  assert.equal(invalid.total, '1000.00')
})

test('非法毛重不参与比较，也不触发附加费', () => {
  const result = calculateFreightEstimate(input({ grossWeightKg: 'abc' }))
  assert.equal(result.weightKg, null)
  assert.equal(result.byWeight, null)
  assert.equal(result.freightBasis, 'VOLUME')
  assert.equal(result.surcharge, null)
  assert.equal(result.total, '420.00')
})

test('tooltip 内金额覆盖气泡反色，避免与 bg-foreground 气泡同色', async () => {
  const source = await readFile(new URL('../../src/views/operations/ocean-containers/ocean-container-line-drawer.vue', import.meta.url), 'utf8')
  const start = source.indexOf('<template #content>')
  const end = source.indexOf('</template>', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const tooltip = source.slice(start, end)
  const amounts = [...tooltip.matchAll(/<AmountDisplay\b[^>]*>/gu)].map(match => match[0])
  assert.ok(amounts.length > 0)
  for (const amount of amounts) {
    assert.match(amount, /!text-background/u)
  }
  // 气泡内部不能沿用页面前的 foreground/muted 语义，否则深色气泡上会看不清。
  assert.doesNotMatch(tooltip, /text-muted-foreground/u)
})
