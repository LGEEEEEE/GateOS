/* ARQUIVO: server.js
   DESCRIÇÃO: Backend Multi-Tenant Seguro com Endereço de Unidade
*/
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit');
const xss = require('xss'); 
require('dotenv').config();

const app = express();

// 1. SEGURANÇA: Configuração permissiva para evitar bloqueio de onclick e fontes
app.use(helmet({
    contentSecurityPolicy: false,       // Permite scripts inline (onclick)
    crossOriginEmbedderPolicy: false,   // Permite carregar recursos de fora
    crossOriginResourcePolicy: false    // Evita bloqueios de CORB
}));

// 2. SEGURANÇA: Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "Muitas tentativas deste IP. Tente novamente em 15 minutos." }
});
app.use(limiter);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 3. SEGURANÇA: Sanitização (Anti-XSS)
const sanitizeInput = (req, res, next) => {
    if (req.body) {
        for (let key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = xss(req.body[key]);
            }
        }
    }
    next();
};
app.use(sanitizeInput);

const SECRET_KEY = process.env.JWT_SECRET || 'gateos_super_secret_key_prod';
const PORT = process.env.PORT || 3000;

// --- MQTT CONFIG ---
const MQTT_HOST = 'e7ed4f597a2e4552bff29de8b6dba0d8.s1.eu.hivemq.cloud';
const MQTT_PORT = 8883;
const MQTT_USER = 'AdminGateOS'; 
const MQTT_PASS = '6A1EAa40180C5A4399E6B1E89DAB79728F5E1DE9F777739462AD2331E8B3BF383';

const mqttClient = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
    username: MQTT_USER, password: MQTT_PASS, protocol: 'mqtts', rejectUnauthorized: false
});

mqttClient.on('connect', () => { console.log('✅ MQTT Conectado'); mqttClient.subscribe('gate/+/status'); });
mqttClient.on('message', async (topic, msg) => {
    if (topic.includes('/status')) {
        const sn = topic.split('/')[1];
        await Device.update({ statusUltimo: msg.toString() }, { where: { serialNumber: sn } }).catch(console.error);
    }
});

// --- DATABASE ---
const isProduction = process.env.NODE_ENV === 'production';
let sequelize;

if (isProduction) {
    sequelize = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false
    });
} else {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: './database.sqlite', logging: false });
}

// --- MODELS ---
const Condominio = sequelize.define('Condominio', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    nome: { type: DataTypes.STRING, allowNull: false },
    accessCode: { type: DataTypes.STRING, unique: true }
});

const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'morador' },
    // NOVOS CAMPOS DE ENDEREÇO
    unitType: { type: DataTypes.STRING },   // 'casa' ou 'apto'
    unitNumber: { type: DataTypes.STRING }, // '503'
    unitBlock: { type: DataTypes.STRING }   // 'Torre A'
});

const Device = sequelize.define('Device', {
    serialNumber: { type: DataTypes.STRING, primaryKey: true },
    nomeAmigavel: { type: DataTypes.STRING, allowNull: false },
    statusUltimo: { type: DataTypes.STRING, defaultValue: 'OFFLINE' },
    securityCode: { type: DataTypes.STRING, defaultValue: '1234' }
});

const Log = sequelize.define('Log', {
    acao: { type: DataTypes.STRING },
    dataHora: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
});

Condominio.hasMany(User); User.belongsTo(Condominio);
Condominio.hasMany(Device); Device.belongsTo(Condominio);
User.hasMany(Log); Log.belongsTo(User);
Device.hasMany(Log); Log.belongsTo(Device);

// --- MIDDLEWARES ---
const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.sendStatus(403);
        req.user = decoded;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas síndicos podem fazer isso.' });
    next();
};

// --- ROTAS ---

