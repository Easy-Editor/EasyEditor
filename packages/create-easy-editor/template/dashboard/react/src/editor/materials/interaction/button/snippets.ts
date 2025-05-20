import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Button',
    schema: {
      componentName: 'Button',
      props: {
        text: 'Primary Button',
      },
      $dashboard: {
        rect: {
          width: 120,
          height: 40,
        },
      },
    },
  },
]

export default snippets
