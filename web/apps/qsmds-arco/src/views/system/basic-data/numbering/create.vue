<script setup lang="ts">
import type { NumberingRuleFormModel } from './numbering-management.logic'
import type { NumberingPurpose } from '@/api/modules/numbering-purpose'
import { numberingPurposeLabel, parseNumberingPurpose } from '@/api/modules/numbering-purpose'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import NumberingPurposeSelectModal from './numbering-purpose-select-modal.vue'
import NumberingRuleForm from './numbering-rule-form.vue'
import { useNumberingCreate } from './use-numbering-create'

defineOptions({ name: 'SystemBasicDataNumberingCreate' })
const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const authorized = computed(() => auth('numbering-rules:read') && auth('numbering-rules:create'))
const purpose = computed(() => parseNumberingPurpose(route.query.purpose))
const formRef = useTemplateRef<InstanceType<typeof NumberingRuleForm>>('formRef')
const { model, preview, previewError, previewLoading, previewRequestId, error, fieldErrors, requestId, submitting, unknownResult, reset, requestPreview, submit } = useNumberingCreate(authorized, purpose)
const selectVisible = ref(false)
const navigating = ref(false)
const discardVisible = ref(false)
let resolveLeave: ((value: boolean) => void) | null = null
let successBypass = false
const dirty = computed(() => formRef.value?.dirty ?? false)
const locked = computed(() => submitting.value || navigating.value)
const returnLocation = computed(() => typeof route.query.returnTo === 'string'
  && /^\/system\/basic-data\/numbering(?:\?|$)/u.test(route.query.returnTo)
  ? route.query.returnTo
  : '/system/basic-data/numbering')

function resolveDiscard(allowed: boolean): void {
  const pending = resolveLeave
  resolveLeave = null
  discardVisible.value = false
  pending?.(allowed)
}
function confirmLeave(): boolean | Promise<boolean> {
  if (!authorized.value) {
    return true
  }
  if (successBypass) {
    successBypass = false
    return true
  }
  if (submitting.value) {
    toast.info('编号规则正在保存，请等待结果确认后再离开')
    return false
  }
  if (!dirty.value) {
    return true
  }
  if (resolveLeave !== null) {
    return false
  }
  discardVisible.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(to => to.query.purpose === route.query.purpose ? true : confirmLeave())

async function choosePurpose(selected: NumberingPurpose): Promise<void> {
  if (locked.value || !authorized.value) {
    return
  }
  navigating.value = true
  try {
    await router.replace({ name: 'systemBasicDataNumberingCreate', query: { purpose: selected, returnTo: returnLocation.value } })
    selectVisible.value = purpose.value === null
  }
  finally { navigating.value = false }
}
async function cancel(): Promise<void> {
  await router.push(returnLocation.value)
}
function onSelectorClosed(): void {
  if (purpose.value === null && !navigating.value) {
    void cancel()
  }
}
async function handleSubmit(input: NumberingRuleFormModel): Promise<void> {
  if (locked.value || !await submit(input)) {
    return
  }
  toast.success('编号规则已创建为草稿')
  successBypass = true
  navigating.value = true
  try {
    await router.replace({ name: 'systemBasicDataNumbering', query: { purpose: purpose.value!, page: '1' } })
  }
  finally {
    successBypass = false
    navigating.value = false
  }
}
function beforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value && !submitting.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}
// 用途变更和身份纪元变化均新建上下文，旧请求不能把旧用途的输入带回来。
watch(purpose, () => {
  reset()
  selectVisible.value = authorized.value && purpose.value === null
}, { immediate: true, flush: 'sync' })
watch(() => [account.authEpoch, authorized.value] as const, () => {
  reset()
  resolveDiscard(false)
  selectVisible.value = authorized.value && purpose.value === null
})
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  resolveDiscard(false)
})
</script>

<template>
  <div data-testid="numbering-create-page" :aria-busy="locked">
    <FaPageHeader title="新增编号规则" description="先配置并预览，再保存为草稿；创建不会发布、启用或派发编号。" />
    <FaPageMain>
      <FaEmpty v-if="!authorized" icon="i-lucide:shield-alert" title="无权新增编号规则" description="需要同时具备编号读取与创建权限。" />
      <template v-else-if="purpose">
        <section class="mb-6 p-4 border border-border rounded-xl bg-muted/20 flex flex-wrap gap-5 items-center justify-between" aria-label="编号用途">
          <div class="flex gap-3 items-center">
            <FaIcon :name="purpose === 'BUSINESS' ? 'i-lucide:binary' : 'i-lucide:tags'" class="text-primary size-6" />
            <div>
              <strong>{{ numberingPurposeLabel(purpose) }}</strong><code class="qs-type-meta ml-3">{{ purpose }}</code><p class="qs-type-meta mb-0 mt-1">
                用途已确定，创建后不可切换
              </p>
            </div>
          </div>
          <span class="qs-type-meta">统计时区 · <code>Asia/Shanghai</code></span>
        </section>
        <NumberingRuleForm
          :key="purpose" ref="formRef" v-model:form-model="model" mode="create" layout="page"
          :error="error" :field-errors="fieldErrors" :request-id="requestId" :submitting="locked"
          :preview="preview" :preview-error="previewError" :preview-loading="previewLoading" :preview-request-id="previewRequestId"
          @preview="requestPreview" @submit="handleSubmit"
        />
        <div data-testid="numbering-create-footer" class="mt-6 pt-4 border-t border-border flex flex-wrap gap-3 items-center justify-end">
          <span v-if="dirty" class="qs-type-meta mr-auto">有未保存修改</span>
          <FaButton variant="outline" :disabled="locked" @click="cancel">
            取消
          </FaButton>
          <FaButton :loading="locked" :disabled="locked || unknownResult || !dirty" @click="formRef?.submit()">
            创建规则
          </FaButton>
        </div>
      </template>
      <FaEmpty v-else title="请先选择编码用途" description="必须明确选择业务编码或唛头编码才能填写规则。" />
    </FaPageMain>
    <NumberingPurposeSelectModal v-if="authorized" v-model="selectVisible" :loading="navigating" @confirm="choosePurpose" @closed="onSelectorClosed" />
    <QsGenericModal :model-value="discardVisible" title="放弃未保存的修改？" description="当前编号规则尚未保存，离开后需要重新填写。" @update:model-value="resolveDiscard(false)">
      <template #footer>
        <FaButton variant="outline" @click="resolveDiscard(false)">
          继续编辑
        </FaButton>
        <FaButton variant="destructive" @click="resolveDiscard(true)">
          放弃修改
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
