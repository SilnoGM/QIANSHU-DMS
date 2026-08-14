export type ApiSessionRequirement = 'none' | 'optional' | 'required'

export const API_CONTRACT_ERROR_STATUSES = [
  400,
  401,
  403,
  404,
  409,
  413,
  415,
  422,
  429,
  500,
  503,
] as const

export type ApiContractErrorStatus =
  (typeof API_CONTRACT_ERROR_STATUSES)[number]

export interface ApiContractErrorMetadata {
  status: ApiContractErrorStatus
  codes: string[]
}

export interface ApiContractErrorOptions {
  status: ApiContractErrorStatus
  codes: readonly string[]
}

export interface QianshuContractMetadata {
  kind: 'health' | 'application'
  authentication: boolean
  authorization: boolean
  resourceLocator: boolean
  conflict: boolean
  validation: boolean
  session?: ApiSessionRequirement
  csrf?: boolean
  privateNoStore?: boolean
  retry?: boolean
  errors?: ApiContractErrorMetadata[]
}

export interface ApiApplicationContractOptions {
  operationId: string
  badRequest?: boolean
  authentication?: boolean
  authorization?: boolean
  resourceLocator?: boolean
  conflict?: boolean
  validation?: boolean
  session?: ApiSessionRequirement
  csrf?: boolean
  privateNoStore?: boolean
  retry?: boolean
  errors?: readonly ApiContractErrorOptions[]
}
