import type { RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  fileName: 'home',
  componentName: 'RootContainer',
  props: {
    backgroundColor: '#ffffff',
    className: 'page test',
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
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: {
          type: 'JSExpression',
          value: 'this.state.text',
          mock: 'Button with state',
        },
      },
      $dashboard: {
        rect: {
          x: 500,
          y: 500,
          width: 50,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button with event',
        __events: {
          eventDataList: [
            {
              type: 'componentEvent',
              name: 'onClick',
              relatedEventName: 'testFunc',
            },
          ],
          eventList: [
            {
              name: 'onClick',
              description: '鼠标点击',
              disabled: true,
            },
          ],
        },
        onClick: {
          type: 'JSFunction',
          value: 'function(){return this.changeState.apply(this,Array.prototype.slice.call(arguments).concat([])) }',
        },
      },
      $dashboard: {
        rect: {
          x: 400,
          y: 500,
          width: 50,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button with Condition',
      },
      $dashboard: {
        rect: {
          x: 800,
          y: 600,
          width: 50,
          height: 30,
        },
      },
      condition: false,
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button with Loop',
      },
      $dashboard: {
        rect: {
          x: 700,
          y: 600,
          width: 50,
          height: 30,
        },
      },
      loop: [1, 2, 3, 4, 5],
      loopArgs: [null, null],
    },
    // {
    //   componentName: 'Button',
    //   props: {
    //     type: 'primary',
    //     text: { error: 'error' },
    //   },
    //   $dashboard: {
    //     rect: {
    //       x: 700,
    //       y: 600,
    //       width: 50,
    //       height: 30,
    //     },
    //   },
    // },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        text: 'Button with className',
        className: 'button test',
      },
      $dashboard: {
        rect: {
          x: 700,
          y: 600,
          width: 50,
          height: 30,
        },
      },
    },
  ],
  dataSource: {
    list: [
      // {
      //   id: 'urlParams',
      //   type: 'urlParams',
      // },
      {
        id: 'sentences',
        type: 'fetch',
        options: {
          method: 'GET',
          uri: 'https://api.apiopen.top/api/sentences',
          isSync: true,
        },
        dataHandler: {
          type: 'JSExpression',
          value:
            'function (response) {\nif (response.data.code !== 200){\n    throw new Error(response.data.message);\n  }\n  return response.data.result;\n}',
        },
      },
      {
        id: 'miniVideo',
        type: 'fetch',
        options: {
          method: 'GET',
          uri: 'https://api.apiopen.top/api/getMiniVideo?page=0&size=10',
          isSync: true,
        },
        dataHandler: {
          type: 'JSExpression',
          value:
            'function (response) {\nif (response.data.code !== 200){\n    throw new Error(response.data.message);\n  }\n  return response.data.result;\n}',
        },
      },
    ],
    dataHandler: {
      type: 'JSExpression',
      value: 'function (dataMap) {\n  console.info("All datasources loaded:", dataMap);\n}',
    },
  },
  state: {
    text: {
      type: 'JSExpression',
      value: '"outer"',
    },
    isShowDialog: {
      type: 'JSExpression',
      value: 'false',
    },
  },
  css: 'body {\n  font-size: 12px;\n}\n\n.button {\n  width: 100px;\n  color: #ff00ff\n}',
  lifeCycles: {
    componentDidMount: {
      type: 'JSFunction',
      value:
        "function componentDidMount() {\n  console.log('did mount ===========', this);\n  console.log(this.state.text, this.testFunc() );\n}",
      source: "function componentDidMount() {\n  console.log('did mount');\n}",
    },
    componentWillUnmount: {
      type: 'JSFunction',
      value: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
      source: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
    },
  },
  methods: {
    testFunc: {
      type: 'JSFunction',
      value: "function testFunc() {\n  console.log('test func');\n}",
      source: "function testFunc() {\n  console.log('test func');\n}",
    },
    changeState: {
      type: 'JSFunction',
      value: "function changeState() {\n  this.setState({text: 'inner'});\n}",
      source: "function changeState() {\n  this.setState({text: 'inner'});\n}",
    },
  },
}
