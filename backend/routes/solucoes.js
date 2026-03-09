const express = require("express");
const router = express.Router();
const pool = require("../db");

// =========================================================================
// 1. LISTAR TODAS AS SOLUÇÕES (Preenche a tabela da aba 1)
// =========================================================================
router.get("/", async (req, res) => {
    try {
        const query = `
            SELECT id, codigo, nome, concentracao, lote, tipo_origem, 
                   TO_CHAR(data_fabricacao, 'YYYY-MM-DD') as data_fabricacao, 
                   TO_CHAR(validade, 'DD/MM/YYYY') as validade_fmt,
                   validade, saldo_total, unidade, observacoes
            FROM solucoes
            ORDER BY id DESC
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao listar soluções:", error);
        res.status(500).json({ error: "Erro interno ao buscar soluções." });
    }
});

// =========================================================================
// 2. LER DETALHES DE UMA SOLUÇÃO ESPECÍFICA (Para o botão do Olho/Lápis)
// =========================================================================
router.get("/:id", async (req, res) => {
    try {
        const solucaoId = req.params.id;
        
        // 1. Busca os dados principais da solução
        const resultSolucao = await pool.query('SELECT * FROM solucoes WHERE id = $1', [solucaoId]);
        if (resultSolucao.rows.length === 0) return res.status(404).json({ error: "Solução não encontrada" });

        const solucao = resultSolucao.rows[0];
        let reagentes = [];
        let solucoes_usadas = [];

        // 2. Se for uma solução CRIADA, vai buscar a receita às tabelas de ligação
        if (solucao.tipo_origem === 'CRIADO') {
            const resReagentes = await pool.query('SELECT reagente_id, qtd_usada FROM solucoes_reagentes WHERE solucao_id = $1', [solucaoId]);
            reagentes = resReagentes.rows;

            const resSolucoes = await pool.query('SELECT solucao_origem_id, qtd_usada FROM solucoes_solucoes WHERE solucao_destino_id = $1', [solucaoId]);
            solucoes_usadas = resSolucoes.rows;
        }

        // Devolve o "pacote" com tudo o que o Frontend precisa para montar a tabela
        res.json({ solucao: solucao, reagentes: reagentes, solucoes_usadas: solucoes_usadas });

    } catch (error) {
        console.error("Erro ao buscar detalhes da solução:", error);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
});

// =========================================================================
// 3. CRIAR NOVA SOLUÇÃO E DESCONTAR DO ESTOQUE
// =========================================================================
router.post("/", async (req, res) => {
    const client = await pool.connect(); 
    
    try {
        await client.query('BEGIN'); // 🔒 Tranca o banco para a transação

        const { 
            nome, concentracao, lote, tipo_origem, data_fabricacao, validade, 
            saldo_total, unidade, observacoes, 
            reagentes_usados, solucoes_usadas_receita 
        } = req.body;

        // 1. Gravar a solução
        const insertQuery = `
            INSERT INTO solucoes (nome, concentracao, lote, tipo_origem, data_fabricacao, validade, saldo_total, unidade, observacoes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING id
        `;
        const values = [nome, concentracao, lote, tipo_origem, data_fabricacao || null, validade, saldo_total, unidade, observacoes];
        const result = await client.query(insertQuery, values);
        const novaSolucaoId = result.rows[0].id;

        // 2. Gerar e gravar o Código SOL-Ano-ID
        const codigoGerado = `SOL-${new Date().getFullYear()}-${String(novaSolucaoId).padStart(4, '0')}`;
        await client.query(`UPDATE solucoes SET codigo = $1 WHERE id = $2`, [codigoGerado, novaSolucaoId]);

        // 3. Se foi criada, guardar ingredientes e abater estoques
        if (tipo_origem === 'CRIADO') {
            if (reagentes_usados && reagentes_usados.length > 0) {
                for (let item of reagentes_usados) {
                    await client.query(`INSERT INTO solucoes_reagentes (solucao_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [novaSolucaoId, item.reagente_id, item.qtd_usada]);
                    await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
                }
            }
            if (solucoes_usadas_receita && solucoes_usadas_receita.length > 0) {
                for (let item of solucoes_usadas_receita) {
                    await client.query(`INSERT INTO solucoes_solucoes (solucao_destino_id, solucao_origem_id, qtd_usada) VALUES ($1, $2, $3)`, [novaSolucaoId, item.solucao_origem_id, item.qtd_usada]);
                    await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_origem_id]);
                }
            }
        }

        await client.query('COMMIT'); // ✅ Confirmar gravação
        res.status(201).json({ success: true, message: "Solução salva com sucesso!", id: novaSolucaoId });
    } catch (error) {
        await client.query('ROLLBACK'); // ❌ Cancelar tudo em caso de erro
        console.error("Erro ao salvar solução:", error);
        res.status(500).json({ error: "Erro interno no servidor ao salvar a solução." });
    } finally {
        client.release(); 
    }
});

