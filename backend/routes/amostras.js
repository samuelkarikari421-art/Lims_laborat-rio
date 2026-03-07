const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Listar todas as Amostras
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, p.nome_produto, p.cod_produto,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt,
                   to_char(a.data_coleta, 'DD/MM/YYYY') as data_coleta_fmt,
                   
                   -- 🔥 NOVO PADRÃO: LDO-YYYYMM-ID
                   CASE 
                       WHEN l.id IS NOT NULL THEN 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0')
                       ELSE NULL 
                   END as laudo_numero, 
                   
                   l.resultado as laudo_resultado,
                   to_char(l.data_emissao, 'DD/MM/YYYY HH24:MI') as data_saida_fmt,
                   u.nome as analista_nome
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            LEFT JOIN usuarios u ON u.id = l.emitido_por
            ORDER BY a.data_entrada ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar amostras:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// 2. Detalhes Específicos
router.get("/:id/detalhes", async (req, res) => {
    try {
        const amostraRes = await pool.query(`
            SELECT a.*, p.nome_produto,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt,
                   to_char(a.data_coleta, 'DD/MM/YYYY') as data_coleta_fmt
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            WHERE a.id = $1
        `, [req.params.id]);

        if (amostraRes.rows.length === 0) return res.status(404).send("Amostra não encontrada");

        const resultadosRes = await pool.query(`
            SELECT parametro, valor_encontrado, conforme, metodo, unidade
            FROM analises
            WHERE amostra_id = $1
        `, [req.params.id]);

        res.json({ amostra: amostraRes.rows[0], resultados: resultadosRes.rows });
    } catch (err) {
        console.error("Erro ao carregar detalhes:", err);
        res.status(500).send("Erro interno");
    }
});

// 3. Cadastrar Nova Amostra (Formato: YYYYMM-0011)
router.post("/", async (req, res) => {
    try {
        const produto_id = req.body.produto_id;
        const lote = req.body.lote;
        const linha_producao = req.body.linha_producao || 'Geral';
        const hora_coleta = req.body.hora_coleta || '00:00';
        const responsavel_coleta = req.body.responsavel_coleta || 'Sistema';
        const tipo_analise = req.body.tipo_analise || 'Rotina';
        const desvio = req.body.desvio || 'Não';
        const observacoes = req.body.observacoes || null;

        const data_coleta = (req.body.data_fabricacao && req.body.data_fabricacao !== "") ? req.body.data_fabricacao : ((req.body.data_coleta && req.body.data_coleta !== "") ? req.body.data_coleta : null);
        const data_validade = (req.body.data_validade && req.body.data_validade !== "") ? req.body.data_validade : null;

        const seqRes = await pool.query("SELECT COALESCE(MAX(id), 10) + 1 AS next_id FROM amostras");
        const nextId = seqRes.rows[0].next_id;

        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        
        const codigoGerado = `${ano}${mes}-${String(nextId).padStart(4, '0')}`;

        await pool.query(
            `INSERT INTO amostras 
            (codigo, produto_id, lote, status, linha_producao, data_coleta, data_validade, hora_coleta, responsavel_coleta, tipo_analise, desvio, observacoes, data_entrada) 
            VALUES ($1, $2, $3, 'PENDENTE', $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [codigoGerado, produto_id, lote, linha_producao, data_coleta, data_validade, hora_coleta, responsavel_coleta, tipo_analise, desvio, observacoes]
        );
        res.json({ success: true, message: "Amostra registrada com sucesso!", codigoGerado });
    } catch (err) {
        console.error("Erro ao registrar amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao registrar amostra" });
    }
});

// 4. Editar Amostra
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { produto_id, lote, linha_producao, data_fabricacao, data_validade, observacoes } = req.body;
        
        const d_fab = (data_fabricacao && data_fabricacao !== "") ? data_fabricacao : null;
        const d_val = (data_validade && data_validade !== "") ? data_validade : null;
        const linha = linha_producao || null;
        
        await pool.query(
            `UPDATE amostras 
             SET produto_id = $1, lote = $2, data_coleta = $3, data_validade = $4, linha_producao = $5, observacoes = $6 
             WHERE id = $7`,
            [produto_id, lote, d_fab, d_val, linha, observacoes, id]
        );
        
        res.json({ success: true, message: "Amostra atualizada com sucesso!" });
    } catch (err) {
        console.error("Erro ao atualizar amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar amostra." });
    }
});

// 5. Excluir Amostra
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const check = await pool.query("SELECT status FROM amostras WHERE id = $1", [id]);
        if (check.rows.length > 0 && check.rows[0].status !== 'PENDENTE') {
            return res.status(400).json({ success: false, message: "Amostras em análise ou concluídas não podem ser excluídas." });
        }

        await pool.query("DELETE FROM amostras WHERE id = $1", [id]);
        res.json({ success: true, message: "Amostra excluída com sucesso!" });
    } catch (err) {
        console.error("Erro ao excluir amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao excluir a amostra." });
    }
});

module.exports = router;