export interface PartConfiguratorProduct {
  readonly key: string
  readonly productNo: string | null
  readonly name: string
  readonly description: string
  readonly quantity: number
  readonly mainImage: null | { readonly id: string, readonly contentUrl: string }
}

export interface PartConfiguration {
  readonly key: string
  readonly items: readonly { readonly productKey: string, readonly quantity: number }[]
}

export interface PartConfiguratorProps {
  readonly products: readonly PartConfiguratorProduct[]
  readonly modelValue: readonly PartConfiguration[]
  readonly disabled?: boolean
  readonly readonly?: boolean
}

export interface PartConfigurationValidation {
  readonly valid: boolean
  readonly remainingQuantity: number
  readonly errors: readonly string[]
}
