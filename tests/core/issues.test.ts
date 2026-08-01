import { describe, expect, it } from 'vitest'
import { maxSeverity, stateOnAbsence, stateOnDetection } from '../../src/core/ledger/issues.js'

describe('stateOnDetection', () => {
  it('keeps an open issue open', () => {
    expect(stateOnDetection('open')).toBe('open')
  })

  it('keeps an acknowledged issue acknowledged', () => {
    expect(stateOnDetection('acknowledged')).toBe('acknowledged')
  })

  it('keeps a wontfix issue suppressed', () => {
    expect(stateOnDetection('wontfix')).toBe('wontfix')
  })

  it('reopens a fixed issue', () => {
    expect(stateOnDetection('fixed')).toBe('open')
  })
})

describe('stateOnAbsence', () => {
  it('closes an open issue', () => {
    expect(stateOnAbsence('open')).toBe('fixed')
  })

  it('closes an acknowledged issue', () => {
    expect(stateOnAbsence('acknowledged')).toBe('fixed')
  })

  it('never closes a wontfix issue', () => {
    expect(stateOnAbsence('wontfix')).toBeNull()
  })

  it('leaves an already fixed issue alone', () => {
    expect(stateOnAbsence('fixed')).toBeNull()
  })
})

describe('maxSeverity', () => {
  it('keeps the stronger of two severities', () => {
    expect(maxSeverity('low', 'high')).toBe('high')
    expect(maxSeverity('critical', 'info')).toBe('critical')
    expect(maxSeverity('medium', 'medium')).toBe('medium')
  })
})
