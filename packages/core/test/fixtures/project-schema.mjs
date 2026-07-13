export function createProjectSchema(overrides = {}) {
  const root = {
    docId: 'page-1',
    id: 'root',
    componentName: 'Page',
    props: { title: 'before' },
    children: [],
  }

  return {
    id: 'project-1',
    version: '0.0.1',
    componentsMap: [],
    componentsTree: [root],
    ...structuredClone(overrides),
  }
}

export function createExecutableSchema() {
  const schema = createProjectSchema()
  schema.componentsTree[0].props = {
    safe: {
      nested: {
        handler: {
          type: 'JSFunction',
          value: 'function () { return globalThis.secret }',
        },
      },
    },
  }
  return schema
}

export function createLoadedResource(name = 'example-material') {
  return {
    type: 'material',
    name,
    version: '1.0.0',
    globalName: 'ExampleMaterial',
    data: { name },
    loadedAt: 1,
  }
}
