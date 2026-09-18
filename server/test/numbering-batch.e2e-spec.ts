import { createHash, randomUUID } from 'node:crypto'

import type { Prisma } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../src/infrastructure/database/transaction-timeouts'
import { createNumberingDraftVersion, createNumberingRuleRecord } from '../src/modules/numbering/numbering-command.persistence'
import { prepareNumberingRuleConfig } from '../src/modules/numbering/numbering-config-fingerprint'
import { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import type { GenerateScopedNumberRequest } from '../src/modules/numbering/numbering-internal-input'
import type { NumberingRuleSegment } from '../src/modules/numbering/rule-engine'
import type { NumberingRandomSource } from '../src/modules/numbering/random-source'
import { createIsolatedNumberingDatabase, IsolatedNumberingPrismaService, type IsolatedNumberingDatabase } from './numbering-e2e-database'

describe('scoped numbering batches with PostgreSQL', () => {
  jest.setTimeout(120_000)
  let database: IsolatedNumberingDatabase
  let prisma: IsolatedNumberingPrismaService
  let generator: NumberingGeneratorService

  beforeAll(async () => {
    database = await createIsolatedNumberingDatabase()
    prisma = new IsolatedNumberingPrismaService(database)
    await prisma.$connect()
    generator = new NumberingGeneratorService(prisma as unknown as PrismaService)
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    await database?.dispose()
  })

  async function rule(segments: NumberingRuleSegment[] = [
    { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
  ]) {
    const ruleCode = `BATCH_${randomUUID().replaceAll('-', '').toUpperCase()}`
    const record = await prisma.$transaction(async (tx) => {
      await applyTransactionTimeouts(tx)
      const created = await createNumberingRuleRecord(tx, {
        purpose: 'BUSINESS', ruleCode, name: 'Batch E2E', description: null,
      })
      const prepared = prepareNumberingRuleConfig({ resetPolicy: 'NEVER', segments })
      const version = await createNumberingDraftVersion(tx, {
        ruleId: created.id, revision: 1, ...prepared,
      })
      await tx.numberingRuleVersion.update({
        where: { id: version.id }, data: { status: 'ACTIVE', publishedAt: new Date() },
      })
      await tx.numberingRule.update({ where: { id: created.id }, data: { status: 'ENABLED' } })
      return created
    })
    return { ...record, ruleCode }
  }

  function requests(ruleCode: string, count = 1000): GenerateScopedNumberRequest[] {
    return Array.from({ length: count }, () => {
      const idempotencyKey = randomUUID()
      return {
        ruleCode, consumerCode: 'SHIPMENT_NO.CREATE', idempotencyKey,
        requestFingerprint: createHash('sha256').update(idempotencyKey).digest('hex'),
      }
    })
  }

  async function issue(tx: Prisma.TransactionClient, inputs: GenerateScopedNumberRequest[]) {
    return generator.generateScopedBatchInTransaction(tx, inputs)
  }

  function batch(inputs: GenerateScopedNumberRequest[]) {
    return prisma.$transaction(async (tx) => {
      await applyTransactionTimeouts(tx)
      return issue(tx, inputs)
    }, { timeout: 30_000 })
  }

  it('issues the maximum 1000 entries within the existing business transaction limit', async () => {
    const created = await rule()
    const start = performance.now()
    const result = await batch(requests(created.ruleCode))
    console.info(`Numbering maximum batch: ${Math.round(performance.now() - start)} ms`)
    expect(result).toHaveLength(1000)
    expect(new Set(result.map(item => item.number)).size).toBe(1000)
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1000)
  })

  it('completes two concurrent maximum batches under the unchanged two second lock timeout', async () => {
    const created = await rule()
    const start = performance.now()
    const outcomes = await Promise.allSettled([
      batch(requests(created.ruleCode)), batch(requests(created.ruleCode)),
    ])
    console.info(`Numbering concurrent maximum batches: ${Math.round(performance.now() - start)} ms; ${outcomes.map(item => item.status).join(',')}`)
    expect(outcomes.every(item => item.status === 'fulfilled')).toBe(true)
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(2000)
  })

  it('replays each stable key in caller order and only consumes capacity for missing entries', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode, 3)
    const first = await batch(inputs.slice(0, 1))
    const completed = await batch(inputs)
    expect(completed[0]).toEqual({ ...first[0], idempotentReplay: true })
    expect(completed.slice(1).every(item => !item.idempotentReplay)).toBe(true)
    const replay = await batch([...inputs].reverse())
    expect(replay).toEqual([...completed].reverse().map(item => ({ ...item, idempotentReplay: true })))
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(3)
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 3n, nextSequenceValue: 4n })
  })

  it('collapses concurrent identical batches to one set of ledger rows', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode)
    const [first, second] = await Promise.all([batch(inputs), batch(inputs)])
    expect(second.map(item => item.issuanceId)).toEqual(first.map(item => item.issuanceId))
    expect([...first, ...second].filter(item => item.idempotentReplay)).toHaveLength(1000)
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1000)
  })

  it('rolls ledger and period creation back with the caller transaction', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode)
    await expect(prisma.$transaction(async tx => {
      await applyTransactionTimeouts(tx)
      await issue(tx, inputs)
      throw new Error('EXPECTED_CALLER_ROLLBACK')
    }, { timeout: 30_000 })).rejects.toThrow('EXPECTED_CALLER_ROLLBACK')
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(0)
    expect(await prisma.numberingPeriodState.count({ where: { ruleId: created.id } })).toBe(0)
    expect((await batch(inputs))[0].number).toBe('000001')
  })

  it('rejects a fingerprint conflict in a partially replayed batch without consuming missing keys', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode, 2)
    await batch(inputs.slice(0, 1))
    await expect(batch([inputs[1], { ...inputs[0], requestFingerprint: 'ab'.repeat(32) }]))
      .rejects.toMatchObject({ code: 'NUMBERING_IDEMPOTENCY_CONFLICT' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1)
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 1n, nextSequenceValue: 2n })
  })

  it('preserves committed replays while disabled and rejects a missing item until enabled', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode, 2)
    const first = await batch(inputs.slice(0, 1))
    await prisma.numberingRule.update({ where: { id: created.id }, data: { status: 'DISABLED' } })
    expect(await batch(inputs.slice(0, 1))).toEqual([{ ...first[0], idempotentReplay: true }])
    await expect(batch(inputs)).rejects.toMatchObject({ code: 'NUMBERING_RULE_UNAVAILABLE' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1)
  })

  it('rejects an oversized batch atomically when sequence capacity cannot hold it', async () => {
    const created = await rule([{ type: 'SEQUENCE', width: 1, startValue: '8', step: '1' }])
    await expect(batch(requests(created.ruleCode, 3))).rejects.toMatchObject({ code: 'NUMBERING_CAPACITY_EXHAUSTED' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(0)
    expect(await prisma.numberingPeriodState.count({ where: { ruleId: created.id } })).toBe(0)
    expect((await batch(requests(created.ruleCode, 2))).map(item => item.number)).toEqual(['8', '9'])
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 2n, nextSequenceValue: null })
  })

  function queuedRandom(values: number[]): NumberingRandomSource {
    let index = 0
    return { nextInt: () => values[index++] ?? 1 }
  }

  async function randomBatch(ruleCode: string, count: number, values: number[]) {
    const randomGenerator = new NumberingGeneratorService(prisma as unknown as PrismaService, queuedRandom(values))
    return prisma.$transaction(async tx => {
      await applyTransactionTimeouts(tx)
      return randomGenerator.generateScopedBatchInTransaction(tx, requests(ruleCode, count))
    }, { timeout: 30_000 })
  }

  it('retries random collisions within a batch and against permanent ledger rows', async () => {
    const created = await rule([{ type: 'RANDOM', letterLength: 0, digitLength: 1, mode: 'LETTERS_THEN_DIGITS' }])
    expect((await randomBatch(created.ruleCode, 2, [1, 1, 2])).map(item => item.number)).toEqual(['1', '2'])
    expect((await randomBatch(created.ruleCode, 1, [1, 2, 3]))[0].number).toBe('3')
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 3n, nextSequenceValue: null })
  })

  it('rolls back already accepted random candidates if another request exhausts retries', async () => {
    const created = await rule([{ type: 'RANDOM', letterLength: 0, digitLength: 1, mode: 'LETTERS_THEN_DIGITS' }])
    await expect(randomBatch(created.ruleCode, 2, [1, 1])).rejects
      .toMatchObject({ code: 'NUMBERING_GENERATION_RETRY_EXHAUSTED' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(0)
    expect(await prisma.numberingPeriodState.count({ where: { ruleId: created.id } })).toBe(0)
  })

  it('issues two concurrent maximum pure random batches without changing lock limits', async () => {
    const created = await rule([{ type: 'RANDOM', letterLength: 0, digitLength: 10, mode: 'LETTERS_THEN_DIGITS' }])
    const start = performance.now()
    const [first, second] = await Promise.all([batch(requests(created.ruleCode)), batch(requests(created.ruleCode))])
    console.info(`Numbering random concurrent maximum batches: ${Math.round(performance.now() - start)} ms`)
    expect(new Set([...first, ...second].map(item => item.number)).size).toBe(2000)
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 2000n, nextSequenceValue: null })
  })

  it('preflights pure random capacity without partial issuance', async () => {
    const created = await rule([{ type: 'RANDOM', letterLength: 0, digitLength: 1, mode: 'LETTERS_THEN_DIGITS' }])
    await expect(randomBatch(created.ruleCode, 11, [1])).rejects
      .toMatchObject({ code: 'NUMBERING_CAPACITY_EXHAUSTED' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(0)
  })

  it('uses the sequence capacity and renderer for mixed sequence plus random rules', async () => {
    const created = await rule([
      { type: 'SEQUENCE', width: 2, startValue: '4', step: '2' },
      { type: 'SEPARATOR', value: '-' },
      { type: 'RANDOM', letterLength: 0, digitLength: 1, mode: 'LETTERS_THEN_DIGITS' },
    ])
    const result = await randomBatch(created.ruleCode, 3, [1, 2, 3])
    expect(result.map(item => item.number)).toEqual(['04-1', '06-2', '08-3'])
    expect(await prisma.numberingPeriodState.findFirst({ where: { ruleId: created.id } }))
      .toMatchObject({ usedCount: 3n, nextSequenceValue: 10n })
  })

  it('rejects inconsistent sequence state without changing permanent ledger', async () => {
    const created = await rule()
    await batch(requests(created.ruleCode, 1))
    await prisma.numberingPeriodState.updateMany({ where: { ruleId: created.id }, data: { nextSequenceValue: 1n } })
    await expect(batch(requests(created.ruleCode, 2))).rejects.toMatchObject({ code: 'NUMBERING_OUTPUT_CONFLICT' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1)
  })

  it('rejects duplicate output atomically even if corrupted counters agree internally', async () => {
    const created = await rule()
    await batch(requests(created.ruleCode, 1))
    await prisma.numberingPeriodState.updateMany({ where: { ruleId: created.id }, data: { usedCount: 0n, nextSequenceValue: 1n } })
    await expect(batch(requests(created.ruleCode, 2))).rejects.toMatchObject({ code: 'NUMBERING_OUTPUT_CONFLICT' })
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(1)
  })

  it('validates the complete bounded homogeneous batch before reading or writing anything', async () => {
    const created = await rule()
    const inputs = requests(created.ruleCode, 2)
    for (const invalid of [
      [], requests(created.ruleCode, 1001), [inputs[0], inputs[0]],
      [inputs[0], { ...inputs[1], ruleCode: 'OTHER_RULE' }],
      [inputs[0], { ...inputs[1], consumerCode: 'OTHER.CONSUMER' }],
      [inputs[0], { ...inputs[1], requestFingerprint: 'invalid' }],
    ]) {
      await expect(batch(invalid)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(await prisma.numberingIssuance.count({ where: { ruleId: created.id } })).toBe(0)
    expect(await prisma.numberingPeriodState.count({ where: { ruleId: created.id } })).toBe(0)
  })
})
