import Root from './root/meta'

import DashboardIcon from './inner/dashboard-icon/meta'
// Inner
import DashboardScene from './inner/dashboard-scene/meta'
import DateTime from './inner/date-time/meta'
import Div from './inner/div/meta'
import GeneratedMaterialHost from './inner/generated-material-host/meta'
import GlobeScene from './inner/globe-scene/meta'
import Group from './inner/group/meta'
import LowAltitudeDashboard from './inner/low-altitude-dashboard/meta'
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

/**
 * 物料元数据
 */
export const componentMetaMap = {
  AreaChart,
  BarChart,
  Image,
  LineChart,
  PieChart,
  RadarChart,
  RadialChart,
  Root,
  Text,
  DateTime,
  DashboardIcon,
  Div,
  GeneratedMaterialHost,
  GlobeScene,
  DashboardScene,
  LowAltitudeDashboard,
}
