const express = require("express");
const router = express.Router();
const pool = require("../db");

// ==========================================
// 1. MÓDULO DE CADASTRO DE SOLUÇÕES (ESTOQUE)
// ==========================================

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, codigo, nome, concentracao, lote, tipo_origem, 
                   to_char(validade, 'DD/MM/YYYY') as validade_fmt, 
                   validade, saldo_total, unidade
            FROM solucoes ORDER BY id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro interno" }); }
});

router.get("/:id", async (req, res) => {
    try {
        const solRes = await pool.query(`SELECT * FROM solucoes WHERE id = $1`, [req.params.id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: "Solução não encontrada" });
        
        const reagRes = await pool.query(`
            SELECT sr.reagente_id, sr.qtd_usada, r.nome_reagente as nome, r.unidade, r.codigo
            FROM solucoes_reagentes sr
            JOIN reagentes r ON r.id = sr.reagente_id
            WHERE sr.solucao_id = $1
        `, [req.params.id]);

        const solOrigemRes = await pool.query(`
            SELECT ss.solucao_origem_id as solucao_id, ss.qtd_usada, s.nome, s.unidade, s.codigo
            FROM solucoes_solucoes ss
            JOIN solucoes s ON s.id = ss.solucao_origem_id
            WHERE ss.solucao_destino_id = $1
        `, [req.params.id]);

        res.json({ solucao: solRes.rows[0], reagentes: reagRes.rows, solucoes_usadas: solOrigemRes.rows });
    } catch (err) { res.status(500).json({ error: "Erro interno" }); }
});

