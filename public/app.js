/* ARQUIVO: app.js
   DESCRIÇÃO: Lógica Frontend com Escape de HTML e Captura de Endereço
*/

const API_URL = '';
let currentMode = 'login';
let registerType = 'entrar_condominio';
let token = localStorage.getItem('gateos_token');
let userData = {};

// SEGURANÇA: Função de escape para prevenir XSS no Frontend
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        userData = {
            role: localStorage.getItem('gateos_role'),
            condoName: localStorage.getItem('gateos_condo'),
            accessCode: localStorage.getItem('gateos_code')
        };
        mostrarApp();
    } else {
        mostrarAuth();
    }
});

function switchTab(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    const regFields = document.getElementById('register-fields');
    const btn = document.getElementById('btn-auth');
    
    if (mode === 'login') {
        regFields.style.display = 'none';
        btn.innerText = 'ACESSAR SISTEMA';
    } else {
        regFields.style.display = 'block';
        btn.innerText = 'CADASTRAR';
    }
}

function setType(type) {
    registerType = type;
    document.getElementById('btn-morador').classList.toggle('active-type', type === 'entrar_condominio');
    document.getElementById('btn-sindico').classList.toggle('active-type', type === 'novo_condominio');
    
    // Estilos manuais
    document.getElementById('btn-morador').style.background = type === 'entrar_condominio' ? 'var(--primary)' : 'transparent';
    document.getElementById('btn-morador').style.color = type === 'entrar_condominio' ? 'white' : 'var(--primary)';
    
    document.getElementById('btn-sindico').style.background = type === 'novo_condominio' ? 'var(--primary)' : 'transparent';
    document.getElementById('btn-sindico').style.color = type === 'novo_condominio' ? 'white' : 'var(--primary)';

    if (type === 'novo_condominio') {
        document.getElementById('field-codigo').style.display = 'none';
        document.getElementById('field-novo').style.display = 'block';
    } else {
        document.getElementById('field-codigo').style.display = 'block';
        document.getElementById('field-novo').style.display = 'none';
    }
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    let body = { email, password };

    if (currentMode === 'register') {
        body.tipo = registerType;
        
        if (registerType === 'entrar_condominio') {
            // DADOS DO MORADOR
            body.codigoAcesso = document.getElementById('accessCode').value;
            body.unitType = document.querySelector('input[name="unitType"]:checked').value;
            body.unitNumber = document.getElementById('unitNumber').value;
            body.unitBlock = document.getElementById('unitBlock').value;

            // Validação simples
            if (!body.unitNumber) return showToast('Informe o número da unidade!', 'error');

        } else {
            // DADOS DO SÍNDICO
            body.nomeCondominio = document.getElementById('condoName').value;
        }
    }

    try {
        const res = await fetch(`${API_URL}/auth/${currentMode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (res.ok) {
            if (currentMode === 'register') {
                showToast('Cadastro sucesso! Faça login.', 'success');
                switchTab('login');
            } else {
                token = data.token;
                userData = { role: data.role, condoName: data.condominioNome, accessCode: data.accessCode };
                
                localStorage.setItem('gateos_token', token);
                localStorage.setItem('gateos_role', data.role);
                localStorage.setItem('gateos_condo', data.condominioNome);
                if(data.accessCode) localStorage.setItem('gateos_code', data.accessCode);
                
                mostrarApp();
            }
        } else {
            showToast(data.error || 'Erro na autenticação', 'error');
        }
    } catch (err) { showToast('Erro de conexão', 'error'); }
}

function mostrarApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    
    // SEGURANÇA: Usando escapeHTML
    document.getElementById('condo-name-display').innerHTML = escapeHTML(userData.condoName) || 'Condomínio';
    
    if (userData.role === 'admin') {
        document.getElementById('admin-badge').style.display = 'block';
        document.getElementById('add-device-bar').style.display = 'flex';
        document.getElementById('admin-panel').style.display = 'block';
        document.getElementById('share-code').innerText = userData.accessCode || '---';
    } else {
        document.getElementById('admin-badge').style.display = 'none';
        document.getElementById('add-device-bar').style.display = 'none';
        document.getElementById('admin-panel').style.display = 'none';
    }

    carregarDevices();
}

function mostrarAuth() {
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    setType('entrar_condominio');
}

function logout() {
    localStorage.clear();
    token = null;
    mostrarAuth();
}

async function carregarDevices() {
    try {
        const res = await fetch(`${API_URL}/devices`, { headers: { 'Authorization': `Bearer ${token}` } });
        const devices = await res.json();
        const grid = document.getElementById('devicesList');
        grid.innerHTML = '';

        if (devices.length === 0) {
            grid.innerHTML = '<p style="color:#64748b; width:100%;">Nenhum portão cadastrado.</p>';
            return;
        }

        devices.forEach(d => {
            const btnLogs = userData.role === 'admin' 
                ? `<button onclick="verLogs('${d.serialNumber}')" style="background:none; border:none; color:#64748b; padding:5px; cursor:pointer;"><span class="material-icons-round">history</span></button>` 
                : '';

            const div = document.createElement('div');
            div.className = 'device-card';
            // SEGURANÇA: Usando escapeHTML nos dados do banco
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <h3>${escapeHTML(d.nomeAmigavel)}</h3>
                    ${btnLogs}
                </div>
                <div class="status-badge ${getStatusClass(d.statusUltimo)}">${d.statusUltimo}</div>
                <button onclick="abrirPortao('${d.serialNumber}')" class="control-btn">
                    <span class="material-icons-round">power_settings_new</span> ABRIR
                </button>
            `;
            grid.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

function getStatusClass(status) {
    if (!status) return 'offline';
    if (status.includes('ABERTO')) return 'aberto';
    if (status.includes('FECHADO')) return 'fechado';
    return 'offline';
}

async function adicionarDevice() {
    const nome = document.getElementById('devName').value;
    const serialNumber = document.getElementById('devSN').value;
    const securityCode = document.getElementById('devCode').value;

    const res = await fetch(`${API_URL}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ nomeAmigavel: nome, serialNumber, securityCode })
    });

    if (res.ok) {
        document.getElementById('devName').value = '';
        document.getElementById('devSN').value = '';
        carregarDevices();
        showToast('Portão Adicionado!');
    } else {
        const data = await res.json();
        showToast(data.error || 'Erro ao adicionar', 'error');
    }
}

async function abrirPortao(sn) {
    showToast('Enviando comando...', 'success');
    await fetch(`${API_URL}/devices/${sn}/open`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    setTimeout(carregarDevices, 2000);
}

function toggleLogs(show) {
    const modal = document.getElementById('logs-modal');
    show ? modal.classList.add('active') : modal.classList.remove('active');
}

async function verLogs(sn) {
    toggleLogs(true);
    const container = document.getElementById('logs-list');
    container.innerHTML = '<p style="text-align:center;">Carregando...</p>';

    const res = await fetch(`${API_URL}/devices/${sn}/logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const logs = await res.json();
    
    let html = '<table style="width:100%; text-align:left; font-size:0.8rem;">';
    logs.forEach(l => {
        // SEGURANÇA: Usando escapeHTML no email e na ação
        const safeUser = escapeHTML(l.User ? l.User.email.split('@')[0] : 'User');
        const safeAction = escapeHTML(l.acao);
        
        // MOSTRAR UNIDADE NO LOG SE DISPONÍVEL
        let unidadeInfo = '';
        if (l.User && l.User.unitNumber) {
            unidadeInfo = ` <span style="color:#64748b; font-size:0.75rem;">(${l.User.unitType === 'casa' ? 'Casa' : 'Ap'} ${l.User.unitNumber})</span>`;
        }

        html += `<tr>
            <td style="padding:5px; color:var(--primary);">${safeUser}${unidadeInfo}</td>
            <td>${safeAction}</td>
            <td style="color:#64748b;">${new Date(l.dataHora).toLocaleTimeString()}</td>
        </tr>`;
    });
    html += '</table>';
    container.innerHTML = html;
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}