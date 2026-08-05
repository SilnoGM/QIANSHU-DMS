import type { SupplierDto, SupplierListItemDto } from '../../src/api/modules/suppliers'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 纯逻辑契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCreateSupplierRequest,
  buildSupplierListQuery,
  buildUpdateSupplierRequest,
  canApplySupplierQueryResponse,
  createSupplierCreateIntent,
  createSupplierFormModel,
  getSupplierMutationFailure,
  hasSupplierFormChanges,
  markSupplierCreateIntentUnknown,
  resolveSupplierActions,
  resolveSupplierEnableReadiness,
  retrySupplierCreateIntent,
  validateSupplierForm,
} from '../../src/views/system/service-provider/suppliers/supplier-management.logic'

const SUPPLIER: SupplierDto = {
  id: '00000000-0000-4000-8000-000000000101',
  code: 'SUP/20260805-0001',
  legalName: '千树原料有限公司',
  shortName: '千树原料',
  entityType: 'ORGANIZATION',
  registration: {
    countryRegion: {
      id: '00000000-0000-4000-8000-000000000201',
      name: '中国',
    },
    number: '91310000TEST',
  },
  primaryContact: {
    name: '林经理',
    phone: '138 0000 0000',
    wechatId: null,
  },
  primaryAddress: {
    countryRegionId: '00000000-0000-4000-8000-000000000201',
    provinceStateId: '00000000-0000-4000-8000-000000000202',
    cityId: '00000000-0000-4000-8000-000000000203',
    regionPath: [
      { id: '00000000-0000-4000-8000-000000000201', name: '中国' },
      { id: '00000000-0000-4000-8000-000000000202', name: '上海市' },
      { id: '00000000-0000-4000-8000-000000000203', name: '上海市' },
    ],
    addressLine: '浦东新区示例路 1 号',
    postalCode: null,
  },
  remark: '重点合作供方',
  enabled: false,
  enableReadiness: { ready: true, missingFields: [] },
  version: 3,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
}

test('列表查询规范化分页、搜索、筛选和稳定排序', () => {
  assert.deepEqual(buildSupplierListQuery({
    entityType: 'ORGANIZATION',
    page: 2,
    pageSize: 50,
    query: '  千树  原料  ',
    sortBy: 'legalName',
    sortOrder: 'asc',
    status: 'ENABLED',
  }), {
    entityType: 'ORGANIZATION',
    page: 2,
    pageSize: 50,
    query: '千树 原料',
    sortBy: 'legalName',
    sortOrder: 'asc',
    status: 'ENABLED',
  })

  assert.deepEqual(buildSupplierListQuery({
    entityType: 'UNKNOWN',
    page: 0,
    pageSize: 500,
    query: ' ',
    sortBy: 'unknown',
    sortOrder: 'unknown',
    status: 'UNKNOWN',
  }), {
    page: 1,
    pageSize: 20,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  })
})

test('创建草稿只要求法定名称与主体类型，空登记、联系人和地址归一为 null', () => {
  const model = createSupplierFormModel('create', null)
  Object.assign(model, {
    legalName: '  千树原料有限公司  ',
    shortName: ' ',
    registrationCountryRegionId: null,
    registrationNumber: '',
    primaryContactName: '',
    primaryContactPhone: '',
    primaryContactWechatId: '',
    primaryAddressLine: '',
    primaryAddressPostalCode: '',
    remark: '',
  })

  assert.deepEqual(validateSupplierForm(model, false), {})
  assert.deepEqual(buildCreateSupplierRequest(model), {
    entityType: 'ORGANIZATION',
    legalName: '千树原料有限公司',
    primaryAddress: null,
    primaryContact: null,
    registration: null,
    remark: null,
    shortName: null,
  })
})

test('登记国家和登记号必须同时填写，地址地区不允许跳级', () => {
  const model = createSupplierFormModel('create', null)
  model.legalName = '示例供方'
  model.registrationCountryRegionId = '00000000-0000-4000-8000-000000000201'
  model.primaryAddressRegion = {
    countryRegionId: null,
    provinceStateId: '00000000-0000-4000-8000-000000000202',
    cityId: null,
  }

  assert.deepEqual(validateSupplierForm(model, false), {
    'primaryAddress.region': '主要地址地区必须按国家/地区、省/州、城市依次选择',
    'registration.number': '登记国家/地区与登记号必须同时填写或同时留空',
  })
})

test('字段长度按 Unicode 码点计算，邮编可空但不得超限', () => {
  const model = createSupplierFormModel('create', null)
  Object.assign(model, {
    legalName: '😀'.repeat(201),
    primaryAddressPostalCode: '1'.repeat(33),
    primaryContactPhone: '1'.repeat(33),
    remark: '备'.repeat(1001),
  })

  assert.deepEqual(validateSupplierForm(model, false), {
    'legalName': '法定名称应为 1 到 200 个字符',
    'primaryAddress.postalCode': '邮编不能超过 32 个字符',
    'primaryContact.phone': '联系人电话不能超过 32 个字符',
    'remark': '备注不能超过 1000 个字符',
  })
})

test('启用就绪度只检查联系人姓名和电话或微信，登记与地址可空', () => {
  const model = createSupplierFormModel('create', null)
  model.legalName = '示例供方'

  assert.deepEqual(resolveSupplierEnableReadiness(model), {
    ready: false,
    missingFields: ['primaryContact.name', 'primaryContact.channel'],
  })

  model.primaryContactName = '王经理'
  model.primaryContactWechatId = 'wang-manager'
  assert.deepEqual(resolveSupplierEnableReadiness(model), {
    ready: true,
    missingFields: [],
  })
  assert.deepEqual(validateSupplierForm(model, true), {})
})

