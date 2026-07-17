import ColorSetter from './basic/color-setter'
import NodeIdSetter from './basic/id-setter'
import JsonSetter from './basic/json-setter'
import NumberSetter from './basic/number-setter'
import RectSetter from './basic/rect-setter'
import StringSetter from './basic/string-setter'
import SwitchSetter from './basic/switch-setter'
import UploadSetter from './basic/upload-setter'

import CollapseSetter from './group/collapse-setter'
import TabSetter from './group/tab-setter'

/**
 * 本地设置器
 */
export const setterMap = {
  CollapseSetter,
  ColorSetter,
  JsonSetter,
  NodeIdSetter,
  NumberSetter,
  RectSetter,
  StringSetter,
  SwitchSetter,
  TabSetter,
  UploadSetter,
}

export * from './custom-field-item'
