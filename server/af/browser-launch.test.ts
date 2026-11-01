import { describe, expect, it } from 'vitest'
import { findBrowserExecutable } from './browser-launch.js'

describe('browser-launch', () => {
  it('prefers Brave when installed on macOS', async () => {
    if (process.platform !== 'darwin') return
    const executable = await findBrowserExecutable()
    expect(executable.toLowerCase()).toMatch(/brave|chrome/)
    // On this machine Brave is present and must win over Chrome.
    if (executable.includes('Brave')) {
      expect(executable).toContain('Brave Browser')
    }
  })
})
