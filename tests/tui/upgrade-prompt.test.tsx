import { describe, expect, it, vi } from 'vitest'
import { UpgradeApp, type UpgradeAppProps } from '../../src/tui/upgrade-app.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'

const props = (over: Partial<UpgradeAppProps> = {}): UpgradeAppProps => ({
  fromVersion: '0.5.1',
  toVersion: '0.6.0',
  publishedAt: '2026-08-14T10:00:00Z',
  entries: [
    {
      version: '0.6.0',
      lines: ['two-level repo and skill navigation', 'reproduce the candidate manifest'],
    },
  ],
  installPath: '/home/u/.skillgantry/versions/0.6.0',
  onAnswer: () => {},
  ...over,
})

describe('UpgradeApp', () => {
  it('names both versions and the path it would install to', () => {
    const ui = renderInk(<UpgradeApp {...props()} />, { columns: 80, rows: 24 })
    const frame = ui.lastFrame()
    expect(frame).toContain('0.5.1')
    expect(frame).toContain('0.6.0')
    expect(frame).toContain('versions/0.6.0')
    ui.unmount()
  })

  it('resolves upgrade on y and skip on n', async () => {
    const onUpgrade = vi.fn()
    const first = renderInk(<UpgradeApp {...props({ onAnswer: onUpgrade })} />)
    first.stdin.send('y')
    await first.settle(40)
    expect(onUpgrade).toHaveBeenCalledWith('upgrade')
    first.unmount()

    const onSkip = vi.fn()
    const second = renderInk(<UpgradeApp {...props({ onAnswer: onSkip })} />)
    second.stdin.send('n')
    await second.settle(40)
    expect(onSkip).toHaveBeenCalledWith('skip')
    second.unmount()
  })

  // A quit key at a prompt nobody asked for exists only to be hit by mistake.
  it('is inert under every other key', async () => {
    const onAnswer = vi.fn()
    const ui = renderInk(<UpgradeApp {...props({ onAnswer })} />)
    for (const key of ['q', '\r', 'j', 'k', ' ', 'Y', 'N']) ui.stdin.send(key)
    await ui.settle(40)
    expect(onAnswer).not.toHaveBeenCalled()
    ui.unmount()
  })

  it('renders every entry newest first under its own version heading', () => {
    const ui = renderInk(
      <UpgradeApp
        {...props({
          fromVersion: '0.4.9',
          entries: [
            { version: '0.6.0', lines: ['the newer thing'] },
            { version: '0.5.0', lines: ['the older thing'] },
          ],
        })}
      />,
      { columns: 80, rows: 24 },
    )
    const frame = ui.lastFrame()
    expect(frame).toContain('the newer thing')
    expect(frame).toContain('the older thing')
    expect(frame.indexOf('0.6.0')).toBeLessThan(frame.indexOf('the older thing'))
    ui.unmount()
  })

  it('truncates the notes at 50x14 and says how many rows it dropped', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `entry line number ${i}`)
    const ui = renderInk(<UpgradeApp {...props({ entries: [{ version: '0.6.0', lines }] })} />, {
      columns: 50,
      rows: 14,
    })
    await waitForFrame(ui, (frame) => frame.includes('more'))
    const frame = ui.lastFrame()
    expect(frame).toMatch(/\d+ more/)
    expect(frame.trimEnd().split('\n').length).toBeLessThanOrEqual(14)
    ui.unmount()
  })
})
