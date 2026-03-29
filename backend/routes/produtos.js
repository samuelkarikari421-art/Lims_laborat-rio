const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para identificar o autor no log
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
        console.error("Erro ao salvar log de atividade (Produtos):", e.message);
    }
}

// =========================================================================
// 1. Listar todos os Produtos (Agora puxa também os limites de UMIDADE)
// =========================================================================
router.get("/", async (req, res) => {
    try {
        // O DISTINCT ON garante que não duplica a linha caso haja mais de um parâmetro de umidade cadastrado por engano
        const result = await pool.query(`
            SELECT DISTINCT ON (p.id) p.*, 
                   s.valor_min as umidade_min, 
                   s.valor_max as umidade_max
            FROM produtos p
            LEFT JOIN produto_specs s ON p.id = s.produto_id AND s.parametro ILIKE '%Umidade%'
            ORDER BY p.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar produtos:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// =========================================================================
// 2. Cadastrar Novo Produto (COM PREFERÊNCIA)
// =========================================================================
router.post("/", async (req, res) => {
    try {
        const { cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, tem_preferencia, observacoes } = req.body;
        
        await pool.query(
            `INSERT INTO produtos (cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, tem_preferencia, observacoes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, tem_preferencia || false, observacoes]
        );

        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "CRIOU PRODUTO", `Cadastrou o produto: ${cod_produto} - ${nome_produto}`);

        res.json({ success: true, message: "Produto cadastrado com sucesso!" });

    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O código de produto "${req.body.cod_produto}" já está cadastrado em outro item!` });
        }
        console.error("Erro ao cadastrar produto:", err);
        res.status(500).json({ success: false, message: "Erro ao cadastrar produto." });
    }
});

// =========================================================================
// 3. Editar Produto (COM PREFERÊNCIA)
// =========================================================================
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, tem_preferencia, observacoes } = req.body;
        
        await pool.query(
            `UPDATE produtos 
             SET cod_produto = $1, nome_produto = $2, categoria = $3, tipo = $4, peso_embalagem = $5, status = $6, tem_preferencia = $7, observacoes = $8 
             WHERE id = $9`,
            [cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, tem_preferencia || false, observacoes, id]
        );
        
        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "EDITOU PRODUTO", `Alterou o cadastro matriz do produto: ${cod_produto} - ${nome_produto}`);

        res.json({ success: true, message: "Produto atualizado com sucesso!" });

    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O código de produto "${req.body.cod_produto}" já está sendo usado por outro item!` });
        }
        console.error("Erro ao atualizar produto:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar produto." });
    }
});

// =========================================================================
// 4. Excluir Produto
// =========================================================================
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const check = await pool.query("SELECT id FROM amostras WHERE produto_id = $1 LIMIT 1", [id]);
        if (check.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Este produto já possui amostras lançadas. Não pode ser excluído, apenas Desativado." });
        }

        // Pega o nome do produto para o log antes de o apagar
        const prodRes = await pool.query("SELECT nome_produto, cod_produto FROM produtos WHERE id = $1", [id]);
        const nomeProd = prodRes.rows.length > 0 ? `${prodRes.rows[0].cod_produto} - ${prodRes.rows[0].nome_produto}` : `ID ${id}`;

        await pool.query("DELETE FROM produtos WHERE id = $1", [id]);

        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "EXCLUIU PRODUTO", `Apagou definitivamente o produto do catálogo: ${nomeProd}`);

        res.json({ success: true, message: "Produto excluído." });
    } catch (err) {
        console.error("Erro ao excluir produto:", err);
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

// =========================================================================
// ROTAS DE ESPECIFICAÇÕES (REGRAS) DO PRODUTO
// =========================================================================

// Listar Regras de um Produto
router.get("/:id/specs", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produto_specs WHERE produto_id = $1 ORDER BY parametro ASC", [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar especificações" });
    }
});

// Adicionar Regra a um Produto (CORRIGIDO PROTEÇÃO CONTRA VAZIO)
router.post("/:id/specs", async (req, res) => {
    try {
        const { id } = req.params;
        const { parametro, metodo, valor_min, valor_max, unidade } = req.body;
        
        await pool.query(
            "INSERT INTO produto_specs (produto_id, parametro, metodo, valor_min, valor_max, unidade) VALUES ($1, $2, $3, $4, $5, $6)",
            [id, parametro, metodo, valor_min === "" ? null : valor_min, valor_max === "" ? null : valor_max, unidade]
        );

        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "ADICIONOU ESPECIFICAÇÃO", `Adicionou o parâmetro [${parametro}] na ficha do produto (ID: ${id})`);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao salvar especificação" });
    }
});

// Editar Regra a um Produto (Especificação)
router.put("/specs/:idSpec", async (req, res) => {
    try {
        const { idSpec } = req.params;
        const { parametro, metodo, valor_min, valor_max, unidade } = req.body;
        
        await pool.query(
            "UPDATE produto_specs SET parametro = $1, metodo = $2, valor_min = $3, valor_max = $4, unidade = $5 WHERE id = $6",
            [parametro, metodo, valor_min === "" ? null : valor_min, valor_max === "" ? null : valor_max, unidade, idSpec]
        );

        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "EDITOU ESPECIFICAÇÃO", `Alterou os limites de tolerância do parâmetro [${parametro}] (Spec ID: ${idSpec})`);

        res.json({ success: true, message: "Especificação atualizada!" });
    } catch (err) {
        console.error("Erro ao editar especificação:", err);
        res.status(500).json({ error: "Erro ao editar especificação" });
    }
});

// Remover Regra
router.delete("/specs/:idSpec", async (req, res) => {
    try {
        await pool.query("DELETE FROM produto_specs WHERE id = $1", [req.params.idSpec]);

        // 🔥 REGISTA A AÇÃO NO HISTÓRICO
        await registrarLog(req, "EXCLUIU ESPECIFICAÇÃO", `Removeu uma regra de parâmetro da ficha de produto (Spec ID: ${req.params.idSpec})`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao deletar" });
    }
});

module.exports = router;