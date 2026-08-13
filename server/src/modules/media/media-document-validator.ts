import { createReadStream } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import yauzl, { type Entry, type ZipFile } from 'yauzl'

import {
  MediaValidationError,
  type ValidatedDocumentContent,
} from './media-validation'
import {
  RestrictedMediaProcessError,
  type RestrictedMediaProcessResult,
} from './restricted-media-process'
import type { RunRestrictedMediaProcess } from './media-video-validator'

const MAX_OOXML_ENTRIES = 2_000
const MAX_OOXML_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_OOXML_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_OOXML_COMPRESSION_RATIO = 100
const MAX_INSPECTED_XML_BYTES = 1024 * 1024
const MAX_TOTAL_INSPECTED_XML_BYTES = 4 * 1024 * 1024
const MAX_MAIN_PART_PREFIX_BYTES = 64 * 1024
const QPDF_TIMEOUT_MS = 15_000
const QPDF_OUTPUT_LIMIT_BYTES = 64 * 1024
const PDF_SCAN_WINDOW_BYTES = 64 * 1024
const PDF_DANGEROUS_NAME_PATTERN = /\/(?:AA|EmbeddedFile|JavaScript|JS|Launch|OpenAction)\b/u
const OOXML_DANGEROUS_EXTENSION_PATTERN = /\.(?:bat|bin|class|cmd|com|dll|exe|html?|jar|js|msi|ps1|scr|svg)$/iu
const OOXML_DANGEROUS_PATH_PATTERN = /(?:^|\/)(?:activex|customui|embeddings|webextensions)(?:\/|$)/iu
const OOXML_XML_ENTRY_PATTERN = /(?:^|\/)[^/]+\.(?:rels|xml)$/iu
const OOXML_DANGEROUS_XML_PATTERN = /<!DOCTYPE|<!ENTITY|\b(?:javascript|macroEnabled|vbaProject|ActiveX|oleObject|script)\b/iu

export type OoxmlKind = 'DOCX' | 'XLSX'

interface OoxmlPackageState {
  contentTypesXml?: string
  readonly entryNames: Set<string>
  entryCount: number
  expandedBytes: number
  inspectedXmlBytes: number
  mainPartPrefix?: string
  readonly relationshipsXml: string[]
  rootRelationshipsXml?: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb8_8320 ^ (value >>> 1)
        : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function updateCrc32(crc: number, chunk: Buffer): number {
  let next = crc
  for (const byte of chunk) {
    next = (next >>> 8) ^ CRC_TABLE[(next ^ byte) & 0xff]
  }
  return next >>> 0
}

function normalizeZipEntryName(value: string): string {
  const normalized = value.normalize('NFC')
  const segments = normalized.split('/')
  if (
    normalized !== value ||
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    hasControlCharacters(normalized) ||
    segments.some((segment, index) => (
      segment === '.' ||
      segment === '..' ||
      (segment.length === 0 && index !== segments.length - 1)
    ))
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  return normalized
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function validateEntryMetadata(
  entry: Entry,
  state: OoxmlPackageState,
): { readonly isDirectory: boolean; readonly normalizedName: string } {
  state.entryCount += 1
  if (state.entryCount > MAX_OOXML_ENTRIES) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }

  const normalizedName = normalizeZipEntryName(entry.fileName)
  const portableName = normalizedName.toLocaleLowerCase('en-US')
  if (state.entryNames.has(portableName)) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  state.entryNames.add(portableName)

  const encrypted = (entry.generalPurposeBitFlag & 0x0001) !== 0
  const isDirectory = normalizedName.endsWith('/')
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const fileType = unixMode & 0o170000
  if (
    encrypted ||
    !Number.isSafeInteger(entry.compressedSize) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.compressedSize < 0 ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > MAX_OOXML_ENTRY_BYTES ||
    state.expandedBytes + entry.uncompressedSize > MAX_OOXML_EXPANDED_BYTES ||
    (entry.uncompressedSize > 0 && (
      entry.compressedSize === 0 ||
      entry.uncompressedSize > entry.compressedSize * MAX_OOXML_COMPRESSION_RATIO
    )) ||
    (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) ||
    (isDirectory && entry.uncompressedSize !== 0) ||
    OOXML_DANGEROUS_EXTENSION_PATTERN.test(normalizedName) ||
    OOXML_DANGEROUS_PATH_PATTERN.test(normalizedName)
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  state.expandedBytes += entry.uncompressedSize
  return { isDirectory, normalizedName }
}

function openZip(sourcePath: string): Promise<ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(sourcePath, {
      autoClose: true,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(new MediaValidationError('MEDIA_CONTENT_INVALID'))
        return
      }
      resolvePromise(zipFile)
    })
  })
}

