import AutoScroll from './_auto-scroll.vue'
import AutoScrollRaw from './_auto-scroll.vue?raw'
import Autoplay from './_autoplay.vue'
import AutoplayRaw from './_autoplay.vue?raw'
import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Fade from './_fade.vue'
import FadeRaw from './_fade.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自动播放',
    component: Autoplay,
    componentRaw: AutoplayRaw,
  },
  {
    title: '自动滚动',
    component: AutoScroll,
    componentRaw: AutoScrollRaw,
  },
  {
    title: '淡入淡出',
    component: Fade,
    componentRaw: FadeRaw,
  },
]
