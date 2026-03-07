const express = require("express");
const router = express.Router();
const pool = require("../db");
const { verificarToken, verificarAdmin } = require('../middleware/authMiddleware');

// 1. Listar Usuários (Qualquer logado pode listar para o sistema funcionar)
router.get("/", verificarToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, nome, cargo, login, perfil, permissoes, assinatura FROM usuarios ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar usuários" });
    }
});

// 2. Criar Usuário (SÓ ADMIN PODE)
router.post("/", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { nome, login, cargo, perfil, senha, permissoes, assinatura } = req.body;
        
        // Trava de segurança: Exigir senha para utilizadores novos!
        if (!senha || senha.trim() === "") {
            return res.status(400).json({ success: false, message: "A senha é obrigatória para cadastrar novos usuários!" });
        }

        await pool.query(
            `INSERT INTO usuarios (nome, login, cargo, perfil, senha, permissoes, assinatura) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [nome, login, cargo, perfil, senha, permissoes, assinatura]
        );
        res.json({ success: true, message: "Usuário criado com sucesso!" });
        
    } catch (err) {
        // AGORA O ERRO VAI GRITAR NO TERMINAL! 🚨
        console.error("ERRO DETALHADO AO CRIAR USUÁRIO:", err);
        
        // Tratamento para Login duplicado (Erro 23505)
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O login "${req.body.login}" já está a ser utilizado por outra pessoa!` });
        }
        
        res.status(500).json({ success: false, message: "Erro interno ao criar usuário. Verifique o terminal." });
    }
});

// 3. Editar Usuário (SÓ ADMIN PODE)
router.put("/:id", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, login, cargo, perfil, senha, permissoes, assinatura, removerAssinatura } = req.body;
        let query = ""; let values = [];

        if (senha) {
            query = "UPDATE usuarios SET nome=$1, login=$2, cargo=$3, perfil=$4, senha=$5, permissoes=$6";
            values = [nome, login, cargo, perfil, senha, permissoes];
        } else {
            query = "UPDATE usuarios SET nome=$1, login=$2, cargo=$3, perfil=$4, permissoes=$5";
            values = [nome, login, cargo, perfil, permissoes];
        }

        if (removerAssinatura === true) {
            query += `, assinatura=NULL`; 
        } else if (assinatura) {
            query += `, assinatura=$${values.length + 1}`; 
            values.push(assinatura);
        }

        query += ` WHERE id=$${values.length + 1}`;
        values.push(id);

        await pool.query(query, values);
        res.json({ success: true, message: "Usuário atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao atualizar usuário" });
    }
});

// 4. Excluir Usuário (SÓ ADMIN PODE)
router.delete("/:id", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);
        res.json({ success: true, message: "Usuário excluído." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

module.exports = router;