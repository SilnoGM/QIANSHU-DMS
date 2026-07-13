<script setup lang="ts">
import type { CascaderOption, FormExpose } from '@fantastic-admin/components'
import { ref } from 'vue'
import apiDictionary from '@/api/modules/dictionary'

const props = withDefaults(
  defineProps<{
    dictionaryId?: string | number
    id?: string | number
    tree: any[]
  }>(),
  {
    dictionaryId: '',
    id: '',
  },
)

const emits = defineEmits<{
  success: []
}>()

const visible = defineModel<boolean>({
  default: false,
})

const title = computed(() => props.id === '' ? '新增字典项' : '编辑字典项')

const treeOptions = computed<CascaderOption[]>(() => {
  function convert(list: any[]): CascaderOption[] {
    return list.map(item => ({
      label: item.label,
      value: item.id,
      disabled: item.disabled,
      children: item.children ? convert(item.children) : undefined,
    }))
  }
  return convert(props.tree)
})

const formRef = useTemplateRef<FormExpose>('formRef')

interface DictionaryItemFormModel {
  dictionaryId?: string | number
  id: string | number
  name: string
  value: string
  enable: boolean
}

const model = ref<DictionaryItemFormModel>({
  dictionaryId: props.dictionaryId as string | number | undefined,
  id: props.id,
  name: '',
  value: '',
  enable: true,
})

const validationSchema = {
  dictionaryId(value: string | number | undefined) {
    return value !== undefined && value !== '' ? true : '请选择所属字典'
  },
  name(value: string) {
    return value.trim() ? true : '请输入字典项名称'
  },
  value(value: string) {
    return value.trim() ? true : '请输入字典项键值'
  },
}

onMounted(() => {
  if (props.id !== '') {
    apiDictionary.itemDetail(props.id).then((res) => {
      model.value.id = res.data.id
      model.value.name = res.data.name
      model.value.value = res.data.value
      model.value.enable = res.data.enable
    })
  }
})

async function onSubmit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  if (model.value.id === '') {
    await apiDictionary.itemCreate(model.value)
    useFaToast().success('模拟新增成功')
  }
  else {
    await apiDictionary.itemEdit(model.value)
    useFaToast().success('模拟编辑成功')
  }

  emits('success')
  return true
}

function onCancel() {
  visible.value = false
}
</script>

<template>
  <FaModal
    v-model="visible"
    :title="title"
    class="w-[400px]"
    show-cancel-button
    :close-on-click-overlay="false"
    :before-close="async (action, done) => {
      if (action === 'confirm') { const ok = await onSubmit(); if (ok) done() }
      else { done() }
    }"
    @cancel="onCancel"
    @closed="onCancel"
  >
    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      label-placement="right"
      :label-width="100"
    >
      <FaFormItem name="dictionaryId" label="所属字典" required>
        <FaCascader :options="treeOptions" :leaf-only="false" placeholder="请选择所属字典" class="w-full" />
      </FaFormItem>
      <FaFormItem name="name" label="字典项名称" required>
        <FaInput placeholder="请输入字典项名称" class="w-full" />
      </FaFormItem>
      <FaFormItem name="value" label="字典项键值" required>
        <FaInput placeholder="请输入字典项键值" class="w-full" />
      </FaFormItem>
      <FaFormItem name="enable" label="状态">
        <FaSwitch />
      </FaFormItem>
    </FaForm>
  </FaModal>
</template>
