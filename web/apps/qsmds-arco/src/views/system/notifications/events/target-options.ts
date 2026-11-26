export interface TargetValueOption {
  readonly label: string
  readonly value: string
  readonly description?: string
}

export function filterTargetOptions(
  options: readonly TargetValueOption[],
  keyword: string,
): TargetValueOption[] {
  const normalized = keyword.trim().toLowerCase()
  if (normalized.length === 0) {
    return [...options]
  }
  return options.filter(option =>
    option.label.toLowerCase().includes(normalized)
    || option.value.toLowerCase().includes(normalized)
    || (option.description ?? '').toLowerCase().includes(normalized),
  )
}

export function toggleTargetValue(values: readonly string[], value: string): string[] {
  const next = new Set(values)
  if (next.has(value)) {
    next.delete(value)
  }
  else {
    next.add(value)
  }
  return [...next]
}

export function targetOptionLabel(
  options: readonly TargetValueOption[],
  value: string,
): string {
  return options.find(option => option.value === value)?.label ?? value
}
