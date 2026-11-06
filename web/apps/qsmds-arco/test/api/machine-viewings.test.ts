import type { AxiosInstance } from 'axios'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证看机预约传输契约与幂等重试边界。
import test from 'node:test'

import { createMachineViewingsApi } from '../../src/api/modules/machine-viewings'

test('列表按分页查询，创建携带幂等键且禁止自动重试', async () => {
  const calls: unknown[][] = []
  const invoke = (...args: unknown[]) => {
    calls.push(args)
    return Promise.resolve({ data: {} })
  }
  const api = createMachineViewingsApi({ get: invoke, post: invoke } as unknown as AxiosInstance)
  const signal = new AbortController().signal

  await api.list({ page: 2, pageSize: 50 }, signal)
  await api.create({
    site: 'TAICHUNG_LONGJING',
    machineType: 'SHREDDER',
    appointmentMonth: 11,
    appointmentDay: 20,
    period: 'AM',
    customerName: '陈先生',
    contactPerson: '李华',
  }, 'key-1', signal)

  assert.equal(calls[0][0], 'machine-viewings')
  assert.deepEqual(calls[0][1], {
    errorPresentation: 'local',
    params: { page: 2, pageSize: 50 },
    signal,
  })

  assert.equal(calls[1][0], 'machine-viewings')
  assert.deepEqual((calls[1][1] as { customerName: string }).customerName, '陈先生')
  assert.deepEqual(calls[1][2], {
    errorPresentation: 'local',
    retry: false,
    headers: { 'Idempotency-Key': 'key-1' },
    signal,
  })
})
