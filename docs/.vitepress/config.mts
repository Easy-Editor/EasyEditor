import { defineConfig } from 'vitepress'

const version = '0.0.1'
// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'zh',
  title: 'EasyEditor',
  description: 'Plugin-based cross-framework low-code engine for building visual application platforms',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' },
      {
        text: `v${version}`,
        items: [
          {
            text: 'Release Notes',
            link: 'https://github.com/unocss/unocss/releases',
          },
          {
            text: 'Contributing',
            link: 'https://github.com/unocss/unocss/blob/main/.github/CONTRIBUTING.md',
          },
          {
            component: 'RainbowAnimationSwitcher',
            props: {
              text: 'Rainbow Animation',
            },
          },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Examples',
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/vuejs/vitepress' }],
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh',
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en',
    },
  },
})
