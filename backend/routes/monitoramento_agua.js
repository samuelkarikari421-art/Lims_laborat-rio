const express = require("express");
const router = express.Router();
const pool = require("../db");

// =========================================================
// 1. ROTA PARA SALVAR DADOS (POST)
// =========================================================
router.post("/salvar", async (req, res) => {
    try {
        const { 
            codigo_analise, ponto_coleta, data_coleta, 
            cloro, ph, condutividade, tds, dureza, acidez, residuo_evaporacao, 
            observacoes, status_geral 
        } = req.body;
        
        // Converte a data do formato DD/MM/YYYY HH:MM para o formato YYYY-MM-DD HH:MM:00 (Padrão do Banco)
        const [data, hora] = data_coleta.split(' ');
        const [dia, mes, ano] = data.split('/');
        const dataParaBanco = `${ano}-${mes}-${dia} ${hora}:00`;

        await pool.query(`
            INSERT INTO monitoramento_agua 
            (ponto_coleta, data_coleta, cloro, ph, condutividade, tds, dureza, acidez, residuo_evaporacao, observacoes, status_geral) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            ponto_coleta, dataParaBanco, cloro, ph, condutividade, tds, 
            dureza, acidez, residuo_evaporacao, observacoes, status_geral
        ]);

        // Nota: O código de consumo de reagentes (Insumos) não foi adicionado aqui para evitar 
        // travar o seu banco de dados, visto que as tabelas de uso de água ainda não foram mapeadas.
        
        res.json({ success: true, message: "Registro salvo com sucesso!" });
    } catch (err) {
        console.error("🔴 ERRO AO SALVAR ÁGUA NO BANCO DE DADOS:", err.message);
        res.status(500).json({ error: "Erro interno.", detalhe: err.message });
    }
});

// =========================================================
// 2. ROTA PARA BUSCAR HISTÓRICO (GET)
// =========================================================
router.get("/historico", async (req, res) => {
    try {
        // Agora busca TODOS os campos novos
        const result = await pool.query(`
            SELECT id, ponto_coleta as ponto, 
                   to_char(data_coleta, 'DD/MM/YYYY HH24:MI') as data_fmt,
                   cloro, ph, condutividade, tds, dureza, acidez, residuo_evaporacao, 
                   observacoes, status_geral as status
            FROM monitoramento_agua
            ORDER BY data_coleta DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("🔴 ERRO AO BUSCAR HISTÓRICO DE ÁGUA:", err.message);
        res.status(500).json({ error: "Erro interno.", detalhe: err.message });
    }
});

// =========================================================
// 3. ROTA PARA EDITAR (PUT)
// =========================================================
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            ponto_coleta, data_coleta, 
            cloro, ph, condutividade, tds, dureza, acidez, residuo_evaporacao, 
            observacoes, status_geral 
        } = req.body;

        const [data, hora] = data_coleta.split(' ');
        const [dia, mes, ano] = data.split('/');
        const dataParaBanco = `${ano}-${mes}-${dia} ${hora}:00`;

        await pool.query(`
            UPDATE monitoramento_agua SET 
                ponto_coleta = $1, data_coleta = $2, cloro = $3, ph = $4, condutividade = $5, 
                tds = $6, dureza = $7, acidez = $8, residuo_evaporacao = $9, observacoes = $10, status_geral = $11
            WHERE id = $12
        `, [
            ponto_coleta, dataParaBanco, cloro, ph, condutividade, tds, 
            dureza, acidez, residuo_evaporacao, observacoes, status_geral, id
        ]);

        res.json({ success: true, message: "Registro atualizado com sucesso!" });
    } catch (err) {
        console.error("🔴 ERRO AO EDITAR ÁGUA:", err.message);
        res.status(500).json({ error: "Erro ao atualizar.", detalhe: err.message });
    }
});

// =========================================================
// 4. ROTA PARA EXCLUIR (DELETE)
// =========================================================
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Tenta apagar. Se der erro de foreign key, vai cair no catch abaixo
        const result = await pool.query('DELETE FROM monitoramento_agua WHERE id = $1 RETURNING *', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Registro não encontrado.' });
        }
        res.json({ message: 'Registro excluído com sucesso!' });
    } catch (err) {
        console.error('🔴 ERRO AO EXCLUIR ÁGUA:', err.message);
        res.status(500).json({ error: 'Erro ao excluir no banco de dados. Pode haver insumos vinculados.', detalhe: err.message });
    }
});

// =========================================================
// 5. ROTA PARA BUSCAR UM ÚNICO REGISTRO DETALHADO (GET)
// =========================================================
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT id, ponto_coleta as ponto, 
                   to_char(data_coleta, 'DD/MM/YYYY HH24:MI') as data_fmt,
                   cloro, ph, condutividade, tds, dureza, acidez, residuo_evaporacao, 
                   observacoes, status_geral as status
            FROM monitoramento_agua WHERE id = $1
        `, [id]);
        res.json(result.rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: "Erro interno.", detalhe: err.message });
    }
});

module.exports = router;