router.post("/", async (req, res) => {
    const client = await pool.connect(); 
    try {
        await client.query('BEGIN'); 
        const { nome, concentracao, lote, tipo_origem, data_fabricacao, validade, saldo_total, unidade, observacoes, reagentes_usados, solucoes_usadas_receita } = req.body;

        const insertSol = await client.query(`
            INSERT INTO solucoes (nome, concentracao, lote, tipo_origem, data_fabricacao, validade, saldo_total, unidade, observacoes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, data_registro
        `, [nome, concentracao, lote, tipo_origem, data_fabricacao || null, validade, saldo_total, unidade, observacoes]);

        const solId = insertSol.rows[0].id;
        const dataReg = new Date(insertSol.rows[0].data_registro);
        const ano = dataReg.getFullYear();
        const mes = String(dataReg.getMonth() + 1).padStart(2, '0');
        const codigo = `SOL-${ano}${mes}-${String(solId).padStart(4, '0')}`;
        await client.query(`UPDATE solucoes SET codigo = $1 WHERE id = $2`, [codigo, solId]);

        if (tipo_origem === 'CRIADO') {
            if (reagentes_usados && reagentes_usados.length > 0) {
                for (const item of reagentes_usados) {
                    await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
                    await client.query(`INSERT INTO solucoes_reagentes (solucao_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [solId, item.reagente_id, item.qtd_usada]);
                }
            }
            if (solucoes_usadas_receita && solucoes_usadas_receita.length > 0) {
                for (const item of solucoes_usadas_receita) {
                    await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
                    await client.query(`INSERT INTO solucoes_solucoes (solucao_destino_id, solucao_origem_id, qtd_usada) VALUES ($1, $2, $3)`, [solId, item.solucao_id, item.qtd_usada]);
                }
            }
        }

        await client.query('COMMIT'); 
        res.json({ success: true, codigo });
    } catch (err) {
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false });
    } finally { client.release(); }
});

router.put("/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const solId = req.params.id;
        const { nome, concentracao, lote, tipo_origem, data_fabricacao, validade, saldo_total, unidade, observacoes, reagentes_usados, solucoes_usadas_receita } = req.body;
        
        await client.query(`
            UPDATE solucoes 
            SET nome = $1, concentracao = $2, lote = $3, data_fabricacao = $4, validade = $5, saldo_total = $6, unidade = $7, observacoes = $8
            WHERE id = $9
        `, [nome, concentracao, lote, data_fabricacao || null, validade, saldo_total, unidade, observacoes, solId]);
        
        if (tipo_origem === 'CRIADO') {
            const oldReag = await client.query(`SELECT reagente_id, qtd_usada FROM solucoes_reagentes WHERE solucao_id = $1`, [solId]);
            for(const old of oldReag.rows) { await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [old.qtd_usada, old.reagente_id]); }
            await client.query(`DELETE FROM solucoes_reagentes WHERE solucao_id = $1`, [solId]);
            
            const oldSol = await client.query(`SELECT solucao_origem_id, qtd_usada FROM solucoes_solucoes WHERE solucao_destino_id = $1`, [solId]);
            for(const old of oldSol.rows) { await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [old.qtd_usada, old.solucao_origem_id]); }
            await client.query(`DELETE FROM solucoes_solucoes WHERE solucao_destino_id = $1`, [solId]);

            if (reagentes_usados && reagentes_usados.length > 0) {
                for(const item of reagentes_usados) {
                    await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
                    await client.query(`INSERT INTO solucoes_reagentes (solucao_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [solId, item.reagente_id, item.qtd_usada]);
                }
            }
            if (solucoes_usadas_receita && solucoes_usadas_receita.length > 0) {
                for (const item of solucoes_usadas_receita) {
                    await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
                    await client.query(`INSERT INTO solucoes_solucoes (solucao_destino_id, solucao_origem_id, qtd_usada) VALUES ($1, $2, $3)`, [solId, item.solucao_id, item.qtd_usada]);
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
    } finally { client.release(); }
});

router.delete("/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM solucoes WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});


// ==========================================
// 2. MÓDULO DE USO EM ANÁLISES (ABA 2)
// ==========================================

router.get("/uso/historico", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.analise_codigo, u.observacoes, 
                   to_char(u.data_registro, 'DD/MM/YYYY HH24:MI') as data_fmt,
                   (SELECT COUNT(*) FROM uso_solucoes_itens WHERE uso_id = u.id) as qtd_solucoes,
                   (SELECT COUNT(*) FROM uso_analise_reagentes WHERE uso_id = u.id) as qtd_reagentes
            FROM uso_solucoes u
            ORDER BY u.id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro interno" }); }
});

router.get("/uso/:id/detalhes", async (req, res) => {
    try {
        const cabecalho = await pool.query(`SELECT * FROM uso_solucoes WHERE id = $1`, [req.params.id]);
        
        const itensSol = await pool.query(`
            SELECT i.solucao_id as id, i.qtd_usada, s.codigo, s.nome, s.unidade 
            FROM uso_solucoes_itens i
            JOIN solucoes s ON s.id = i.solucao_id
            WHERE i.uso_id = $1
        `, [req.params.id]);

        const itensReag = await pool.query(`
            SELECT i.reagente_id as id, i.qtd_usada, r.codigo, r.nome_reagente as nome, r.unidade 
            FROM uso_analise_reagentes i
            JOIN reagentes r ON r.id = i.reagente_id
            WHERE i.uso_id = $1
        `, [req.params.id]);

        res.json({ cabecalho: cabecalho.rows[0], solucoes: itensSol.rows, reagentes: itensReag.rows });
    } catch (err) { res.status(500).json({ error: "Erro interno" }); }
});

router.post("/uso", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { analise_codigo, observacoes, solucoes_usadas, reagentes_usados } = req.body;

        const insertUso = await client.query(`INSERT INTO uso_solucoes (analise_codigo, observacoes) VALUES ($1, $2) RETURNING id`, [analise_codigo, observacoes]);
        const usoId = insertUso.rows[0].id;

        if(solucoes_usadas) {
            for (const item of solucoes_usadas) {
                await client.query(`INSERT INTO uso_solucoes_itens (uso_id, solucao_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.id, item.qtd_usada]);
                await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.id]);
            }
        }
        if(reagentes_usados) {
            for (const item of reagentes_usados) {
                await client.query(`INSERT INTO uso_analise_reagentes (uso_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.id, item.qtd_usada]);
                await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.id]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
    } finally { client.release(); }
});

router.put("/uso/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usoId = req.params.id;
        const { analise_codigo, observacoes, solucoes_usadas, reagentes_usados } = req.body;

        // 1. Estorna os saldos
        const oldSol = await client.query(`SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1`, [usoId]);
        for (const o of oldSol.rows) { await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [o.qtd_usada, o.solucao_id]); }
        await client.query(`DELETE FROM uso_solucoes_itens WHERE uso_id = $1`, [usoId]);

        const oldReag = await client.query(`SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1`, [usoId]);
        for (const o of oldReag.rows) { await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [o.qtd_usada, o.reagente_id]); }
        await client.query(`DELETE FROM uso_analise_reagentes WHERE uso_id = $1`, [usoId]);

        // 2. Atualiza cabeçalho
        await client.query(`UPDATE uso_solucoes SET analise_codigo = $1, observacoes = $2 WHERE id = $3`, [analise_codigo, observacoes, usoId]);

        // 3. Aplica novos descontos
        if(solucoes_usadas) {
            for (const item of solucoes_usadas) {
                await client.query(`INSERT INTO uso_solucoes_itens (uso_id, solucao_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.id, item.qtd_usada]);
                await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.id]);
            }
        }
        if(reagentes_usados) {
            for (const item of reagentes_usados) {
                await client.query(`INSERT INTO uso_analise_reagentes (uso_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.id, item.qtd_usada]);
                await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.id]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
    } finally { client.release(); }
});

router.delete("/uso/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usoId = req.params.id;
        
        const oldSol = await client.query(`SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1`, [usoId]);
        for (const o of oldSol.rows) { await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [o.qtd_usada, o.solucao_id]); }

        const oldReag = await client.query(`SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1`, [usoId]);
        for (const o of oldReag.rows) { await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [o.qtd_usada, o.reagente_id]); }

        await client.query(`DELETE FROM uso_solucoes WHERE id = $1`, [usoId]); 

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
    } finally { client.release(); }
});

module.exports = router;