import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Custom from './_custom.vue'
import CustomRaw from './_custom.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自定义参数',
    component: Custom,
    componentRaw: CustomRaw,
  },
]
