<script setup lang="ts">
import type { SupplierDto } from './supplier-management.logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'

defineOptions({ name: 'SupplierDetailDrawer' })

const props = withDefaults(defineProps<{
  allowDisable?: boolean
  allowEdit?: boolean
  allowEnable?: boolean
  detail: null | SupplierDto
  error?: null | string
  loading?: boolean
  modelValue: boolean
  requestId?: null | string
}>(), {
  allowDisable: false,
  allowEdit: false,
  allowEnable: false,
  error: null,
  loading: false,
  requestId: null,
})

const emit = defineEmits<{
  'action': [action: 'disable' | 'edit' | 'enable', detail: SupplierDto]
  'closed': []
  'reload': []
  'update:modelValue': [value: boolean]
}>()

const hasActions = computed(() => props.detail !== null && (
  props.allowEdit || props.allowEnable || props.allowDisable
))

function requestAction(action: 'disable' | 'edit' | 'enable'): void {
  const detail = props.detail
  if (detail === null) {
    return
  }
  const allowed = {
    disable: props.allowDisable && detail.enabled,
    edit: props.allowEdit,
    enable: props.allowEnable && !detail.enabled,
  }[action]
  if (allowed) {
    emit('action', action, detail)
  }
}

function entityTypeLabel(value: SupplierDto['entityType']): string {
  return value === 'ORGANIZATION' ? '企业/组织' : '个人'
}

function regionPathLabel(detail: SupplierDto): string {
  return detail.primaryAddress?.regionPath.map(item => item.name).join(' ') || '未填写'
}

function missingFieldLabel(
  field: SupplierDto['enableReadiness']['missingFields'][number],
): string {
  return field === 'primaryContact.name'
    ? '联系人姓名'
    : '联系人电话或微信号'
}
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="detail?.legalName ?? '供应商详情'"
    :description="detail === null
      ? '核验供应商主体、联系人、地址与当前状态。'
      : `${detail.code} · Version ${detail.version}`"
    size="lg"
    :loading="loading"
    :error="error"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:building-2" class="size-4" />
    </template>

    <template #error-actions>
      <FaButton size="sm" variant="outline" @click="emit('reload')">
        重新加载
      </FaButton>
      <code v-if="requestId" class="qs-type-meta break-all">
        requestId: {{ requestId }}
      </code>
    </template>

    <FaEmpty
      v-if="detail === null"
      icon="i-lucide:file-question"
      title="暂无供应商详情"
      description="请返回列表重新选择供应商。"
      class="min-h-64"
    />

    <div v-else data-testid="supplier-detail-drawer" class="gap-5 grid min-w-0">
      <section class="p-4 border border-border rounded-lg bg-muted/25 min-w-0">
        <div class="flex gap-3 items-start justify-between">
          <div class="min-w-0">
            <p class="qs-type-compact-label m-0">
              Supplier Code
            </p>
            <code class="qs-type-data-emphasis mt-1 block break-all">
              {{ detail.code }}
            </code>
          </div>
          <span class="qs-type-compact-label px-2.5 py-1 border border-border rounded-full bg-background inline-flex items-center">
            <FaIcon
              :name="detail.enabled ? 'i-lucide:circle-check' : 'i-lucide:circle-pause'"
              class="mr-1 size-3.5"
            />
            {{ detail.enabled ? '已启用' : '已停用' }}
          </span>
        </div>
      </section>

      <section aria-labelledby="supplier-subject-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-subject-heading" class="qs-type-section m-0">
          主体信息
        </h3>
        <dl class="supplier-detail-grid">
          <div>
            <dt class="qs-type-compact-label">
              法定名称
            </dt>
            <dd>{{ detail.legalName }}</dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              简称
            </dt>
            <dd>{{ detail.shortName || '未填写' }}</dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              主体类型
            </dt>
            <dd>{{ entityTypeLabel(detail.entityType) }}</dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              当前版本
            </dt>
            <dd class="font-mono tabular-nums">
              {{ detail.version }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="supplier-registration-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-registration-heading" class="qs-type-section m-0">
          登记信息
        </h3>
        <dl class="supplier-detail-grid">
          <div>
            <dt class="qs-type-compact-label">
              登记国家/地区
            </dt>
            <dd>{{ detail.registration?.countryRegion.name || '未填写' }}</dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              登记号
            </dt>
            <dd class="font-mono break-all">
              {{ detail.registration?.number || '未填写' }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="supplier-contact-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-contact-heading" class="qs-type-section m-0">
          主要联系人
        </h3>
        <dl class="supplier-detail-grid">
          <div>
            <dt class="qs-type-compact-label">
              姓名
            </dt>
            <dd>{{ detail.primaryContact?.name || '未填写' }}</dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              电话
            </dt>
            <dd class="font-mono break-all">
              {{ detail.primaryContact?.phone || '未填写' }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label">
              微信号
            </dt>
            <dd class="font-mono break-all">
              {{ detail.primaryContact?.wechatId || '未填写' }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="supplier-address-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-address-heading" class="qs-type-section m-0">
          主要地址
        </h3>
        <dl class="supplier-detail-grid">
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label">
              地区
            </dt>
            <dd>{{ regionPathLabel(detail) }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label">
              详细地址
            </dt>
            <dd class="break-words">
              {{ detail.primaryAddress?.addressLine || '未填写' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              邮编
            </dt>
            <dd class="font-mono">
              {{ detail.primaryAddress?.postalCode || '未填写' }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="supplier-readiness-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-readiness-heading" class="qs-type-section m-0">
          启用就绪度
        </h3>
        <FaAlert
          :variant="detail.enableReadiness.ready ? 'default' : 'destructive'"
          :icon="detail.enableReadiness.ready ? 'i-lucide:badge-check' : 'i-lucide:circle-alert'"
          :title="detail.enableReadiness.ready ? '已满足启用条件' : '尚未满足启用条件'"
          :description="detail.enableReadiness.ready
            ? '联系人姓名和电话或微信号已完整；登记、地址和邮编不影响启用。'
            : `请补充：${detail.enableReadiness.missingFields.map(missingFieldLabel).join('、')}`"
        />
      </section>

      <section aria-labelledby="supplier-other-heading" class="gap-3 grid min-w-0">
        <h3 id="supplier-other-heading" class="qs-type-section m-0">
          其他信息
        </h3>
        <dl class="supplier-detail-grid">
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label">
              备注
            </dt>
            <dd class="whitespace-pre-wrap break-words">
              {{ detail.remark || '未填写' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              创建时间
            </dt>
            <dd><DateTimeDisplay :value="detail.createdAt" /></dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              更新时间
            </dt>
            <dd><DateTimeDisplay :value="detail.updatedAt" /></dd>
          </div>
        </dl>
      </section>
    </div>

    <template v-if="hasActions" #footer>
      <FaButton
        v-if="allowEdit"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="requestAction('edit')"
      >
        编辑资料
      </FaButton>
      <FaButton
        v-if="allowEnable && detail && !detail.enabled"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="!detail.enableReadiness.ready"
        @click="requestAction('enable')"
      >
        启用供应商
      </FaButton>
      <FaButton
        v-if="allowDisable && detail?.enabled"
        variant="destructive"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="requestAction('disable')"
      >
        停用供应商
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>

<style scoped>
.supplier-detail-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.supplier-detail-grid > div {
  min-width: 0;
  padding: 0.75rem;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
}

.supplier-detail-grid dt {
  color: hsl(var(--muted-foreground));
}

.supplier-detail-grid dd {
  min-width: 0;
  margin: 0.25rem 0 0;
}

@media (width >= 640px) {
  .supplier-detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
