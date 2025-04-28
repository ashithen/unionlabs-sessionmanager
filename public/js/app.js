/**
 * ═══════════════════════════════════════════════════════════
 * UnionLabs Testbed Session Manager — Frontend Application
 * Vanilla JavaScript · Socket.IO · REST API client
 * ═══════════════════════════════════════════════════════════
 */

/* ─── Hardcoded Testbed Catalog (UnionLabs paper) ──────── */
const FALLBACK_TESTBEDS = [
  {
    id: 'next',
    name: 'NeXT — Networked eXperimental Testbed',
    codename: 'NeXT',
    description:
      'A reconfigurable ad hoc wireless networking testbed for mobile experiments in multi-hop routing, relay selection, and D2D communication using software-defined radios.',
    experiments: ['Ad Hoc Networking', 'Multi-Hop Routing', 'D2D Communication', 'Relay Selection'],
    frequencyBand: '900 MHz / 2.4 GHz',
    status: 'online',
  },
  {
    id: 'uwct',
    name: 'UWCT — Underwater Communications Testbed',
    codename: 'UWCT',
    description:
      'An underwater acoustic and optical communications testbed supporting experiments in channel modeling, modulation, and underwater sensor networking in controlled tank environments.',
    experiments: ['Underwater Acoustics', 'Optical Comms', 'Channel Modeling', 'Sensor Networking'],
    frequencyBand: '10–200 kHz Acoustic',
    status: 'online',
  },
  {
    id: 'ugct',
    name: 'UGCT — Underground Communications Testbed',
    codename: 'UGCT',
    description:
      'A purpose-built underground wireless testbed for evaluating communication through soil, tunnels, and mines, including propagation modeling and cross-layer protocol design.',
    experiments: ['Underground Propagation', 'Tunnel Comms', 'Cross-Layer Protocols', 'Soil Sensing'],
    frequencyBand: '300–900 MHz',
    status: 'online',
  },
  {
    id: 'millinet',
    name: 'MilliNet — Millimeter-Wave Network Testbed',
    codename: 'MilliNet',
    description:
      'A mmWave beamforming and beam-tracking testbed featuring phased-array antennas and real-time beam management for 5G NR and beyond research.',
    experiments: ['mmWave Beamforming', 'Beam Tracking', '5G NR PHY', 'Phased Array'],
    frequencyBand: '28 GHz / 60 GHz',
    status: 'online',
  },
  {
    id: 'oran',
    name: 'O-RAN — Open RAN 5G Testbed',
    codename: 'O-RAN',
    description:
      'An O-RAN-compliant 5G network slicing testbed with near-RT and non-RT RICs, enabling research in xApp/rApp development, RAN intelligent control, and dynamic spectrum sharing.',
    experiments: ['Network Slicing', 'xApp Development', 'RAN Control', 'Spectrum Sharing'],
    frequencyBand: 'Sub-6 GHz (n78)',
    status: 'online',
  },
  {
    id: 'iot',
    name: 'IoT — LoRa Sensor Network Testbed',
    codename: 'IoT',
    description:
      'A large-scale LoRaWAN IoT testbed with distributed sensor nodes for experiments in low-power wide-area networking, adaptive data rate, and edge analytics.',
    experiments: ['LoRaWAN', 'LPWAN', 'Adaptive Data Rate', 'Edge Analytics'],
    frequencyBand: '915 MHz ISM',
    status: 'online',
  },
];

/* ─── Application State ──────────────────────────────────── */
const state = {
  currentTab: 'dashboard',
  sessions: [],
  testbeds: [],
  stats: {
    activeSessions: 0,
    availableTestbeds: 0,
    totalSessions: 0,
    systemHealth: 'unknown',
  },
  socket: null,
  refreshInterval: null,
};

/* ─── Config ─────────────────────────────────────────────── */
const API_BASE = window.location.origin + '/api';
const REFRESH_INTERVAL_MS = 30_000;

