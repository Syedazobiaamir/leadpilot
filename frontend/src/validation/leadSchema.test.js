import { describe, expect, it } from 'vitest'
import { validateLead } from './leadSchema.js'

const validLead = {
  name: 'Maria Gonzalez',
  phone: '(512) 555-0147',
  email: 'Maria@Example.com ',
  zip: '78701',
  serviceType: 'Roofing',
  timeline: 'ASAP',
  message: 'Storm damage on the roof, need inspection.',
}

describe('validateLead', () => {
  it('accepts a valid lead and cleans the data', () => {
    const result = validateLead(validLead)
    expect(result.success).toBe(true)
    expect(result.data.email).toBe('maria@example.com') // trimmed + lowercased
  })

  it.each(['5125550147', '512-555-0147', '+1 512 555 0147', '512.555.0147'])(
    'accepts US phone format %s',
    (phone) => {
      expect(validateLead({ ...validLead, phone }).success).toBe(true)
    },
  )

  it('rejects a missing phone number', () => {
    const result = validateLead({ ...validLead, phone: '' })
    expect(result.success).toBe(false)
    expect(result.errors.phone).toMatch(/valid US phone/)
  })

  it('rejects an invalid email', () => {
    const result = validateLead({ ...validLead, email: 'not-an-email' })
    expect(result.errors.email).toBe('Enter a valid email address')
  })

  it.each(['9021', 'ABCDE', '787011'])('rejects invalid ZIP %s', (zip) => {
    expect(validateLead({ ...validLead, zip }).errors.zip).toMatch(/ZIP/)
  })

  it('accepts ZIP+4 format', () => {
    expect(validateLead({ ...validLead, zip: '78701-1234' }).success).toBe(true)
  })

  it('rejects an unknown service type', () => {
    expect(validateLead({ ...validLead, serviceType: 'Pool cleaning' }).errors.serviceType).toBe(
      'Choose a service type',
    )
  })

  it('reports every invalid field on an empty form', () => {
    const result = validateLead({})
    expect(Object.keys(result.errors).sort()).toEqual(
      ['email', 'message', 'name', 'phone', 'serviceType', 'timeline', 'zip'].sort(),
    )
  })
})
