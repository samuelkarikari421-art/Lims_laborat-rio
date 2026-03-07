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
            
            // GERAÇÃO DO TOKEN (O Crachá)
            const token = jwt.sign({ id: user.id, perfil: user.perfil }, SECRET_KEY, { expiresIn: '8h' });
            
            // Envia o usuário e o Token para o Frontend
            res.json({ success: true, user: user, token: token });
        } else {
            res.status(401).json({ success: false, message: "Usuário ou senha incorretos." });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro no servidor." });
    }
});

module.exports = router;