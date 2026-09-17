import type { PurchasePayableDto, PurchasePayableOrderDto } from '@/api/generated/types.gen'
import { sumMoneyValues, validateMoneyString } from '../../../components/base/MoneyInput/logic'

type StatementErrorCode = 'INVALID_STATEMENT' | 'STATEMENT_TOO_LARGE' | 'STATEMENT_RENDER_FAILED'
type StatementTotals = Pick<PurchasePayableDto, 'dueAmount' | 'paidAmount' | 'remainingAmount'>
type StatementItem = StatementTotals & Pick<PurchasePayableDto, 'paymentType' | 'status'>

export interface PurchasePaymentStatement {
  supplierName: string
  generatedAt: string
  orderCount: number
  orders: { orderNo: string, orderDate: string, items: StatementItem[], totals: StatementTotals }[]
  totals: StatementTotals
}

export interface StatementImageLabels {
  title: string
  supplier: string
  generatedAt: string
  selectedOrders: string
  unpaidTotal: string
  order: string
  stage: string
  due: string
  paid: string
  remaining: string
  status: string
  total: string
  currency: string
  note: string
  paymentTypes: Record<PurchasePayableDto['paymentType'], string>
  statuses: Record<PurchasePayableDto['status'], string>
}

export class PurchasePaymentStatementError extends Error {
  constructor(readonly code: StatementErrorCode) {
    super(code)
    this.name = 'PurchasePaymentStatementError'
  }
}

const WIDTH = 1200
// A4 竖版按 210:297 保留最小画布；订单超过一页时只增加高度，保持字号和宽度一致。
const MIN_HEIGHT = Math.ceil(WIDTH * 297 / 210)
const MARGIN = 48
const MAX_HEIGHT = 12000
const MAX_ORDERS = 100

function requireText(value: unknown, maximum = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new PurchasePaymentStatementError('INVALID_STATEMENT')
  }
  return value
}

function money(value: string): string {
  if (typeof value !== 'string' || value.length > 100) {
    throw new PurchasePaymentStatementError('INVALID_STATEMENT')
  }
  const result = validateMoneyString(value, { precision: 2 })
  if (!result.valid || result.normalizedValue === null) {
    throw new PurchasePaymentStatementError('INVALID_STATEMENT')
  }
  return result.normalizedValue
}

function totals(items: StatementTotals[]): StatementTotals {
  return {
    dueAmount: sumMoneyValues(items.map(item => item.dueAmount), { precision: 2 }),
    paidAmount: sumMoneyValues(items.map(item => item.paidAmount), { precision: 2 }),
    remainingAmount: sumMoneyValues(items.map(item => item.remainingAmount), { precision: 2 }),
  }
}

/** 保存已核对的纯数据快照；任何不平或不完整的应付款都不能被渲染成可对外使用的账单。 */
export function buildPurchasePaymentStatement(
  orders: readonly PurchasePayableOrderDto[],
  supplierName: string,
  generatedAt: string,
): PurchasePaymentStatement {
  requireText(supplierName)
  requireText(generatedAt, 128)
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new PurchasePaymentStatementError('INVALID_STATEMENT')
  }
  if (orders.length > MAX_ORDERS) {
    throw new PurchasePaymentStatementError('STATEMENT_TOO_LARGE')
  }
  const orderIds = new Set<string>()
  const payableIds = new Set<string>()
  const rows = orders.map((order: PurchasePayableOrderDto) => {
    if (!order || orderIds.has(order.id) || order.currencyCode !== 'CNY' || !Array.isArray(order.items) || order.items.length !== 2) {
      throw new PurchasePaymentStatementError('INVALID_STATEMENT')
    }
    orderIds.add(requireText(order.id, 200))
    const stages = new Set<string>()
    const items = order.items.map((item: PurchasePayableDto): StatementItem => {
      if (!item || payableIds.has(item.id) || stages.has(item.paymentType) || !['DEPOSIT', 'BALANCE'].includes(item.paymentType)) {
        throw new PurchasePaymentStatementError('INVALID_STATEMENT')
      }
      payableIds.add(requireText(item.id, 200))
      stages.add(item.paymentType)
      const dueAmount = money(item.dueAmount)
      const paidAmount = money(item.paidAmount)
      const remainingAmount = money(item.remainingAmount)
      const balanced = sumMoneyValues([paidAmount, remainingAmount], { precision: 2 }) === dueAmount
      const validStatus = (item.status === 'PENDING_PAYMENT' && remainingAmount !== '0.00')
        || (item.status === 'PAID' && remainingAmount === '0.00' && dueAmount !== '0.00')
        || (item.status === 'NO_PAYMENT' && dueAmount === '0.00')
      if (!balanced || !validStatus) {
        throw new PurchasePaymentStatementError('INVALID_STATEMENT')
      }
      return { paymentType: item.paymentType, status: item.status, dueAmount, paidAmount, remainingAmount }
    }).sort((left, right) => Number(left.paymentType === 'BALANCE') - Number(right.paymentType === 'BALANCE'))
    const summary = totals(items)
    if (summary.dueAmount !== money(order.purchaseTotalAmount) || summary.remainingAmount === '0.00') {
      throw new PurchasePaymentStatementError('INVALID_STATEMENT')
    }
    return { orderNo: requireText(order.orderNo), orderDate: requireText(order.orderDate, 64), items, totals: summary }
  })
  return { supplierName, generatedAt, orderCount: rows.length, orders: rows, totals: totals(rows.map(row => row.totals)) }
}