app.post('/auth/register', async (req, res) => {
    // Captura os novos campos do body
    const { email, password, tipo, nomeCondominio, codigoAcesso, unitType, unitNumber, unitBlock } = req.body;
    
    try {
        const hash = await bcrypt.hash(password, 10);
        let condominio;

        if (tipo === 'novo_condominio') {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            condominio = await Condominio.create({ nome: nomeCondominio, accessCode: code });
            
            // Síndico também pode ter unidade, salvamos se vier
            await User.create({ 
                email, password: hash, role: 'admin', CondominioId: condominio.id,
                unitType, unitNumber, unitBlock
            });
        } else {
            condominio = await Condominio.findOne({ where: { accessCode: codigoAcesso } });
            if (!condominio) return res.status(404).json({ error: 'Código do condomínio inválido.' });
            
            // Cria morador com os dados da unidade
            await User.create({ 
                email, password: hash, role: 'morador', CondominioId: condominio.id,
                unitType, unitNumber, unitBlock
            });
        }
        res.status(201).json({ message: 'Conta criada com sucesso!' });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: 'Erro ao criar conta. Verifique os dados.' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const user = await User.findOne({ where: { email: req.body.email } });
        if (!user || !await bcrypt.compare(req.body.password, user.password)) return res.status(400).json({error: 'Credenciais inválidas'});
        
        const token = jwt.sign({ 
            id: user.id, email: user.email, role: user.role, condominioId: user.CondominioId 
        }, SECRET_KEY);

        const condominio = await Condominio.findByPk(user.CondominioId);
        
        // Retornamos dados extras se precisar usar no front
        res.json({ 
            token, 
            email: user.email, 
            role: user.role, 
            condominioNome: condominio.nome, 
            accessCode: user.role === 'admin' ? condominio.accessCode : null 
        });
    } catch (e) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

app.get('/devices', authenticate, async (req, res) => {
    try {
        const devices = await Device.findAll({ where: { CondominioId: req.user.condominioId } });
        res.json(devices);
    } catch (e) { res.status(500).json({error: 'Erro ao buscar dispositivos'}); }
});

app.post('/devices', authenticate, isAdmin, async (req, res) => {
    const { nomeAmigavel, serialNumber, securityCode } = req.body;
    try {
        const exists = await Device.findOne({ where: { serialNumber } });
        if (exists && exists.CondominioId !== req.user.condominioId) {
            return res.status(400).json({ error: 'Este dispositivo pertence a outro condomínio.' });
        }

        await Device.upsert({
            serialNumber,
            nomeAmigavel, 
            securityCode: securityCode || '1234',
            CondominioId: req.user.condominioId
        });
        
        res.sendStatus(201);
    } catch (e) { res.status(400).json({ error: 'Erro ao cadastrar' }); }
});

app.post('/devices/:sn/open', authenticate, async (req, res) => {
    const { sn } = req.params;
    try {
        const device = await Device.findOne({ where: { serialNumber: sn, CondominioId: req.user.condominioId } });
        if (!device) return res.status(403).json({ error: 'Sem permissão' });

        const payload = `${device.securityCode}:ABRIR_PORTAO_AGORA`;
        mqttClient.publish(`gate/${sn}/cmd`, payload);

        await Log.create({ UserId: req.user.id, DeviceSerialNumber: sn, acao: 'ACIONOU_ABERTURA' });
        res.sendStatus(200);
    } catch(e) { res.status(500).json({error: 'Erro no comando'}); }
});

app.get('/devices/:sn/logs', authenticate, isAdmin, async (req, res) => {
    const { sn } = req.params;
    try {
        const device = await Device.findOne({ where: { serialNumber: sn, CondominioId: req.user.condominioId } });
        if (!device) return res.status(403).json({ error: 'Sem permissão' });

        const logs = await Log.findAll({
            where: { DeviceSerialNumber: sn },
            include: [{ model: User, attributes: ['email', 'unitType', 'unitNumber', 'unitBlock'] }], // Trazemos info da unidade se quiser mostrar
            order: [['dataHora', 'DESC']],
            limit: 50
        });
        res.json(logs);
    } catch(e) { res.status(500).json({error: 'Erro ao buscar logs'}); }
});

sequelize.sync({ alter: true }).then(() => {
    console.log('✅ Banco de dados Seguro sincronizado!');
    app.listen(PORT, () => console.log(`🚀 Server na porta ${PORT}`));
});