const db = require('./db')
const push = require('./push')

let intervalId = null
const progress = {}
let lastMatchFetch = 0
let matchStatusMap = {}

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

async function fetchMatchStatuses() {
  const now = Date.now()
  if (now - lastMatchFetch < 60000) return matchStatusMap  // cache 1 min
  lastMatchFetch = now

  try {
    const resp = await fetch('https://wcup2026.org/matches.php?lang=en', { signal: AbortSignal.timeout(5000) })
    const html = await resp.text()
    const map = {}
    function he(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") }

    const sections = html.match(/<section[^>]*class="day-block[^"]*"[^>]*>.*?<div class="match-grid">(.*?)<\/section>/gs) || []
    for (const section of sections) {
      const dateMatch = section.match(/datetime="([^"]+)"[^>]*data-mode="date"/)
      if (!dateMatch) continue
      const blockDate = new Date(dateMatch[1])
      if (blockDate < new Date(Date.now() - 86400000)) continue

      const cards = section.match(/<a class="match-card[^"]*"[^>]*>(.*?)<\/a>/gs) || []
      for (const card of cards) {
        const teams = [...card.matchAll(/team-name[^>]*>([^<]+)</g)]
        const dateEl = card.match(/datetime="([^"]+)"/)
        const badge = card.match(/badge[^"]*badge-(\w+)/)
        const scoreMatch = card.match(/mc-score-num[^>]*>(\d+)<\/span>\s*<span class="mc-score-sep">\s*:\s*<\/span>\s*<span class="mc-score-num">(\d+)<\/span>/)
        if (teams.length >= 2 && dateEl) {
          const t1 = he(teams[0][1].trim())
          const t2 = he(teams[teams.length - 1][1].trim())
          const badgeVal = badge ? badge[1] : ''
          let status = 'SCHEDULED'
          if (badgeVal === 'live') status = 'LIVE'
          else if (badgeVal === 'done') status = 'FT'

          const dt = new Date(dateEl[1])
          const score = scoreMatch ? `${scoreMatch[1]}x${scoreMatch[2]}` : null

          // Indexa por time1+time2 e time2+time1
          const key = `${t1}|${t2}`
          map[key] = { status, date: dt, score, teams: [t1, t2] }
        }
      }
    }

    matchStatusMap = map
    return map
  } catch {
    return matchStatusMap
  }
}

function getMatchTimeFromMap(bet, map) {
  const key1 = `${bet.home_team}|${bet.away_team}`
  const key2 = `${bet.away_team}|${bet.home_team}`
  const match = map[key1] || map[key2]
  if (!match) return null
  return match
}

function isMatchLive(bet, map) {
  const match = getMatchTimeFromMap(bet, map)
  return match && match.status === 'LIVE'
}

function isMatchFinished(bet, map) {
  const match = getMatchTimeFromMap(bet, map)
  return match && match.status === 'FT'
}

function isMatchScheduled(bet, map) {
  const match = getMatchTimeFromMap(bet, map)
  return match && match.status === 'SCHEDULED'
}

async function checkBet(bet, map) {
  const now = new Date()

  // 1) Checa status real do jogo no site
  const match = getMatchTimeFromMap(bet, map)

  if (match) {
    if (match.status === 'SCHEDULED' && now < match.date) {
      const timeStr = match.date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      console.log(`  ⏳ Bet #${bet.id}: ${bet.home_team} x ${bet.away_team} às ${timeStr}, aguardando...`)
      return
    }

    // Se o jogo já terminou, usa o placar real
    if (match.status === 'FT' && match.score) {
      const [hs, as] = match.score.split('x').map(Number)
      if (bet.bet_type === 'goals' && !bet.notified) {
        const total = hs + as
        const met = (bet.condition_type === 'over' && total >= bet.condition_value) ||
                    (bet.condition_type === 'under' && total < bet.condition_value) ||
                    (bet.condition_type === 'exact' && total === bet.condition_value)
        if (met) {
          const title = `✅ Aposta Ganha!`
          const body = `${bet.home_team} ${hs}x${as} ${bet.away_team}\nPlacar real: ${total} gols`
          await push.notifyAll(title, body, '/')
          updateBetStatus(bet.id, 'won')
          markNotified(bet.id)
          console.log(`[${new Date().toLocaleTimeString()}] ✅ Bet #${bet.id} GANHA (placar real):`, body)
          return
        }
      }
      // Se não atingiu, marca como perdida
      if (!bet.notified) {
        updateBetStatus(bet.id, 'lost')
        console.log(`[${new Date().toLocaleTimeString()}] ❌ Bet #${bet.id} PERDEU (placar real): ${match.score}`)
      }
      return
    }

    // Se o jogo não está AO VIVO, não simula
    if (match.status !== 'LIVE') {
      console.log(`  ⏳ Bet #${bet.id}: jogo não começou (${match.status})`)
      return
    }
  } else {
    // Fallback: se não achou no site, usa match_time
    if (bet.match_time) {
      let matchDate
      if (bet.match_time.includes('-')) {
        matchDate = new Date(bet.match_time)
      } else {
        const [h, m] = bet.match_time.split(':').map(Number)
        matchDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
      }
      if (now < matchDate) {
        console.log(`  ⏳ Bet #${bet.id}: jogo às ${bet.match_time}, aguardando...`)
        return
      }
    }
  }

  // 2) Só chega aqui se o jogo estiver AO VIVO (ou sem info no site + sem match_time)
  // Se não temos info do site E não tem match_time, ainda assim não simula
  if (!match && !bet.match_time) {
    console.log(`  ⏳ Bet #${bet.id}: sem info do jogo, aguardando dados reais...`)
    return
  }

  // 3) Simulação progressiva apenas para jogos AO VIVO
  const p = getP(bet.id)
  p.tick++
  const tick = p.tick

  let currentValue = 0
  let label = BET_LABELS[bet.bet_type] || bet.bet_type

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
  const teamSims = {
    team_goals:           () => Math.min(tick > 5  ? (p.tg  || 0) + (Math.random() < 0.05 ? 1 : 0) : 0, 4),
    team_cards:           () => Math.min(tick > 2  ? (p.tc  || 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 6),
    team_corners:         () => Math.min(tick > 1  ? (p.tcr || 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 10),
    team_shots_on_target: () => Math.min(tick > 1  ? (p.tsot|| 0) + (Math.random() < 0.12 ? 1 : 0) : 0, 8),
    team_offsides:        () => Math.min(tick > 2  ? (p.toff|| 0) + (Math.random() < 0.10 ? 1 : 0) : 0, 5),
    team_fouls:           () => Math.min(tick > 1  ? (p.tf  || 0) + (Math.random() < 0.14 ? 1 : 0) : 0, 14)
  }
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

  // Fetch real match data once per cycle
  const map = await fetchMatchStatuses()

  for (const bet of bets) {
    try {
      await checkBet(bet, map)
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
