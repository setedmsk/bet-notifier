self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()

    const options = {
      body: data.body || '',
icon: '/icon-192.svg',
badge: '/icon-192.svg',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/',
        timestamp: data.timestamp || Date.now()
      },
      actions: [
        { action: 'open', title: 'Abrir App' }
      ],
      tag: `bet-${data.timestamp || Date.now()}`
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'Bet Notifier', options)
    )
  } catch (e) {
    event.waitUntil(
      self.registration.showNotification('Bet Notifier', {
        body: event.data.text(),
        icon: '/icon-192.svg'
      })
    )
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})