// =========================================================================
// 4. LISTAR HISTÓRICO DE USO (Preenche a tabela da aba 2)
// =========================================================================
router.get('/uso/historico', async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.analise_codigo, TO_CHAR(u.data_registro, 'DD/MM/YYYY HH24:MI') as data_fmt, u.observacoes,
            (SELECT COUNT(*) FROM uso_solucoes_itens WHERE uso_id = u.id) as qtd_solucoes,
            (SELECT COUNT(*) FROM uso_analise_reagentes WHERE uso_id = u.id) as qtd_reagentes
            FROM uso_solucoes u
            ORDER BY u.id DESC
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao buscar histórico de uso:", error);
        res.status(500).json({ error: "Erro ao buscar histórico" });
    }
});

// =========================================================================
// 5. LER DETALHES DE UM USO REGISTRADO (Para o botão do Olho/Lápis da aba 2)
// =========================================================================
router.get('/uso/:id/detalhes', async (req, res) => {
    try {
        const usoId = req.params.id;

        const resultUso = await pool.query('SELECT * FROM uso_solucoes WHERE id = $1', [usoId]);
        if (resultUso.rows.length === 0) return res.status(404).json({ error: "Registro não encontrado" });

        const cabecalho = resultUso.rows[0];

        const resReag = await pool.query('SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        const resSol = await pool.query('SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);

        res.json({ cabecalho: cabecalho, reagentes: resReag.rows, solucoes: resSol.rows });
    } catch (error) {
        console.error("Erro ao buscar detalhes do uso:", error);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
});

// =========================================================================
// 6. REGISTRAR USO EM ANÁLISE E DESCONTAR DO ESTOQUE
// =========================================================================
router.post('/uso', async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // 🔒 Tranca o banco

        const { analise_codigo, observacoes, reagentes_usados, solucoes_usadas } = req.body;

        const insertUsoQuery = `INSERT INTO uso_solucoes (analise_codigo, observacoes, data_registro) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`;
        const resUso = await client.query(insertUsoQuery, [analise_codigo, observacoes]);
        const novoUsoId = resUso.rows[0].id;

        if (reagentes_usados && reagentes_usados.length > 0) {
            for (let item of reagentes_usados) {
                await client.query(`INSERT INTO uso_analise_reagentes (uso_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [novoUsoId, item.reagente_id, item.qtd_usada]);
                await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
            }
        }

        if (solucoes_usadas && solucoes_usadas.length > 0) {
            for (let item of solucoes_usadas) {
                await client.query(`INSERT INTO uso_solucoes_itens (uso_id, solucao_id, qtd_usada) VALUES ($1, $2, $3)`, [novoUsoId, item.solucao_id, item.qtd_usada]);
                await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
            }
        }

        await client.query('COMMIT'); // ✅ Sucesso!
        res.status(201).json({ success: true, message: "Uso registrado com sucesso!", id: novoUsoId });
    } catch (error) {
        await client.query('ROLLBACK'); // ❌ Erro! Desfaz tudo
        console.error("Erro ao registrar uso:", error);
        res.status(500).json({ error: "Erro interno ao abater estoque." });
    } finally {
        client.release();
    }
});

// =========================================================================
// 7. APAGAR UMA SOLUÇÃO OU UM USO (Básico)
// =========================================================================
router.delete("/:id", async (req, res) => {
    try {
        await pool.query('DELETE FROM solucoes WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Erro ao excluir" }); }
});

router.delete("/uso/:id", async (req, res) => {
    try {
        await pool.query('DELETE FROM uso_solucoes WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Erro ao excluir" }); }
});

// Exporta as rotas para o server.js
module.exports = router;