const express = require("express");
const router = express.Router();
const pool = require("../db");

// SALVAR COLETA
router.post("/salvar", async (req, res) => {
    try {
        const { codigo, ponto, data_fmt, responsavel, valor, observacoes } = req.body;
        const status = parseFloat(valor) > 25.0 ? 'NÃO CONFORME' : 'CONFORME'; // Limite padrão de 25%

        await pool.query(
            `INSERT INTO monitoramento_tpm (codigo, ponto, data_coleta, responsavel, valor_tpm, status, observacoes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [codigo, ponto, data_fmt, responsavel, valor, status, observacoes]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// BUSCAR HISTÓRICO
router.get("/historico", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, codigo, ponto, responsavel, valor_tpm as valor, status, observacoes,
            to_char(data_coleta, 'DD/MM/YYYY HH24:MI') as data_fmt 
            FROM monitoramento_tpm ORDER BY data_coleta DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).send("Erro interno"); }
});

module.exports = router;