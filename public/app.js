let subscription = null

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setNotificationStatus('off', 'Seu navegador não suporta notificações push')
    return false
  }

  try {
    await navigator.serviceWorker.register('/sw.js')
    console.log('Service Worker registrado')
    return true
  } catch (err) {
    console.error('Erro ao registrar Service Worker:', err)
    setNotificationStatus('off', 'Erro ao registrar Service Worker')
    return false
  }
}

async function setupPush() {
  const existing = await navigator.serviceWorker.ready
    .then(reg => reg.pushManager.getSubscription())

  if (existing) {
    subscription = existing
    setNotificationStatus('on', '🔔 Notificações ativadas')

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing.toJSON())
      })
      await res.json()
    } catch {}
    return
  }

  try {
    const healthRes = await fetch('/api/health')
    const health = await healthRes.json()
    const publicKey = health.vapidPublicKey

    if (!publicKey) {
      setNotificationStatus('off', '🔕 VAPID key não configurada no servidor')
      return
    }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    })

    subscription = sub

    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON())
    })

    if (res.ok) {
      setNotificationStatus('on', '🔔 Notificações ativadas')
    }
  } catch (err) {
    console.error('Erro ao configurar push:', err)
    setNotificationStatus('off', '🔕 Erro ao ativar notificações: ' + err.message)
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

function setNotificationStatus(state, message) {
  const el = document.getElementById('notificationStatus')
  el.className = 'notification-status ' + state
  el.textContent = message || (state === 'on' ? '🔔 Notificações ativadas' : '🔕 Notificações desativadas')
}

async function loadTodayMatches() {
  const section = document.getElementById('matchesSection')
  const list = document.getElementById('matchesList')
  const count = document.getElementById('matchesCount')

  try {
    const res = await fetch('/api/matches/today')
    if (!res.ok) throw new Error('Erro ao buscar jogos')
    const matches = await res.json()

    section.style.display = 'block'
    count.textContent = `(${matches.length})`

    if (matches.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>Nenhum jogo encontrado para hoje</p></div>`
      return
    }

    list.innerHTML = matches.map(m => {
      const hour = new Date(m.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const isLive = m.status === 'LIVE'
      return `
        <div class="match-card" onclick="selectMatch('${esc(m.league)}', '${esc(m.home_team)}', '${esc(m.away_team)}', ${m.id})">
          <div class="match-info">
            <div class="match-league">${esc(m.league)}</div>
            <div class="match-teams">
              <span class="match-team">${esc(m.home_team)}</span>
              <span class="match-vs">vs</span>
              <span class="match-team">${esc(m.away_team)}</span>
            </div>
            <div class="match-time">
              ${isLive ? '<span class="live-badge">🔴 AO VIVO</span>' : hour}
            </div>
          </div>
          <div class="match-add">+</div>
        </div>`
    }).join('')
  } catch (err) {
    console.error('Erro:', err)
    section.style.display = 'none'
  }
}

function selectMatch(league, home, away, matchId) {
  document.getElementById('league').value = league
  document.getElementById('homeTeam').value = home
  document.getElementById('awayTeam').value = away
  document.getElementById('matchApiId').value = matchId
  document.getElementById('conditionValue').value = '1.5'

  document.getElementById('betType').value = 'cards'
  document.getElementById('conditionType').value = 'over'

  window.scrollTo({ top: 0, behavior: 'smooth' })
  showToast(`Jogo selecionado: ${home} vs ${away}`)
}

async function loadBets() {
  try {
    const res = await fetch('/api/bets')
    const bets = await res.json()
    renderBets(bets)
    updateStats(bets)
  } catch (err) {
    console.error('Erro ao carregar apostas:', err)
  }
}

function updateStats(bets) {
  document.getElementById('totalStats').textContent = bets.length
  document.getElementById('activeStats').textContent = bets.filter(b => b.status === 'active').length
  document.getElementById('wonStats').textContent = bets.filter(b => b.status === 'won').length
}

function getBetTypeLabel(type) {
  return ({ cards: 'Cartões', goals: 'Gols', corners: 'Escanteios' })[type] || type
}

function getConditionLabel(type) {
  return ({ over: 'Over', under: 'Under', exact: 'Exato' })[type] || type
}

function getStatusBadge(status) {
  const labels = { active: 'Ativa', won: 'Ganha ✅', lost: 'Perdida ❌' }
  const classes = { active: 'badge-active', won: 'badge-won', lost: 'badge-lost' }
  return `<span class="badge ${classes[status] || ''}">${labels[status] || status}</span>`
}

function renderBets(bets) {
  const container = document.getElementById('betsList')
  const count = document.getElementById('betCount')
  count.textContent = `(${bets.length})`

  if (bets.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <p>Nenhuma aposta cadastrada ainda</p>
        <p style="font-size:0.85rem;margin-top:8px;">Adicione suas apostas acima e receba notificações ao vivo!</p>
      </div>`
    return
  }

  container.innerHTML = bets.map(bet => `
    <div class="bet-item">
      <div class="info">
        <div class="teams">${esc(bet.home_team)} vs ${esc(bet.away_team)}</div>
        <div class="detail">
          ${getConditionLabel(bet.condition_type)} ${bet.condition_value} ${getBetTypeLabel(bet.bet_type)}
          &middot; ${esc(bet.league)}
        </div>
        <div class="meta">
          ${getStatusBadge(bet.status)}
          <span style="font-size:0.75rem;color:var(--text2);">
            ${new Date(bet.created_at + 'Z').toLocaleString('pt-BR')}
          </span>
          ${bet.notified ? '<span style="font-size:0.75rem;color:var(--green);">🔔 Notificado</span>' : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-danger" onclick="deleteBet(${bet.id})">✕</button>
      </div>
    </div>
  `).join('')
}

function esc(text) {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

async function addBet() {
  const league = document.getElementById('league').value.trim()
  const homeTeam = document.getElementById('homeTeam').value.trim()
  const awayTeam = document.getElementById('awayTeam').value.trim()
  const betType = document.getElementById('betType').value
  const conditionType = document.getElementById('conditionType').value
  const conditionValue = parseFloat(document.getElementById('conditionValue').value)
  const matchApiId = document.getElementById('matchApiId').value

  if (!league || !homeTeam || !awayTeam) {
    showToast('Preencha todos os campos obrigatórios')
    return
  }

  if (isNaN(conditionValue) || conditionValue <= 0) {
    showToast('Valor da condição inválido')
    return
  }

  const bet = {
    league,
    home_team: homeTeam,
    away_team: awayTeam,
    bet_type: betType,
    condition_type: conditionType,
    condition_value: conditionValue,
    match_api_id: matchApiId ? parseInt(matchApiId) : null
  }

  try {
    const res = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bet)
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Erro ao salvar')
    }

    showToast(`✅ Aposta adicionada: ${homeTeam} vs ${awayTeam}`)
    resetForm()
    await loadBets()
  } catch (err) {
    showToast('❌ ' + err.message)
  }
}

async function deleteBet(id) {
  if (!confirm('Remover esta aposta?')) return

  try {
    const res = await fetch(`/api/bets/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Erro ao remover')
    showToast('Aposta removida')
    await loadBets()
  } catch (err) {
    showToast('❌ ' + err.message)
  }
}

function resetForm() {
  document.getElementById('league').value = ''
  document.getElementById('homeTeam').value = ''
  document.getElementById('awayTeam').value = ''
  document.getElementById('conditionValue').value = '1.5'
  document.getElementById('matchApiId').value = ''
}

function showToast(message) {
  const existing = document.querySelector('.toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

async function init() {
  const swOk = await registerServiceWorker()
  if (swOk) {
    await setupPush()
  }
  await loadTodayMatches()
  await loadBets()
  setInterval(loadBets, 30000)
}

document.addEventListener('DOMContentLoaded', init)
