import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Dashboard HTML
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenAssist Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    
    .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
    .logo { font-size: 1.5rem; font-weight: bold; color: #22d3ee; }
    .status { display: flex; align-items: center; gap: 0.5rem; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; }
    
    .nav { background: #1e293b; padding: 0.75rem 2rem; display: flex; gap: 0.5rem; border-bottom: 1px solid #334155; }
    .nav-btn { background: transparent; border: none; color: #94a3b8; padding: 0.5rem 1rem; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
    .nav-btn:hover { background: #334155; color: #e2e8f0; }
    .nav-btn.active { background: #22d3ee; color: #0f172a; }
    
    .main { padding: 2rem; }
    
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: #22d3ee; }
    
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat { background: #0f172a; padding: 1.25rem; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #22d3ee; }
    .stat-label { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; }
    
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-weight: 500; font-size: 0.875rem; }
    tr:hover { background: #0f172a; }
    
    .btn { background: #22d3ee; color: #0f172a; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 500; }
    .btn:hover { background: #06b6d4; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; }
    input, select { width: 100%; padding: 0.625rem; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; }
    input:focus, select:focus { outline: none; border-color: #22d3ee; }
    
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .log-entry { padding: 0.5rem; border-bottom: 1px solid #334155; font-family: monospace; font-size: 0.875rem; }
    .log-time { color: #64748b; }
    .log-user { color: #22d3ee; }
    .log-ai { color: #a78bfa; }
    
    .advanced { display: none; }
    .advanced.show { display: block; }
    .advanced-toggle { background: none; border: none; color: #64748b; cursor: pointer; font-size: 0.875rem; }
    .advanced-toggle:hover { color: #22d3ee; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🤖 OpenAssist</div>
    <div class="status">
      <div class="status-dot"></div>
      <span>Online</span>
    </div>
  </div>
  
  <nav class="nav">
    <button class="nav-btn active" onclick="showTab('overview')">Overview</button>
    <button class="nav-btn" onclick="showTab('users')">Users</button>
    <button class="nav-btn" onclick="showTab('conversations')">Conversations</button>
    <button class="nav-btn" onclick="showTab('reminders')">Reminders</button>
    <button class="nav-btn" onclick="showTab('settings')">Settings</button>
  </nav>
  
  <main class="main">
    <!-- Overview Tab -->
    <div id="overview" class="tab-content active">
      <div class="stats">
        <div class="stat">
          <div class="stat-value" id="totalUsers">-</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="totalMessages">-</div>
          <div class="stat-label">Messages Today</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="activeReminders">-</div>
          <div class="stat-label">Active Reminders</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="uptime">-</div>
          <div class="stat-label">Uptime</div>
        </div>
      </div>
      
      <div class="card" style="margin-top: 1.5rem;">
        <div class="card-title">Recent Activity</div>
        <div id="recentActivity"></div>
      </div>
    </div>
    
    <!-- Users Tab -->
    <div id="users" class="tab-content">
      <div class="card">
        <div class="card-title">User Management</div>
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Joined</th><th>Actions</th></tr>
          </thead>
          <tbody id="usersTable"></tbody>
        </table>
      </div>
    </div>
    
    <!-- Conversations Tab -->
    <div id="conversations" class="tab-content">
      <div class="card">
        <div class="card-title">Conversation Logs</div>
        <div id="conversationLogs"></div>
      </div>
    </div>
    
    <!-- Reminders Tab -->
    <div id="reminders" class="tab-content">
      <div class="card">
        <div class="card-title">Active Reminders</div>
        <table>
          <thead>
            <tr><th>User</th><th>Message</th><th>Schedule</th><th>Next Run</th><th>Actions</th></tr>
          </thead>
          <tbody id="remindersTable"></tbody>
        </table>
      </div>
    </div>
    
    <!-- Settings Tab -->
    <div id="settings" class="tab-content">
      <div class="card">
        <div class="card-title">Configuration</div>
        <div class="form-group">
          <label>OpenAI API Key</label>
          <input type="password" id="openaiKey" placeholder="sk-...">
        </div>
        <div class="form-group">
          <label>Telegram Bot Token</label>
          <input type="password" id="telegramToken" placeholder="123456:ABC-DEF...">
        </div>
        <div class="form-group">
          <label>Max Conversation Turns</label>
          <input type="number" id="maxTurns" value="50">
        </div>
        <div class="form-group">
          <label>Log Level</label>
          <select id="logLevel">
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info" selected>Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <button class="btn" onclick="saveSettings()">Save Settings</button>
        
        <div style="margin-top: 1.5rem;">
          <button class="advanced-toggle" onclick="toggleAdvanced()">▼ Advanced Settings</button>
        </div>
        
        <div class="advanced">
          <div class="form-group">
            <label>Rate Limit - Web Search (per hour)</label>
            <input type="number" id="rateWebSearch" value="20">
          </div>
          <div class="form-group">
            <label>Rate Limit - Web Fetch (per hour)</label>
            <input type="number" id="rateWebFetch" value="30">
          </div>
          <div class="form-group">
            <label>Session Timeout (minutes)</label>
            <input type="number" id="sessionTimeout" value="60">
          </div>
          <div class="form-group">
            <label>Vector Memory Enabled</label>
            <select id="vectorMemory">
              <option value="true" selected>Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <button class="btn" onclick="saveAdvanced()">Save Advanced</button>
        </div>
      </div>
    </div>
  </main>
  
  <script>
    const API = '';
    let startTime = Date.now();
    
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      event.target.classList.add('active');
    }
    
    function toggleAdvanced() {
      document.querySelector('.advanced').classList.toggle('show');
    }
    
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('totalUsers').textContent = data.users || 0;
        document.getElementById('totalMessages').textContent = data.messagesToday || 0;
        document.getElementById('activeReminders').textContent = data.activeReminders || 0;
        const hours = Math.floor((Date.now() - startTime) / 3600000);
        document.getElementById('uptime').textContent = hours + 'h';
      } catch (e) {
        console.log('API not available yet');
      }
    }
    
    async function loadUsers() {
      try {
        const res = await fetch('/api/users');
        const users = await res.json();
        document.getElementById('usersTable').innerHTML = users.map(u => 
          '<tr><td>' + u.id + '</td><td>' + (u.name || 'Unknown') + '</td><td>' + new Date(u.created_at).toLocaleDateString() + '</td><td><button class="btn btn-danger" onclick="deleteUser(\'' + u.id + '\')">Delete</button></td></tr>'
        ).join('');
      } catch (e) {}
    }
    
    async function loadReminders() {
      try {
        const res = await fetch('/api/reminders');
        const reminders = await res.json();
        document.getElementById('remindersTable').innerHTML = reminders.map(r => 
          '<tr><td>' + r.user_id + '</td><td>' + r.message + '</td><td>' + r.schedule + '</td><td>' + new Date(r.next_run).toLocaleString() + '</td><td><button class="btn btn-danger" onclick="deleteReminder(' + r.id + ')">Delete</button></td></tr>'
        ).join('');
      } catch (e) {}
    }
    
    async function loadConversations() {
      try {
        const res = await fetch('/api/conversations?limit=50');
        const convos = await res.json();
        document.getElementById('conversationLogs').innerHTML = convos.map(c => 
          '<div class="log-entry"><span class="log-time">' + new Date(c.created_at).toLocaleTimeString() + '</span> <span class="log-user">' + c.role + ':</span> ' + c.content.substring(0, 100) + '</div>'
        ).join('');
      } catch (e) {}
    }
    
    function saveSettings() {
      alert('Settings saved!');
    }
    
    function saveAdvanced() {
      alert('Advanced settings saved!');
    }
    
    function deleteUser(id) {
      if (confirm('Delete this user?')) {
        fetch('/api/users/' + id, { method: 'DELETE' }).then(loadUsers);
      }
    }
    
    function deleteReminder(id) {
      if (confirm('Delete this reminder?')) {
        fetch('/api/reminders/' + id, { method: 'DELETE' }).then(loadReminders);
      }
    }
    
    loadStats();
    loadUsers();
    loadReminders();
    loadConversations();
    setInterval(loadStats, 30000);
  </script>
</body>
</html>
  `);
});

app.get('/api/stats', (req, res) => {
  res.json({ users: 0, messagesToday: 0, activeReminders: 0 });
});

app.get('/api/users', (req, res) => {
  res.json([]);
});

app.get('/api/reminders', (req, res) => {
  res.json([]);
});

app.get('/api/conversations', (req, res) => {
  res.json([]);
});

const PORT = process.env.DASHBOARD_PORT || 3001;
app.listen(PORT, () => {
  console.log(`📊 Dashboard running at http://localhost:${PORT}/dashboard`);
});

export default app;
