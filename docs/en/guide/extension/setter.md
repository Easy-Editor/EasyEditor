---
title: Setter Extension
description: Developing custom setters for EasyEditor
---

# Custom Property Setters

Property setters (Setters) are interactive controls used in EasyEditor to edit component properties. This guide will help you understand how to create custom property setters to meet specific editing needs.

## Overview

A Setter is a special component that provides a visual editing interface for specific types of properties in the designer. EasyEditor comes with a series of built-in basic Setters, such as text input, number input, color picker, etc. However, in certain scenarios, you may need to create custom Setters to provide more professional or convenient editing experiences.

The main responsibilities of a Setter include:

- Displaying current property values
- Providing interactive interfaces to modify property values
- Validating input validity
- Converting data formats
- Providing a friendly user experience

## Directory Structure

A complete Setter project typically contains the following file structure:

```bash
my-setter/
├── index.tsx       # Setter component implementation
```

## Usage

### Basic Setter Component (index.tsx)

A basic Setter component needs to implement the `SetterProps` interface:

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

export interface CustomSetterProps extends SetterProps {
  // Custom properties
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
}

const CustomSetter: React.FC<CustomSetterProps> = (props) => {
  const { value, onChange, placeholder, options = [] } = props;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <select
      value={value}
      onChange={handleChange}
      className="w-full px-2 py-1 border rounded"
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default CustomSetter;
```

### Composite Property Setter (index.tsx)

For composite properties containing multiple sub-properties, such as margins, positioning, etc., you can create composite Setters:

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

interface MarginValue {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface MarginSetterProps extends SetterProps<MarginValue> {
  units?: string[];
  defaultUnit?: string;
}

const MarginSetter: React.FC<MarginSetterProps> = (props) => {
  const { value = {}, onChange, units = ['px', '%', 'rem'], defaultUnit = 'px' } = props;
  const [selectedUnit, setSelectedUnit] = React.useState(defaultUnit);

  const handleChange = (key: keyof MarginValue, val: string) => {
    const numValue = parseFloat(val);
    onChange({
      ...value,
      [key]: isNaN(numValue) ? undefined : numValue,
    });
  };

  const handleUnitChange = (unit: string) => {
    setSelectedUnit(unit);
    // Unit conversion logic can be implemented here
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center">
        <label className="text-xs mr-2">Top:</label>
        <input
          type="number"
          value={value.top ?? ''}
          onChange={(e) => handleChange('top', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">Right:</label>
        <input
          type="number"
          value={value.right ?? ''}
          onChange={(e) => handleChange('right', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">Bottom:</label>
        <input
          type="number"
          value={value.bottom ?? ''}
          onChange={(e) => handleChange('bottom', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="flex items-center">
        <label className="text-xs mr-2">Left:</label>
        <input
          type="number"
          value={value.left ?? ''}
          onChange={(e) => handleChange('left', e.target.value)}
          className="w-full px-2 py-1 border rounded"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <select
          value={selectedUnit}
          onChange={(e) => handleUnitChange(e.target.value)}
          className="text-xs px-1 border rounded"
        >
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default MarginSetter;
```

### Third-Party Library Integration Setter

Sometimes we need to integrate third-party libraries to provide more professional editing experiences, such as color pickers, date pickers, etc.:

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'
import { SketchPicker } from 'react-color'

interface ColorSetterProps extends SetterProps<string> {
  presetColors?: string[];
  showAlpha?: boolean;
}

const ColorSetter: React.FC<ColorSetterProps> = (props) => {
  const { value = '#000000', onChange, presetColors, showAlpha = true } = props;
  const [isOpen, setIsOpen] = React.useState(false);

  const handleClick = () => {
    setIsOpen(!isOpen);
  };

  const handleChange = (color: any) => {
    onChange(color.hex);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <div
        className="w-full h-8 rounded cursor-pointer border flex items-center px-2"
        style={{ backgroundColor: value }}
        onClick={handleClick}
      >
        <span className="text-xs text-white shadow-sm">{value}</span>
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1">
          <div className="fixed inset-0" onClick={handleClose} />
          <SketchPicker
            color={value}
            onChange={handleChange}
            presetColors={presetColors}
            disableAlpha={!showAlpha}
          />
        </div>
      )}
    </div>
  );
};

export default ColorSetter;
```

### Advanced Event Setter

Setters can access the designer, document, and nodes to implement more complex functionality, such as event binding:

```tsx
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JSFunction, SetterProps } from '@easy-editor/core'
import { Settings, Trash } from 'lucide-react'
import { useState } from 'react'

