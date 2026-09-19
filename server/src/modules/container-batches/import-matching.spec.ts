import { matchContainerShipment, type ContainerShipmentCandidate } from './import-matching'

const first: ContainerShipmentCandidate = { id: 'one', shippingMarkText: 'TEST/20260917-001/货件-01', shipmentNo: 'PKG/20260917-00001', trackingNo: '0500229791938' }
const second: ContainerShipmentCandidate = { id: 'two', shippingMarkText: 'F-FSL-0290-0291', shipmentNo: 'PKG/20260917-00002', trackingNo: 'YT7643290737720' }
describe('container shipment matching', () => {
  it.each([first.shippingMarkText, first.shipmentNo, first.trackingNo])('matches full identifier %s', (value) => {
    expect(matchContainerShipment(value, [first, second])).toMatchObject({ status: 'MATCHED', shipmentId: 'one', candidateIds: ['one'] })
  })
  it('extracts complete references around carrier annotations without mutating the source', () => {
    expect(matchContainerShipment('YT7643290737720（圆通）F-FSL-0290-0291', [first, second])).toMatchObject({ status: 'MATCHED', shipmentId: 'two' })
    expect(matchContainerShipment('0500229791938（安能）', [first, second]).shipmentId).toBe('one')
  })
  it.each(['500229791938', '0500229791938-2', 'TEST/20260917-001', 'XPKG/20260917-00001', 'L-091726-01', null])('does not fuzzy match %s', reference => {
    expect(matchContainerShipment(reference, [first, second]).status).toBe('UNMATCHED')
  })
  it('does not strip a suffix after an annotation', () => {
    expect(matchContainerShipment('0500229791938（安能）-2', [first]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('0500229791938（安能） -2', [first]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('0500229791938 （安能） -2', [first]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('0500229791938（2）', [first]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('0500229791938（A01）', [first]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('0500229791938 （A01）', [first]).status).toBe('UNMATCHED')
  })
  it('keeps ambiguous shared tracking and conflicting identifiers unselected', () => {
    expect(matchContainerShipment(first.trackingNo, [first, { ...second, trackingNo: first.trackingNo }])).toMatchObject({ status: 'AMBIGUOUS', shipmentId: null, candidateIds: ['one', 'two'] })
    expect(matchContainerShipment(`${first.shippingMarkText} ${second.trackingNo}`, [first, second])).toMatchObject({ status: 'AMBIGUOUS', shipmentId: null })
  })
  it('never turns punctuation or case variants into exact matching evidence', () => {
    expect(matchContainerShipment('F-FSL-0290-0291A', [second]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('f-fsl-0290-0291', [second]).status).toBe('UNMATCHED')
    expect(matchContainerShipment('F-FSL-0290', [second]).status).toBe('UNMATCHED')
  })
})
