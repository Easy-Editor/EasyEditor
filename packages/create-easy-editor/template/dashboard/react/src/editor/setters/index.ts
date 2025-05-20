import ColorSetter from './basic/color-setter'
import NodeIdSetter from './basic/id-setter'
import NumberSetter from './basic/number-setter'
import RadioSetter from './basic/radio-setter'
import RectSetter from './basic/rect-setter'
import SelectSetter from './basic/select-setter'
import StringSetter from './basic/string-setter'
import SwitchSetter from './basic/switch-setter'
import ToggleSetter from './basic/toggle-setter'
import UploadSetter from './basic/upload-setter'

import AccordionSetter from './group/accordion-setter'
import CollapseSetter from './group/collapse-setter'
import SubTabSetter from './group/sub-tab-setter'
import TabSetter from './group/tab-setter'
import ToggleGroupSetter from './group/toggle-group-setter'

/**
 * 设置器
 */
export const setterMap = {
  AccordionSetter,
  CollapseSetter,
  ColorSetter,
  NodeIdSetter,
  NumberSetter,
  RadioSetter,
  RectSetter,
  SelectSetter,
  StringSetter,
  SubTabSetter,
  SwitchSetter,
  TabSetter,
  ToggleGroupSetter,
  ToggleSetter,
  UploadSetter,
}

export * from './custom-field-item'
