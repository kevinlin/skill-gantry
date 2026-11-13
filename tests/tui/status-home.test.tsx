import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import { VERSION, createQueue } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { HomeLabelContext, StatusBar } from '../../src/tui/components/StatusBar.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const HINTS = 'j/k move · q quit'
const HOME = '~/work/sg-home'

const plain = (frame: string): string => frame.replace(/\x1b\[[0-9;]*m/g, '')

function bar(columns: number, home: string | null): string {
  const ui = renderInk(
    <HomeLabelContext.Provider value={home}>
      <StatusBar hints={HINTS} columns={columns} />
    </HomeLabelContext.Provider>,
    { columns, rows: 4 },
  )
  const line = plain(ui.lastFrame()).split('\n').at(-1) as string
  ui.unmount()
  return line
}

describe('R11.25 the status line names a home that is not the default', () => {
  it('shows the version alone when no home is named', () => {
    const line = bar(60, null)
    expect(line).toContain(HINTS)
    expect(line.trimEnd().endsWith(`v${VERSION}`)).toBe(true)
    expect(line).not.toContain('·  ')
    expect(line).not.toContain('~')
  })

  it('shows `v<version> · <home>` on the right otherwise', () => {
    const line = bar(80, HOME)
    expect(line).toContain(HINTS)
    expect(line.trimEnd().endsWith(`v${VERSION} · ${HOME}`)).toBe(true)
  })

  it('drops the label whole when the keys do not fit beside all of it', () => {
    const label = `v${VERSION} · ${HOME}`
    // One cell short of the keys, a space and the whole label.
    const tight = stringWidth(HINTS) + stringWidth(label)
    const line = bar(tight, HOME)
    expect(line).toContain(HINTS)
    // Neither half: a bare version here would read as the whole label, and the
    // home it was meant to qualify is the part the user opened this for.
    expect(line).not.toContain(VERSION)
    expect(line).not.toContain(HOME)
    // And the same width holds the version alone when no home is named.
    expect(bar(tight, null)).toContain(`v${VERSION}`)
  })

  it('keeps the keys whole at the width the label first fits', () => {
    const label = `v${VERSION} · ${HOME}`
    const line = bar(stringWidth(HINTS) + stringWidth(label) + 1, HOME)
    expect(line).toContain(HINTS)
    expect(line).toContain(label)
  })

  it('reaches every screen through the App, on the row the keys already had', async () => {
    const queue = createQueue({ concurrency: 1, startRun: () => fakeRun().handle })
    const ui = renderInk(
      <App
        skills={[skillRef('declawed')]}
        queue={queue}
        stages={['validate']}
        concurrency={1}
        views={fakeViews()}
        intervalMs={20}
        homeLabel={HOME}
      />,
      { columns: 100, rows: 30 },
    )
    await waitForFrame(ui, (frame) => frame.includes(HOME))
    const withHome = plain(ui.lastFrame())
    expect(withHome.split('\n').at(-1)).toContain(`v${VERSION} · ${HOME}`)

    // The same row on Tools, which draws its own footer.
    ui.stdin.send(':')
    await ui.settle()
    for (const ch of 'tools') ui.stdin.send(ch)
    await ui.settle()
    ui.stdin.send('\r')
    await waitForFrame(ui, (frame) => !frame.includes('Validate'))
    expect(plain(ui.lastFrame()).split('\n').at(-1)).toContain(HOME)

    ui.unmount()
    queue.close()
  })

  it('adds no row to the Work screen', async () => {
    const framesFor = async (homeLabel: string | undefined): Promise<string> => {
      const queue = createQueue({ concurrency: 1, startRun: () => fakeRun().handle })
      const ui = renderInk(
        <App
          skills={[skillRef('declawed')]}
          queue={queue}
          stages={['validate']}
          concurrency={1}
          views={fakeViews()}
          intervalMs={20}
          {...(homeLabel === undefined ? {} : { homeLabel })}
        />,
        { columns: 80, rows: 24 },
      )
      await ui.settle(80)
      const frame = ui.lastFrame()
      ui.unmount()
      queue.close()
      return frame
    }
    const without = await framesFor(undefined)
    const withHome = await framesFor(HOME)
    expect(withHome.split('\n')).toHaveLength(without.split('\n').length)
  })
})
