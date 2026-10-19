import type { WorkbookCell, WorkbookSheet } from './import-parser.types'
import { cellPosition } from './import-parser.workbook'

interface Ratio { numerator: bigint, denominator: bigint }
function bounded(value: Ratio): Ratio {
  if (value.denominator === 0n || value.numerator.toString().length > 256 || value.denominator.toString().length > 256) throw new Error('Invalid numeric expression')
  if (value.denominator < 0n) return { numerator: -value.numerator, denominator: -value.denominator }
  return value
}
function decimal(value: string): Ratio {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/u.exec(value.trim())
  if (!match || value.length > 100 || Math.abs(Number(match[4] ?? 0)) > 40) throw new Error('Invalid decimal')
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0)
  const numerator = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${match[3] ?? ''}`)
  return bounded(scale < 0 ? { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n } : { numerator, denominator: 10n ** BigInt(scale) })
}
function formatRatio(value: Ratio, scale: number, precision: number, positive: boolean): string {
  if (value.numerator < 0n || (positive && value.numerator === 0n)) throw new Error('Non-positive value')
  const expanded = value.numerator * 10n ** BigInt(scale)
  const rounded = (expanded * 2n + value.denominator) / (value.denominator * 2n)
  if (rounded.toString().length > precision || (positive && rounded === 0n)) throw new Error('Decimal out of range')
  const digits = rounded.toString().padStart(scale + 1, '0')
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, '') : digits
}
/** 只支持四则运算、括号和同工作表单元格引用；不执行函数、名称、外链或任意 JS。 */
function evaluate(formula: string, sheet: WorkbookSheet, seen: Set<string>): Ratio {
  const source = formula.replace(/^=/u, '').replace(/\s/gu, '')
  const tokens = source.match(/\$?[A-Z]{1,3}\$?[1-9]\d{0,5}|(?:\d+(?:\.\d*)?)(?:[Ee][+-]?\d+)?|[()+*/-]/gu) ?? []
  if (!source || tokens.join('') !== source || tokens.length > 128 || seen.size > 16) throw new Error('Unsupported formula')
  let offset = 0, depth = 0
  const factor = (): Ratio => {
    if (++depth > 32) throw new Error('Expression too deep')
    const token = tokens[offset++]
    let value: Ratio
    if (token === '+' || token === '-') { value = factor(); if (token === '-') value = { ...value, numerator: -value.numerator } }
    else if (token === '(') { value = sum(); if (tokens[offset++] !== ')') throw new Error('Missing parenthesis') }
    else if (token && /^\$?[A-Z]/u.test(token)) {
      const position = cellPosition(token), cell = sheet.rows.get(position.row)?.get(position.column)
      value = cellRatio(cell, sheet, seen)
    }
    else value = decimal(token ?? '')
    depth--; return value
  }
  const product = (): Ratio => {
    let result = factor()
    while (tokens[offset] === '*' || tokens[offset] === '/') {
      const operator = tokens[offset++], right = factor()
      result = bounded(operator === '*' ? { numerator: result.numerator * right.numerator, denominator: result.denominator * right.denominator } : { numerator: result.numerator * right.denominator, denominator: result.denominator * right.numerator })
    }
    return result
  }
  const sum = (): Ratio => {
    let result = product()
    while (tokens[offset] === '+' || tokens[offset] === '-') {
      const operator = tokens[offset++], right = product()
      result = bounded({ numerator: result.numerator * right.denominator + (operator === '+' ? 1n : -1n) * right.numerator * result.denominator, denominator: result.denominator * right.denominator })
    }
    return result
  }
  const result = sum()
  if (offset !== tokens.length) throw new Error('Unexpected formula token')
  return result
}
function cellRatio(cell: WorkbookCell | undefined, sheet: WorkbookSheet, seen: Set<string>): Ratio {
  if (!cell || cell.type === 'e' || cell.type === 'b' || seen.has(cell.reference)) throw new Error('Invalid cell value')
  if (cell.value?.trim()) return decimal(cell.value)
  if (!cell.formula) throw new Error('Missing formula value')
  return evaluate(cell.formula, sheet, new Set([...seen, cell.reference]))
}
export function importCellNumber(cell: WorkbookCell | undefined, sheet: WorkbookSheet, scale: number, precision: number, positive: boolean): string | null {
  if (!cell || (!cell.value?.trim() && cell.formula === null)) return null
  return formatRatio(cellRatio(cell, sheet, new Set()), scale, precision, positive)
}
/**
 * 尺寸专用：来源可带小数，按整数厘米向上取整；公式仍走同一受限求值器。
 */
export function importCellNumberCeil(cell: WorkbookCell | undefined, sheet: WorkbookSheet, precision: number, positive: boolean): string | null {
  if (!cell || (!cell.value?.trim() && cell.formula === null)) return null
  const value = cellRatio(cell, sheet, new Set())
  if (value.numerator < 0n || (positive && value.numerator === 0n)) throw new Error('Non-positive value')
  const ceil = (value.numerator + value.denominator - 1n) / value.denominator
  if (ceil.toString().length > precision || (positive && ceil === 0n)) throw new Error('Decimal out of range')
  return ceil.toString()
}
export function importPackageCount(cell: WorkbookCell | undefined, sheet: WorkbookSheet): number {
  const value = cellRatio(cell, sheet, new Set())
  if (value.numerator % value.denominator !== 0n) throw new Error('Fractional package count')
  const count = value.numerator / value.denominator
  if (count < 1n || count > 1_000_000n) throw new Error('Package count out of range')
  return Number(count)
}