/* ═══════════════════════════════════════════════════════════
   API CLIENT
   ═══════════════════════════════════════════════════════════ */

/**
 * Generic fetch wrapper with error handling.
 * @param {string} path  - API path (e.g. '/testbeds')
 * @param {object} opts  - Fetch options
 * @returns {Promise<any>}
 */
async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  const res = await fetch(url, { ...defaults, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

/** Fetch all testbeds from the API. */
async function fetchTestbeds() {
  try {
    const data = await apiFetch('/testbeds');
    return Array.isArray(data) ? data : data.testbeds || data.data || [];
  } catch {
    return [];
  }
}

/** Fetch all sessions from the API. */
async function fetchSessions() {
  try {
    const data = await apiFetch('/sessions');
    return Array.isArray(data) ? data : data.sessions || data.data || [];
  } catch {
    return [];
  }
}

/** Fetch system health. */
async function fetchHealth() {
  try {
    return await apiFetch('/health');
  } catch {
    return { status: 'unknown' };
  }
}

/** Create a new session. */
async function createSession(payload) {
  return apiFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Start (provision) a session. */
async function startSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}/start`, { method: 'POST' });
}

/** Stop a session. */
async function stopSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}/stop`, { method: 'POST' });
}

/** Delete a session. */
async function deleteSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
}


/* ═══════════════════════════════════════════════════════════
   SOCKET.IO INTEGRATION
   ═══════════════════════════════════════════════════════════ */

function initSocket() {
  try {
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      setConnectionStatus(true);
      showToast('Connected to server', 'success');
    });

    socket.on('disconnect', () => {
      setConnectionStatus(false);
      showToast('Disconnected from server', 'warning');
    });

    socket.on('connect_error', () => {
      setConnectionStatus(false);
    });

    // Session status change events
    socket.on('session:status', (data) => {
      if (data && data.sessionId) {
        const label = data.status ? data.status.replace(/_/g, ' ') : 'updated';
        showToast(
          `Session ${truncateId(data.sessionId)} → ${label}`,
          data.status === 'FAILED' ? 'error' : 'info'
        );
        refreshDashboardData();
      }
    });

    socket.on('session:created', (data) => {
      showToast(`New session created: ${truncateId(data.sessionId || data.id)}`, 'success');
      refreshDashboardData();
    });

    socket.on('session:deleted', (data) => {
      showToast(`Session removed: ${truncateId(data.sessionId || data.id)}`, 'info');
      refreshDashboardData();
    });

    state.socket = socket;
  } catch (err) {
    console.warn('Socket.IO initialization failed:', err);
    setConnectionStatus(false);
  }
}

function setConnectionStatus(connected) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (connected) {
    dot.classList.remove('disconnected');
    dot.classList.add('connected');
    label.textContent = 'Connected';
  } else {
    dot.classList.remove('connected');
    dot.classList.add('disconnected');
    label.textContent = 'Disconnected';
  }
}


/* ═══════════════════════════════════════════════════════════
   TAB SYSTEM
   ═══════════════════════════════════════════════════════════ */

function initTabs() {
  const buttons = document.querySelectorAll('.nav-tab');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Shortcut buttons
  document.getElementById('btn-view-all-sessions')?.addEventListener('click', () => switchTab('sessions'));
  document.getElementById('btn-new-session-shortcut')?.addEventListener('click', () => switchTab('new-session'));

  // Position indicator on initial active tab
  requestAnimationFrame(() => updateIndicator());
}

function switchTab(tabId) {
  state.currentTab = tabId;

  // Update buttons
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update panels
  document.querySelectorAll('.tab-content').forEach((panel) => {
    const isActive = panel.id === `tab-${tabId}`;
    panel.classList.toggle('active', isActive);
    if (isActive) {
      // Re-trigger animation
      panel.style.animation = 'none';
      panel.offsetHeight; // reflow
      panel.style.animation = '';
    }
  });

  updateIndicator();

  // Load fresh data on tab switch
  if (tabId === 'dashboard') refreshDashboardData();
  if (tabId === 'testbeds') renderTestbeds();
  if (tabId === 'sessions') renderSessionsTable();
  if (tabId === 'new-session') populateTestbedSelect();
}

