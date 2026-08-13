import type { BigIntStats } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { createRequire } from 'node:module'

import type { FileTypeResult } from 'file-type'

import {
  documentValidationResult,
  validateOoxmlPackage,
  validatePdfDocument,
} from './media-document-validator'
import {
  type ImageContentIdentity,
  validateImageContent,
} from './media-image-validator'
import {
  MediaValidationError,
  type MediaContentValidationInput,
  type ValidatedMediaContent,
} from './media-validation'
import { runRestrictedMediaProcess } from './restricted-media-process'
import {
  type RunRestrictedMediaProcess,
  validateVideoContent,
} from './media-video-validator'

const MEBIBYTE = 1024n * 1024n
const MEDIA_SIZE_LIMITS = {
  DOCUMENT: 50n * MEBIBYTE,
  IMAGE: 10n * MEBIBYTE,
  VIDEO: 500n * MEBIBYTE,
} as const

const requireFromRuntime = createRequire(__filename)

async function detectFileTypeWithNode24(
  sourcePath: string,
): Promise<FileTypeResult | undefined> {
  // file-type@21 是 ESM-only；项目固定 Node 24 可通过原生 require(esm) 加载。
  // 使用 createRequire 绕过 Jest 29 不理解 ESM-only exports 的旧 resolver，生产与测试执行同一真实模块。
  const fileTypeModule = requireFromRuntime('file-type') as typeof import('file-type')
  return fileTypeModule.fileTypeFromFile(sourcePath)
}

export interface MediaValidatorConfiguration {
  readonly ffprobePath: string
  readonly qpdfPath: string
}

export interface MediaContentValidatorDependencies {
  readonly detectFileType: (sourcePath: string) => Promise<FileTypeResult | undefined>
  readonly runProcess: RunRestrictedMediaProcess
}

interface DeclaredImageIdentity extends ImageContentIdentity {
  readonly allowedExtensions: readonly string[]
  readonly detectedExtension: 'jpg' | 'png' | 'webp'
}

const IMAGE_IDENTITIES: readonly DeclaredImageIdentity[] = [
  {
    allowedExtensions: ['.jpg', '.jpeg'],
    canonicalExtension: '.jpg',
    detectedExtension: 'jpg',
    format: 'jpeg',
    mimeType: 'image/jpeg',
  },
  {
    allowedExtensions: ['.png'],
    canonicalExtension: '.png',
    detectedExtension: 'png',
    format: 'png',
    mimeType: 'image/png',
  },
  {
    allowedExtensions: ['.webp'],
    canonicalExtension: '.webp',
    detectedExtension: 'webp',
    format: 'webp',
    mimeType: 'image/webp',
  },
]

const DOCUMENT_IDENTITIES = {
  '.docx': {
    detectedExtensions: ['docx', 'zip'],
    kind: 'DOCX' as const,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pdf': {
    detectedExtensions: ['pdf'],
    kind: 'PDF' as const,
    mimeType: 'application/pdf',
  },
  '.xlsx': {
    detectedExtensions: ['xlsx', 'zip'],
    kind: 'XLSX' as const,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
} as const

function readUntrustedExtension(originalFilename: string): string {
  if (typeof originalFilename !== 'string' || originalFilename.includes('\0')) return ''
  const leaf = originalFilename.split(/[\\/]/u).at(-1) ?? ''
  const dotIndex = leaf.lastIndexOf('.')
  return dotIndex > 0 ? leaf.slice(dotIndex).toLocaleLowerCase('en-US') : ''
}

function normalizeDeclaredMime(value: string): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : ''
}

function matchesDetectedType(
  detected: FileTypeResult | undefined,
  extensions: readonly string[],
): boolean {
  return detected !== undefined && extensions.includes(detected.ext)
}

export class MediaContentValidator {
  private readonly dependencies: MediaContentValidatorDependencies

