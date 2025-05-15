# @easy-editor/plugin-hotkey

Hotkey plugin for EasyEditor.

## Default Hotkeys

| Action | Shortcut |
|--------|----------|
| Undo | ⌘ + Z / Ctrl + Z |
| Redo | ⌘ + Y / Ctrl + Y |
| Lock/Unlock | ⌘ + Shift + L / Ctrl + Shift + L |
| Show/Hide | ⌘ + Shift + H / Ctrl + Shift + H |
| Copy | ⌘ + C / Ctrl + C |
| Paste | ⌘ + V / Ctrl + V |
| Cut | ⌘ + X / Ctrl + X |
| Delete | Backspace / Delete |
| Clear Selection | Esc |

## Customizing Hotkeys

The HotkeyPlugin now supports customizing hotkeys. You can modify the key combinations or disable specific hotkeys entirely.

### Example Usage

```typescript
import { HotkeyPlugin } from '@easy-editor/plugin-hotkey';

HotkeyPlugin({
  config: {
    // Change the "undo" shortcut to only use Alt+Z
    HISTORY_UNDO: {
      keys: ['alt+z']
    },
    // Disable the "show/hide" shortcut
    SHOW_HIDE: false,
    // Customize "delete" to use only the Delete key
    DELETE: {
      keys: ['del']
    },
    // Explicitly enable a shortcut (default is enabled)
    COPY: true
  }
})
```

### Configuration Options

The configuration object accepts the following hotkey actions (all lowercase):

- `HISTORY_UNDO` - Undo last action
- `HISTORY_REDO` - Redo last undone action
- `LOCK_UNLOCK` - Lock or unlock selected elements
- `SHOW_HIDE` - Show or hide selected elements
- `COPY` - Copy selected elements
- `PASTE` - Paste copied elements
- `CUT` - Cut selected elements
- `DELETE` - Delete selected elements
- `CLEAR_SELECTION` - Clear the current selection

For each action, you can provide:

- A boolean value: `true` to enable (default), `false` to disable
- Or an object with:
  - `enabled` (boolean, optional) - Set to `false` to disable the hotkey, defaults to `true`
  - `keys` (string[]) - Array of key combinations to use (replaces default keys)

### Key Combination Format

Key combinations should be specified in the format:

- Modifier keys: `ctrl`, `alt`, `shift`, `command` (or `meta`)
- Regular keys: letter keys (a-z), number keys (0-9), special keys (`esc`, `del`, `backspace`, etc.)
- Combined with `+` symbol, e.g., `ctrl+s` or `command+shift+z`