function openEntry(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        rejectPromise(new MediaValidationError('MEDIA_CONTENT_INVALID'))
        return
      }
      resolvePromise(stream)
    })
  })
}

function decodeXml(contents: Buffer): string {
  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    return contents.subarray(2).toString('utf16le')
  }
  if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const swapped = Buffer.from(contents.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  return contents.toString('utf8')
}

async function readAndValidateEntry(
  zipFile: ZipFile,
  entry: Entry,
  normalizedName: string,
  state: OoxmlPackageState,
  kind: OoxmlKind,
): Promise<void> {
  const expectedMainPart = kind === 'DOCX' ? 'word/document.xml' : 'xl/workbook.xml'
  const fullyInspectedXml = (
    normalizedName === '[Content_Types].xml' || normalizedName.endsWith('.rels')
  )
  const isMainPart = normalizedName === expectedMainPart
  const retainedLimit = fullyInspectedXml
    ? entry.uncompressedSize
    : isMainPart
      ? Math.min(entry.uncompressedSize, MAX_MAIN_PART_PREFIX_BYTES)
      : 0
  if (
    fullyInspectedXml &&
    (
      entry.uncompressedSize > MAX_INSPECTED_XML_BYTES ||
      state.inspectedXmlBytes + retainedLimit > MAX_TOTAL_INSPECTED_XML_BYTES
    )
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  if (retainedLimit > 0) state.inspectedXmlBytes += retainedLimit

  const stream = await openEntry(zipFile, entry)
  const selectedChunks: Buffer[] = []
  const scanXml = OOXML_XML_ENTRY_PATTERN.test(normalizedName) || normalizedName === '[Content_Types].xml'
  let scanCarry = ''
  let retainedBytes = 0
  let actualSize = 0
  let crc = 0xffff_ffff
  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      actualSize += chunk.length
      if (actualSize > entry.uncompressedSize || actualSize > MAX_OOXML_ENTRY_BYTES) {
        throw new MediaValidationError('MEDIA_CONTENT_INVALID')
      }
      crc = updateCrc32(crc, chunk)
      if (scanXml) {
        const scanWindow = scanCarry + chunk.toString('utf8')
        if (OOXML_DANGEROUS_XML_PATTERN.test(scanWindow)) {
          throw new MediaValidationError('MEDIA_CONTENT_INVALID')
        }
        scanCarry = scanWindow.slice(-128)
      }
      if (retainedBytes < retainedLimit) {
        const retained = chunk.subarray(0, retainedLimit - retainedBytes)
        selectedChunks.push(retained)
        retainedBytes += retained.length
      }
    }
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }

  if (actualSize !== entry.uncompressedSize || ((crc ^ 0xffff_ffff) >>> 0) !== entry.crc32) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  if (retainedLimit > 0) {
    const xml = decodeXml(Buffer.concat(selectedChunks))
    if (normalizedName === '[Content_Types].xml') {
      state.contentTypesXml = xml
    }
    else if (normalizedName === expectedMainPart) {
      state.mainPartPrefix = xml
    }
    else if (normalizedName === '_rels/.rels') {
      state.rootRelationshipsXml = xml
    }
    else {
      state.relationshipsXml.push(xml)
    }
  }
}

function rejectUnsafeXml(xml: string): void {
  if (
    OOXML_DANGEROUS_XML_PATTERN.test(xml) ||
    /TargetMode\s*=\s*["']External["']/iu.test(xml)
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}

function readOverrideContentTypes(xml: string): ReadonlyMap<string, string> {
  const overrides = new Map<string, string>()
  for (const tag of xml.match(/<Override\b[^>]*>/giu) ?? []) {
    const partName = /\bPartName\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]
    const contentType = /\bContentType\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]
    if (!partName || !contentType || overrides.has(partName)) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
    overrides.set(partName, contentType)
  }
  return overrides
}