interface Cell {
  lines: string[]
  font: string
  color?: string
  align?: CanvasTextAlign
}

function formattedAmount(value: string): string {
  const [integer, decimal] = value.split('.')
  return `${integer.replace(/\B(?=(?:\d{3})+(?!\d))/gu, ',')}.${decimal}`
}

async function prepareFonts(statement: PurchasePaymentStatement, labels: StatementImageLabels) {
  const style = getComputedStyle(document.documentElement)
  const sans = style.getPropertyValue('--qs-font-text-sans').trim()
  const mono = style.getPropertyValue('--qs-font-text-mono').trim()
  const primary = style.getPropertyValue('--primary').trim()
  if (!sans || !mono || !primary || !document.fonts) {
    throw new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')
  }
  const sample = [...new Set(Array.from(JSON.stringify({ statement, labels })))].join('')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    // 中文字体按 unicode-range 分片；必须加载本张账单实际用字，不能仅等待应用首屏字体。
    await Promise.race([
      Promise.all([`400 22px ${sans}`, `600 22px ${sans}`, `400 22px ${mono}`, `600 22px ${mono}`].map(async (font) => {
        const faces = await document.fonts.load(font, sample)
        if (!faces.length || !document.fonts.check(font, sample)) {
          throw new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')
        }
      })),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')), 15000)
      }),
    ])
  }
  finally {
    clearTimeout(timeout)
  }
  return { sans, mono, primary: `oklch(${primary})` }
}

/**
 * 单张白底 PNG 是供剪贴板分享的业务文档，独立于页面明暗背景；金额使用 Noto 等宽字体。
 * 先完整测量再分配画布，超出像素预算必须失败，不能静默裁掉尾部订单或合计。
 */
