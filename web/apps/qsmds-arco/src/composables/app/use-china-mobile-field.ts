import type { ChinaMobileInputIssue } from '../../utils/china-mobile'

import { computed, ref } from 'vue'

import {
  buildChinaMobileE164,
  normalizeMobileInput,
  parseStoredMobileE164,
} from '../../utils/china-mobile'

export interface ChinaMobileFieldOptions {
  getInitial: () => string | null
  getValue: () => string
  setValue: (value: string) => void
}

/**
 * 个人资料与管理端用户表单共享的大陆手机号字段。
 *
 * 输入框是“非受控显示”：`national` 只在资料加载/重置时同步一次，用户键入时
 * 由输入框自身维护显示值，避免 FaFormItem 自动绑定与被动 v-model 在同一 input
 * 事件里回灌旧 E.164 或清空输入框。表单真值仍是 E.164。
 */
export function useChinaMobileField(options: ChinaMobileFieldOptions) {
  const inputNotice = ref<ChinaMobileInputIssue | null>(null)
  const national = ref(parseStoredMobileE164(options.getValue()).national)

  const unsupported = computed(() => {
    const initial = options.getInitial()
    return initial !== null
      && options.getValue() === initial
      && parseStoredMobileE164(initial).unsupported
  })

  function syncFromModel(): void {
    national.value = parseStoredMobileE164(options.getValue()).national
  }

  function onInput(raw: string | number | undefined): void {
    const normalized = normalizeMobileInput(String(raw ?? ''))
    inputNotice.value = normalized.issue
    // 外国号码与超长输入不写入模型：显示值保留给用户自行修正，提交时由守卫拦截。
    if (normalized.issue === 'foreign' || normalized.issue === 'length') {
      return
    }
    options.setValue(buildChinaMobileE164(normalized.digits) ?? '')
  }

  function clearUnsupported(): void {
    inputNotice.value = null
    options.setValue('')
    national.value = ''
  }

  function clearNotice(): void {
    inputNotice.value = null
  }

  return {
    clearNotice,
    clearUnsupported,
    inputNotice,
    national,
    onInput,
    syncFromModel,
    unsupported,
  }
}
