const webpush = require('web-push')
const db = require('./db')

function setupPush(publicKey, privateKey, email) {
  if (publicKey && privateKey) {
    webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey)
    return true
  }
  return false
}

function getAllSubscriptions() {
  return db.prepare('SELECT * FROM push_subscriptions').all()
}

function saveSubscription(sub) {
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint)
  if (existing) {
    db.prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?')
      .run(sub.keys.p256dh, sub.keys.auth, existing.id)
    return existing.id
  }
  const result = db.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)')
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth)
  return result.lastInsertRowid
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
}

async function notifyAll(title, body, url) {
  const subs = getAllSubscriptions()
  const payload = JSON.stringify({ title, body, url, timestamp: Date.now() })

  const results = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload)
      results.push({ endpoint: sub.endpoint, success: true })
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        removeSubscription(sub.endpoint)
      }
      results.push({ endpoint: sub.endpoint, success: false, error: err.message })
    }
  }
  return results
}

module.exports = { setupPush, getAllSubscriptions, saveSubscription, removeSubscription, notifyAll }
