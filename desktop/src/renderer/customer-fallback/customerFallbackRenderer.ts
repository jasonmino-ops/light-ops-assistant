const time = document.querySelector('time')

function renderTime() {
  if (time) time.textContent = new Date().toLocaleTimeString()
}

renderTime()
setInterval(renderTime, 1000)

export {}
