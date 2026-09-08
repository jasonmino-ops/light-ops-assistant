'use client'

import { useEffect, useState } from 'react'

// Extracted from Customer Display's existing browser-only fullscreen lifecycle.
// Electron employee fullscreen remains in the cashier and is not used here.
export function useBrowserFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported(Boolean(document.fullscreenEnabled
      && typeof document.documentElement.requestFullscreen === 'function'
      && typeof document.exitFullscreen === 'function'))
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    updateFullscreen()
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  }

  return { isFullscreen, supported, toggleFullscreen }
}
