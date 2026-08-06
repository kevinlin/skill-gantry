import { describe, expect, it } from 'vitest'
import {
  type DetectorSuppressionRow,
  detectorSuppressed,
  issueSuppression,
  maxSeverity,
  stateOnAbsence,
  stateOnDetection,
  stateOnUserAction,
} from '../../src/core/ledger/issues.js'

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

describe('detectorSuppressed — R8.15', () => {
  it('holds only while the pair describes the current sighting', () => {
    expect(detectorSuppressed({ last_seen_run: 'r2', suppressed_run: 'r2' })).toBe(true)
    // A pair left behind by an older sighting must not outlive it.
    expect(detectorSuppressed({ last_seen_run: 'r3', suppressed_run: 'r2' })).toBe(false)
    expect(detectorSuppressed({ last_seen_run: 'r2', suppressed_run: null })).toBe(false)
  })
})

describe('issueSuppression — the conjunction over detectors still reporting', () => {
  const row = (over: Partial<DetectorSuppressionRow>): DetectorSuppressionRow => ({
    last_seen_run: 'r2',
    last_absent_run: null,
    suppressed_run: null,
    suppressed_reason: null,
    ...over,
  })

  it('is null when nothing is reporting the issue', () => {
    expect(issueSuppression([])).toBeNull()
    expect(issueSuppression([row({ last_seen_run: 'r1', last_absent_run: 'r2' })])).toBeNull()
  })

  it('is null while any reporting detector reports it plainly', () => {
    expect(
      issueSuppression([row({ suppressed_run: 'r2', suppressed_reason: 'x' }), row({})]),
    ).toBeNull()
  })

  it('holds when every reporting detector suppresses', () => {
    expect(
      issueSuppression([
        row({ suppressed_run: 'r2', suppressed_reason: 'first' }),
        row({ last_seen_run: 'r3', suppressed_run: 'r3', suppressed_reason: 'later' }),
      ]),
    ).toEqual({ run: 'r3', reason: 'later' })
  })

  it('gives a detector that says gone no vote', () => {
    expect(
      issueSuppression([
        row({ suppressed_run: 'r2', suppressed_reason: 'only voter' }),
        row({ last_seen_run: 'r1', last_absent_run: 'r2' }),
      ]),
    ).toEqual({ run: 'r2', reason: 'only voter' })
  })

  it('is independent of row order', () => {
    const a = row({ suppressed_run: 'r2', suppressed_reason: 'a' })
    const b = row({ last_seen_run: 'r3', suppressed_run: 'r3', suppressed_reason: 'b' })
    expect(issueSuppression([a, b])).toEqual(issueSuppression([b, a]))
  })
})

describe('suppression is a column, not a state — R8.7', () => {
  it('leaves every user transition exactly as it was', () => {
    // The two are orthogonal by construction: nothing in the state machine
    // reads a suppression, and nothing about suppression writes a state.
    expect(stateOnUserAction('wontfix', 'reopen')).toBe('open')
    expect(stateOnUserAction('open', 'wontfix')).toBe('wontfix')
    expect(stateOnDetection('wontfix')).toBe('wontfix')
    expect(stateOnAbsence('wontfix')).toBeNull()
  })
})
