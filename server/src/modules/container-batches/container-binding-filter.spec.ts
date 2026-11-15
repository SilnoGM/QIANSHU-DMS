import { ContainerBindingFilterDto } from './container-batch.dto'
import { buildContainerBatchListWhere, withContainerBindingFilter } from './container-binding-filter'

describe('container batch binding filter', () => {
  it('keeps search and warehouse conditions while the default ALL adds no binding condition', () => {
    const where = buildContainerBatchListWhere({ search: '  柜次  ', warehouseValue: 'B5' })
    expect(where).toEqual({
      warehouseValue: 'B5',
      OR: [
        { containerBatchName: { contains: '柜次', mode: 'insensitive' } },
        { containerBatchNo: { contains: '柜次', mode: 'insensitive' } },
        { items: { some: { recipientName: { contains: '柜次', mode: 'insensitive' } } } },
      ],
    })
    expect(buildContainerBatchListWhere({ bindingState: ContainerBindingFilterDto.ALL })).toEqual({})
    expect(buildContainerBatchListWhere({ search: '   ' })).toEqual({})
  })

  it('requires at least one loading line and no unbound line for FULL', () => {
    expect(withContainerBindingFilter({}, ContainerBindingFilterDto.FULL).AND).toEqual([
      { items: { some: {} } },
      { items: { none: { shipmentId: null } } },
    ])
  })

  it('requires both a bound and an unbound line for PARTIAL', () => {
    expect(withContainerBindingFilter({}, ContainerBindingFilterDto.PARTIAL).AND).toEqual([
      { items: { some: { shipmentId: { not: null } } } },
      { items: { some: { shipmentId: null } } },
    ])
  })

  it('treats containers without any loading line as NONE so the three states partition all batches', () => {
    expect(withContainerBindingFilter({}, ContainerBindingFilterDto.NONE).AND).toEqual([
      { items: { none: { shipmentId: { not: null } } } },
    ])
    // 未绑定不要求存在明细行，空柜因此落在未绑定而不是被三态漏掉。
    expect(withContainerBindingFilter({}, ContainerBindingFilterDto.NONE).AND).not.toEqual(expect.arrayContaining([
      { items: { some: {} } },
    ]))
  })

  it('omits its own dimension for count baselines and merges into existing AND clauses', () => {
    const base = buildContainerBatchListWhere({ search: '唛头', bindingState: ContainerBindingFilterDto.FULL }, { omitBindingState: true })
    expect(base.AND).toBeUndefined()
    expect(withContainerBindingFilter({ ...base, AND: [{ warehouseValue: 'B5' }] }, ContainerBindingFilterDto.NONE)).toEqual({
      OR: [
        { containerBatchName: { contains: '唛头', mode: 'insensitive' } },
        { containerBatchNo: { contains: '唛头', mode: 'insensitive' } },
        { items: { some: { recipientName: { contains: '唛头', mode: 'insensitive' } } } },
      ],
      AND: [
        { warehouseValue: 'B5' },
        { items: { none: { shipmentId: { not: null } } } },
      ],
    })
  })
})
