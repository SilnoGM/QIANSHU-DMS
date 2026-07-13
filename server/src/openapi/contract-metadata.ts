export interface QianshuContractMetadata {
  kind: 'health' | 'application'
  authentication: boolean
  authorization: boolean
  resourceLocator: boolean
  conflict: boolean
  validation: boolean
}

export interface ApiApplicationContractOptions {
  operationId: string
  badRequest?: boolean
  authentication?: boolean
  authorization?: boolean
  resourceLocator?: boolean
  conflict?: boolean
  validation?: boolean
}
