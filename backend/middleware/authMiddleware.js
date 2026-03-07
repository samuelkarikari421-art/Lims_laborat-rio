const jwt = require('jsonwebtoken');

// Senha secreta do servidor (Nunca passe isso para o frontend!)
const SECRET_KEY = "KariKari_LIMS_Secret_Key_2026!@#"; 

// Função que verifica se o usuário está logado
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(403).json({ success: false, message: 'Acesso negado! Crachá (Token) não fornecido.' });
    }

    // O formato padrão é "Bearer <token>", então separamos pelo espaço
    const token = authHeader.split(" ")[1];

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(401).json({ success: false, message: 'Sessão expirada ou Token inválido. Faça login novamente.' });
        }
        
        // Se o token for válido, guarda os dados do usuário na requisição para as próximas etapas
        req.userId = decoded.id;
        req.userPerfil = decoded.perfil;
        next(); // Libera a catraca, pode passar!
    });
}

// Função extra para rotas que SÓ o ADMIN pode mexer (ex: tela de usuários)
function verificarAdmin(req, res, next) {
    if (req.userPerfil !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Operação bloqueada! Apenas Administradores podem fazer isso.' });
    }
    next();
}

module.exports = { verificarToken, verificarAdmin, SECRET_KEY };