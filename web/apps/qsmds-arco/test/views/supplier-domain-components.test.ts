import type { SupplierDto } from '../../src/api/modules/suppliers'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 领域组件和纯展示契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSupplierStatusPresentation,
  buildSupplierStatusRequest,
  cloneSupplierFormModel,
  createSupplierFormModel,
  firstSupplierFormErrorField,
  resolveSupplierFormFieldErrors,
} from '../../src/views/system/service-provider/suppliers/supplier-management.logic'

const VIEW_ROOT = new URL(
  '../../src/views/system/service-provider/suppliers/',
  import.meta.url,
)

const SUPPLIER: SupplierDto = {
  id: '00000000-0000-4000-8000-000000000101',
  code: 'SUP/20260805-0001',
  legalName: '千树原料有限公司',
  shortName: '千树原料',
  entityType: 'ORGANIZATION',
  registration: null,
  primaryContact: {
    name: '林经理',
    phone: '13800000000',
    wechatId: null,
  },
  primaryAddress: null,
  remark: null,
  enabled: false,
  enableReadiness: { ready: true, missingFields: [] },
  version: 3,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
}

function readSource(fileName: string): string {
  return readFileSync(new URL(fileName, VIEW_ROOT), 'utf8')
}

test('供应商表单模型深拷贝地区值且字段错误只接受白名单', () => {
  const model = createSupplierFormModel('edit', SUPPLIER)
  const cloned = cloneSupplierFormModel(model)
  cloned.primaryAddressRegion.countryRegionId
    = '00000000-0000-4000-8000-000000000999'

  assert.notEqual(cloned, model)
  assert.notEqual(cloned.primaryAddressRegion, model.primaryAddressRegion)
  assert.equal(model.primaryAddressRegion.countryRegionId, null)
  assert.deepEqual(resolveSupplierFormFieldErrors({
    'legalName': ['Server 名称错误'],
    'password': ['不得透传'],
    'primaryContact.channel': '缺少联系方式',
  }), {
    'legalName': 'Server 名称错误',
    'primaryContact.channel': '缺少联系方式',
  })
  assert.equal(firstSupplierFormErrorField({
    'remark': '备注错误',
    'registration.number': '登记错误',
  }), 'registration.number')
})

test('启停展示明确当前供应商、动作影响与 expectedVersion', () => {
  assert.deepEqual(buildSupplierStatusPresentation('enable', SUPPLIER), {
    action: 'enable',
    canConfirm: true,
    confirmLabel: '确认启用',
    destructive: false,
    impact: '启用后该供应商可进入后续业务使用范围；登记、地址和邮编仍可为空。',
    title: '确认启用供应商',
  })
  assert.deepEqual(buildSupplierStatusRequest(SUPPLIER), {
    expectedVersion: 3,
  })

  const blocked = buildSupplierStatusPresentation('enable', {
    ...SUPPLIER,
    enableReadiness: {
      ready: false,
      missingFields: ['primaryContact.name', 'primaryContact.channel'],
    },
  })
  assert.equal(blocked.canConfirm, false)
  assert.match(blocked.impact, /联系人姓名/u)
  assert.match(blocked.impact, /电话或微信号/u)

  const disable = buildSupplierStatusPresentation('disable', {
    ...SUPPLIER,
    enabled: true,
  })
  assert.equal(disable.destructive, true)
  assert.match(disable.impact, /历史资料/u)
  assert.match(disable.impact, /不删除/u)
})

