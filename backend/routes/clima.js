const express = require("express");
const router = express.Router();
const pool = require("../db");
const { verificarToken } = require('../middleware/authMiddleware'); 

// SALVAR NOVA LEITURA
router.post("/salvar", verificarToken, async (req, res) => {
    try {
        const { codigo, ambiente, equipamento, data_fmt, responsavel, temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes } = req.body;
        
        await pool.query(
            `INSERT INTO monitoramento_clima 
            (codigo, ambiente, equipamento, data_registro, responsavel, temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [codigo, ambiente, equipamento, data_fmt, responsavel, temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 🔥 NOVA ROTA: ATUALIZAR LEITURA EXISTENTE (EDITAR)
router.put("/:id", verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { ambiente, equipamento, data_fmt, responsavel, temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes } = req.body;
        
        await pool.query(
            `UPDATE monitoramento_clima 
            SET ambiente=$1, equipamento=$2, data_registro=$3, responsavel=$4, temp_atual=$5, temp_min=$6, temp_max=$7, umid_atual=$8, umid_min=$9, umid_max=$10, observacoes=$11 
            WHERE id=$12`,
            [ambiente, equipamento, data_fmt, responsavel, temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes, id]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 🔥 NOVA ROTA: EXCLUIR LEITURA
router.delete("/:id", verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM monitoramento_clima WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// BUSCAR HISTÓRICO 
router.get("/historico", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, codigo, ambiente, equipamento, responsavel, 
            temp_atual, temp_min, temp_max, umid_atual, umid_min, umid_max, observacoes,
            to_char(data_registro, 'DD/MM/YYYY HH24:MI') as data_fmt 
            FROM monitoramento_clima 
            ORDER BY data_registro DESC 
            LIMIT 300
        `);
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

module.exports = router;