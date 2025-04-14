import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'

const title = 'EasyEditor'

export const shared = defineConfig({
  lang: 'zh',
  title,
  titleTemplate: title,
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
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Easy-Editor/EasyEditor' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-PRESENT JinSo',
    },
  },

  markdown: {
    // math: true,
    config(md) {
      md.use(groupIconMdPlugin)
    },
  },

  vite: {
    plugins: [groupIconVitePlugin()],
  },
})
