import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: '主按钮',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: '主按钮',
      },
      // TODO: 这样写法是否奇怪
      $dashboard: {
        rect: {
          width: 100,
          height: 100,
        },
      },
    },
  },
  {
    title: '次按钮',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Button',
      props: {
        type: 'default',
        text: '次按钮',
      },
    },
  },
]

export default snippets
