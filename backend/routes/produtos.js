const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Listar todos os Produtos
router.get("/", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produtos ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar produtos:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// 2. Cadastrar Novo Produto (COM VERIFICAÇÃO DE DUPLICIDADE)
router.post("/", async (req, res) => {
    try {
        const { cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, observacoes } = req.body;
        
        await pool.query(
            `INSERT INTO produtos (cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, observacoes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, observacoes]
        );
        res.json({ success: true, message: "Produto cadastrado com sucesso!" });

    } catch (err) {
        // TRATAMENTO DE ERRO DE CÓDIGO DUPLICADO (Erro 23505 no PostgreSQL)
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O código de produto "${req.body.cod_produto}" já está cadastrado em outro item!` });
        }
        console.error("Erro ao cadastrar produto:", err);
        res.status(500).json({ success: false, message: "Erro ao cadastrar produto." });
    }
});

// 3. Editar Produto (COM VERIFICAÇÃO DE DUPLICIDADE)
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, observacoes } = req.body;
        
        await pool.query(
            `UPDATE produtos 
             SET cod_produto = $1, nome_produto = $2, categoria = $3, tipo = $4, peso_embalagem = $5, status = $6, observacoes = $7 
             WHERE id = $8`,
            [cod_produto, nome_produto, categoria, tipo, peso_embalagem, status, observacoes, id]
        );
        
        res.json({ success: true, message: "Produto atualizado com sucesso!" });

    } catch (err) {
        // TRATAMENTO DE ERRO DE CÓDIGO DUPLICADO 
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: `O código de produto "${req.body.cod_produto}" já está sendo usado por outro item!` });
        }
        console.error("Erro ao atualizar produto:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar produto." });
    }
});

// 4. Excluir Produto
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verifica se o produto tem amostras vinculadas antes de excluir
        const check = await pool.query("SELECT id FROM amostras WHERE produto_id = $1 LIMIT 1", [id]);
        if (check.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Este produto já possui amostras lançadas. Não pode ser excluído, apenas Desativado." });
        }

        await pool.query("DELETE FROM produtos WHERE id = $1", [id]);
        res.json({ success: true, message: "Produto excluído." });
    } catch (err) {
        console.error("Erro ao excluir produto:", err);
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

// ==========================================
// ROTAS DE ESPECIFICAÇÕES (REGRAS) DO PRODUTO
// ==========================================

// Listar Regras de um Produto
router.get("/:id/specs", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM produto_specs WHERE produto_id = $1 ORDER BY parametro ASC", [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar especificações" });
    }
});

// Adicionar Regra a um Produto
router.post("/:id/specs", async (req, res) => {
    try {
        const { id } = req.params;
        const { parametro, metodo, valor_min, valor_max, unidade } = req.body;
        
        await pool.query(
            "INSERT INTO produto_specs (produto_id, parametro, metodo, valor_min, valor_max, unidade) VALUES ($1, $2, $3, $4, $5, $6)",
            [id, parametro, metodo, valor_min, valor_max, unidade]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao salvar especificação" });
    }
});

// Remover Regra
router.delete("/specs/:idSpec", async (req, res) => {
    try {
        await pool.query("DELETE FROM produto_specs WHERE id = $1", [req.params.idSpec]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao deletar" });
    }
});

module.exports = router;