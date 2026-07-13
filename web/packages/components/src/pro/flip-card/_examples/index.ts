import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import CustomSize from './_custom-size.vue'
import CustomSizeRaw from './_custom-size.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自定义尺寸',
    component: CustomSize,
    componentRaw: CustomSizeRaw,
  },
]
