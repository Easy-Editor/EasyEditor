export {}

declare module 'vue' {
  export interface GlobalComponents {
    RainbowAnimationSwitcher: typeof import('./.vitepress/theme/components/RainbowAnimationSwitcher.vue')['default']
    RainbowSwitcher: typeof import('./.vitepress/theme/components/RainbowSwitcher.vue')['default']
  }
}