function updateIndicator() {
  const activeBtn = document.querySelector('.nav-tab.active');
  const indicator = document.getElementById('nav-indicator');
  if (!activeBtn || !indicator) return;
  const navInner = document.querySelector('.nav-inner');
  const navRect = navInner.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  indicator.style.left = `${btnRect.left - navRect.left}px`;
  indicator.style.width = `${btnRect.width}px`;
}

window.addEventListener('resize', () => updateIndicator());


/* ═══════════════════════════════════════════════════════════
   ANIMATED NUMBER COUNTER
   ═══════════════════════════════════════════════════════════ */

function animateCounter(element, target) {
  const current = parseInt(element.textContent, 10) || 0;
  if (current === target) return;
  const duration = 800;
  const startTime = performance.now();

  function step(timestamp) {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}


/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════ */

async function refreshDashboardData() {
  const [sessions, testbeds, health] = await Promise.all([
    fetchSessions(),
    fetchTestbeds(),
    fetchHealth(),
  ]);

  state.sessions = sessions;
  state.testbeds = testbeds.length ? testbeds : FALLBACK_TESTBEDS;

  const activeSessions = sessions.filter(
    (s) => s.status === 'ACTIVE' || s.status === 'READY' || s.status === 'PROVISIONING'
  ).length;

  state.stats = {
    activeSessions,
    availableTestbeds: state.testbeds.length,
    totalSessions: sessions.length,
    systemHealth: health.status || 'unknown',
  };

  renderDashboard();
}

function renderDashboard() {
  const { stats, sessions } = state;

  // Animated counters
  animateCounter(document.getElementById('stat-val-active'), stats.activeSessions);
  animateCounter(document.getElementById('stat-val-testbeds'), stats.availableTestbeds);
  animateCounter(document.getElementById('stat-val-total'), stats.totalSessions);

  // Health text
  const healthEl = document.getElementById('stat-val-health');
  const hMap = { healthy: '● Healthy', degraded: '◐ Degraded', unhealthy: '○ Down', unknown: '— N/A' };
  healthEl.textContent = hMap[stats.systemHealth] || hMap.unknown;
  healthEl.className = 'stat-value stat-health-text';
  if (stats.systemHealth === 'healthy') healthEl.style.color = 'var(--color-success)';
  else if (stats.systemHealth === 'degraded') healthEl.style.color = 'var(--color-warning)';
  else if (stats.systemHealth === 'unhealthy') healthEl.style.color = 'var(--color-error)';
  else healthEl.style.color = 'var(--text-muted)';

  // Recent sessions (last 5)
  const recent = [...sessions]
    .sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0))
    .slice(0, 5);

  const tbody = document.getElementById('recent-sessions-tbody');
  const empty = document.getElementById('recent-sessions-empty');

  if (recent.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = recent.map((s) => sessionRowHTML(s, false)).join('');
  }
}


/* ═══════════════════════════════════════════════════════════
   TESTBED BROWSER
   ═══════════════════════════════════════════════════════════ */

