const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Listar todos os CoAs
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, p.nome_produto, p.cod_produto,
                   to_char(c.data_recebimento, 'DD/MM/YYYY') as data_fmt
            FROM coas_materia_prima c
            JOIN produtos p ON c.produto_id = p.id
            ORDER BY c.data_recebimento DESC, c.hora_recebimento DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar CoAs:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

// 2. Registrar novo CoA (Upload)
router.post("/", async (req, res) => {
    try {
        const { produto_id, data_recebimento, hora_recebimento, nome_arquivo, arquivo_base64 } = req.body;
        
        await pool.query(
            `INSERT INTO coas_materia_prima (produto_id, data_recebimento, hora_recebimento, nome_arquivo, arquivo_base64) 
             VALUES ($1, $2, $3, $4, $5)`,
            [produto_id, data_recebimento, hora_recebimento, nome_arquivo, arquivo_base64]
        );

        res.json({ success: true, message: "CoA salvo com sucesso!" });
    } catch (err) {
        console.error("Erro ao salvar CoA:", err);
        res.status(500).json({ success: false, error: "Erro ao salvar o documento" });
    }
});

// 3. Excluir CoA
router.delete("/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM coas_materia_prima WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao excluir CoA:", err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;