# @easy-editor/plugin-dashboard

Dashboard plugin for EasyEditor. This plugin provides dashboard functionality for managing elements on a canvas-like editor interface, with features like:

- Element positioning and drag-and-drop
- Grouping and ungrouping elements
- Element layering (move to top, bottom, etc.)
- Guidelines and element alignment
- Visual feedback and layout management

## Features

### Positioning and Movement

The dashboard plugin handles precise positioning of elements on your canvas with:

- Drag-and-drop movement with position tracking
- Automatic alignment guides with element snapping
- Coordinate-based positioning with `x`, `y`, `width`, and `height` properties

### Element Grouping

Easily organize your design by grouping elements together:

| Action | Description |
|--------|-------------|
| Group Elements | Combine multiple elements into a single manageable group |
| Ungroup | Split a group back into individual elements |
| Nested Groups | Support for groups within groups |

### Element Layering

Control the stacking order of elements on your dashboard:

| Method | Description |
|--------|-------------|
| `levelTop()` | Move element to the front |
| `levelBottom()` | Send element to the back |
| `levelUp()` | Move element up one layer |
| `levelDown()` | Move element down one layer |
| `moveToLevel(level)` | Move element to a specific layer |

### Guide Lines

The plugin provides smart guide lines that help with precise element alignment:

- Automatic alignment to element edges and centers
- Configurable guide lines at specific positions
- Visual feedback during element movement

## Usage Example

```typescript
import { DashboardPlugin } from '@easy-editor/plugin-dashboard';

// Define your group component metadata
const groupMeta = {
  componentName: 'Group',
  title: 'Group',
  category: 'inner',
  configure: {
    advanced: {
      view: GroupComponent
    }
  }
};

// Initialize the plugin with required configuration
DashboardPlugin({
  group: {
    meta: groupMeta,
    initSchema: {
      componentName: 'Group',
      title: 'Group',
      isGroup: true,
    },
  }
})
```

## Configuration Options

The plugin accepts a configuration object with the following properties:

### Group Component

The `group` property is required and defines how groups will be handled in the dashboard:

```typescript
{
  group: {
    // Component metadata for the group
    meta: ComponentMetadata;

    // Initial schema for new groups
    initSchema: NodeSchema;
  }
}
```

## API Extensions

The dashboard plugin extends several core interfaces with additional methods:

### Document Extensions

- `document.group(nodeIdList)` - Group multiple nodes together
- `document.ungroup(group)` - Ungroup a group node

### Node Extensions

- `node.isGroup` - Boolean indicating if node is a group
- `node.getDashboardRect()` - Get positioning rectangle
- `node.updateDashboardRect(rect)` - Update positioning
- `node.getNodesInGroup()` - Get direct child nodes in a group
- `node.getAllNodesInGroup()` - Get all nested nodes in a group
- `node.getCurrentGroup()` - Get immediate parent group
- `node.getTopGroup()` - Get top-most parent group
- `node.getAllGroups()` - Get all parent groups

### Designer Extensions

- `designer.guideline` - Access to guidelines functionality
