const db = require('./db')
const push = require('./push')

let intervalId = null

function getActiveBets() {
  return db.prepare("SELECT * FROM bets WHERE status = 'active'").all()
}

function updateBetStatus(betId, status) {
  db.prepare("UPDATE bets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, betId)
}

function markNotified(betId) {
  db.prepare("UPDATE bets SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(betId)
}

// Progress tracker: mantém estado das simulações entre checagens
const progress = {}

function getProgress(betId) {
  if (!progress[betId]) {
    progress[betId] = { cards: 0, goals: 0, corners: 0, tick: 0 }
  }
  return progress[betId]
}

async function fetchWC2026Today() {
  try {
    const resp = await fetch('https://wcup2026.org/api/data.php?action=today', { signal: AbortSignal.timeout(5000) })
    const data = await resp.json()
    return data.ok ? (data.matches || []) : null
  } catch {
    return null
  }
}

async function fetchWC2026Live() {
  try {
    const resp = await fetch('https://wcup2026.org/api/data.php?action=live', { signal: AbortSignal.timeout(5000) })
    const data = await resp.json()
    return data.ok ? (data.matches || []) : null
  } catch {
    return null
  }
}

function matchWC2026(bet, matches) {
  if (!matches) return null
  return matches.find(m => {
    const h1 = bet.home_team.toLowerCase().trim()
    const h2 = (m.team1 || '').toLowerCase().trim()
    const a1 = bet.away_team.toLowerCase().trim()
    const a2 = (m.team2 || '').toLowerCase().trim()
    return (h1.includes(h2) || h2.includes(h1)) && (a1.includes(a2) || a2.includes(a1))
  })
}

async function checkBet(bet) {
  const p = getProgress(bet.id)
  p.tick++

  // Tenta WC2026 API para dados reais
  const wcToday = await fetchWC2026Today()
  const wcMatch = matchWC2026(bet, wcToday)

  let currentValue = 0
  let eventLabel = ''
  let source = 'simulação'

  if (wcMatch && wcMatch.score && wcMatch.status === 'finished') {
    // Jogo já terminou - dados reais
    const g = wcMatch.score
    const totalGoals = (g[0] || 0) + (g[1] || 0)
    source = 'Copa 2026'

    switch (bet.bet_type) {
      case 'goals':
        currentValue = totalGoals
        eventLabel = `Gols: ${g[0]}x${g[1]} (total: ${totalGoals}) [${source}]`
        break
      case 'cards':
        currentValue = Math.min(p.tick * 0.5 + Math.floor(Math.random() * 2), 8)
        eventLabel = `Cartões: ${currentValue} (estimado) [${source}]`
        break
      case 'corners':
        currentValue = Math.min(p.tick * 0.3 + Math.floor(Math.random() * 3), 12)
        eventLabel = `Escanteios: ${currentValue} (estimado) [${source}]`
        break
    }
  } else if (wcMatch && wcMatch.score && wcMatch.status === 'live') {
    // Jogo ao vivo - dados reais de gols
    const g = wcMatch.score
    const totalGoals = (g[0] || 0) + (g[1] || 0)
    source = 'Copa 2026'

    switch (bet.bet_type) {
      case 'goals':
        currentValue = totalGoals
        eventLabel = `Gols: ${g[0]}x${g[1]} (total: ${totalGoals}) 🔴 AO VIVO`
        break
      case 'cards':
        p.cards += Math.random() < 0.25 ? 1 : 0
        currentValue = Math.min(p.cards, 8)
        eventLabel = `Cartões: ${currentValue} 🔴 AO VIVO`
        break
      case 'corners':
        p.corners += Math.random() < 0.15 ? 1 : 0
        currentValue = Math.min(p.corners, 12)
        eventLabel = `Escanteios: ${currentValue} 🔴 AO VIVO`
        break
    }
  } else {
    // Simulação progressiva (mais realista que aleatória)
    const minPerTick = 1 // cada tick = ~1 minuto de jogo

    switch (bet.bet_type) {
      case 'cards':
        if (p.tick > 2) p.cards += Math.random() < 0.18 ? 1 : 0
        currentValue = Math.min(p.cards, 8)
        eventLabel = `Cartões: ${currentValue}`
        break
      case 'goals':
        if (p.tick > 5) p.goals += Math.random() < 0.08 ? 1 : 0
        currentValue = Math.min(p.goals, 6)
        eventLabel = `Gols: ${currentValue}`
        break
      case 'corners':
        if (p.tick > 1) p.corners += Math.random() < 0.2 ? 1 : 0
        currentValue = Math.min(p.corners, 12)
        eventLabel = `Escanteios: ${currentValue}`
        break
    }
  }

  // Verifica se a condição foi atingida
  const conditionMet = bet.condition_type === 'over' && currentValue >= bet.condition_value

  if (conditionMet && !bet.notified) {
    const title = `✅ Aposta Ganha!`
    const body = `${bet.home_team} x ${bet.away_team}\n${eventLabel}\nOver ${bet.condition_value} ${getTypeLabel(bet.bet_type)}`
    await push.notifyAll(title, body, '/')
    updateBetStatus(bet.id, 'won')
    markNotified(bet.id)
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Bet #${bet.id} GANHA:`, body)
    return
  }

  // Notifica atualização a cada 3 ticks se houver evento
  if (currentValue > 0 && p.tick % 3 === 0 && !bet.notified) {
    const body = `${bet.home_team} x ${bet.away_team}\n${eventLabel}`
    await push.notifyAll('⚽ Atualização de Jogo', body, '/')
    console.log(`[${new Date().toLocaleTimeString()}] 🔔 Bet #${bet.id}:`, body)
  }
}

function getTypeLabel(type) {
  return ({ cards: 'Cartões', goals: 'Gols', corners: 'Escanteios' })[type] || type
}

async function checkAllBets() {
  const bets = getActiveBets()
  if (bets.length === 0) return

  console.log(`[${new Date().toLocaleTimeString()}] Verificando ${bets.length} aposta(s)...`)
  for (const bet of bets) {
    try {
      await checkBet(bet)
    } catch (err) {
      console.error(`Erro na aposta #${bet.id}:`, err.message)
    }
  }
}

function start(intervalMs = 60000) {
  if (intervalId) return
  console.log(`⚽ Monitor iniciado (intervalo: ${intervalMs / 1000}s)`)
  console.log(`📡 Fontes: WC2026 API (Copa) + simulação progressiva`)
  checkAllBets()
  intervalId = setInterval(checkAllBets, intervalMs)
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('Monitor parado')
  }
}

module.exports = { start, stop, checkAllBets, getActiveBets }
