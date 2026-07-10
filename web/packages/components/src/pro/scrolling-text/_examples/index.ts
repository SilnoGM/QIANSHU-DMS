import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import DownClick from './_down-click.vue'
import DownClickRaw from './_down-click.vue?raw'
import Fade from './_fade.vue'
import FadeRaw from './_fade.vue?raw'
import Slot from './_slot.vue'
import SlotRaw from './_slot.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '多条可见 + fade 动画',
    component: Fade,
    componentRaw: FadeRaw,
  },
  {
    title: '向下滚动 + 点击事件',
    component: DownClick,
    componentRaw: DownClickRaw,
  },
  {
    title: '自定义条目 slot',
    component: Slot,
    componentRaw: SlotRaw,
  },
]
