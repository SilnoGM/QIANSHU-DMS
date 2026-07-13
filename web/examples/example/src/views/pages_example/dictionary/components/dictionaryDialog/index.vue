<script setup lang="ts">
import type { CascaderOption, FormExpose } from '@fantastic-admin/components'
import { ref } from 'vue'
import apiDictionary from '@/api/modules/dictionary'

const props = withDefaults(
  defineProps<{
    parentId?: string | number
    id?: string | number
    tree: any[]
  }>(),
  {
    parentId: undefined,
    id: '',
  },
)

const emits = defineEmits<{
  addNode: [
    node: {
      id: string | number
      label: string
      code: string
    },
  ]
  editNode: [
    node: {
      id: string | number
      label: string
      code: string
    },
    parentId: string | number,
  ]
}>()

const visible = defineModel<boolean>({
  default: false,
})

const title = computed(() => props.id === '' ? '新增字典' : '编辑字典')

function formatTree(tree: any[], id: string | number, childrenDisabled = false): CascaderOption[] {
  const data: CascaderOption[] = []
  tree.forEach((item) => {
    const temp = { ...item, label: item.label, value: item.id }
    if (temp.id === id || childrenDisabled) {
      temp.disabled = true
      if (temp.children) {
        temp.children = formatTree(temp.children, id, true)
      }
    }
    else {
      temp.disabled = false
      if (temp.children) {
        temp.children = formatTree(temp.children, id, childrenDisabled)
      }
    }
    data.push(temp)
  })
  return data
}
const myTree = computed(() => formatTree(props.tree, props.id))

const formRef = useTemplateRef<FormExpose>('formRef')

interface DictionaryFormModel {
  parentId?: string | number
  id: string | number
  name: string
  code: string
}

const model = ref<DictionaryFormModel>({
  parentId: props.parentId as string | number | undefined,
  id: props.id,
  name: '',
  code: '',
})

const validationSchema = {
  name(value: string) {
    return value.trim() ? true : '请输入字典名称'
  },
  code(value: string) {
    return value.trim() ? true : '请输入字典编码'
  },
}

onMounted(() => {
  if (props.id !== '') {
    apiDictionary.detail(props.id).then((res) => {
      model.value.id = res.data.id
      model.value.name = res.data.name
      model.value.code = res.data.code
    })
  }
})

async function onSubmit() {
  const result = await formRef.value?.validate()

  if (!result?.valid) {
    return false
  }

  if (model.value.id === '') {
    const res = await apiDictionary.create(model.value)
    useFaToast().success('模拟新增成功')
    emits('addNode', {
      id: res.data.data,
      label: model.value.name,
      code: model.value.code,
    })
  }
  else {
    await apiDictionary.edit(model.value)
    useFaToast().success('模拟编辑成功')
    emits('editNode', {
      id: model.value.id,
      label: model.value.name,
      code: model.value.code,
    }, model.value.parentId ?? '')
  }

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
      :label-width="80"
    >
      <FaFormItem name="parentId" label="父级字典">
        <FaCascader :options="myTree" :leaf-only="false" clearable placeholder="请选择父级字典，默认为根字典" class="w-full" />
      </FaFormItem>
      <FaFormItem name="name" label="字典名称" required>
        <FaInput placeholder="请输入字典名称" class="w-full" />
      </FaFormItem>
      <FaFormItem name="code" label="字典编码" required>
        <FaInput placeholder="请输入字典编码" class="w-full" />
      </FaFormItem>
    </FaForm>
  </FaModal>
</template>
