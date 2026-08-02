import { describe, expect, it } from 'vitest'
import { resolveTargetVersion } from '../../src/core/release/version.js'

describe('resolveTargetVersion', () => {
  it('accepts an explicit semver', () => {
    expect(resolveTargetVersion('1.0.0', '2.3.4')).toBe('2.3.4')
  })

  it.each([
    ['major', '2.0.0'],
    ['minor', '1.3.0'],
    ['patch', '1.2.4'],
  ])('applies the %s bump level', (level, expected) => {
    expect(resolveTargetVersion('1.2.3', level)).toBe(expected)
  })

  it('drops a prerelease when bumping, because a bump means a release', () => {
    expect(resolveTargetVersion('1.2.3-rc.1', 'patch')).toBe('1.2.4')
  })

  it('refuses a bump level with no current version', () => {
    expect(() => resolveTargetVersion(null, 'minor')).toThrow('no current version to bump')
  })

  it('accepts an explicit semver with no current version', () => {
    expect(resolveTargetVersion(null, '0.1.0')).toBe('0.1.0')
  })

  it('refuses a spec that is neither a semver nor a bump level', () => {
    expect(() => resolveTargetVersion('1.0.0', 'next')).toThrow('not a semver or a bump level')
  })

  it('refuses a target that is not greater than the current version', () => {
    expect(() => resolveTargetVersion('2.0.0', '1.9.9')).toThrow('not greater than 2.0.0')
    expect(() => resolveTargetVersion('2.0.0', '2.0.0')).toThrow('not greater than 2.0.0')
  })
})
