import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: '输入框',
    // screenshot: require('./__screenshots__/button-1.png'),
    schema: {
      componentName: 'Input',
      props: {
        placeholder: '请输入',
      },
    },
  },
]

export default snippets
