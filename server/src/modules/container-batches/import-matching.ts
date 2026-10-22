export interface ContainerShipmentCandidate {
  id: string
  shippingMarkText: string | null
  trackingNo: string | null
  shipmentNo: string | null
}
export type ReferenceField = 'shippingMarkText' | 'trackingNo' | 'shipmentNo'
export interface ContainerShipmentMatch {
  status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'
  shipmentId: string | null
  candidateIds: string[]
  evidence: Array<{ shipmentId: string, field: ReferenceField, value: string }>
  reason: string | null
}

/** 只拆已知分隔符和承运商附注；附注后的编号后缀属于原编号，不能误命中主号码。 */
export function extractContainerReferenceTokens(reference: string | null): string[] {
  if (!reference?.trim()) return []
  const original = reference.trim()
  const annotated = original.replace(/\s*[（(]([^()（）]*)[）)](\s*[-~～])?/gu, (whole: string, note: string, suffix: string | undefined) => {
    // 数字或包装编号形式的括号内容仍属标识；只移除明确的承运商文字附注。
    if (!/(?:安能|圆通|圓通|韵达|韻達|顺丰|順豐|中通|申通|百世|德邦|京东|京東|壹米滴答|极兔|極兔|物流|快递|快遞|快运|快運|速递|速遞|速运|速運)/u.test(note)) return whole.trimStart()
    return suffix ? suffix.trim() : ' '
  })
  return [...new Set([original, ...annotated.split(/[\s,，;；|｜]+/u)].map(value => value.trim()).filter(Boolean))]
}

export function matchContainerShipment(reference: string | null, candidates: ContainerShipmentCandidate[]): ContainerShipmentMatch {
  const tokens = new Set(extractContainerReferenceTokens(reference))
  const evidence: ContainerShipmentMatch['evidence'] = []
  const fields: ReferenceField[] = ['shippingMarkText', 'trackingNo', 'shipmentNo']
  for (const candidate of candidates) {
    for (const field of fields) {
      const value = candidate[field]?.trim()
      if (value && tokens.has(value)) evidence.push({ shipmentId: candidate.id, field, value })
    }
  }
  const candidateIds = [...new Set(evidence.map(item => item.shipmentId))]
  if (candidateIds.length === 1) return { status: 'MATCHED', shipmentId: candidateIds[0], candidateIds, evidence, reason: null }
  if (candidateIds.length > 1) return { status: 'AMBIGUOUS', shipmentId: null, candidateIds, evidence, reason: '入仓参考命中多个货件，请人工核对' }
  return { status: 'UNMATCHED', shipmentId: null, candidateIds, evidence, reason: '未找到完整标识一致的货件' }
}