test('编辑已启用供应商时不允许清空启用必需联系人', () => {
  const model = createSupplierFormModel('edit', { ...SUPPLIER, enabled: true })
  model.primaryContactPhone = ''
  model.primaryContactWechatId = ''

  assert.deepEqual(validateSupplierForm(model, true), {
    'primaryContact.channel': '联系人电话或微信号至少填写一项',
  })
})

test('编辑请求完整替换分组、携带 expectedVersion 且不提交不可变字段', () => {
  const model = createSupplierFormModel('edit', SUPPLIER)
  model.shortName = ''
  model.primaryContactWechatId = 'qianshu'

  const request = buildUpdateSupplierRequest(model, SUPPLIER)
  assert.deepEqual(request, {
    entityType: 'ORGANIZATION',
    expectedVersion: 3,
    legalName: '千树原料有限公司',
    primaryAddress: {
      addressLine: '浦东新区示例路 1 号',
      cityId: '00000000-0000-4000-8000-000000000203',
      countryRegionId: '00000000-0000-4000-8000-000000000201',
      postalCode: null,
      provinceStateId: '00000000-0000-4000-8000-000000000202',
    },
    primaryContact: {
      name: '林经理',
      phone: '138 0000 0000',
      wechatId: 'qianshu',
    },
    registration: {
      countryRegionId: '00000000-0000-4000-8000-000000000201',
      number: '91310000TEST',
    },
    remark: '重点合作供方',
    shortName: null,
  })
  assert.equal(Object.hasOwn(request, 'code'), false)
  assert.equal(Object.hasOwn(request, 'enabled'), false)
  assert.equal(hasSupplierFormChanges(model, SUPPLIER), true)
  assert.equal(hasSupplierFormChanges(createSupplierFormModel('edit', SUPPLIER), SUPPLIER), false)
})

test('行级动作同时服从权限与当前状态', () => {
  const row: SupplierListItemDto = {
    code: SUPPLIER.code,
    enabled: false,
    entityType: SUPPLIER.entityType,
    hasPrimaryContactPhone: true,
    hasPrimaryContactWechatId: false,
    id: SUPPLIER.id,
    legalName: SUPPLIER.legalName,
    primaryAddressRegionPath: [],
    primaryContactName: '林经理',
    registrationCountryRegion: null,
    shortName: null,
    updatedAt: SUPPLIER.updatedAt,
    version: SUPPLIER.version,
  }

  assert.deepEqual(resolveSupplierActions(row, {
    canDisable: true,
    canEnable: true,
    canRead: true,
    canUpdate: false,
  }), {
    canDisable: false,
    canEdit: false,
    canEnable: true,
    canView: true,
    hasAny: true,
  })
})

test('mutation 错误只接受供应商字段白名单并映射稳定领域冲突', () => {
  assert.deepEqual(getSupplierMutationFailure({
    kind: 'http',
    status: 409,
    body: {
      code: 'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
      fieldErrors: {
        'registration.number': ['登记号重复'],
        'password': ['不得透传'],
      },
      message: '同一登记地区下登记号已存在',
      requestId: 'request-1',
    },
  }), {
    code: 'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
    fieldErrors: { 'registration.number': '登记号重复' },
    message: '同一登记地区下登记号已存在',
    requestId: 'request-1',
    requiresRefresh: false,
    unknownResult: false,
  })

  assert.equal(getSupplierMutationFailure({
    kind: 'http',
    status: 409,
    body: {
      code: 'SUPPLIER_STATE_CHANGED',
      message: '供应商状态已变化',
      requestId: 'request-2',
    },
  }).requiresRefresh, true)
})

test('网络失败标记创建结果未知且不泄露底层异常', () => {
  assert.deepEqual(getSupplierMutationFailure({
    kind: 'network',
    message: 'connect ECONNREFUSED user=secret',
  }, 'create'), {
    code: undefined,
    fieldErrors: {},
    message: '网络中断，创建结果未知，请使用原请求确认结果',
    requestId: undefined,
    requiresRefresh: false,
    unknownResult: true,
  })
})

test('创建意图冻结规范化 payload 与 canonical UUID v4，未知结果只能手动原样重放', () => {
  const model = createSupplierFormModel('create', null)
  model.legalName = '  示例供方  '
  const key = '123e4567-e89b-42d3-a456-426614174000'
  const intent = createSupplierCreateIntent(model, key)

  model.legalName = '已被用户修改'
  assert.equal(intent.state, 'ready')
  assert.equal(intent.payload.legalName, '示例供方')
  assert.throws(() => createSupplierCreateIntent(model, key.toUpperCase()), /UUID v4/u)

  const unknownIntent = markSupplierCreateIntentUnknown(intent)
  assert.equal(unknownIntent.state, 'unknown')
  assert.deepEqual(retrySupplierCreateIntent(unknownIntent), {
    idempotencyKey: key,
    payload: intent.payload,
  })
  assert.throws(() => retrySupplierCreateIntent(intent), /结果未知/u)
})

test('查询响应仅在未取消、同身份、仍有读权限且为最新代次时生效', () => {
  assert.equal(canApplySupplierQueryResponse({
    aborted: false,
    authEpoch: 3,
    authorized: true,
    currentAuthEpoch: 3,
    latestRequestVersion: 2,
    requestVersion: 2,
  }), true)
  assert.equal(canApplySupplierQueryResponse({
    aborted: false,
    authEpoch: 3,
    authorized: false,
    currentAuthEpoch: 3,
    latestRequestVersion: 2,
    requestVersion: 2,
  }), false)
})
