import Root from './root/meta'

// Inner
import Group from './inner/group/meta'
export { Group }

// Basic
import Image from './basic/image/meta'
import Text from './basic/text/meta'

// Chart
import AreaChart from './chart/area-chart/meta'
import BarChart from './chart/bar-chart/meta'
import LineChart from './chart/line-chart/meta'
import PieChart from './chart/pie-chart/meta'
import RadarChart from './chart/radar-chart/meta'
import RadialChart from './chart/radial-chart/meta'

// Interaction
import Button from './interaction/button/meta'

/**
 * 物料元数据
 */
export const componentMetaMap = {
  AreaChart,
  BarChart,
  Button,
  Image,
  LineChart,
  PieChart,
  RadarChart,
  RadialChart,
  Root,
  Text,
}
