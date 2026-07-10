import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/component_pro_example',
  component: Layout,
  name: 'componentProExample',
  meta: {
    title: $t('route.componentPro.root'),
    icon: 'i-bx:bxs-component',
    badge: 'PRO',
  },
  children: [
    {
      path: 'animated_beam',
      name: 'componentProExampleAnimatedBeam',
      component: () => import('@/views/component_pro_example/animated_beam.vue'),
      meta: {
        title: $t('route.componentPro.animatedBeam'),
      },
    },
    {
      path: 'animated_count_to',
      name: 'componentProExampleAnimatedCountTo',
      component: () => import('@/views/component_pro_example/animated_count_to.vue'),
      meta: {
        title: $t('route.componentPro.animatedCountTo'),
      },
    },
    {
      path: 'blur_reveal',
      name: 'componentProExampleBlurReveal',
      component: () => import('@/views/component_pro_example/blur_reveal.vue'),
      meta: {
        title: $t('route.componentPro.blurReveal'),
      },
    },
    {
      path: 'border_beam',
      name: 'componentProExampleBorderBeam',
      component: () => import('@/views/component_pro_example/border_beam.vue'),
      meta: {
        title: $t('route.componentPro.borderBeam'),
      },
    },
    {
      path: 'carousel',
      name: 'componentProExampleCarousel',
      component: () => import('@/views/component_pro_example/carousel.vue'),
      meta: {
        title: $t('route.componentPro.carousel'),
      },
    },
    {
      path: 'cascader',
      name: 'componentProExampleCascader',
      component: () => import('@/views/component_pro_example/cascader.vue'),
      meta: {
        title: $t('route.componentPro.cascader'),
      },
    },
    {
      path: 'date',
      name: 'componentProExampleDate',
      component: () => import('@/views/component_pro_example/date.vue'),
      meta: {
        title: $t('route.componentPro.date'),
      },
    },
    {
      path: 'calendar_date',
      name: 'componentProExampleCalendarDate',
      component: () => import('@/views/component_pro_example/calendar_date.vue'),
      meta: {
        title: $t('route.componentPro.calendarDate'),
      },
    },
    {
      path: 'calendar_date_range',
      name: 'componentProExampleCalendarDateRange',
      component: () => import('@/views/component_pro_example/calendar_date_range.vue'),
      meta: {
        title: $t('route.componentPro.calendarDateRange'),
      },
    },
    {
      path: 'calendar_month',
      name: 'componentProExampleCalendarMonth',
      component: () => import('@/views/component_pro_example/calendar_month.vue'),
      meta: {
        title: $t('route.componentPro.calendarMonth'),
      },
    },
    {
      path: 'calendar_month_range',
      name: 'componentProExampleCalendarMonthRange',
      component: () => import('@/views/component_pro_example/calendar_month_range.vue'),
      meta: {
        title: $t('route.componentPro.calendarMonthRange'),
      },
    },
    {
      path: 'calendar_year',
      name: 'componentProExampleCalendarYear',
      component: () => import('@/views/component_pro_example/calendar_year.vue'),
      meta: {
        title: $t('route.componentPro.calendarYear'),
      },
    },
    {
      path: 'calendar_year_range',
      name: 'componentProExampleCalendarYearRange',
      component: () => import('@/views/component_pro_example/calendar_year_range.vue'),
      meta: {
        title: $t('route.componentPro.calendarYearRange'),
      },
    },
    {
      path: 'code',
      name: 'componentProExampleCode',
      component: () => import('@/views/component_pro_example/code.vue'),
      meta: {
        title: $t('route.componentPro.code'),
      },
    },
    {
      path: 'combobox',
      name: 'componentProExampleCombobox',
      component: () => import('@/views/component_pro_example/combobox.vue'),
      meta: {
        title: $t('route.componentPro.combobox'),
      },
    },
    {
      path: 'count_to',
      name: 'componentProExampleCountTo',
      component: () => import('@/views/component_pro_example/count_to.vue'),
      meta: {
        title: $t('route.componentPro.countTo'),
      },
    },
    {
      path: 'digital_card',
      name: 'componentProExampleDigitalCard',
      component: () => import('@/views/component_pro_example/digital_card.vue'),
      meta: {
        title: $t('route.componentPro.digitalCard'),
      },
    },
    {
      path: 'empty',
      name: 'componentProExampleEmpty',
      component: () => import('@/views/component_pro_example/empty.vue'),
      meta: {
        title: $t('route.componentPro.empty'),
      },
    },
    {
      path: 'flip_card',
      name: 'componentProExampleFlipCard',
      component: () => import('@/views/component_pro_example/flip_card.vue'),
      meta: {
        title: $t('route.componentPro.flipCard'),
      },
    },
    {
      path: 'flip_words',
      name: 'componentProExampleFlipWords',
      component: () => import('@/views/component_pro_example/flip_words.vue'),
      meta: {
        title: $t('route.componentPro.flipWords'),
      },
    },
    {
      path: 'glowy_card',
      name: 'componentProExampleGlowyCard',
      component: () => import('@/views/component_pro_example/glowy_card.vue'),
      meta: {
        title: $t('route.componentPro.glowyCard'),
      },
    },
    {
      path: 'gradient_button',
      name: 'componentProExampleGradientButton',
      component: () => import('@/views/component_pro_example/gradient_button.vue'),
      meta: {
        title: $t('route.componentPro.gradientButton'),
      },
    },
    {
      path: 'icon_picker',
      name: 'componentProExampleIconPicker',
      component: () => import('@/views/component_pro_example/icon_picker.vue'),
      meta: {
        title: $t('route.componentPro.iconPicker'),
      },
    },
    {
      path: 'interactive_button',
      name: 'componentProExampleInteractiveButton',
      component: () => import('@/views/component_pro_example/interactive_button.vue'),
      meta: {
        title: $t('route.componentPro.interactiveButton'),
      },
    },
    {
      path: 'link_preview',
      name: 'componentProExampleLinkPreview',
      component: () => import('@/views/component_pro_example/link_preview.vue'),
      meta: {
        title: $t('route.componentPro.linkPreview'),
      },
    },
    {
      path: 'layout_container',
      name: 'componentProExampleLayoutContainer',
      component: () => import('@/views/component_pro_example/layout_container.vue'),
      meta: {
        title: $t('route.componentPro.layoutContainer'),
      },
    },
    {
      path: 'loading',
      name: 'componentProExampleLoading',
      component: () => import('@/views/component_pro_example/loading.vue'),
      meta: {
        title: $t('route.componentPro.loading'),
      },
    },
    {
      path: 'marquee',
      name: 'componentProExampleMarquee',
      component: () => import('@/views/component_pro_example/marquee.vue'),
      meta: {
        title: $t('route.componentPro.marquee'),
      },
    },
    {
      path: 'mention',
      name: 'componentProExampleMention',
      component: () => import('@/views/component_pro_example/mention.vue'),
      meta: {
        title: $t('route.componentPro.mention'),
      },
    },
    {
      path: 'multi_step_loader',
      name: 'componentProExampleMultiStepLoader',
      component: () => import('@/views/component_pro_example/multi_step_loader.vue'),
      meta: {
        title: $t('route.componentPro.multiStepLoader'),
      },
    },
    {
      path: 'particles_bg',
      name: 'componentProExampleParticlesBg',
      component: () => import('@/views/component_pro_example/particles_bg.vue'),
      meta: {
        title: $t('route.componentPro.particlesBg'),
      },
    },
    {
      path: 'pattern_bg',
      name: 'componentProExamplePatternBg',
      component: () => import('@/views/component_pro_example/pattern_bg.vue'),
      meta: {
        title: $t('route.componentPro.patternBg'),
      },
    },
    {
      path: 'qrcode',
      name: 'componentProExampleQrcode',
      component: () => import('@/views/component_pro_example/qrcode.vue'),
      meta: {
        title: $t('route.componentPro.qrcode'),
      },
    },
    {
      path: 'scratch_off',
      name: 'componentProExampleScratchOff',
      component: () => import('@/views/component_pro_example/scratch_off.vue'),
      meta: {
        title: $t('route.componentPro.scratchOff'),
      },
    },
    {
      path: 'scrolling_text',
      name: 'componentProExampleScrollingText',
      component: () => import('@/views/component_pro_example/scrolling_text.vue'),
      meta: {
        title: $t('route.componentPro.scrollingText'),
      },
    },
    {
      path: 'smooth_swipe',
      name: 'componentProExampleSmoothSwipe',
      component: () => import('@/views/component_pro_example/smooth_swipe.vue'),
      meta: {
        title: $t('route.componentPro.smoothSwipe'),
      },
    },
    {
      path: 'sparkles_text',
      name: 'componentProExampleSparkleText',
      component: () => import('@/views/component_pro_example/sparkles_text.vue'),
      meta: {
        title: $t('route.componentPro.sparklesText'),
      },
    },
    {
      path: 'sparkline',
      name: 'componentProExampleSparkline',
      component: () => import('@/views/component_pro_example/sparkline.vue'),
      meta: {
        title: $t('route.componentPro.sparkline'),
      },
    },
    {
      path: 'spotlight_card',
      name: 'componentProExampleSpotlightCard',
      component: () => import('@/views/component_pro_example/spotlight_card.vue'),
      meta: {
        title: $t('route.componentPro.spotlightCard'),
      },
    },
    {
      path: 'steps',
      name: 'componentProExampleSteps',
      component: () => import('@/views/component_pro_example/steps.vue'),
      meta: {
        title: $t('route.componentPro.steps'),
      },
    },
    {
      path: 'storage_box',
      name: 'componentProExampleStoragebox',
      component: () => import('@/views/component_pro_example/storage_box.vue'),
      meta: {
        title: $t('route.componentPro.storageBox'),
      },
    },
    {
      path: 'text_highlight',
      name: 'componentProExampleTextHighlight',
      component: () => import('@/views/component_pro_example/text_highlight.vue'),
      meta: {
        title: $t('route.componentPro.textHighlight'),
      },
    },
    {
      path: 'text_shiny',
      name: 'componentProExampleTextShiny',
      component: () => import('@/views/component_pro_example/text_shiny.vue'),
      meta: {
        title: $t('route.componentPro.textShiny'),
      },
    },
    {
      path: 'time_ago',
      name: 'componentProExampleTimeAgo',
      component: () => import('@/views/component_pro_example/time_ago.vue'),
      meta: {
        title: $t('route.componentPro.timeAgo'),
      },
    },
    {
      path: 'timeline',
      name: 'componentProExampleTimeline',
      component: () => import('@/views/component_pro_example/timeline.vue'),
      meta: {
        title: $t('route.componentPro.timeline'),
      },
    },
    {
      path: 'tree',
      name: 'componentProExampleTree',
      component: () => import('@/views/component_pro_example/tree.vue'),
      meta: {
        title: $t('route.componentPro.tree'),
      },
    },
  ],
}

export default routes