interface EventData {
  type: string
  name: string
  relatedEventName: string
  paramStr?: string
}

export interface Event {
  eventDataList?: EventData[]
  eventList?: Array<{
    name: string
    description?: string
    disabled?: boolean
  }>
}

interface EventSetterProps extends SetterProps<Event> {
  events: Array<{
    title: string
    children: Array<{
      label: string
      value: string
      description?: string
    }>
  }>
  field: any // SettingField type
}

const EventSetter = (props: EventSetterProps) => {
  const { value, onChange, events, field } = props

  // Access designer, document, and nodes through field
  const methods = field.designer?.currentDocument?.rootNode?.getExtraPropValue('methods') as Record<string, JSFunction>

  // Other state and methods
  const [openKey, setOpenKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [eventName, setEventName] = useState<string | undefined>(undefined)
  const [editEventName, setEditEventName] = useState<string | undefined>(undefined)

  const handleValueChange = (value: string) => {
    setOpenKey(prev => prev + 1)
    setOpen(true)
    setEventName(value)
  }

  const handleAddEvent = (eventName: string, method: string, params?: string) => {
    if (!eventName) return

    const newEventData: EventData = {
      type: 'method',
      name: eventName,
      relatedEventName: method,
    }

    if (params) {
      newEventData.paramStr = params
    }

    // Edit existing event
    if (editEventName) {
      onChange?.({
        ...value,
        eventDataList: value?.eventDataList?.map(item =>
          item.name === editEventName ? newEventData : item
        ),
      })
      setEditEventName(undefined)
    }
    // Add new event
    else {
      onChange?.({
        eventDataList: [...(value?.eventDataList || []), newEventData],
        eventList: [...(value?.eventList || []), { name: newEventData.name }],
      })
    }
  }

  const handleDeleteEvent = (eventData: EventData) => {
    onChange?.({
      eventDataList: value?.eventDataList?.filter(item => item.name !== eventData.name),
      eventList: value?.eventList?.filter(item => item.name !== eventData.name),
    })
  }

  return (
    <div className="flex flex-col space-y-4">
      {/* Event selection */}
      <div className="flex flex-col w-full">
        {events.map((event, index) => (
          <Select key={`${event.title}-${openKey}-${index}`} value={undefined} onValueChange={handleValueChange}>
            <SelectTrigger className="w-full justify-center text-xs">
              <SelectValue placeholder={event.title} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {event.children.map(child => (
                  <SelectItem
                    key={child.value}
                    value={child.value}
                    disabled={value?.eventDataList?.some(item => item.name === child.value)}
                    className="flex justify-between"
                  >
                    <span>{child.label}</span>
                    <span className="text-xs text-gray-500">{child.description}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>

      {/* Event list */}
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[220px] text-xs">Existing Events</TableHead>
            <TableHead className="text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value?.eventDataList?.map(eventData => (
            <TableRow key={eventData.name}>
              <TableCell className="font-medium text-xs">
                {eventData.name}
                <span className="px-2">-</span>
                <Button variant="link" className="text-xs px-0 py-0 h-0">
                  {eventData.relatedEventName}
                </Button>
              </TableCell>
              <TableCell className="flex gap-2">
                <Settings
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => {
                    setOpen(true)
                    setEventName(eventData.name)
                    setEditEventName(eventData.name)
                  }}
                />
                <Trash
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => handleDeleteEvent(eventData)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Event editing dialog would be here */}
    </div>
  )
}

export default EventSetter
```

## Register Setter

After creating the Setter component, you need to register it with EasyEditor:

```typescript
import { createEditor } from '@easy-editor/core'
import CustomSetter from './path/to/CustomSetter'
import MarginSetter from './path/to/MarginSetter'
import ColorSetter from './path/to/ColorSetter'
import EventSetter from './path/to/EventSetter'

// Register when creating editor instance
const editor = createEditor({
  // ...other configurations
  setters: {
    // Register custom setters
    CustomSetter,
    MarginSetter,
    ColorSetter,
    EventSetter
  }
})
```

## Using in Materials

In the component's property configuration, you can specify the `setter` field to use custom Setters:

```typescript
import type { Configure } from '@easy-editor/core'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: 'Basic',
      setter: 'GroupSetter',
      items: [
        {
          type: 'field',
          name: 'type',
          title: 'Button Type',
          setter: 'CustomSetter',  // Use custom Setter
          extraProps: {
            placeholder: 'Please select button type',
            options: [
              { label: 'Primary Button', value: 'primary' },
              { label: 'Secondary Button', value: 'secondary' },
              { label: 'Text Button', value: 'text' },
            ],
          }
        },
        {
          type: 'field',
          name: 'margin',
          title: 'Margin',
          setter: 'MarginSetter',  // Use custom composite Setter
          extraProps: {
            units: ['px', 'rem', 'em'],
            defaultUnit: 'px'
          }
        },
        {
          type: 'field',
          name: 'backgroundColor',
          title: 'Background Color',
          setter: 'ColorSetter',  // Use custom color Setter
          extraProps: {
            presetColors: ['#FF5630', '#00B8D9', '#36B37E', '#6554C0', '#FFAB00'],
            showAlpha: true
          }
        }
      ]
    },
    {
      type: 'group',
      title: 'Event Settings',
      setter: 'CollapseSetter',
      items: [
        {
          name: '__events',
          title: 'Click Event Binding',
          setter: {
            componentName: 'EventSetter',  // Use event setter
            props: {
              events: [
                {
                  title: 'Component Built-in Events',
                  children: [
                    {
                      label: 'onClick',
                      value: 'onClick',
                      description: 'Click event',
                    },
                  ],
                },
              ],
            }
          },
          extraProps: {
            // Advanced data transformation and processing through setValue
            setValue(target, value, oldValue) {
              const { eventDataList } = value
              const { eventList: oldEventList } = oldValue

              // Delete old events
              Array.isArray(oldEventList) &&
                oldEventList.map(item => {
                  target.parent.clearPropValue(item.name)
                  return item
                })

              // Re-add new events
              Array.isArray(eventDataList) &&
                eventDataList.map(item => {
                  target.parent.setPropValue(item.name, {
                    type: 'JSFunction',
                    value: `function(){return this.${
                      item.relatedEventName
                    }.apply(this,Array.prototype.slice.call(arguments).concat([${item.paramStr ? item.paramStr : ''}])) }`,
                  })
                  return item
                })
            }
          }
        }
      ]
    }
  ]
}

export default configure
```

## Interaction with Designer

### Using field Property

Setter components can access designer context through the `field` property, including current document, selected nodes, and other information:

```tsx
import React from 'react'
import type { SetterProps } from '@easy-editor/core'

const AdvancedSetter: React.FC<SetterProps> = (props) => {
  const { value, onChange, field } = props;

  // Get currently selected node
  const selectedNode = field.getNode();

  // Get current document
  const currentDocument = field.designer?.currentDocument;

  // Get component metadata
  const componentMeta = selectedNode && currentDocument?.getComponentMeta(selectedNode.componentName);

  // Access other properties
  const otherPropValue = field.parent.getPropValue('otherProp');

  return (
    <div>
      <div>Current Component: {selectedNode?.componentName}</div>
      <div>
        <button onClick={() => onChange(value + 1)}>
          Increase Value
        </button>
      </div>
    </div>
  );
};

export default AdvancedSetter;
```

### Using extraProps

Through the `setValue` and `getValue` methods in `extraProps`, you can perform special processing before and after value changes:

```typescript
{
  name: 'complexProp',
  title: 'Complex Property',
  setter: 'CustomSetter',
  extraProps: {
    // Convert raw data to setter-usable format
    getValue(target, fieldValue) {
      // Extract needed parts from raw data
      return fieldValue?.someNestedValue || '';
    },

    // Convert setter output value to component-needed format
    setValue(target, value, oldValue) {
      // Update other related properties
      if (value === 'special') {
        target.parent.setPropValue('relatedProp', true);
      }

      // Return processed value
      return {
        someNestedValue: value,
        timestamp: Date.now()
      };
    }
  }
}
```

### Accessing Document and Global Data

Setters can access document root nodes and global data through `field`:

```tsx
const CustomSetter = (props: SetterProps) => {
  const { field } = props;

  // Get global variables
  const globalVariables = field.designer?.currentDocument?.rootNode?.getExtraPropValue('variables');

  // Get global methods
  const globalMethods = field.designer?.currentDocument?.rootNode?.getExtraPropValue('methods');

  // Use global data to render options
  return (
    <select>
      {Object.keys(globalVariables || {}).map(key => (
        <option key={key} value={key}>
          {key}: {globalVariables[key]}
        </option>
      ))}
    </select>
  );
};
```
