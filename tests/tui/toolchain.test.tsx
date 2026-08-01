import { describe, expect, it } from 'vitest'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { renderInk } from '../helpers/render-ink.js'

function Probe(): React.ReactElement {
  const [pressed, setPressed] = useState('none')
  useInput((input) => setPressed(input))
  return (
    <Box flexDirection="column">
      <Text>skillgantry</Text>
      <Text>pressed: {pressed}</Text>
    </Box>
  )
}

describe('ink toolchain', () => {
  it('renders a component to a frame', async () => {
    const ui = renderInk(<Probe />)
    await ui.settle()
    expect(ui.lastFrame()).toContain('skillgantry')
    ui.unmount()
  })

  it('delivers keypresses through the fake stdin', async () => {
    const ui = renderInk(<Probe />)
    await ui.settle()
    ui.stdin.send('q')
    await ui.settle()
    expect(ui.lastFrame()).toContain('pressed: q')
    ui.unmount()
  })
})
