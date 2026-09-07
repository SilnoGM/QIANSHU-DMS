import type { CreatePurchaseOrderRequestDto } from '../../../api/generated/types.gen'
import type { OrderProductLineModel } from '../../../components/business/QsOrderProductLineEditor/types'
import type { PartConfiguration, PartConfiguratorProduct } from '../../../components/business/QsPartConfigurator/types'
import { validatePartConfigurations } from '../../../components/business/QsPartConfigurator/logic'

function quantityOf(line: OrderProductLineModel): number {
  if (!/^\d+$/u.test(line.quantity)) {
    return 0
  }
  const quantity = Number(line.quantity)
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 2_147_483_647 ? quantity : 0
}

/** 仅接收本次采购行；历史已采购快照不得参与再次分配或提交。 */
export function mapPurchaseOrderPartProducts(
  lines: readonly OrderProductLineModel[],
): readonly PartConfiguratorProduct[] {
  return lines.map(line => ({
    key: line.key,
    productNo: line.productNo,
    name: line.name,
    description: line.description,
    quantity: quantityOf(line),
    mainImage: line.mainImage,
  }))
}

/** 展示快照与提交快照一起冻结，迟到的产品请求不能改变用户正在恢复的分箱内容。 */
export function freezePurchaseOrderPartReview(
  lines: readonly OrderProductLineModel[],
  parts: readonly PartConfiguration[],
): { readonly products: readonly PartConfiguratorProduct[], readonly parts: readonly PartConfiguration[] } {
  return Object.freeze({
    products: Object.freeze(mapPurchaseOrderPartProducts(lines).map(product => Object.freeze({
      ...product,
      mainImage: product.mainImage === null ? null : Object.freeze({ ...product.mainImage }),
    }))),
    parts: Object.freeze(parts.map(part => Object.freeze({
      key: part.key,
      items: Object.freeze(part.items.map(item => Object.freeze({ ...item }))),
    }))),
  })
}

export function buildPurchaseOrderParts(
  lines: readonly OrderProductLineModel[],
  parts: readonly PartConfiguration[],
): { valid: true, parts: CreatePurchaseOrderRequestDto['parts'] }
  | { valid: false, message: string } {
  const validation = validatePartConfigurations(mapPurchaseOrderPartProducts(lines), parts)
  if (!validation.valid) {
    return {
      valid: false,
      message: validation.remainingQuantity > 0
        ? `还有 ${validation.remainingQuantity} 件产品未配置货件，请先完成配置`
        : validation.errors[0] ?? '请检查货件内的产品与数量分配',
    }
  }
  const lineNumberByKey = new Map(lines.map((line, index) => [line.key, index + 1]))
  return {
    valid: true,
    parts: parts.map(part => ({
      key: part.key,
      items: part.items.map(item => ({
        lineNumber: lineNumberByKey.get(item.productKey)!,
        quantity: item.quantity,
      })),
    })),
  }
}

/**
 * 返回修改采购产品时，只撤回已删除或被减至超量的产品分配，并由调用方轻提示。
 * 不自动猜测该从哪个箱子扣件；其他产品、增加数量和改名改价保留已有货件身份。
 */
export function reconcilePurchaseOrderParts(
  lines: readonly OrderProductLineModel[],
  parts: readonly PartConfiguration[],
): { parts: readonly PartConfiguration[], changed: boolean } {
  const quantityByKey = new Map(lines.map(line => [line.key, quantityOf(line)]))
  const assignedByKey = new Map<string, number>()
  for (const part of parts) {
    for (const item of part.items) {
      assignedByKey.set(item.productKey, (assignedByKey.get(item.productKey) ?? 0) + item.quantity)
    }
  }
  const removedKeys = new Set([...assignedByKey].filter(([key, assigned]) => (
    !quantityByKey.has(key) || assigned > quantityByKey.get(key)!
  )).map(([key]) => key))
  if (removedKeys.size === 0) {
    return { parts, changed: false }
  }
  return {
    changed: true,
    parts: parts.map(part => ({
      ...part,
      items: part.items.filter(item => !removedKeys.has(item.productKey)),
    })).filter(part => part.items.length > 0),
  }
}
