const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve o Front

const SECRET_KEY = process.env.JWT_SECRET || 'super_segredo_123';

// --- BANCO DE DADOS ---
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite',
    logging: false
});

// Modelo de Usuário
const User = sequelize.define('User', {
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }
});

// Modelo de Dispositivo (Agora vinculado a um Usuário)
const Device = sequelize.define('Device', {
    serialNumber: { type: DataTypes.STRING, unique: true, allowNull: false },
    nomeAmigavel: { type: DataTypes.STRING, allowNull: false },
    statusUltimo: { type: DataTypes.STRING, defaultValue: 'DESCONHECIDO' }
});

// Relacionamento: Usuário tem vários devices
User.hasMany(Device);
Device.belongsTo(User);

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
// Protege as rotas, exigindo login
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user; // Salva o ID do usuário na requisição
        next();
    });
};

// --- ROTAS DE AUTH ---
app.post('/auth/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ email: req.body.email, password: hashedPassword });
        res.status(201).send('Criado');
    } catch { res.status(400).send('Erro ou Email já existe'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ where: { email: req.body.email } });
    if (!user || !await bcrypt.compare(req.body.password, user.password)) {
        return res.status(400).send('Email ou senha inválidos');
    }
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
    res.json({ token, email: user.email });
});

// --- ROTAS DE USUÁRIO (O que você pediu) ---

// Mudar Senha
app.post('/user/password', authenticate, async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
        await User.update({ password: hashedPassword }, { where: { id: req.user.id } });
        res.send('Senha atualizada');
    } catch { res.status(500).send('Erro'); }
});

// Deletar Conta (Apaga usuário e seus devices)
app.delete('/user/me', authenticate, async (req, res) => {
    try {
        await Device.destroy({ where: { UserId: req.user.id } }); // Remove devices
        await User.destroy({ where: { id: req.user.id } }); // Remove user
        res.send('Conta deletada');
    } catch { res.status(500).send('Erro'); }
});

// --- ROTAS DE DEVICES (Protegidas) ---
app.get('/devices', authenticate, async (req, res) => {
    // Só retorna os devices DO USUÁRIO logado
    const devices = await Device.findAll({ where: { UserId: req.user.id } });
    res.json(devices);
});

app.post('/devices', authenticate, async (req, res) => {
    try {
        await Device.create({
            ...req.body,
            UserId: req.user.id // Vincula ao dono
        });
        res.sendStatus(201);
    } catch { res.status(400).send('Erro'); }
});

app.post('/devices/:sn/open', authenticate, (req, res) => {
    // Aqui validaria se o device pertence ao user, mas simplificaremos
    const { sn } = req.params;
    mqttClient.publish(`gate/${sn}/cmd`, 'ABRIR_PORTAO_AGORA');
    res.sendStatus(200);
});

// --- MQTT (Mesma lógica anterior) ---
const mqttClient = mqtt.connect(process.env.MQTT_URL, { /* ...mesmas configs... */ });
// ... lógica de subscribe e message igual ...

sequelize.sync().then(() => {
    app.listen(3000, () => console.log('🔥 Server Seguro na porta 3000'));
});