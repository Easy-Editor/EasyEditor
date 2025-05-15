# @easy-editor/plugin-datasource

DataSource plugin for EasyEditor. This plugin provides data fetching and management capabilities for connecting your editor components to external data sources via API requests and custom handlers.

## Features

### Data Source Management

The plugin enables easy management of data sources with features like:

- Multiple request types (fetch, custom)
- Synchronous and asynchronous data loading
- Request parameters handling
- Headers and timeout configuration
- Data transformation with handlers

### Runtime Data States

Manage the lifecycle of your data with built-in state tracking:

| State | Description |
|-------|-------------|
| `Initial` | Data source is initialized but not yet loaded |
| `Loading` | Data is currently being fetched |
| `Loaded` | Data has been successfully loaded |
| `Error` | An error occurred during data fetching |

### Custom Data Handlers

Transform and process fetched data with customizable handlers:

- Process API responses before using in your components
- Handle errors with custom error handlers
- Implement pre-fetch logic with willFetch handlers
- Control fetching conditions with shouldFetch handlers

## Usage Example

```typescript
import DataSourcePlugin from '@easy-editor/plugin-datasource';

// Initialize the plugin with default configuration
const plugin = DataSourcePlugin();

// Or with custom request handlers
const customPlugin = DataSourcePlugin({
  requestHandlersMap: {
    // Override default fetch handler
    fetch: (options) => {
      // Custom fetch implementation
      return customFetchFunction(options);
    },
    // Add a custom GraphQL handler
    graphql: (options) => {
      return graphqlClient.request(options.uri, options.params);
    }
  },
  // Add a default data handler for all requests
  defaultDataHandler: (response) => {
    // Transform all responses
    return response.data.results;
  }
});
```

## Runtime Example

Using data sources:

```typescript
// Define your data sources
const dataSources = {
  list: [
    {
      id: 'userList',
      type: 'fetch',
      isInit: true, // Load on initialization
      options: () => ({
        uri: 'https://api.example.com/users',
        method: 'GET',
        params: {
          page: 1,
          limit: 10
        }
      }),
      dataHandler: (response) => {
        return response.data.users;
      }
    },
    {
      id: 'productData',
      type: 'fetch',
      isInit: false, // Load on demand
      options: () => ({
        uri: 'https://api.example.com/products',
        method: 'GET'
      })
    }
  ]
};
```

## Configuration Options

The plugin accepts a configuration object with the following properties:

### Request Handlers Map

```typescript
{
  requestHandlersMap?: {
    [key: string]: (
      options: RuntimeOptionsConfig,
      context?: IDataSourceRuntimeContext
    ) => Promise<any>
  }
}
```

By default, the plugin includes a `fetch` handler that uses the `universal-request` library.

### Default Data Handler

```typescript
{
  defaultDataHandler?: (
    response: { data: any, [key: string]: any }
  ) => Promise<any>
}
```

## API

### Data Source Configuration

Each data source can be configured with:

- `id`: Unique identifier for the data source
- `type`: Request type (fetch, custom, etc.)
- `isInit`: Whether to load data on initialization
- `isSync`: Whether data loading is synchronous
- `options`: Function returning request configuration
- `willFetch`: Pre-fetch handler for modifying request options
- `shouldFetch`: Condition function determining if fetch should occur
- `dataHandler`: Function to process successful responses
- `errorHandler`: Function to handle errors

### Data Source Methods

Each runtime data source provides:

- `load(params?)`: Load or reload data, optionally with new parameters
- `status`: Current status (initial, loading, loaded, error)
- `data`: The loaded data (when available)
- `error`: Error information (when an error occurs)
- `isLoading`: Boolean indicator for loading state
