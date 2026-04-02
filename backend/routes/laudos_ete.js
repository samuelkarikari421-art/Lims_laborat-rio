const express = require('express');
const router = express.Router();
const pool = require('../db'); // Conexão com o banco ajustada para a raiz

// ==========================================
// ROTAS DA API - LAUDOS ETE (Salvo no Banco / Base64)
// ==========================================

// GET: Listar todos os laudos ETE
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM laudos_ete ORDER BY data_coleta DESC');
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao listar laudos ETE:", error);
        res.status(500).json({ error: "Erro interno ao buscar laudos." });
    }
});

// POST: Criar novo laudo ETE
router.post('/', async (req, res) => {
    const { data_coleta, numero, status, ponto, laboratorio, observacoes, arquivo_base64 } = req.body;

    try {
        const query = `
            INSERT INTO laudos_ete 
            (data_coleta, numero, status, ponto, laboratorio, observacoes, arquivo_base64)
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            RETURNING *;
        `;
        const values = [data_coleta, numero, status, ponto, laboratorio, observacoes, arquivo_base64];
        
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Erro ao salvar laudo ETE:", error);
        res.status(500).json({ error: "Erro ao cadastrar o laudo." });
    }
});

// PUT: Atualizar laudo existente
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { data_coleta, numero, status, ponto, laboratorio, observacoes, arquivo_base64 } = req.body;
    
    try {
        // Busca o laudo atual para não perder o arquivo antigo caso o usuário não tenha enviado um novo
        const laudoAtual = await pool.query('SELECT arquivo_base64 FROM laudos_ete WHERE id = $1', [id]);
        if (laudoAtual.rows.length === 0) {
            return res.status(404).json({ error: "Laudo não encontrado." });
        }

        // Se o front-end mandou um Base64 novo, usa ele. Se não, mantém o que já estava no banco.
        let base64Final = arquivo_base64 ? arquivo_base64 : laudoAtual.rows[0].arquivo_base64;

        const query = `
            UPDATE laudos_ete 
            SET data_coleta = $1, numero = $2, status = $3, ponto = $4, 
                laboratorio = $5, observacoes = $6, arquivo_base64 = $7
            WHERE id = $8 
            RETURNING *;
        `;
        const values = [data_coleta, numero, status, ponto, laboratorio, observacoes, base64Final, id];
        
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Erro ao atualizar laudo ETE:", error);
        res.status(500).json({ error: "Erro ao atualizar o laudo." });
    }
});

// DELETE: Excluir laudo
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM laudos_ete WHERE id = $1', [id]);
        res.status(200).json({ message: "Laudo excluído com sucesso." });
    } catch (error) {
        console.error("Erro ao excluir laudo ETE:", error);
        res.status(500).json({ error: "Erro ao excluir o laudo." });
    }
});

module.exports = router;