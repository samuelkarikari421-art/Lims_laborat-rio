const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');
const { verificarToken, verificarAdmin } = require('../middleware/authMiddleware');

// Tenta importar a chave secreta para podermos ler o crachá do utilizador
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

// =========================================================================
// 🔥 MOTOR SILENCIOSO DE AUDITORIA (LOG DE ATIVIDADES)
// =========================================================================
async function registrarLog(req, acao, detalhes) {
    let usuarioNome = "Sistema / Desconhecido";
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, SECRET);
            const userRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [decoded.id]);
            if (userRes.rows.length > 0) usuarioNome = userRes.rows[0].nome;
        }
    } catch (e) {}

    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade (Usuários):", e.message);
    }
}

// =========================================================================
// 1. LISTAR USUÁRIOS E ATUALIZAR STATUS ONLINE (HEARTBEAT)
// =========================================================================
router.get("/", verificarToken, async (req, res) => {
    try {
        // 🔥 BATIMENTO CARDÍACO: Atualiza o "visto por último" do usuário que fez a requisição
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, SECRET);
            await pool.query("UPDATE usuarios SET ultimo_acesso = CURRENT_TIMESTAMP WHERE id = $1", [decoded.id]);
        } catch (e) {
            console.error("Aviso: Não foi possível atualizar o status online do usuário.", e.message);
        }

        // Devolve a lista completa com a data formatada para a bolinha verde do Front-end
        const result = await pool.query(`
            SELECT id, nome, cargo, login, perfil, permissoes, assinatura, email, recebe_alertas,
                   ultimo_acesso,
                   to_char(ultimo_acesso, 'DD/MM/YYYY HH24:MI:SS') as ultimo_acesso_fmt
            FROM usuarios 
            ORDER BY id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar usuários" });
    }
});

// =========================================================================
// 2. CRIAR USUÁRIO (SÓ ADMIN PODE)
// =========================================================================
router.post("/", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { nome, login, cargo, perfil, senha, permissoes, assinatura, email, recebe_alertas } = req.body;
        
        if (!senha || senha.trim() === "") {
            return res.status(400).json({ success: false, message: "A senha é obrigatória para cadastrar novos usuários!" });
        }

        await pool.query(
            `INSERT INTO usuarios (nome, login, cargo, perfil, senha, permissoes, assinatura, email, recebe_alertas) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [nome, login, cargo, perfil, senha, permissoes, assinatura, email || null, recebe_alertas || false]
        );

        await registrarLog(req, "CRIOU USUÁRIO", `Cadastrou o novo utilizador: ${nome} (${perfil})`);

        res.json({ success: true, message: "Usuário criado com sucesso!" });
        
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O login "${req.body.login}" já está a ser utilizado por outra pessoa!` });
        }
        res.status(500).json({ success: false, message: "Erro interno ao criar usuário." });
    }
});

// =========================================================================
// 3. EDITAR USUÁRIO (SÓ ADMIN PODE)
// =========================================================================
router.put("/:id", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, login, cargo, perfil, senha, permissoes, assinatura, removerAssinatura, email, recebe_alertas } = req.body;
        let query = ""; let values = [];

        if (senha) {
            query = "UPDATE usuarios SET nome=$1, login=$2, cargo=$3, perfil=$4, senha=$5, permissoes=$6, email=$7, recebe_alertas=$8";
            values = [nome, login, cargo, perfil, senha, permissoes, email || null, recebe_alertas || false];
        } else {
            query = "UPDATE usuarios SET nome=$1, login=$2, cargo=$3, perfil=$4, permissoes=$5, email=$6, recebe_alertas=$7";
            values = [nome, login, cargo, perfil, permissoes, email || null, recebe_alertas || false];
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

        await registrarLog(req, "EDITOU USUÁRIO", `Alterou os dados cadastrais ou permissões de: ${nome}`);

        res.json({ success: true, message: "Usuário atualizado com sucesso!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao atualizar usuário" });
    }
});

// =========================================================================
// 4. EXCLUIR USUÁRIO (SÓ ADMIN PODE)
// =========================================================================
router.delete("/:id", verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const userRes = await pool.query("SELECT nome, perfil FROM usuarios WHERE id = $1", [id]);
        const nomeUser = userRes.rows.length > 0 ? `${userRes.rows[0].nome} (${userRes.rows[0].perfil})` : `ID ${id}`;

        await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);

        await registrarLog(req, "EXCLUIU USUÁRIO", `Apagou o acesso do utilizador: ${nomeUser}`);

        res.json({ success: true, message: "Usuário excluído." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

// =========================================================================
// 5. ROTA DE AUDITORIA DE ACESSOS 
// =========================================================================
router.get("/auditoria", verificarToken, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, SECRET);
        
        const checkPerm = await pool.query("SELECT perfil, permissoes FROM usuarios WHERE id = $1", [decoded.id]);
        const u = checkPerm.rows[0];
        const isAdmin = (u.perfil === 'ADMIN' || u.perfil === 'ADMINISTRADOR');
        const podeVer = isAdmin || (u.permissoes && u.permissoes.logs_view === true);

        if (!podeVer) {
            return res.status(403).json({ error: "Acesso negado aos logs." });
        }

        const result = await pool.query(`
            SELECT l.id, l.usuario_id, u.nome, u.perfil, l.ip, l.navegador,
                   to_char(l.data_hora, 'DD/MM/YYYY HH24:MI:SS') as data_fmt,
                   CASE 
                       WHEN l.navegador ILIKE '%Windows%' THEN 'Windows'
                       WHEN l.navegador ILIKE '%Mac%' THEN 'Mac OS'
                       WHEN l.navegador ILIKE '%Android%' THEN 'Android'
                       WHEN l.navegador ILIKE '%iPhone%' OR l.navegador ILIKE '%iPad%' THEN 'iOS'
                       ELSE 'Desconhecido'
                   END || ' | ' ||
                   CASE
                       WHEN l.navegador ILIKE '%Edg/%' THEN 'Edge'
                       WHEN l.navegador ILIKE '%Chrome/%' THEN 'Chrome'
                       WHEN l.navegador ILIKE '%Firefox/%' THEN 'Firefox'
                       WHEN l.navegador ILIKE '%Safari/%' THEN 'Safari'
                       ELSE 'Navegador Web'
                   END as browser_resumo
            FROM log_acessos l
            JOIN usuarios u ON l.usuario_id = u.id
            ORDER BY l.data_hora DESC
            LIMIT 300
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao puxar auditoria:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// =========================================================================
// 6. ROTA DE AUDITORIA DE ATIVIDADES 
// =========================================================================
router.get("/atividades", verificarToken, async (req, res) => {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, SECRET);
        
        const checkPerm = await pool.query("SELECT perfil, permissoes FROM usuarios WHERE id = $1", [decoded.id]);
        const u = checkPerm.rows[0];
        const isAdmin = (u.perfil === 'ADMIN' || u.perfil === 'ADMINISTRADOR');
        const podeVer = isAdmin || (u.permissoes && u.permissoes.logs_view === true);

        if (!podeVer) {
            return res.status(403).json({ error: "Acesso negado aos logs." });
        }

        const result = await pool.query(`
            SELECT id, usuario_nome, acao, detalhes,
                   to_char(data_hora, 'DD/MM/YYYY HH24:MI:SS') as data_fmt
            FROM log_atividades
            ORDER BY data_hora DESC
            LIMIT 500
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao puxar log de atividades:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

module.exports = router;