function validateOoxmlIdentity(state: OoxmlPackageState, kind: OoxmlKind): void {
  if (!state.contentTypesXml || !state.rootRelationshipsXml) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  rejectUnsafeXml(state.contentTypesXml)
  rejectUnsafeXml(state.rootRelationshipsXml)
  for (const relationships of state.relationshipsXml) rejectUnsafeXml(relationships)

  const overrides = readOverrideContentTypes(state.contentTypesXml)
  const expected = kind === 'DOCX'
    ? {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      partName: '/word/document.xml',
      portableEntry: 'word/document.xml',
    }
    : {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      partName: '/xl/workbook.xml',
      portableEntry: 'xl/workbook.xml',
    }
  const otherPart = kind === 'DOCX' ? '/xl/workbook.xml' : '/word/document.xml'
  const otherPortableEntry = kind === 'DOCX' ? 'xl/workbook.xml' : 'word/document.xml'

  const officeDocumentRelationships = (
    state.rootRelationshipsXml.match(/<Relationship\b[^>]*>/giu) ?? []
  ).filter(tag => (
    /\bType\s*=\s*["'][^"']*\/officeDocument["']/iu.test(tag)
  ))
  const relationshipTarget = officeDocumentRelationships.length === 1
    ? /\bTarget\s*=\s*["']([^"']+)["']/iu.exec(officeDocumentRelationships[0])?.[1]
    : undefined
  if (relationshipTarget === otherPortableEntry || overrides.has(otherPart)) {
    throw new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH')
  }
  if (relationshipTarget !== expected.portableEntry) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  const mainPartPattern = kind === 'DOCX'
    ? /<(?:[A-Za-z_][\w.-]*:)?document\b[^>]*\bxmlns(?::[A-Za-z_][\w.-]*)?=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/iu
    : /<(?:[A-Za-z_][\w.-]*:)?workbook\b[^>]*\bxmlns(?::[A-Za-z_][\w.-]*)?=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/iu
  if (!state.mainPartPrefix || !mainPartPattern.test(state.mainPartPrefix)) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }

  if (
    overrides.get(expected.partName) !== expected.contentType ||
    !state.entryNames.has(expected.portableEntry)
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}

/**
 * 按 central directory 顺序一次只打开一个 entry；每个 entry 实际流式读取并校验 CRC，
 * 因而伪造 size、截断 deflate stream 或 central/local header 不一致都会失败关闭。
 */
export async function validateOoxmlPackage(
  sourcePath: string,
  kind: OoxmlKind,
): Promise<void> {
  let zipFile: ZipFile | undefined
  try {
    zipFile = await openZip(sourcePath)
    const state: OoxmlPackageState = {
      entryCount: 0,
      entryNames: new Set<string>(),
      expandedBytes: 0,
      inspectedXmlBytes: 0,
      relationshipsXml: [],
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      const rejectOnce = (error: unknown): void => {
        if (settled) return
        settled = true
        zipFile?.close()
        rejectPromise(
          error instanceof MediaValidationError
            ? error
            : new MediaValidationError('MEDIA_CONTENT_INVALID'),
        )
      }

      zipFile!.on('error', rejectOnce)
      zipFile!.on('entry', (entry: Entry) => {
        void (async () => {
          const metadata = validateEntryMetadata(entry, state)
          if (!metadata.isDirectory) {
            await readAndValidateEntry(
              zipFile!,
              entry,
              metadata.normalizedName,
              state,
              kind,
            )
          }
          zipFile!.readEntry()
        })().catch(rejectOnce)
      })
      zipFile!.on('end', () => {
        if (settled) return
        try {
          validateOoxmlIdentity(state, kind)
          settled = true
          resolvePromise()
        }
        catch (error) {
          rejectOnce(error)
        }
      })
      zipFile!.readEntry()
    })
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  finally {
    zipFile?.close()
  }
}

