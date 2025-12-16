import type { RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  fileName: 'home',
  fileDesc: '首页',
  componentName: 'Root',
  props: {
    backgroundColor: '#232630',
    className: 'page test',
  },
  isRoot: true,
  $dashboard: {
    rect: {
      x: 0,
      y: 0,
      // TODO: 根节点需要动态调整
      width: 1920,
      height: 1080,
    },
  },
  children: [
    // {
    //   componentName: 'Image',
    //   $dashboard: {
    //     rect: {
    //       x: 600,
    //       y: 480,
    //       width: 740,
    //       height: 120,
    //     },
    //   },
    // },
    // {
    //   componentName: 'Group',
    //   title: 'Title Bar',
    //   isGroup: true,
    //   children: [
    //     {
    //       componentName: 'Text',
    //       title: 'Left Title',
    //       props: {
    //         text: '标题标题标题左',
    //         style: {
    //           fontSize: '36px',
    //           fontFamily: 'KaiTi',
    //           fontWeight: 'bold',
    //           color: '#FFFFFF',
    //         },
    //       },
    //       $dashboard: {
    //         rect: {
    //           x: 0,
    //           y: 0,
    //           width: 400,
    //           height: 100,
    //         },
    //       },
    //     },
    //     {
    //       componentName: 'Text',
    //       title: 'Right Title',
    //       props: {
    //         text: '标题标题标题右',
    //         style: {
    //           fontSize: '36px',
    //           fontFamily: 'KaiTi',
    //           fontWeight: 'bold',
    //           color: '#FFFFFF',
    //         },
    //       },
    //       $dashboard: {
    //         rect: {
    //           x: 1520,
    //           y: 0,
    //           width: 400,
    //           height: 100,
    //         },
    //       },
    //     },
    //   ],
    // },
  ],
}
