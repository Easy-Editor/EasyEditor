import type { Snippet } from '@easy-editor/core'

const snippets: Snippet[] = [
  {
    title: 'Text',
    screenshot: 'https://img.alicdn.com/imgextra/i3/O1CN01n5wpxc1bi862KuXFz_!!6000000003498-55-tps-50-50.svg',
    schema: {
      componentName: 'Text',
      props: {
        text: 'Text Text Text',
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
