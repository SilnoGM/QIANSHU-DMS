import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_COLORS, FRAMEWORK_COLORS, THEMES } from '@fantastic-admin/themes'
import { entriesToCss } from '@unocss/core'
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetWind4,
  transformerCompileClass,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'
import { presetAnimations } from 'unocss-preset-animations'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const iconInventoryPath = path.resolve(projectRoot, 'apps/qsmds-arco/src/icons/project-icon-inventory.generated.json')
const iconInventory = JSON.parse(readFileSync(iconInventoryPath, 'utf8')) as { name: string, source: string }[]
type ColorScheme = 'light' | 'dark'
type ThemeTokens = Record<ColorScheme, Record<string, string>>

function getColorSchemeSelectors(selector: string, colorScheme: ColorScheme) {
  if (colorScheme === 'light') {
    return [selector]
  }
  return [`${selector}.dark`, `${selector} .dark`]
}

function generateThemeCss(
  entries: [string, ThemeTokens][],
  getSelector: (name: string) => string,
) {
  return entries.flatMap(([name, colorSchemes]) => {
    return Object.entries(colorSchemes).map(([colorScheme, tokens]) => {
      const roots = getColorSchemeSelectors(getSelector(name), colorScheme as ColorScheme)
      const css = entriesToCss(Object.entries(tokens))
      return roots.map(root => `${root}{color-scheme:${colorScheme};${css}}`).join('')
    })
  })
}

function generateFrameworkCss(colorSchemes: ThemeTokens) {
  return Object.entries(colorSchemes).map(([colorScheme, tokens]) => {
    const roots = getColorSchemeSelectors(':root', colorScheme as ColorScheme)
    const css = entriesToCss(Object.entries(tokens))
    return roots.map(root => `${root}{color-scheme:${colorScheme};${css}}`).join('')
  })
}

/*
 * 语义排版 shortcut 只组合已确认的字体、尺度与主题颜色，不承载布局。
 * 每个应用级 CSS 变量都保留静态数值 fallback，保证共享组件在参考应用中仍有有效计算值。
 */
