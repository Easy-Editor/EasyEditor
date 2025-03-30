import { defineConfig } from 'vitepress'
import { en } from './en'
import { shared } from './shared'
import { zh } from './zh'

export default defineConfig({
  ...shared,
  locales: {
    root: { label: '简体中文', ...zh },
    en: { label: 'English', ...en },
  },
})
