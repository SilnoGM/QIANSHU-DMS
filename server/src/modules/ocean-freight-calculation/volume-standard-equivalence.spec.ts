import { calculateOceanVolume, VOLUME_CAI_SCALE } from './ocean-freight-calculation'
import { recordSlhVolume, slhVolumeRatio, SLH_VOLUME_SCALE } from '../slh-bills/slh-bill-calculation'

/**
 * 两个来源表格共用同一材积标准：长 × 宽 × 高 ÷ 28316 × 箱数，
 * 非按材积计价保留两位小数，按材积计价向上取整。
 * 样例取自真实表格：装柜明细 0226 柜与顺联航账单中带尺寸的明细行。
 */
const samples = [
  { label: '装柜明细 0226柜 撕碎机', lengthCm: '158', widthCm: '102', heightCm: '165', packageCount: 1, recorded: '93.91', chargeable: 94 },
  { label: '账单明细 150×120×87', lengthCm: '150', widthCm: '120', heightCm: '87', packageCount: 1, recorded: '55.30', chargeable: 56 },
  { label: '账单明细 48×46×42 两箱', lengthCm: '48', widthCm: '46', heightCm: '42', packageCount: 2, recorded: '6.55', chargeable: 7 },
  { label: '账单明细 190×92×63 单价 30', lengthCm: '190', widthCm: '92', heightCm: '63', packageCount: 1, recorded: '38.89', chargeable: 39 },
] as const

describe('装柜明细与账单表的材积标准一致', () => {
  it('两侧共用同一分母与记录精度', () => {
    expect(VOLUME_CAI_SCALE).toBe(SLH_VOLUME_SCALE)
  })

  it.each(samples)('$label 在两侧记录值与计费数量一致', sample => {
    const container = calculateOceanVolume({
      lengthCm: sample.lengthCm, widthCm: sample.widthCm, heightCm: sample.heightCm,
      packageCount: sample.packageCount, reportedVolumeCai: null,
    })
    const ratio = slhVolumeRatio({
      lengthCm: sample.lengthCm, widthCm: sample.widthCm, heightCm: sample.heightCm, packageCount: sample.packageCount,
    })

    // 记录值：两侧都是两位小数；计费数量：两侧都是同一精确值的向上取整。
    expect(Number(container.volumeCai)).toBe(Number(sample.recorded))
    expect(container.chargeableVolumeCai).toBe(sample.chargeable)
    expect(recordSlhVolume(ratio!, 'WEIGHT')).toBe(sample.recorded)
    expect(Number(recordSlhVolume(ratio!, 'VOLUME'))).toBe(sample.chargeable)
    // 按材积计价取账单侧记录值，按重量计价取装柜侧记录值，两者必须相等。
    expect(Number(recordSlhVolume(ratio!, 'VOLUME'))).toBe(container.chargeableVolumeCai)
    expect(Number(recordSlhVolume(ratio!, 'WEIGHT'))).toBe(Number(container.volumeCai))
  })
})
