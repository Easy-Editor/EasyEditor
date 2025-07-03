import type { FC } from 'react'

export interface FormContainerProps {
  children?: React.ReactNode
  className?: string
  onSubmit?: (data: any) => void
}

const FormContainer: FC<FormContainerProps> = ({ children, className = '', onSubmit }) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSubmit) {
      const formData = new FormData(e.target as HTMLFormElement)
      const data = Object.fromEntries(formData.entries())
      onSubmit(data)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 p-4 ${className}`}>
      {children}
    </form>
  )
}

export default FormContainer