export async function renderPurchasePaymentStatement(statement: PurchasePaymentStatement, labels: StatementImageLabels): Promise<Blob> {
  let canvas: HTMLCanvasElement | undefined
  try {
    const fonts = await prepareFonts(statement, labels)
    canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      throw new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')
    }
    const ink = '#17211b'
    const muted = '#66736b'
    const border = '#dde4df'
    const sans = (weight = 400, size = 22) => `${weight} ${size}px ${fonts.sans}`
    const mono = (weight = 400, size = 22) => `${weight} ${size}px ${fonts.mono}`
    const wrap = (text: string, font: string, width: number): string[] => {
      context.font = font
      const lines: string[] = []
      let current = ''
      for (const character of Array.from(text)) {
        if (character === '\n' || (current && context.measureText(current + character).width > width)) {
          lines.push(current)
          current = ''
        }
        if (character !== '\n') {
          current += character
        }
      }
      lines.push(current)
      return lines
    }
    const cell = (text: string, width: number, font = sans(), align: CanvasTextAlign = 'left', color = ink): Cell => ({ lines: wrap(text, font, width), font, align, color })
    const draw = (value: Cell, x: number, y: number, width: number, lineHeight = 32) => {
      context.font = value.font
      context.fillStyle = value.color ?? ink
      context.textAlign = value.align ?? 'left'
      context.textBaseline = 'top'
      const origin = value.align === 'right' ? x + width : value.align === 'center' ? x + width / 2 : x
      value.lines.forEach((line, index) => context.fillText(line, origin, y + index * lineHeight))
    }
    const rule = (x: number, y: number, width: number) => {
      context.fillStyle = border
      context.fillRect(x, y, width, 1)
    }
    const contentWidth = WIDTH - 2 * MARGIN
    const supplier = cell(`${labels.supplier}  ${statement.supplierName}`, contentWidth, sans(600, 24))
    const time = cell(`${labels.generatedAt}  ${statement.generatedAt}`, contentWidth, sans(400, 18), 'left', muted)
    const totalAmount = cell(`${formattedAmount(statement.totals.remainingAmount)} ${labels.currency}`, contentWidth - 48, mono(600, 36), 'right', fonts.primary)
    const headingY = 126
    const summaryY = headingY + supplier.lines.length * 34 + time.lines.length * 28 + 38
    const summaryHeight = 72 + totalAmount.lines.length * 48
    const tableY = summaryY + summaryHeight + 36
    const widths = [320, 100, 174, 174, 190, 146]
    const headers = [labels.order, labels.stage, labels.due, labels.paid, labels.remaining, labels.status].map((text, index) => cell(text, widths[index] - 24, sans(600, 20), index >= 2 && index <= 4 ? 'right' : 'left'))
    const headerHeight = Math.max(...headers.map(item => item.lines.length * 30)) + 30
    const groups = statement.orders.map((order) => {
      const orderCell = cell(`${order.orderNo}\n${order.orderDate}`, widths[0] - 28, mono(400, 20))
      const stages = order.items.map((item) => {
        const values = [
          cell(labels.paymentTypes[item.paymentType], widths[1] - 24, sans(400, 20)),
          ...[item.dueAmount, item.paidAmount, item.remainingAmount].map((amount, index) => cell(formattedAmount(amount), widths[index + 2] - 24, mono(index === 2 ? 600 : 400, 20), 'right', index === 2 && amount !== '0.00' ? fonts.primary : ink)),
          cell(labels.statuses[item.status], widths[5] - 24, sans(600, 19), 'left', item.status === 'PENDING_PAYMENT' ? '#a3610c' : item.status === 'PAID' ? fonts.primary : muted),
        ]
        return { values, height: Math.max(60, ...values.map(value => value.lines.length * 30 + 28)) }
      })
      const extra = Math.max(0, orderCell.lines.length * 30 + 32 - stages.reduce((sum, stage) => sum + stage.height, 0))
      stages[0].height += extra
      return { orderCell, stages, height: stages.reduce((sum, stage) => sum + stage.height, 0) }
    })
    const totalCells = [cell(labels.total, widths[0] - 24, sans(600)), cell('', widths[1] - 24), ...[statement.totals.dueAmount, statement.totals.paidAmount, statement.totals.remainingAmount].map((amount, index) => cell(formattedAmount(amount), widths[index + 2] - 24, mono(600, 20), 'right', fonts.primary)), cell(labels.currency, widths[5] - 24, sans(400, 18), 'left', muted)]
    const totalHeight = Math.max(...totalCells.map(value => value.lines.length * 30)) + 36
    const note = cell(labels.note, contentWidth, sans(400, 18), 'left', muted)
    const footerY = tableY + headerHeight + groups.reduce((sum, group) => sum + group.height, 0) + totalHeight + 30
    const height = Math.max(MIN_HEIGHT, footerY + note.lines.length * 28 + MARGIN)
    if (height > MAX_HEIGHT) {
      throw new PurchasePaymentStatementError('STATEMENT_TOO_LARGE')
    }
    canvas.width = WIDTH
    canvas.height = height
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, height)
    context.fillStyle = fonts.primary
    context.fillRect(MARGIN, 48, 6, 42)
    draw(cell(labels.title, contentWidth - 24, sans(600, 36)), MARGIN + 24, 46, contentWidth - 24, 46)
    draw(supplier, MARGIN, headingY, contentWidth, 34)
    draw(time, MARGIN, headingY + supplier.lines.length * 34 + 12, contentWidth, 28)
    context.fillStyle = '#f3f7f4'
    context.fillRect(MARGIN, summaryY, contentWidth, summaryHeight)
    draw(cell(`${labels.selectedOrders}  ${statement.orderCount}`, contentWidth - 48, sans(600, 20)), MARGIN + 24, summaryY + 20, contentWidth - 48)
    draw(cell(labels.unpaidTotal, contentWidth - 48, sans(400, 18), 'right', muted), MARGIN + 24, summaryY + 20, contentWidth - 48)
    draw(totalAmount, MARGIN + 24, summaryY + 58, contentWidth - 48, 48)
    let y = tableY
    context.fillStyle = '#eef3ef'
    context.fillRect(MARGIN, y, contentWidth, headerHeight)
    let x = MARGIN
    headers.forEach((value, index) => {
      draw(value, x + 12, y + 15, widths[index] - 24, 30)
      x += widths[index]
    })
    y += headerHeight
    groups.forEach((group, index) => {
      if (index % 2 === 1) {
        context.fillStyle = '#fafcfb'
        context.fillRect(MARGIN, y, contentWidth, group.height)
      }
      draw(group.orderCell, MARGIN + 12, y + 16, widths[0] - 28, 30)
      group.stages.forEach((stage, stageIndex) => {
        let stageX = MARGIN + widths[0]
        stage.values.forEach((value, index) => {
          draw(value, stageX + 12, y + 14, widths[index + 1] - 24, 30)
          stageX += widths[index + 1]
        })
        y += stage.height
        if (stageIndex === 0) {
          rule(MARGIN + widths[0], y, contentWidth - widths[0])
        }
      })
      rule(MARGIN, y, contentWidth)
    })
    context.fillStyle = '#eef3ef'
    context.fillRect(MARGIN, y, contentWidth, totalHeight)
    x = MARGIN
    totalCells.forEach((value, index) => {
      draw(value, x + 12, y + 18, widths[index] - 24, 30)
      x += widths[index]
    })
    draw(note, MARGIN, footerY, contentWidth, 28)
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/png'))
    if (!blob || blob.size === 0) {
      throw new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')
    }
    return blob
  }
  catch (error) {
    if (error instanceof PurchasePaymentStatementError) {
      throw error
    }
    throw new PurchasePaymentStatementError('STATEMENT_RENDER_FAILED')
  }
  finally {
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