function renderTestbeds() {
  const testbeds = state.testbeds.length ? state.testbeds : FALLBACK_TESTBEDS;
  const grid = document.getElementById('testbed-grid');
  const countBadge = document.getElementById('testbed-count-badge');

  countBadge.textContent = `${testbeds.length} testbed${testbeds.length !== 1 ? 's' : ''}`;

  grid.innerHTML = testbeds
    .map(
      (tb) => `
    <article class="testbed-card" id="testbed-card-${tb.id}">
      <div class="testbed-card-header">
        <div>
          <div class="testbed-codename">${esc(tb.codename || tb.id)}</div>
          <div class="testbed-name">${esc(tb.name)}</div>
        </div>
        <span class="testbed-status-badge ${tb.status || 'online'}">${esc(tb.status || 'online')}</span>
      </div>
      <p class="testbed-description">${esc(tb.description)}</p>
      <div class="testbed-meta">
        ${(tb.experiments || []).map((e) => `<span class="testbed-tag">${esc(e)}</span>`).join('')}
        ${tb.frequencyBand ? `<span class="testbed-tag freq">${esc(tb.frequencyBand)}</span>` : ''}
      </div>
      <div class="testbed-card-footer">
        <span class="form-hint">${(tb.experiments || []).length} experiment type${(tb.experiments || []).length !== 1 ? 's' : ''}</span>
        <button class="btn btn-primary btn-sm" onclick="requestSession('${esc(tb.id)}')" id="btn-request-${tb.id}">Request Session</button>
      </div>
    </article>
  `
    )
    .join('');
}

/** Shortcut: jump to New Session tab with testbed pre-selected. */
function requestSession(testbedId) {
  switchTab('new-session');
  const select = document.getElementById('input-testbed');
  if (select) {
    select.value = testbedId;
    select.dispatchEvent(new Event('change'));
  }
}
// Expose globally for onclick
window.requestSession = requestSession;


/* ═══════════════════════════════════════════════════════════
   SESSION MANAGEMENT TABLE
   ═══════════════════════════════════════════════════════════ */

async function renderSessionsTable() {
  const sessions = await fetchSessions();
  state.sessions = sessions;

  const tbody = document.getElementById('sessions-tbody');
  const empty = document.getElementById('sessions-empty');

  if (sessions.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0)
    );
    tbody.innerHTML = sorted.map((s) => sessionRowHTML(s, true)).join('');
  }
}

function sessionRowHTML(session, showActions) {
  const id = session.id || session.sessionId || '—';
  const testbed = session.testbedId || session.testbed || '—';
  const user = session.userId || session.user || '—';
  const status = session.status || 'UNKNOWN';
  const created = formatDate(session.createdAt || session.created_at);
  const duration = session.duration ? `${session.duration} min` : '—';

  const actionBtns = showActions ? buildActionButtons(id, status) : '';

  return `
    <tr>
      <td title="${esc(id)}">${truncateId(id)}</td>
      <td>${esc(testbed)}</td>
      <td>${esc(user)}</td>
      <td><span class="badge badge-${statusClass(status)}">${esc(status)}</span></td>
      <td>${created}</td>
      ${showActions ? `<td>${duration}</td><td><div class="action-btns">${actionBtns}</div></td>` : ''}
    </tr>
  `;
}

