const { Pool } = require("pg");

const pool = new Pool({
    user: "lims_app",
    host: "localhost",
    database: "lims_kari_kari",
    password: "limsbatata2620", 
    port: 5432
});

pool.on("connect", () => {
    // Conexão silenciosa para não poluir o terminal
});

pool.on("error", (err) => {
    console.error("❌ Erro inesperado no banco:", err);
    process.exit(-1);
});

module.exports = pool;