import metadata from './brand-icons.json'

export interface BrandIconEntry {
  name: string
  label: string
  category: string
  usages: readonly string[]
}

export const brandIcons: readonly BrandIconEntry[] = metadata
