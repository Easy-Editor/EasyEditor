/**
 * Remote Resource Config
 * 远程资源配置
 */

import type { RemoteMaterialConfig } from './managers/material-manager'
import type { RemoteSetterConfig } from './managers/setter-manager'

/** 远程物料配置列表 */
export const remoteMaterialsConfig: RemoteMaterialConfig[] = [
  // basic
  {
    package: '@easy-editor/materials-dashboard-text',
    version: 'latest',
    globalName: 'EasyEditorMaterialsText',
    enabled: true,
  },
  // // media
  // {
  //   package: '@easy-editor/materials-dashboard-audio',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsAudio',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-filter',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsFilter',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-image',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsImage',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-video',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsVideo',
  //   enabled: true,
  // },
  // // chart
  // {
  //   package: '@easy-editor/materials-dashboard-bar-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsBarChart',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-gauge-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsGaugeChart',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-line-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsLineChart',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-pie-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsPieChart',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-radar-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsRadarChart',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-scatter-chart',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsScatterChart',
  //   enabled: true,
  // },
  // // display
  // {
  //   package: '@easy-editor/materials-dashboard-carousel',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsCarousel',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-number-flip',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsNumberFlip',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-progress',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsProgress',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-scroll-list',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsScrollList',
  //   enabled: true,
  // },
  // // interaction
  // {
  //   package: '@easy-editor/materials-dashboard-button',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsButton',
  //   enabled: true,
  // },
  // // map
  // {
  //   package: '@easy-editor/materials-dashboard-fly-line',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsFlyLine',
  //   enabled: true,
  // },
  // {
  //   package: '@easy-editor/materials-dashboard-geo-map',
  //   version: 'latest',
  //   globalName: 'EasyEditorMaterialsGeoMap',
  //   enabled: true,
  // },
]

/** 远程设置器配置列表 */
export const remoteSettersConfig: RemoteSetterConfig[] = [
  {
    package: '@easy-editor/setters',
    version: 'latest',
    globalName: 'EasyEditorSetters',
    enabled: true,
  },
]
