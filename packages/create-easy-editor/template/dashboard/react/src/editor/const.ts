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
    {
      componentName: 'Image',
      $dashboard: {
        rect: {
          x: 600,
          y: 480,
          width: 740,
          height: 120,
        },
      },
    },
  ],
  state: {
    testState: {
      type: 'JSExpression',
      value: '"testState"',
      description: '文本状态',
    },
    isShow: {
      type: 'JSExpression',
      value: 'true',
      description: '是否显示',
    },
  },
  lifeCycles: {
    componentDidMount: {
      type: 'JSFunction',
      value:
        "function componentDidMount() {\n  console.log('did mount ===========', this);\n  setInterval(() => {\n  this.toggleState();\n  }, 1000);\n}",
      description: '页面挂载时触发',
    },
    componentWillUnmount: {
      type: 'JSFunction',
      value: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
      description: '页面卸载时触发',
    },
  },
  methods: {
    testFunc: {
      type: 'JSFunction',
      value: "function testFunc(...params) {\n  console.log('test func', params, this);\n}",
      description: '测试方法',
    },
    toggleState: {
      type: 'JSFunction',
      value: 'function toggleState() {\n  this.setState({isShow: !this.state.isShow});\n}',
      description: '切换状态',
    },
  },
}

export const _defaultRootSchema: RootSchema = {
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
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button in Root',
        textDirection: 'horizontal',
        variant: 'default',
        loading: false,
        horizontalAlign: 'center',
        verticalAlign: 'center',
        radius: 6,
        text: {
          fontFamily: 'Arial',
          fontSize: 16,
          color: '#000000',
          fontWeight: false,
          fontStyle: false,
          letterSpacing: 0,
          lineHeight: 18,
        },
        background: {
          // color: 'transparent',
        },
        border: {
          color: '#000000',
          width: 0,
          type: 'solid',
        },
        icon: {
          enable: false,
          size: 16,
        },
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
          value: 'function(){return this.testFunc.apply(this,Array.prototype.slice.call(arguments).concat([])) }',
        },
      },
      $dashboard: {
        rect: {
          x: 100,
          y: 100,
          width: 150,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button in Root with hidden',
      },
      hidden: true,
      $dashboard: {
        rect: {
          x: 1000,
          y: 100,
          width: 180,
          height: 150,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button in Root with locked',
      },
      locked: true,
      $dashboard: {
        rect: {
          x: 1000,
          y: 200,
          width: 230,
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
                content: 'Button in Group2',
              },
              $dashboard: {
                rect: {
                  x: 400,
                  y: 400,
                  width: 150,
                  height: 50,
                },
              },
            },
            {
              componentName: 'Button',
              props: {
                type: 'primary',
                content: 'Button2 in Group2',
              },
              $dashboard: {
                rect: {
                  x: 200,
                  y: 200,
                  width: 170,
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
            content: 'Hidden Button in Group',
          },
          $dashboard: {
            rect: {
              x: 300,
              y: 20,
              width: 160,
              height: 50,
            },
          },
          isHidden: true,
        },
        {
          componentName: 'Button',
          props: {
            type: 'primary',
            content: 'Locked Button in Group',
          },
          $dashboard: {
            rect: {
              x: 300,
              y: 300,
              width: 150,
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
        content: {
          type: 'JSExpression',
          value: 'this.state.text',
          mock: 'Button with state',
        },
      },
      $dashboard: {
        rect: {
          x: 500,
          y: 500,
          width: 150,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button with event',
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
          width: 150,
          height: 30,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button with Condition',
      },
      $dashboard: {
        rect: {
          x: 800,
          y: 600,
          width: 150,
          height: 30,
        },
      },
      condition: false,
    },
    {
      componentName: 'Button',
      props: {
        type: 'primary',
        content: 'Button with Loop',
      },
      $dashboard: {
        rect: {
          x: 700,
          y: 600,
          width: 150,
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
    //     content: { error: 'error' },
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
        content: 'Button with className',
        className: 'button test',
      },
      $dashboard: {
        rect: {
          x: 700,
          y: 700,
          width: 150,
          height: 30,
        },
      },
    },
  ],
  dataSource: {
    list: [
      {
        type: 'fetch',
        isInit: true,
        options: {
          params: {},
          method: 'GET',
          isCors: true,
          timeout: 5000,
          headers: {},
          uri: 'mock/info.json',
        },
        id: 'info',
        shouldFetch: {
          type: 'JSFunction',
          value: "function() { \n  console.log('should fetch.....');\n  return true; \n}",
        },
      },
    ],
  },
  state: {
    text: {
      type: 'JSExpression',
      value: '"outer"',
      description: '文本状态',
    },
    isShowDialog: {
      type: 'JSExpression',
      value: 'false',
      description: '是否显示对话框',
    },
  },
  css: 'body {\n  font-size: 12px;\n}\n\n.button {\n  color: #ff00ff\n}',
  lifeCycles: {
    componentDidMount: {
      type: 'JSFunction',
      value:
        "function componentDidMount() {\n  console.log('did mount ===========', this);\n  console.log(this.state.text, this.testFunc() );\n}",
      source: "function componentDidMount() {\n  console.log('did mount');\n}",
      description: '页面挂载时触发',
    },
    componentWillUnmount: {
      type: 'JSFunction',
      value: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
      source: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
      description: '页面卸载时触发',
    },
  },
  methods: {
    testFunc: {
      type: 'JSFunction',
      value: "function testFunc(...params) {\n  console.log('test func', params);\n}",
      source: "function testFunc(...params) {\n  console.log('test func', params);\n}",
      description: '测试方法',
    },
    changeState: {
      type: 'JSFunction',
      value: "function changeState() {\n  this.setState({text: 'inner'});\n}",
      source: "function changeState() {\n  this.setState({text: 'inner'});\n}",
      description: '改变状态',
    },
  },
}
