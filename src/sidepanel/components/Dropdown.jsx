import { useMemo } from 'react'
import './Dropdown.css'

function normalizeOption(option) {
  if (typeof option === 'string') {
    return { value: option, label: option }
  }

  return {
    value: option.value,
    label: option.label,
  }
}

function Dropdown({ label, value, options, onChange, placeholder, disabled }) {
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options])

  const handleChange = (event) => {
    if (onChange) {
      onChange(event.target.value)
    }
  }

  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={handleChange} aria-label={label} disabled={disabled}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default Dropdown
