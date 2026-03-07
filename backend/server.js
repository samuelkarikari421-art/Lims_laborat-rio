const express = require("express");
const cors = require("cors");
const path = require("path");
const pool = require("./db"); 

const app = express();

app.use(cors());

// 🚀 SOLUÇÃO AQUI: Aumentando o limite do Express para 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, "../frontend")));

// Rotas da API
app.use("/api/auth", require("./routes/auth"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/produtos", require("./routes/produtos"));
app.use("/api/analises", require("./routes/analises"));
app.use("/api/usuarios", require("./routes/usuarios"));
app.use("/api/amostras", require("./routes/amostras"));
app.use("/api/laudos", require("./routes/laudos"));
app.use("/api/reagentes", require("./routes/reagentes"));
app.use("/api/relatorios", require("./routes/relatorios"));
app.use("/api/solucoes", require("./routes/solucoes"));

// Teste de conexão ao iniciar
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error("❌ ERRO CRÍTICO: Banco de dados não conectado!");
        console.error(err.message);
    } else {
        console.log("✅ BANCO DE DADOS: Conectado e pronto.");
    }
});

// Qualquer outra rota vai para o login
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

// --- PORTA 3002 (Configurada aqui) ---
const PORT = 3002;
const HOST = '0.0.0.0'; // O segredo está aqui: 0.0.0.0 permite conexões de outros computadores da rede

app.listen(PORT, HOST, () => {
    console.log(`🚀 LIMS Kari Kari rodando na porta ${PORT}`);
    console.log(`💻 Acesso Local: http://localhost:${PORT}`);
    console.log(`🌐 Acesso na Rede: http://192.168.100.132:${PORT}`);
});