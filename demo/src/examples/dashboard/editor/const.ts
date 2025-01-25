import type { RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  componentName: 'RootContainer',
  props: {
    backgroundColor: '#27272A',
  },
  $dashboard: {
    rect: {
      x: 0,
      y: 0,
      // width: '100%',
      // height: '100%',
    },
  },
  children: [
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button in Root',
      },
      $dashboard: {
        rect: {
          x: 100,
          y: 100,
          width: 50,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button in Root with hidden',
      },
      hidden: true,
      $dashboard: {
        rect: {
          x: 1000,
          y: 100,
          width: 80,
          height: 150,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button in Root with locked',
      },
      locked: true,
      $dashboard: {
        rect: {
          x: 1000,
          y: 200,
          width: 130,
          height: 50,
        },
      },
    },
    {
      componentName: 'Group',
      isGroup: true,
      children: [
        {
          componentName: 'Group',
          isGroup: true,
          children: [
            {
              componentName: 'Button',
              props: {
                type: 'primary',
                text: 'Button in Group2',
              },
              $dashboard: {
                rect: {
                  x: 400,
                  y: 400,
                  width: 50,
                  height: 50,
                },
              },
            },
            {
              componentName: 'Button',
              props: {
                type: 'primary',
                text: 'Button2 in Group2',
              },
              $dashboard: {
                rect: {
                  x: 200,
                  y: 200,
                  width: 70,
                  height: 70,
                },
              },
            },
          ],
        },
        {
          componentName: 'Button',
          props: {
            type: 'primary',
            text: 'Hidden Button in Group',
          },
          $dashboard: {
            rect: {
              x: 300,
              y: 20,
              width: 60,
              height: 50,
            },
          },
          isHidden: true,
        },
        {
          componentName: 'Button',
          props: {
            type: 'primary',
            text: 'Locked Button in Group',
          },
          $dashboard: {
            rect: {
              x: 300,
              y: 300,
              width: 50,
              height: 50,
            },
          },
          isLocked: true,
        },
      ],
    },
  ],
}
