const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken'); 
const { SECRET_KEY } = require('../middleware/authMiddleware'); 

router.post("/login", async (req, res) => {
    try {
        const { login, senha } = req.body;
        
        const result = await pool.query("SELECT * FROM usuarios WHERE login = $1 AND senha = $2", [login, senha]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            // 🔥 1. CAPTURAR OS DADOS DE AUDITORIA (Cofre de Segurança)
            // Tenta pegar o IP real (mesmo se estiver atrás de um roteador)
            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
            // Se o teste for no próprio computador, traduz "::1" para algo legível
            if (ip === '::1') ip = '127.0.0.1 (Localhost)';
            
            // Pega as informações do dispositivo e do navegador
            const navegador = req.headers['user-agent'] || 'Desconhecido';

            // 🔥 2. GRAVAR NO BANCO DE DADOS SILENCIOSAMENTE
            try {
                await pool.query(
                    "INSERT INTO log_acessos (usuario_id, ip, navegador) VALUES ($1, $2, $3)",
                    [user.id, ip, navegador]
                );
            } catch (auditErr) {
                console.error("⚠️ Aviso: Falha ao gravar log de auditoria", auditErr);
                // Não bloqueamos o login se houver falha ao gravar o log
            }
            
            // 3. GERAÇÃO DO TOKEN (O Crachá)
            // Agora o token carrega o id e o perfil
            const token = jwt.sign({ id: user.id, perfil: user.perfil }, SECRET_KEY, { expiresIn: '8h' });
            
            // 🔒 SEGURANÇA: Nunca envie a senha de volta para o front-end!
            delete user.senha;
            
            // 4. Envia o usuário e o Token para o Frontend
            // O objeto "user" agora contém o "perfil" e as "permissoes" que o sidebar.js precisa!
            res.json({ success: true, user: user, token: token });
        } else {
            res.status(401).json({ success: false, message: "Usuário ou senha incorretos." });
        }
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({ success: false, message: "Erro no servidor." });
    }
});

module.exports = router;