function buildActionButtons(sessionId, status) {
  const btns = [];
  const sid = esc(sessionId);

  if (status === 'READY' || status === 'ACTIVE') {
    btns.push(`<button class="btn btn-success btn-sm" onclick="handleConnect('${sid}')" id="btn-connect-${sid}" title="Connect via noVNC">Connect</button>`);
  }
  if (status === 'PENDING') {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="handleStart('${sid}')" id="btn-start-${sid}" title="Start session">Start</button>`);
  }
  if (['ACTIVE', 'READY', 'PROVISIONING'].includes(status)) {
    btns.push(`<button class="btn btn-warning btn-sm" onclick="handleStop('${sid}')" id="btn-stop-${sid}" title="Stop session">Stop</button>`);
  }
  if (['COMPLETED', 'FAILED', 'PENDING'].includes(status)) {
    btns.push(`<button class="btn btn-danger btn-sm" onclick="handleDelete('${sid}')" id="btn-delete-${sid}" title="Delete session">Delete</button>`);
  }

  return btns.join('');
}

/* ── Session action handlers ── */

async function handleStart(sessionId) {
  try {
    await startSession(sessionId);
    showToast(`Session ${truncateId(sessionId)} starting…`, 'info');
    renderSessionsTable();
    refreshDashboardData();
  } catch (err) {
    showToast(`Failed to start session: ${err.message}`, 'error');
  }
}
window.handleStart = handleStart;

async function handleStop(sessionId) {
  try {
    await stopSession(sessionId);
    showToast(`Session ${truncateId(sessionId)} stopping…`, 'info');
    renderSessionsTable();
    refreshDashboardData();
  } catch (err) {
    showToast(`Failed to stop session: ${err.message}`, 'error');
  }
}
window.handleStop = handleStop;

async function handleDelete(sessionId) {
  if (!confirm('Delete this session permanently?')) return;
  try {
    await deleteSession(sessionId);
    showToast(`Session ${truncateId(sessionId)} deleted`, 'success');
    renderSessionsTable();
    refreshDashboardData();
  } catch (err) {
    showToast(`Failed to delete session: ${err.message}`, 'error');
  }
}
window.handleDelete = handleDelete;

async function handleConnect(sessionId) {
  try {
    // Attempt to get VNC URL from session details
    const session = state.sessions.find((s) => (s.id || s.sessionId) === sessionId);
    let vncUrl = session?.vncUrl || session?.vnc_url || null;

    if (!vncUrl) {
      // Try fetching from API
      try {
        const detail = await apiFetch(`/sessions/${sessionId}`);
        vncUrl = detail.vncUrl || detail.vnc_url || null;
      } catch {
        // ignore
      }
    }

    if (!vncUrl) {
      // Construct a default noVNC URL based on common pattern
      vncUrl = `${window.location.origin}/vnc/?sessionId=${sessionId}`;
    }

    openVncModal(sessionId, session?.testbedId || session?.testbed || '—', vncUrl);
  } catch (err) {
    showToast(`Failed to connect: ${err.message}`, 'error');
  }
}
window.handleConnect = handleConnect;


/* ═══════════════════════════════════════════════════════════
   NEW SESSION FORM
   ═══════════════════════════════════════════════════════════ */

function initNewSessionForm() {
  const form = document.getElementById('new-session-form');
  const durationInput = document.getElementById('input-duration');
  const durationDisplay = document.getElementById('duration-display');
  const radioNow = document.getElementById('radio-start-now');
  const radioScheduled = document.getElementById('radio-start-scheduled');
  const scheduledInput = document.getElementById('input-scheduled-time');

  // Duration slider
  durationInput.addEventListener('input', () => {
    durationDisplay.textContent = `${durationInput.value} min`;
  });

  // Start-type radios
  radioNow.addEventListener('change', () => scheduledInput.classList.add('hidden'));
  radioScheduled.addEventListener('change', () => {
    scheduledInput.classList.remove('hidden');
    // Set min to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    scheduledInput.min = now.toISOString().slice(0, 16);
  });

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-submit-session');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Launching…';

    const testbedId = document.getElementById('input-testbed').value;
    const userId = document.getElementById('input-user-id').value.trim();
    const duration = parseInt(durationInput.value, 10);
    const startType = document.querySelector('input[name="start-type"]:checked').value;

    if (!testbedId || !userId) {
      showToast('Please fill in all required fields.', 'warning');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> Launch Session';
      return;
    }

    const payload = {
      testbedId,
      userId,
      duration,
    };

    if (startType === 'scheduled') {
      const scheduledTime = scheduledInput.value;
      if (!scheduledTime) {
        showToast('Please select a scheduled start time.', 'warning');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> Launch Session';
        return;
      }
      payload.scheduledStart = new Date(scheduledTime).toISOString();
    }

    try {
      const result = await createSession(payload);
      showToast(`Session created successfully!`, 'success');
      form.reset();
      durationDisplay.textContent = '60 min';
      scheduledInput.classList.add('hidden');
      // Switch to sessions tab to show new session
      switchTab('sessions');
    } catch (err) {
      showToast(`Failed to create session: ${err.message}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML =
        '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> Launch Session';
    }
  });
}

