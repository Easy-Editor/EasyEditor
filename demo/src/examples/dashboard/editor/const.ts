import type { DocumentSchema } from '@easy-editor/core'

export const defaultDocumentSchema: DocumentSchema = {
  name: '未命名',
  rootNode: {
    componentName: 'RootContainer',
    props: {
      backgroundColor: '#18181B',
    },
    $: {
      dashboard: {
        position: {
          x: 0,
          y: 0,
        },
      },
    },
    children: [
      {
        componentName: 'Button',
        props: {
          type: 'primary',
          text: '按钮',
        },
        $: {
          dashboard: {
            position: {
              x: 100,
              y: 100,
            },
          },
        },
      },
      // {
      //   componentName: 'Group',
      //   children: [
      //     {
      //       componentName: 'Button',
      //       props: {
      //         type: 'primary',
      //         text: '按钮 in Group',
      //       },
      //       $: {
      //         dashboard: {
      //           position: {
      //             x: 0,
      //             y: 0,
      //           },
      //         },
      //       },
      //     },
      //     {
      //       componentName: 'Button',
      //       props: {
      //         type: 'primary',
      //         text: '按钮222 in Group',
      //       },
      //       $: {
      //         dashboard: {
      //           position: {
      //             x: 100,
      //             y: 50,
      //           },
      //         },
      //       },
      //     },
      //   ],
      //   $: {
      //     dashboard: {
      //       position: {
      //         x: 200,
      //         y: 200,
      //       },
      //     },
      //   },
      // },
    ],
  },
}