const qsTypographyShortcuts = {
  'qs-type-display-title': 'font-sans [font-size:var(--qs-type-size-2xl,1.5rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-xl,2rem)] [letter-spacing:var(--qs-type-tracking-tight,-0.025em)] text-foreground md:[font-size:var(--qs-type-size-3xl,1.875rem)] md:[line-height:var(--qs-type-leading-2xl,2.375rem)]',
  'qs-type-auth-display': 'font-sans [font-size:var(--qs-type-size-4xl,2.25rem)] [font-weight:var(--qs-type-weight-bold,700)] [line-height:var(--qs-type-leading-3xl,2.5rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-page-title': 'font-sans [font-size:var(--qs-type-size-xl,1.25rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-lg,1.75rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground md:[font-size:var(--qs-type-size-2xl,1.5rem)] md:[line-height:var(--qs-type-leading-xl,2rem)]',
  'qs-type-section-title': 'font-sans [font-size:var(--qs-type-size-lg,1.125rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-lg,1.75rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-component-title': 'font-sans [font-size:var(--qs-type-size-md,1rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-md,1.5rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-compact-title': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-body': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-body-medium': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-body-relaxed': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-md,1.5rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-description': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-muted-foreground',
  'qs-type-meta': 'font-sans [font-size:var(--qs-type-size-xs,0.75rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-xs,1rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-muted-foreground',
  'qs-type-compact-label': 'font-sans [font-size:var(--qs-type-size-xs,0.75rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-xs,1rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-muted-foreground',
  'qs-type-form-label': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-form-help': 'font-sans [font-size:var(--qs-type-size-xs,0.75rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-xs,1rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-muted-foreground',
  'qs-type-form-control': 'font-sans [font-size:var(--qs-type-size-md,1rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-md,1.5rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground md:[font-size:var(--qs-type-size-sm,0.875rem)] md:[line-height:var(--qs-type-leading-sm,1.25rem)]',
  'qs-type-action': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] disabled:opacity-50',
  'qs-type-action-disabled': 'font-sans [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] opacity-50',
  'qs-type-tag': 'font-sans [font-size:var(--qs-type-size-xs,0.75rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-xs,1rem)] [letter-spacing:var(--qs-type-tracking-normal,0)]',
  'qs-type-status-tag': 'font-sans [font-size:var(--qs-type-size-xs,0.75rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-xs,1rem)] [letter-spacing:var(--qs-type-tracking-normal,0)]',
  'qs-type-dialog-title': 'font-sans [font-size:var(--qs-type-size-lg,1.125rem)] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:var(--qs-type-leading-md,1.5rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground',
  'qs-type-table-header': 'font-sans [font-size:0.8125rem] [font-weight:var(--qs-type-weight-semibold,600)] [line-height:1.125rem] [letter-spacing:0.01em] text-muted-foreground',
  'qs-type-data': 'font-mono [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-regular,400)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground tabular-nums',
  'qs-type-data-emphasis': 'font-mono [font-size:var(--qs-type-size-sm,0.875rem)] [font-weight:var(--qs-type-weight-medium,500)] [line-height:var(--qs-type-leading-sm,1.25rem)] [letter-spacing:var(--qs-type-tracking-normal,0)] text-foreground tabular-nums',
} satisfies Record<string, string>

export default defineConfig({
  content: {
    pipeline: {
      include: [
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        'src/**/*.{js,ts}',
        path.resolve(projectRoot, 'packages/components/**/*.{vue,js,ts}'),
      ],
    },
  },
  // 图标目录以动态名称渲染，构建时固定生成本地 CSS，避免依赖源页面提取或运行时远程加载。
  safelist: [
    ...Object.keys(qsTypographyShortcuts),
    ...iconInventory.filter(icon => icon.source === 'iconify').map(icon => icon.name),
  ],
  shortcuts: [
    qsTypographyShortcuts,
    [/^flex-?(col)?-(start|end|center|baseline|stretch)-?(start|end|center|between|around|evenly|left|right)?$/, ([, col, items, justify]) => {
      const cls = ['flex']
      if (col === 'col') {
        cls.push('flex-col')
      }
      if (items === 'center' && !justify) {
        cls.push('items-center')
        cls.push('justify-center')
      }
      else {
        cls.push(`items-${items}`)
        if (justify) {
          cls.push(`justify-${justify}`)
        }
      }
      return cls.join(' ')
    }],
  ],
  theme: {
    /* UnoCSS 字体工具类只引用产品 Token，避免 presetWind4 注入平台字体栈。 */
    font: {
      sans: 'var(--qs-font-sans, "Noto Sans SC")',
      mono: 'var(--qs-font-mono, "Noto Sans Mono", "Noto Sans SC")',
    },
  },
  presets: [
    presetWind4(),
    presetAnimations(),
    presetAttributify(),
    presetIcons({
      collectionsNodeResolvePath: projectRoot,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
    presetTypography(),
    {
      name: 'unocss-preset-shadcn',
      preflights: [
        {
          getCSS: () => {
            const returnCss = [
              ...generateThemeCss(
                Object.entries(BASE_COLORS) as [string, ThemeTokens][],
                baseColorName => `[data-base-color="${baseColorName}"]`,
              ),
              ...generateThemeCss(
                Object.entries(THEMES) as [string, ThemeTokens][],
                themeName => `[data-theme="${themeName}"]`,
              ),
              ...generateFrameworkCss(FRAMEWORK_COLORS),
            ]
            return `
${returnCss.join('\n')}

::selection {
  color: oklch(var(--primary-foreground));
  background-color: oklch(var(--primary));
}

* {
  border-color: oklch(var(--border));
  scrollbar-color: oklch(var(--border)) transparent;
  scrollbar-width: thin;
}

body {
  color: oklch(var(--foreground));
  background: oklch(var(--background));
}

button:not(:disabled),
[role="button"]:not(:disabled) {
  cursor: pointer;
}
`
          },
        },
      ],
      theme: {
        colors: {
          background: 'oklch(var(--background))',
          foreground: 'oklch(var(--foreground))',
          card: {
            DEFAULT: 'oklch(var(--card))',
            foreground: 'oklch(var(--card-foreground))',
          },
          popover: {
            DEFAULT: 'oklch(var(--popover))',
            foreground: 'oklch(var(--popover-foreground))',
          },
          primary: {
            DEFAULT: 'oklch(var(--primary))',
            foreground: 'oklch(var(--primary-foreground))',
          },
          secondary: {
            DEFAULT: 'oklch(var(--secondary))',
            foreground: 'oklch(var(--secondary-foreground))',
          },
          muted: {
            DEFAULT: 'oklch(var(--muted))',
            foreground: 'oklch(var(--muted-foreground))',
          },
          accent: {
            DEFAULT: 'oklch(var(--accent))',
            foreground: 'oklch(var(--accent-foreground))',
          },
          destructive: 'oklch(var(--destructive))',
          border: 'oklch(var(--border))',
          input: 'oklch(var(--input))',
          ring: 'oklch(var(--ring))',
        },
        radius: {
          xl: 'calc(var(--radius) + 4px)',
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
      },
    },
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
    transformerCompileClass(),
  ],
  configDeps: [
    path.resolve(projectRoot, 'packages/themes/index.ts'),
    iconInventoryPath,
  ],
})
