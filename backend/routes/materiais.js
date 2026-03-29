const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// =========================================================================
// 🔥 MOTOR DE AUDITORIA (LOG DE ATIVIDADES) 
// =========================================================================
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

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
    } catch (e) { console.error("Erro ao salvar log (Materiais):", e.message); }
}

// 1. Listar todos os Materiais
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT *, to_char(data_recebimento, 'DD/MM/YYYY') as data_fmt
            FROM materiais
            ORDER BY id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro interno" }); }
});

// 2. Registrar Novo Material
router.post("/", async (req, res) => {
    try {
        const { nome, fabricante, lote, data_recebimento, data_validade, quantidade, unidade, observacoes, estoque_minimo, certificado_nome, certificado_base64, imagem_nome, imagem_base64 } = req.body;
        
        const seqRes = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM materiais");
        const nextId = seqRes.rows[0].next_id;
        const codigoGerado = `MAT-${nextId}`;

        await pool.query(
            `INSERT INTO materiais (codigo, nome, fabricante, lote, data_recebimento, quantidade, unidade, observacoes, estoque_minimo, data_validade, certificado_nome, certificado_base64, imagem_nome, imagem_base64) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [codigoGerado, nome, fabricante, lote, data_recebimento || null, quantidade, unidade, observacoes, estoque_minimo || 0, data_validade || null, certificado_nome || null, certificado_base64 || null, imagem_nome || null, imagem_base64 || null]
        );
        
        await registrarLog(req, "CRIOU MATERIAL", `Adicionou o material: ${codigoGerado} - ${nome}`);
        res.json({ success: true, message: "Material salvo com sucesso!", codigo: codigoGerado });
    } catch (err) { res.status(500).json({ success: false, error: "Erro ao salvar material" }); }
});

// 3. Atualizar/Editar Material
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, fabricante, lote, data_recebimento, data_validade, quantidade, unidade, observacoes, estoque_minimo, certificado_nome, certificado_base64, imagem_nome, imagem_base64, remover_certificado, remover_imagem } = req.body;
        
        let query = `UPDATE materiais SET nome = $1, fabricante = $2, lote = $3, data_recebimento = $4, quantidade = $5, unidade = $6, observacoes = $7, estoque_minimo = $8, data_validade = $9`;
        let values = [nome, fabricante, lote, data_recebimento || null, quantidade, unidade, observacoes, estoque_minimo || 0, data_validade || null];
        let idx = 10;

        if (remover_certificado) { query += `, certificado_nome = NULL, certificado_base64 = NULL`; }
        else if (certificado_base64) { query += `, certificado_nome = $${idx++}, certificado_base64 = $${idx++}`; values.push(certificado_nome, certificado_base64); }

        if (remover_imagem) { query += `, imagem_nome = NULL, imagem_base64 = NULL`; }
        else if (imagem_base64) { query += `, imagem_nome = $${idx++}, imagem_base64 = $${idx++}`; values.push(imagem_nome, imagem_base64); }

        query += ` WHERE id = $${idx}`;
        values.push(id);

        await pool.query(query, values);

        await registrarLog(req, "EDITOU MATERIAL", `Alterou dados do material ID: ${id}`);
        res.json({ success: true, message: "Material atualizado com sucesso!" });
    } catch (err) { res.status(500).json({ success: false, error: "Erro ao editar material" }); }
});

// 4. Excluir Material (do Banco)
router.delete("/:id", async (req, res) => {
    try {
        const regRes = await pool.query("SELECT nome, codigo FROM materiais WHERE id = $1", [req.params.id]);
        const nomeReg = regRes.rows.length > 0 ? `${regRes.rows[0].codigo} - ${regRes.rows[0].nome}` : `ID ${req.params.id}`;

        await pool.query("DELETE FROM materiais WHERE id = $1", [req.params.id]);
        await registrarLog(req, "EXCLUIU MATERIAL", `Apagou o material do banco: ${nomeReg}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 5. REGISTRAR DESCARTE / USO DE MATERIAL (E GRAVAR NO HISTÓRICO)
router.post('/descarte', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { material_id, quantidade, setor, observacoes } = req.body;

        if (!material_id || !quantidade) {
            return res.status(400).json({ error: "ID e quantidade são obrigatórios." });
        }

        const matRes = await client.query("SELECT codigo, nome, quantidade as saldo_atual, unidade FROM materiais WHERE id = $1", [material_id]);
        if (matRes.rows.length === 0) throw new Error("Material não encontrado.");
        const mat = matRes.rows[0];

        if (parseFloat(mat.saldo_atual) < parseFloat(quantidade)) {
            return res.status(400).json({ error: `Saldo insuficiente. Disponível: ${mat.saldo_atual} ${mat.unidade}` });
        }

        await client.query(`UPDATE materiais SET quantidade = quantidade - $1 WHERE id = $2`, [quantidade, material_id]);

        let usuarioNome = "Sistema";
        try {
            const authHeader = req.headers.authorization;
            if (authHeader) {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, SECRET);
                const userRes = await client.query("SELECT nome FROM usuarios WHERE id = $1", [decoded.id]);
                if (userRes.rows.length > 0) usuarioNome = userRes.rows[0].nome;
            }
        } catch (e) {}

        await client.query(
            `INSERT INTO materiais_uso (material_id, quantidade, unidade, setor, observacoes, usuario_nome) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [material_id, quantidade, mat.unidade, setor, observacoes, usuarioNome]
        );

        await client.query('COMMIT');
        await registrarLog(req, "DESCARTOU MATERIAL", `Baixa de ${quantidade} ${mat.unidade} do material ${mat.codigo} - ${mat.nome}. Setor: ${setor || 'N/A'}`);

        res.status(200).json({ success: true, message: "Uso registrado com sucesso!" });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message || "Erro interno ao registrar uso." });
    } finally {
        client.release();
    }
});

// 6. LISTAR HISTÓRICO DE USO DE MATERIAIS
router.get("/uso", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mu.*, m.nome as material_nome, m.codigo as material_codigo 
            FROM materiais_uso mu
            JOIN materiais m ON mu.material_id = m.id
            ORDER BY mu.data_uso DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar uso:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

// 7. EXCLUIR REGISTRO DE USO (ESTORNO DE SALDO)
router.delete("/uso/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usoId = req.params.id;

        const usoRes = await client.query("SELECT * FROM materiais_uso WHERE id = $1", [usoId]);
        if (usoRes.rows.length === 0) throw new Error("Registro não encontrado.");
        const uso = usoRes.rows[0];

        await client.query(`UPDATE materiais SET quantidade = quantidade + $1 WHERE id = $2`, [uso.quantidade, uso.material_id]);
        await client.query("DELETE FROM materiais_uso WHERE id = $1", [usoId]);
        await client.query('COMMIT');
        
        await registrarLog(req, "ESTORNO DE MATERIAL", `Estornou (devolveu) ${uso.quantidade} ${uso.unidade} do registro de uso ID ${usoId}.`);

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erro ao excluir registro de uso:", err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

module.exports = router;