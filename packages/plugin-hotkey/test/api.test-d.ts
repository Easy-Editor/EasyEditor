import HotkeyPlugin, { type HotkeyConfig } from '../src/index.js'

const config: HotkeyConfig = {
  COPY: { enabled: true, keys: ['meta+c'] },
  PASTE: true,
}
const plugin = HotkeyPlugin({ config })

void plugin
