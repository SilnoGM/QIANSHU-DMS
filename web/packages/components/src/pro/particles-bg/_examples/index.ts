import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Config from './_config.vue'
import ConfigRaw from './_config.vue?raw'
import Copy from './_copy.vue'
import CopyRaw from './_copy.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '颜色、数量、速度',
    component: Config,
    componentRaw: ConfigRaw,
  },
  {
    title: '搭配文案',
    component: Copy,
    componentRaw: CopyRaw,
  },
]
