// database.js
const { Sequelize } = require('sequelize');
require('dotenv').config();

// Verifica se estamos rodando localmente ou em produção
const isProduction = process.env.NODE_ENV === 'production';

let sequelize;

if (isProduction) {
    // Configuração para o Supabase (PostgreSQL)
    sequelize = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false // Necessário para Supabase/Heroku
            }
        }
    });
} else {
    // Configuração para Testes Locais (SQLite)
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: './database.sqlite', // Cria um arquivo local
        logging: false
    });
}

module.exports = sequelize;