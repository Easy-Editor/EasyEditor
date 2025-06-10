---
title: Dashboard Design Introduction
description: Introduction to dashboard design with EasyEditor
---

# Introduction

EasyEditor's dashboard design scenario is implemented based on a plugin architecture, providing developers with complete dashboard design capabilities through two core packages: `@easy-editor/plugin-dashboard` and `@easy-editor/react-renderer-dashboard`.

## Core Value

The dashboard design scenario aims to solve the following problems:

1. **Development Efficiency**
   - Quickly build dashboard applications through visual drag-and-drop
   - Built-in rich component library, ready to use
   - Support for component reuse and template management

2. **Technical Barriers**
   - Lower the technical barriers for dashboard development
   - No need to master complex data visualization technologies in depth
   - Provide friendly visual configuration interface

3. **Maintenance Costs**
   - Unified component management mechanism
   - Standardized data access solutions
   - Reusable theme configuration system

## Technical Architecture

The core of the dashboard design scenario is the `@easy-editor/plugin-dashboard` plugin, which extends the basic capabilities of `@easy-editor/core` and provides:

- Dashboard-specific designer logic
- Dashboard component material system
- Dashboard-specific layout system
- Grouping functionality
- ...

### Rendering Engine

`@easy-editor/react-renderer-dashboard` is a React-based dashboard rendering engine that extends the basic capabilities of `@easy-editor/react-renderer` and provides:

- Dashboard-specific layout system
- Multi-page capabilities
- Component enhancement capabilities
- Performance optimization

## Use Cases

The dashboard design scenario is suitable for:

- Data visualization dashboards
- Monitoring centers
- Command centers
- Display dashboards
- Data dashboards

## Best Practices

We provide a complete dashboard design case [EasyDashboard](https://github.com/Easy-Editor/EasyDashboard), demonstrating how to build professional dashboard applications based on EasyEditor. This case includes:

- Complete dashboard design workflow
- Rich component examples
- Data source integration examples
- Theme configuration examples
- Performance optimization practices