function populateTestbedSelect() {
  const select = document.getElementById('input-testbed');
  const testbeds = state.testbeds.length ? state.testbeds : FALLBACK_TESTBEDS;

  // Keep first placeholder option
  const placeholder = select.querySelector('option[disabled]');
  select.innerHTML = '';
  if (placeholder) select.appendChild(placeholder);

  testbeds.forEach((tb) => {
    const opt = document.createElement('option');
    opt.value = tb.id;
    opt.textContent = `${tb.codename || tb.id} — ${tb.name}`;
    select.appendChild(opt);
  });
}


/* ═══════════════════════════════════════════════════════════
   noVNC MODAL
   ═══════════════════════════════════════════════════════════ */

function openVncModal(sessionId, testbed, url) {
  const modal = document.getElementById('vnc-modal');
  const iframe = document.getElementById('vnc-iframe');
  const testbedLabel = document.getElementById('vnc-modal-testbed');
  const sessionLabel = document.getElementById('vnc-modal-session-id');

  testbedLabel.textContent = testbed;
  sessionLabel.textContent = sessionId;
  iframe.src = url;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeVncModal() {
  const modal = document.getElementById('vnc-modal');
  const iframe = document.getElementById('vnc-iframe');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  // Unload iframe
  setTimeout(() => (iframe.src = 'about:blank'), 350);
}

function initVncModal() {
  document.getElementById('vnc-modal-close').addEventListener('click', closeVncModal);
  document.getElementById('vnc-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeVncModal();
  });
  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeVncModal();
  });
}


/* ═══════════════════════════════════════════════════════════
   TOAST NOTIFICATION SYSTEM
   ═══════════════════════════════════════════════════════════ */

const TOAST_ICONS = {
  success:
    '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:
    '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning:
    '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:
    '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

const TOAST_TITLES = {
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/**
 * Show a toast notification.
 * @param {string} message - Notification text
 * @param {'success'|'error'|'warning'|'info'} type - Toast type
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    ${TOAST_ICONS[type] || TOAST_ICONS.info}
    <div class="toast-body">
      <div class="toast-title">${TOAST_TITLES[type] || 'Notice'}</div>
      <div class="toast-message">${esc(message)}</div>
    </div>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  // Auto-dismiss after 5s
  const timer = setTimeout(() => dismissToast(toast), 5000);

  // Click to dismiss early
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(toast);
  });
}

function dismissToast(toast) {
  toast.classList.add('toast-removing');
  toast.addEventListener('animationend', () => toast.remove());
}


/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════ */

/** Escape HTML to prevent XSS. */
function esc(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/** Truncate a session ID for display. */
function truncateId(id) {
  if (!id) return '—';
  const s = String(id);
  return s.length > 12 ? s.slice(0, 8) + '…' : s;
}

/** Format a date string for display. */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Map status to CSS class suffix. */
function statusClass(status) {
  if (!status) return 'info';
  return status.toLowerCase().replace(/_/g, '-');
}


/* ═══════════════════════════════════════════════════════════
   AUTO-REFRESH
   ═══════════════════════════════════════════════════════════ */

function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(() => {
    if (state.currentTab === 'dashboard') {
      refreshDashboardData();
    } else if (state.currentTab === 'sessions') {
      renderSessionsTable();
    }
  }, REFRESH_INTERVAL_MS);
}


/* ═══════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize sub-systems
  initTabs();
  initNewSessionForm();
  initVncModal();
  initSocket();

  // Load initial data
  state.testbeds = FALLBACK_TESTBEDS;
  await refreshDashboardData();
  renderTestbeds();
  populateTestbedSelect();

  // Start auto-refresh
  startAutoRefresh();
});