async function readPdfBoundaries(
  sourcePath: string,
  sizeBytes: bigint,
): Promise<{ readonly header: Buffer; readonly trailer: Buffer }> {
  let handle: FileHandle | undefined
  try {
    handle = await open(sourcePath, 'r')
    const numericSize = Number(sizeBytes)
    const header = Buffer.alloc(Math.min(1024, numericSize))
    const trailer = Buffer.alloc(Math.min(4096, numericSize))
    await handle.read(header, 0, header.length, 0)
    await handle.read(trailer, 0, trailer.length, Math.max(0, numericSize - trailer.length))
    return { header, trailer }
  }
  catch {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  finally {
    await handle?.close().catch(() => undefined)
  }
}

function decodePdfNames(value: string): string {
  return value.replace(/#([0-9a-f]{2})/giu, (_match, hex: string) => (
    String.fromCharCode(Number.parseInt(hex, 16))
  ))
}

async function rejectDangerousPdfNames(sourcePath: string): Promise<void> {
  let carry = ''
  try {
    for await (const rawChunk of createReadStream(sourcePath, {
      highWaterMark: PDF_SCAN_WINDOW_BYTES,
    })) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      const decoded = decodePdfNames(carry + chunk.toString('latin1'))
      if (PDF_DANGEROUS_NAME_PATTERN.test(decoded)) {
        throw new MediaValidationError('MEDIA_CONTENT_INVALID')
      }
      carry = decoded.slice(-128)
    }
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}

function mapQpdfFailure(error: unknown): never {
  if (
    error instanceof RestrictedMediaProcessError &&
    (
      error.code === 'MEDIA_PROCESS_EXIT_NON_ZERO' ||
      error.code === 'MEDIA_PROCESS_OUTPUT_LIMIT'
    )
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  throw new MediaValidationError('MEDIA_VALIDATOR_UNAVAILABLE')
}

export async function validatePdfDocument(
  sourcePath: string,
  sizeBytes: bigint,
  qpdfPath: string,
  runProcess: RunRestrictedMediaProcess,
): Promise<void> {
  const { header, trailer } = await readPdfBoundaries(sourcePath, sizeBytes)
  if (
    !header.toString('latin1').startsWith('%PDF-') ||
    !/%%EOF\s*$/u.test(trailer.toString('latin1'))
  ) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  await rejectDangerousPdfNames(sourcePath)

  let checkResult: RestrictedMediaProcessResult
  let encryptionResult: RestrictedMediaProcessResult
  let structureResult: RestrictedMediaProcessResult
  try {
    checkResult = await runProcess({
      arguments: ['--check', '--password=', sourcePath],
      executablePath: qpdfPath,
      stderrLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      stdoutLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      timeoutMs: QPDF_TIMEOUT_MS,
    })
    encryptionResult = await runProcess({
      arguments: ['--show-encryption', '--password=', sourcePath],
      executablePath: qpdfPath,
      stderrLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      stdoutLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      timeoutMs: QPDF_TIMEOUT_MS,
    })
    structureResult = await runProcess({
      arguments: [
        '--json=1',
        '--json-key=attachments',
        '--json-key=objects',
        '--json-stream-data=none',
        '--password=',
        sourcePath,
      ],
      executablePath: qpdfPath,
      stderrLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      stdoutLimitBytes: QPDF_OUTPUT_LIMIT_BYTES,
      timeoutMs: QPDF_TIMEOUT_MS,
    })
  }
  catch (error) {
    mapQpdfFailure(error)
  }
  void checkResult
  if (!encryptionResult.stdout.includes('File is not encrypted')) {
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
  try {
    const normalizedStructure = decodePdfNames(structureResult.stdout)
    const structure: unknown = JSON.parse(normalizedStructure)
    if (
      typeof structure !== 'object' ||
      structure === null ||
      PDF_DANGEROUS_NAME_PATTERN.test(normalizedStructure) ||
      /"attachments"\s*:\s*\{\s*"/u.test(normalizedStructure)
    ) {
      throw new MediaValidationError('MEDIA_CONTENT_INVALID')
    }
  }
  catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('MEDIA_CONTENT_INVALID')
  }
}

export function documentValidationResult(
  kind: 'DOCX' | 'PDF' | 'XLSX',
  sizeBytes: bigint,
): ValidatedDocumentContent {
  const identities = {
    DOCX: { canonicalExtension: '.docx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    PDF: { canonicalExtension: '.pdf' as const, mimeType: 'application/pdf' },
    XLSX: { canonicalExtension: '.xlsx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  }
  return Object.freeze({
    ...identities[kind],
    mediaType: 'DOCUMENT',
    sizeBytes,
  })
}
