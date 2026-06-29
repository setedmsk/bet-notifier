require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const path = require('path')
const cors = require('cors')
const db = require('./db')
const push = require('./push')
const monitor = require('./monitor')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const pushReady = push.setupPush(
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
  process.env.VAPID_EMAIL
)

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    pushReady,
    monitorRunning: true,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null
  })
})

app.get('/api/matches/today', async (req, res) => {
  // Tenta WC2026 API (100% gratuita, sem key)
  try {
    const resp = await fetch('https://wcup2026.org/api/data.php?action=today', { signal: AbortSignal.timeout(5000) })
    const data = await resp.json()
    if (data.ok && data.matches?.length) {
      const matches = data.matches.map(m => ({
        id: 200000 + m.id,
        league: `Copa do Mundo 2026 - ${m.group || ''}`,
        home_team: m.team1,
        away_team: m.team2,
        home_logo: m.flag1,
        away_logo: m.flag2,
        date: new Date(m.datetime * 1000).toISOString(),
        status: m.status === 'live' ? 'LIVE' : m.status === 'finished' ? 'FT' : 'SCHEDULED',
        venue: m.ground,
        score: m.score ? `${m.score[0]}x${m.score[1]}` : null
      }))
      return res.json(matches)
    }
  } catch {
    console.log('WC2026 API indisponivel, usando simulacao')
  }

  const simulated = simulateTodayMatches()
  res.json(simulated)
})

function simulateTodayMatches() {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const currentHour = now.getHours()

  const matches = [
    { league: 'Copa do Mundo 2026', home: 'Brasil', away: 'Argentina', time: '16:00' },
    { league: 'Copa do Mundo 2026', home: 'Alemanha', away: 'França', time: '13:00' },
    { league: 'Copa do Mundo 2026', home: 'Portugal', away: 'Espanha', time: '10:00' },
    { league: 'Copa do Mundo 2026', home: 'Inglaterra', away: 'Itália', time: '19:00' },
    { league: 'Brasileirão Série A', home: 'Flamengo', away: 'Palmeiras', time: '21:30' },
    { league: 'Brasileirão Série A', home: 'Corinthians', away: 'São Paulo', time: '18:30' },
    { league: 'Premier League', home: 'Manchester City', away: 'Liverpool', time: '13:30' },
    { league: 'La Liga', home: 'Barcelona', away: 'Real Madrid', time: '16:00' },
    { league: 'Champions League', home: 'Bayern de Munique', away: 'PSG', time: '16:00' },
    { league: 'Serie A', home: 'Juventus', away: 'Milan', time: '14:00' }
  ]

  return matches.map((m, i) => ({
    id: 100000 + i,
    league: m.league,
    home_team: m.home,
    away_team: m.away,
    home_logo: null,
    away_logo: null,
    date: `${today}T${m.time}:00`,
    status: currentHour >= parseInt(m.time) ? 'LIVE' : 'SCHEDULED',
    venue: null,
    score: null
  }))
}

app.get('/api/bets', (req, res) => {
  const bets = db.prepare('SELECT * FROM bets ORDER BY created_at DESC').all()
  res.json(bets)
})

app.post('/api/bets', (req, res) => {
  const { league, home_team, away_team, bet_type, condition_type, condition_value, match_api_id } = req.body

  if (!league || !home_team || !away_team || !bet_type || !condition_type || condition_value === undefined) {
    return res.status(400).json({ error: 'Campos obrigatórios: league, home_team, away_team, bet_type, condition_type, condition_value' })
  }

  const result = db.prepare(
    'INSERT INTO bets (league, home_team, away_team, bet_type, condition_type, condition_value, match_api_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(league, home_team, away_team, bet_type, condition_type, condition_value, match_api_id || null)

  const bet = db.prepare('SELECT * FROM bets WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json(bet)
})

app.delete('/api/bets/:id', (req, res) => {
  const result = db.prepare('DELETE FROM bets WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Aposta não encontrada' })
  res.json({ success: true })
})

app.post('/api/subscribe', (req, res) => {
  const { endpoint, keys } = req.body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription inválida' })
  }
  try {
    const id = push.saveSubscription({ endpoint, keys })
    res.status(201).json({ id, message: 'Inscrito para notificações!' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/test-notification', async (req, res) => {
  try {
    const results = await push.notifyAll('🔔 Notificação de Teste', 'Notificações push estão funcionando!', '/')
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/monitor/check', async (req, res) => {
  try {
    await monitor.checkAllBets()
    res.json({ message: 'Verificação concluída' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`\n⚽ Bet Notifier rodando em http://localhost:${PORT}`)
  console.log(`📱 Push: ${pushReady ? '✅ ATIVADAS' : '❌ DESATIVADAS (gere as VAPID keys no .env)'}`)
  console.log(`📡 Dados: WC2026 API (Copa) + simulação progressiva`)
  console.log(`💯 100% gratuito, sem chave de API necessária\n`)

  monitor.start(60000)
})