  constructor(
    private readonly configuration: MediaValidatorConfiguration,
    dependencyOverrides: Partial<MediaContentValidatorDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      detectFileType: detectFileTypeWithNode24,
      runProcess: runRestrictedMediaProcess,
      ...dependencyOverrides,
    })
  }

  async validate(input: MediaContentValidationInput): Promise<ValidatedMediaContent> {
    const initialMetadata = await this.readSafeMetadata(input.sourcePath)
    const sizeBytes = initialMetadata.size
    if (sizeBytes > MEDIA_SIZE_LIMITS[input.expectedMediaType]) {
      throw new MediaValidationError('MEDIA_CONTENT_TOO_LARGE')
    }
    if (sizeBytes === 0n) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }

    let detected: FileTypeResult | undefined
    try {
      detected = await this.dependencies.detectFileType(input.sourcePath)
    }
    catch {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
    const extension = readUntrustedExtension(input.originalFilename)
    const declaredMime = normalizeDeclaredMime(input.declaredMimeType)

    if (input.expectedMediaType === 'IMAGE') {
      const identity = IMAGE_IDENTITIES.find(candidate => (
        candidate.allowedExtensions.includes(extension) &&
        candidate.mimeType === declaredMime
      ))
      if (
        !identity ||
        !matchesDetectedType(detected, [identity.detectedExtension]) ||
        detected?.mime !== identity.mimeType
      ) {
        throw new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH')
      }
      const result = await validateImageContent(input.sourcePath, sizeBytes, identity)
      await this.requireUnchangedSource(input.sourcePath, initialMetadata)
      return result
    }

    if (input.expectedMediaType === 'VIDEO') {
      if (
        extension !== '.mp4' ||
        declaredMime !== 'video/mp4' ||
        !matchesDetectedType(detected, ['mp4']) ||
        detected?.mime !== 'video/mp4'
      ) {
        throw new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH')
      }
      const result = await validateVideoContent(
        input.sourcePath,
        sizeBytes,
        this.configuration.ffprobePath,
        this.dependencies.runProcess,
      )
      await this.requireUnchangedSource(input.sourcePath, initialMetadata)
      return result
    }

    if (input.expectedMediaType === 'DOCUMENT') {
      const identity = DOCUMENT_IDENTITIES[
        extension as keyof typeof DOCUMENT_IDENTITIES
      ]
      if (
        !identity ||
        declaredMime !== identity.mimeType ||
        !matchesDetectedType(detected, identity.detectedExtensions)
      ) {
        throw new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH')
      }
      if (identity.kind === 'PDF') {
        if (detected?.mime !== 'application/pdf') {
          throw new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH')
        }
        await validatePdfDocument(
          input.sourcePath,
          sizeBytes,
          this.configuration.qpdfPath,
          this.dependencies.runProcess,
        )
      }
      else {
        await validateOoxmlPackage(input.sourcePath, identity.kind)
      }
      await this.requireUnchangedSource(input.sourcePath, initialMetadata)
      return documentValidationResult(identity.kind, sizeBytes)
    }

    throw new MediaValidationError('MEDIA_CONTENT_UNSUPPORTED')
  }

  private async readSafeMetadata(sourcePath: string): Promise<BigIntStats> {
    try {
      const metadata = await lstat(sourcePath, { bigint: true })
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 0n) {
        throw new MediaValidationError('MEDIA_CONTENT_INVALID')
      }
      return metadata
    }
    catch (error) {
      if (error instanceof MediaValidationError) throw error
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
  }

  private async requireUnchangedSource(
    sourcePath: string,
    initial: BigIntStats,
  ): Promise<void> {
    const current = await this.readSafeMetadata(sourcePath)
    if (
      current.dev !== initial.dev ||
      current.ino !== initial.ino ||
      current.size !== initial.size ||
      current.mtimeNs !== initial.mtimeNs ||
      current.ctimeNs !== initial.ctimeNs
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
  }
}
