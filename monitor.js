const db = require('./db')
const push = require('./push')

let intervalId = null
const progress = {}

function getActiveBets() {
  return db.prepare("SELECT * FROM bets WHERE status = 'active'").all()
}

function updateBetStatus(betId, status) {
  db.prepare("UPDATE bets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, betId)
}

function markNotified(betId) {
  db.prepare("UPDATE bets SET notified = 1, updated_at = datetime('now') WHERE id = ?").run(betId)
}

function getP(betId) {
  if (!progress[betId]) progress[betId] = { tick: 0 }
  return progress[betId]
}

const BET_LABELS = {
  cards: 'Cartões', goals: 'Gols', corners: 'Escanteios',
  offsides: 'Impedimentos', total_shots: 'Finalizações',
  shots_on_target: 'Chutes no Gol', shots_off_target: 'Chutes pra Fora',
  fouls: 'Faltas', throwins: 'Laterais', goal_kicks: 'Tiros de Meta',
  penalties: 'Pênaltis', free_kicks: 'Faltas Perigosas',
  team_goals: 'Gols', team_cards: 'Cartões', team_corners: 'Escanteios',
  team_shots_on_target: 'Chutes no Gol', team_offsides: 'Impedimentos',
  team_fouls: 'Faltas',
  player_goals: 'Gols', player_cards: 'Cartões',
  player_shots_on_target: 'Chutes no Gol', player_assists: 'Assistências',
  player_fouls: 'Faltas', player_offsides: 'Impedimentos'
}

async function checkBet(bet) {
  const p = getP(bet.id)
  p.tick++
  const tick = p.tick

  let currentValue = 0
  let label = BET_LABELS[bet.bet_type] || bet.bet_type

  // ---- MATCH STATS ----
  const matchSims = {
    cards:        () => Math.min(tick > 2 ? (p.cards   || 0) + (Math.random() < 0.18 ? 1 : 0) : 0, 8),
    goals:        () => Math.min(tick > 5 ? (p.goals   || 0) + (Math.random() < 0.08 ? 1 : 0) : 0, 6),
    corners:      () => Math.min(tick > 1 ? (p.corners || 0) + (Math.random() < 0.20 ? 1 : 0) : 0, 14),
    offsides:     () => Math.min(tick > 2 ? (p.off     || 0) + (Math.random() < 0.15 ? 1 : 0) : 0, 8),
    total_shots:  () => Math.min(tick > 1 ? (p.shots   || 0) + (Math.random() < 0.30 ? 1 : 0) : 0, 25),
    shots_on_target:  () => Math.min(tick > 1 ? (p.sot    || 0) + (Math.random() < 0.18 ? 1 : 0) : 0, 12),
    shots_off_target: () => Math.min(tick > 1 ? (p.soff   || 0) + (Math.random() < 0.20 ? 1 : 0) : 0, 15),
    fouls:        () => Math.min(tick > 1 ? (p.fouls  || 0) + (Math.random() < 0.22 ? 1 : 0) : 0, 20),
    throwins:     () => Math.min(tick > 0 ? (p.thr    || 0) + (Math.random() < 0.35 ? 1 : 0) : 0, 30),
    goal_kicks:   () => Math.min(tick > 0 ? (p.gk     || 0) + (Math.random() < 0.20 ? 1 : 0) : 0, 15),
    penalties:    () => Math.min(tick > 8 ? (p.pen    || 0) + (Math.random() < 0.03 ? 1 : 0) : 0, 3),
    free_kicks:   () => Math.min(tick > 1 ? (p.fk     || 0) + (Math.random() < 0.15 ? 1 : 0) : 0, 12)
  }

  // ---- TEAM STATS ----
  const teamSims = {
    team_goals:           () => Math.min(tick > 5  ? (p.tg  || 0) + (Math.random() < 0.05 ? 1 : 0) : 0, 4),
    team_cards:           () => Math.min(tick > 2  ? (p.tc  || 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 6),
    team_corners:         () => Math.min(tick > 1  ? (p.tcr || 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 10),
    team_shots_on_target: () => Math.min(tick > 1  ? (p.tsot|| 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 8),
    team_offsides:        () => Math.min(tick > 2  ? (p.toff|| 0) + (Math.random() < 0.10 ? 1 : 0) : 0, 5),
    team_fouls:           () => Math.min(tick > 1  ? (p.tf  || 0) + (Math.random() < 0.14 ? 1 : 0) : 0, 14)
  }

  // ---- PLAYER STATS ----
  const playerSims = {
    player_goals:              () => Math.min(tick > 8  ? (p.pg  || 0) + (Math.random() < 0.03 ? 1 : 0) : 0, 3),
    player_cards:              () => Math.min(tick > 3  ? (p.pc  || 0) + (Math.random() < 0.06 ? 1 : 0) : 0, 2),
    player_shots_on_target:    () => Math.min(tick > 2  ? (p.psot|| 0) + (Math.random() < 0.10 ? 1 : 0) : 0, 5),
    player_assists:            () => Math.min(tick > 10 ? (p.pa  || 0) + (Math.random() < 0.02 ? 1 : 0) : 0, 2),
    player_fouls:              () => Math.min(tick > 2  ? (p.pf  || 0) + (Math.random() < 0.08 ? 1 : 0) : 0, 4),
    player_offsides:           () => Math.min(tick > 3  ? (p.po  || 0) + (Math.random() < 0.06 ? 1 : 0) : 0, 3)
  }

  const simFn = matchSims[bet.bet_type] || teamSims[bet.bet_type] || playerSims[bet.bet_type]
  if (!simFn) return

  currentValue = simFn()
  const player = bet.player_name ? ` [${bet.player_name}]` : ''
  const side = bet.team_side ? ` (${bet.team_side === 'home' ? bet.home_team : bet.away_team})` : ''
  const eventLabel = `${label}${player}${side}: ${currentValue}`

  const conditionMet = bet.condition_type === 'over' && currentValue >= bet.condition_value

  if (conditionMet && !bet.notified) {
    const title = `✅ Aposta Ganha!`
    const body = `${bet.home_team} x ${bet.away_team}\n${eventLabel}\nOver ${bet.condition_value} ${label}`
    await push.notifyAll(title, body, '/')
    updateBetStatus(bet.id, 'won')
    markNotified(bet.id)
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Bet #${bet.id} GANHA:`, body)
    return
  }

  if (currentValue > 0 && tick % 3 === 0 && !bet.notified) {
    const body = `${bet.home_team} x ${bet.away_team}\n${eventLabel}`
    await push.notifyAll('⚽ Atualização de Jogo', body, '/')
    console.log(`[${new Date().toLocaleTimeString()}] 🔔 Bet #${bet.id}:`, body)
  }
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
  console.log(`⚽ Monitor iniciado (${intervalMs / 1000}s)`)
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
