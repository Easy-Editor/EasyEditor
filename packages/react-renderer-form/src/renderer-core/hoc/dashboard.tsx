import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { classnames } from '@easy-editor/renderer-core'
import { Component } from 'react'

export function formWrapper(Comp: any, { schema, baseRenderer, componentInfo, scope }: ComponentHocInfo) {
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'

  // 获取表单配置信息
  const formConfig = host?.formConfig || {}
  const {
    layout = 'vertical', // vertical | horizontal | inline
    labelCol = { span: 8 },
    wrapperCol = { span: 16 },
    colon = true,
    size = 'middle', // small | middle | large
    validateTrigger = 'onChange',
    showValidationErrors = true,
  } = formConfig

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, __designMode, className, ...rest } = this.props

      // 根节点直接渲染
      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} className={classnames('lc-form-container', className)} {...rest}>
            {children}
          </Comp>
        )
      }

      // 获取表单字段配置
      const formFieldConfig = schema.$form || {}
      const {
        fieldType,
        label,
        name,
        required = false,
        rules = [],
        tooltip,
        hidden = false,
        disabled = false,
        placeholder,
        defaultValue,
        // 布局配置
        labelCol: fieldLabelCol,
        wrapperCol: fieldWrapperCol,
        layout: fieldLayout,
        // 验证配置
        validateTrigger: fieldValidateTrigger,
        // 样式配置
        className: fieldClassName,
        style: fieldStyle,
      } = formFieldConfig

      // 如果字段被隐藏，不渲染
      if (hidden) {
        return null
      }

      // 判断是否是表单字段
      const isFormField = Boolean(fieldType || name)

      // 确定当前字段的布局
      const currentLayout = fieldLayout || layout
      const currentLabelCol = fieldLabelCol || labelCol
      const currentWrapperCol = fieldWrapperCol || wrapperCol
      const currentValidateTrigger = fieldValidateTrigger || validateTrigger

      // 如果不是表单字段，使用普通布局
      if (!isFormField) {
        return (
          <div className={classnames('lc-form-item-wrapper', className)}>
            <Comp ref={forwardRef} {...rest}>
              {children}
            </Comp>
          </div>
        )
      }

      // 表单字段渲染
      const fieldId = name ? `form-field-${name}` : undefined
      const labelElement = label && (
        <label
          htmlFor={fieldId}
          className={classnames(
            'lc-form-item-label',
            required && 'lc-form-item-required',
            currentLayout === 'horizontal' && 'lc-form-item-label-horizontal',
          )}
          style={
            currentLayout === 'horizontal'
              ? {
                  width: `${(currentLabelCol.span / 24) * 100}%`,
                }
              : undefined
          }
        >
          {label}
          {colon && ':'}
          {tooltip && (
            <span className='lc-form-item-tooltip' title={tooltip}>
              ?
            </span>
          )}
        </label>
      )

      const fieldElement = (
        <div
          className={classnames(
            'lc-form-item-control',
            currentLayout === 'horizontal' && 'lc-form-item-control-horizontal',
          )}
          style={
            currentLayout === 'horizontal' && label
              ? {
                  width: `${(currentWrapperCol.span / 24) * 100}%`,
                }
              : undefined
          }
        >
          <Comp
            ref={forwardRef}
            id={fieldId}
            className={classnames('lc-form-field', fieldClassName, className)}
            style={fieldStyle}
            name={name}
            placeholder={placeholder}
            disabled={disabled}
            defaultValue={defaultValue}
            data-field-type={fieldType}
            data-validate-trigger={currentValidateTrigger}
            data-required={required}
            {...rest}
          >
            {children}
          </Comp>
          {/* 验证错误显示区域 */}
          {showValidationErrors && (
            <div className='lc-form-item-error' data-field-name={name}>
              {/* 错误信息将通过 form plugin 动态插入 */}
            </div>
          )}
        </div>
      )

      return (
        <div
          className={classnames(
            'lc-form-item',
            `lc-form-item-${currentLayout}`,
            `lc-form-item-size-${size}`,
            required && 'lc-form-item-required',
            disabled && 'lc-form-item-disabled',
            isDesignMode && 'lc-form-item-design-mode',
          )}
          data-field-name={name}
          data-field-type={fieldType}
        >
          {currentLayout === 'horizontal' ? (
            <>
              {labelElement}
              {fieldElement}
            </>
          ) : (
            <>
              {labelElement}
              {fieldElement}
            </>
          )}
        </div>
      )
    }
  }
  ;(Wrapper as any).displayName = `FormWrapper(${Comp.displayName || Comp.name || 'Component'})`

  return createForwardRefHocElement(Wrapper, Comp)
}

// 向后兼容，保持原有的导出名称
export { formWrapper as dashboardWrapper }
