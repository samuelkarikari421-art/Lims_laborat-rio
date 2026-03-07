const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Listar Reagentes (Lógica FIFO)
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT *, 
                   to_char(validade, 'DD/MM/YYYY') as validade_fmt,
                   to_char(validade, 'YYYY-MM-DD') as validade_input,
                   to_char(data_entrada, 'DD/MM/YYYY HH24:MI') as entrada_fmt,
                   to_char(data_ultimo_uso, 'DD/MM/YYYY HH24:MI') as ultimo_uso_fmt
            FROM reagentes 
            ORDER BY validade ASC, id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar reagentes" });
    }
});

// 2. Cadastrar Entrada de Material 
router.post("/", async (req, res) => {
    try {
        // INCLUÍDO OS 4 NOVOS CAMPOS AQUI:
        const { nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, responsavel, observacoes } = req.body;

        const seqRes = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM reagentes");
        const nextId = seqRes.rows[0].next_id;

        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const codGerado = `RGT-${ano}${mes}-${String(nextId).padStart(4, '0')}`;

        await pool.query(
            `INSERT INTO reagentes 
            (codigo, nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, status, observacoes, responsavel, data_entrada) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'OK', $15, $16, NOW())`,
            [codGerado, nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, observacoes, responsavel]
        );

        res.json({ success: true, message: "Reagente registrado com sucesso!", codigoGerado: codGerado });
    } catch (err) {
        console.error("Erro ao cadastrar reagente:", err);
        res.status(500).json({ success: false, message: "Erro ao salvar no banco." });
    }
});

// 3. EDITAR Reagente 
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, observacoes } = req.body;

        await pool.query(
            `UPDATE reagentes 
             SET nome = $1, grau_pureza = $2, fabricante = $3, lote = $4, cas = $5, unidade = $6, 
                 quantidade = $7, estoque_minimo = $8, validade = $9, local_armazenamento = $10, 
                 faixa_uso = $11, metodo_analitico = $12, periculosidade = $13, observacoes = $14
             WHERE id = $15`,
            [nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, observacoes, id]
        );

        res.json({ success: true, message: "Reagente atualizado com sucesso!" });
    } catch (err) {
        console.error("Erro ao atualizar reagente:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar." });
    }
});

// 4. Excluir Reagente
router.delete("/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM reagentes WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

// 5. Atualizar Estoque (Consumo)
router.put("/:id/movimentar", async (req, res) => {
    try {
        const { qtd, tipo } = req.body;
        const operador = tipo === 'entrada' ? '+' : '-';
        await pool.query(`UPDATE reagentes SET quantidade = quantidade ${operador} $1, data_ultimo_uso = NOW() WHERE id = $2`, [qtd, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;