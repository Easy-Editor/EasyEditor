import { Designer, Hotkey, Materials, Setters } from '@easy-editor/core'
import { Editor } from './editor'

const editor = new Editor()

const designer = new Designer({ editor })
const { project } = designer

const hotkey = new Hotkey()
const setters = new Setters()
const material = new Materials(editor)

editor.set('designer', designer)
editor.set('project', project)
editor.set('setters', setters)
editor.set('materials', material)
editor.set('hotkey', hotkey)
