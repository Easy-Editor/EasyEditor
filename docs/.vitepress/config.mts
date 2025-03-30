import { defineConfig } from 'vitepress'
import { version } from '../../packages/core/package.json'

const title = 'EasyEditor'
const description = 'Plugin-based cross-framework low-code engine for building visual application platforms'

export default defineConfig({
  lang: 'zh',
  title,
  titleTemplate: title,
  description,
  outDir: './dist',
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    ['link', { rel: 'alternate icon', href: '/favicon.ico', type: 'image/png', sizes: '16x16' }],
    ['meta', { name: 'author', content: 'JinSo' }],
    [
      'link',
      { rel: 'search', type: 'application/opensearchdescription+xml', href: '/search.xml', title: 'EasyEditor' },
    ],
  ],
  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    logo: '/logo-dark.svg',
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' },
      {
        text: `v${version}`,
        items: [
          {
            text: 'Release Notes',
            link: 'https://github.com/Easy-Editor/EasyEditor/releases',
          },
          {
            text: 'Report',
            link: 'https://github.com/Easy-Editor/EasyEditor/issues',
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

    socialLinks: [{ icon: 'github', link: 'https://github.com/Easy-Editor/EasyEditor' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-PRESENT JinSo',
    },
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