test('表单抽屉组合 xl、真实表单和地区选择器，副作用留在页面', () => {
  const source = readSource('supplier-form-drawer.vue')

  assert.match(source, /defineOptions\(\{ name: 'SupplierFormDrawer' \}\)/u)
  assert.match(source, /QsGenericDrawer/u)
  assert.match(source, /size="xl"/u)
  assert.match(source, /QsRegionSelector/u)
  assert.match(source, /<FaForm\b/u)
  assert.match(source, /label="法定名称"/u)
  assert.match(source, /label="主体类型"/u)
  assert.match(source, /label="登记号"/u)
  assert.match(source, /label="联系人姓名"/u)
  assert.match(source, /label="联系人电话"/u)
  assert.match(source, /label="微信号"/u)
  assert.match(source, /label="邮编（可选）"/u)
  assert.match(source, /label="备注"/u)
  for (const field of [
    'registration.number',
    'primaryContact.name',
    'primaryContact.phone',
    'primaryContact.wechatId',
    'primaryAddress.addressLine',
    'primaryAddress.postalCode',
  ]) {
    assert.match(
      source,
      new RegExp(
        `<FaFormItem[^>]*name="${field.replaceAll('.', '\\.')}"[^>]*:auto-bind="false"`,
        'su',
      ),
    )
  }
  assert.match(source, /供应商编号由 SUPPLIER 规则自动生成/u)
  assert.doesNotMatch(source, /网站|website|email|银行|账期/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|useAuth|usePermission|useQsToast/u)
})

test('表单抽屉具备提交锁、首错聚焦、脏表单保护和安全关闭旁路', () => {
  const source = readSource('supplier-form-drawer.vue')

  assert.match(source, /const submitRequested = ref\(false\)/u)
  assert.match(source, /:submitting="submitLocked"/u)
  assert.match(source, /:before-close="handleBeforeClose"/u)
  assert.match(source, /formRef\.value\?\.setFieldError/u)
  assert.match(source, /formRef\.value\?\.scrollToField/u)
  assert.match(source, /closeWithoutDirtyGuard/u)
  assert.match(source, /closeForAuthorityLoss/u)
  assert.match(source, /'closeRequest'/u)
  assert.match(source, /'submit'/u)
  assert.match(source, /requestId:/u)
})

test('详情抽屉以 lg 只读展示完整资料、启用就绪度和文字状态', () => {
  const source = readSource('supplier-detail-drawer.vue')

  assert.match(source, /defineOptions\(\{ name: 'SupplierDetailDrawer' \}\)/u)
  assert.match(source, /<QsGenericDrawer\b/u)
  assert.match(source, /size="lg"/u)
  assert.match(source, /Supplier Code/u)
  assert.match(source, /法定名称/u)
  assert.match(source, /登记信息/u)
  assert.match(source, /主要联系人/u)
  assert.match(source, /主要地址/u)
  assert.match(source, /启用就绪度/u)
  assert.match(source, /DateTimeDisplay/u)
  assert.match(source, /已启用|已停用/u)
  assert.match(source, /allowEdit/u)
  assert.match(source, /allowEnable/u)
  assert.match(source, /allowDisable/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|useAuth|usePermission|useQsToast/u)
})

test('详情抽屉信息卡片使用项目 OKLCH 主题 Token', () => {
  const source = readSource('supplier-detail-drawer.vue')

  assert.match(source, /background: oklch\(var\(--background\)\)/u)
  assert.match(source, /border: 1px solid oklch\(var\(--border\)\)/u)
  assert.match(source, /color: oklch\(var\(--muted-foreground\)\)/u)
  assert.doesNotMatch(source, /hsl\(var\(--(?:background|border|muted-foreground)\)\)/u)
})

test('状态确认使用 sm 通用 Modal，启用未就绪时禁止确认', () => {
  const source = readSource('supplier-status-change-modal.vue')

  assert.match(source, /defineOptions\(\{ name: 'SupplierStatusChangeModal' \}\)/u)
  assert.match(source, /<QsGenericModal\b/u)
  assert.match(source, /size="sm"/u)
  assert.match(source, /presentation\.canConfirm/u)
  assert.match(source, /enableReadiness\.missingFields/u)
  assert.match(source, /expectedVersion/u)
  assert.match(source, /requestId:/u)
  assert.match(source, /min-h-11 w-full sm:min-h-9 sm:w-auto/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|useAuth|usePermission|useQsToast/u)
})

test('三个领域组件不引入原始色值、渐变、删除或公共发号动作', () => {
  const source = [
    readSource('supplier-form-drawer.vue'),
    readSource('supplier-detail-drawer.vue'),
    readSource('supplier-status-change-modal.vue'),
  ].join('\n')

  assert.doesNotMatch(source, /gradient|#[\dA-Fa-f]{3,8}\b|rgba?\(/u)
  assert.doesNotMatch(source, /删除供应商|DELETE|generateSupplier|supplierCatalog/u)
})
