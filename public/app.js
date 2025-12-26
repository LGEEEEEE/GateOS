const API_URL = '';
let currentMode = 'login'; // login ou register
let token = localStorage.getItem('gateos_token');

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        mostrarApp();
    } else {
        mostrarAuth();
    }
});

// --- SISTEMA DE ABAS (LOGIN vs REGISTRO) ---
function switchTab(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    const btn = document.getElementById('btn-auth');
    btn.innerText = mode === 'login' ? 'ACESSAR SISTEMA' : 'CRIAR CONTA GRÁTIS';
}

// --- AUTH (LOGIN / REGISTRO) ---
async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const endpoint = currentMode === 'login' ? '/auth/login' : '/auth/register';

    try {
        const res = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (currentMode === 'register') {
            if (res.ok) {
                showToast('Conta criada! Faça login.', 'success');
                switchTab('login');
            } else {
                showToast('Erro ao criar conta.', 'error');
            }
        } else {
            // LOGIN
            if (res.ok) {
                const data = await res.json();
                token = data.token;
                localStorage.setItem('gateos_token', token);
                localStorage.setItem('gateos_email', data.email);
                mostrarApp();
            } else {
                showToast('Credenciais inválidas.', 'error');
            }
        }
    } catch (err) { showToast('Erro de conexão.', 'error'); }
}

// --- NAVEGAÇÃO ---
function mostrarApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('user-email-display').innerText = localStorage.getItem('gateos_email');
    carregarDevices();
}

function mostrarAuth() {
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
}

// --- CONFIGURAÇÕES E MODAL ---
function toggleSettings(show) {
    const modal = document.getElementById('settings-modal');
    show ? modal.classList.add('active') : modal.classList.remove('active');
}

function logout() {
    localStorage.removeItem('gateos_token');
    token = null;
    toggleSettings(false);
    mostrarAuth();
    showToast('Você saiu do sistema.');
}

async function mudarSenha() {
    const newPassword = document.getElementById('new-pass').value;
    if (!newPassword) return showToast('Digite uma senha.', 'error');

    const res = await fetch(`${API_URL}/user/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ newPassword })
    });

    if (res.ok) {
        showToast('Senha alterada com sucesso!', 'success');
        document.getElementById('new-pass').value = '';
    } else {
        showToast('Erro ao alterar senha.', 'error');
    }
}

async function deletarConta() {
    if (!confirm('TEM CERTEZA? Isso apagará todos os seus dispositivos!')) return;

    const res = await fetch(`${API_URL}/user/me`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) logout();
}

// --- DISPOSITIVOS (Lógica Protegida) ---
async function carregarDevices() {
    const res = await fetch(`${API_URL}/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const devices = await res.json();
    const grid = document.getElementById('devicesList');
    grid.innerHTML = '';

    devices.forEach(d => {
        const div = document.createElement('div');
        div.className = 'device-card';
        div.innerHTML = `
            <h3>${d.nomeAmigavel}</h3>
            <p style="color:#64748b; font-size:0.8rem; margin-bottom:15px">${d.serialNumber}</p>
            <button onclick="abrirPortao('${d.serialNumber}')" class="btn-outline">
                <span class="material-icons-round">power_settings_new</span> ACIONAR
            </button>
        `;
        grid.appendChild(div);
    });
}

async function adicionarDevice() {
    const nome = document.getElementById('devName').value;
    const serialNumber = document.getElementById('devSN').value;
    
    await fetch(`${API_URL}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ nomeAmigavel: nome, serialNumber })
    });
    
    document.getElementById('devName').value = '';
    document.getElementById('devSN').value = '';
    carregarDevices();
    showToast('Dispositivo Adicionado!');
}

async function abrirPortao(sn) {
    showToast('Enviando comando...', 'success');
    await fetch(`${API_URL}/devices/${sn}/open`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
}

// --- UI HELPERS ---
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}