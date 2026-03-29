const jwt = require('jsonwebtoken');
const pool = require("../db"); // Importamos o banco para checar as permissões em tempo real

// Senha secreta do servidor
const SECRET_KEY = "KariKari_LIMS_Secret_Key_2026!@#"; 

// 1. Função que verifica se o usuário está logado
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(403).json({ success: false, message: 'Acesso negado! Token não fornecido.' });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(401).json({ success: false, message: 'Sessão expirada. Faça login novamente.' });
        }
        
        req.userId = decoded.id;
        req.userPerfil = decoded.perfil;
        next();
    });
}

// 2. Função para rotas EXCLUSIVAS de ADMIN
function verificarAdmin(req, res, next) {
    if (req.userPerfil !== 'ADMIN' && req.userPerfil !== 'ADMINISTRADOR') {
        return res.status(403).json({ success: false, message: 'Bloqueado! Apenas Administradores.' });
    }
    next();
}

// 3. NOVO: Função para verificar permissões específicas (JSONB no banco)
const verificarPermissao = (permissaoNecessaria) => {
    return async (req, res, next) => {
        try {
            // Buscamos o usuário no banco para garantir que as permissões são as mais atuais
            const result = await pool.query("SELECT perfil, permissoes FROM usuarios WHERE id = $1", [req.userId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Usuário não encontrado." });
            }

            const user = result.rows[0];
            const isAdmin = (user.perfil === 'ADMIN' || user.perfil === 'ADMINISTRADOR');

            // Regra: Se for Admin ou se tiver a permissão específica marcada como true no JSON
            if (isAdmin || (user.permissoes && user.permissoes[permissaoNecessaria] === true)) {
                return next();
            }

            return res.status(403).json({ 
                success: false, 
                message: `Acesso negado! Você não tem a permissão: ${permissaoNecessaria}` 
            });

        } catch (err) {
            console.error("Erro no middleware de permissão:", err);
            res.status(500).json({ error: "Erro interno ao validar acesso." });
        }
    };
};

module.exports = { verificarToken, verificarAdmin, verificarPermissao, SECRET_KEY };