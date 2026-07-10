import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Form from './_form.vue'
import FormRaw from './_form.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '表单应用',
    component: Form,
    componentRaw: FormRaw,
  },
]
