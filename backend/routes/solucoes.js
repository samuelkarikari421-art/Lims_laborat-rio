const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para identificar o autor no log
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

// Função auxiliar para descobrir quem está logado
async function getUsuarioNome(req) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, SECRET);
            const userRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [decoded.id]);
            if (userRes.rows.length > 0) return userRes.rows[0].nome;
        }
    } catch(e) {}
    return "Sistema";
}

// =========================================================================
// 🔥 MOTOR SILENCIOSO DE AUDITORIA (LOG DE ATIVIDADES)
// =========================================================================
async function registrarLog(req, acao, detalhes) {
    const usuarioNome = await getUsuarioNome(req);
    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade (Soluções):", e.message);
    }
}

// =========================================================================
// 1. LISTAR TODAS AS SOLUÇÕES
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
// 2. LER DETALHES DE UMA SOLUÇÃO
// =========================================================================
router.get("/:id", async (req, res) => {
    try {
        const solucaoId = req.params.id;
        
        const resultSolucao = await pool.query('SELECT * FROM solucoes WHERE id = $1', [solucaoId]);
        if (resultSolucao.rows.length === 0) return res.status(404).json({ error: "Solução não encontrada" });

        const solucao = resultSolucao.rows[0];
        let reagentes = [];
        let solucoes_usadas = [];

        if (solucao.tipo_origem === 'CRIADO') {
            const resReagentes = await pool.query('SELECT reagente_id, qtd_usada FROM solucoes_reagentes WHERE solucao_id = $1', [solucaoId]);
            reagentes = resReagentes.rows;

            const resSolucoes = await pool.query('SELECT solucao_origem_id, qtd_usada FROM solucoes_solucoes WHERE solucao_destino_id = $1', [solucaoId]);
            solucoes_usadas = resSolucoes.rows;
        }

        res.json({ solucao: solucao, reagentes: reagentes, solucoes_usadas: solucoes_usadas });

    } catch (error) {
        console.error("Erro ao buscar detalhes da solução:", error);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
});

// =========================================================================
// 3. CRIAR NOVA SOLUÇÃO E DESCONTAR ESTOQUE (RECEITA)
// =========================================================================
router.post("/", async (req, res) => {
    const client = await pool.connect(); 
    let codigoFinalLog = "";
    
    try {
        await client.query('BEGIN'); 

        const { 
            nome, concentracao, lote, tipo_origem, data_fabricacao, validade, 
            saldo_total, unidade, observacoes, 
            reagentes_usados, solucoes_usadas_receita 
        } = req.body;

        const insertQuery = `
            INSERT INTO solucoes (nome, concentracao, lote, tipo_origem, data_fabricacao, validade, saldo_total, unidade, observacoes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING id
        `;
        const values = [nome, concentracao, lote, tipo_origem, data_fabricacao || null, validade, saldo_total, unidade, observacoes];
        const result = await client.query(insertQuery, values);
        const novaSolucaoId = result.rows[0].id;

        codigoFinalLog = `SOL-${new Date().getFullYear()}-${String(novaSolucaoId).padStart(4, '0')}`;
        await client.query(`UPDATE solucoes SET codigo = $1 WHERE id = $2`, [codigoFinalLog, novaSolucaoId]);

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

        await client.query('COMMIT'); 
        
        await registrarLog(req, "CRIOU SOLUÇÃO", `Cadastrou a solução ${codigoFinalLog}: ${nome} (${concentracao || ''})`);

        res.status(201).json({ success: true, message: "Solução salva com sucesso!", id: novaSolucaoId });
    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error("Erro ao salvar solução:", error);
        res.status(500).json({ error: "Erro interno no servidor ao salvar a solução." });
    } finally {
        client.release(); 
    }
});

// =========================================================================
// 4. EDITAR SOLUÇÃO (REPÕE O ESTOQUE ANTIGO E DESCONTA O NOVO)
// =========================================================================
router.put("/:id", async (req, res) => {
    const solucaoId = req.params.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); 

        const { 
            nome, concentracao, lote, tipo_origem, data_fabricacao, validade, 
            saldo_total, unidade, observacoes, 
            reagentes_usados, solucoes_usadas_receita 
        } = req.body;

        const solRes = await client.query("SELECT codigo FROM solucoes WHERE id = $1", [solucaoId]);
        const codSol = solRes.rows.length > 0 ? solRes.rows[0].codigo : `ID ${solucaoId}`;

        // 1. Atualizar Cabecalho
        await client.query(`
            UPDATE solucoes SET nome=$1, concentracao=$2, lote=$3, tipo_origem=$4, data_fabricacao=$5, validade=$6, saldo_total=$7, unidade=$8, observacoes=$9
            WHERE id=$10
        `, [nome, concentracao, lote, tipo_origem, data_fabricacao || null, validade, saldo_total, unidade, observacoes, solucaoId]);

        // 2. Repor estoques antigos
        const oldReagentes = await client.query('SELECT reagente_id, qtd_usada FROM solucoes_reagentes WHERE solucao_id = $1', [solucaoId]);
        for (let item of oldReagentes.rows) {
            await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
        }
        
        const oldSolucoes = await client.query('SELECT solucao_origem_id, qtd_usada FROM solucoes_solucoes WHERE solucao_destino_id = $1', [solucaoId]);
        for (let item of oldSolucoes.rows) {
            await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [item.qtd_usada, item.solucao_origem_id]);
        }

        // 3. Apagar a receita antiga
        await client.query('DELETE FROM solucoes_reagentes WHERE solucao_id = $1', [solucaoId]);
        await client.query('DELETE FROM solucoes_solucoes WHERE solucao_destino_id = $1', [solucaoId]);

        // 4. Inserir a nova receita
        if (tipo_origem === 'CRIADO') {
            if (reagentes_usados && reagentes_usados.length > 0) {
                for (let item of reagentes_usados) {
                    await client.query(`INSERT INTO solucoes_reagentes (solucao_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [solucaoId, item.reagente_id, item.qtd_usada]);
                    await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
                }
            }
            if (solucoes_usadas_receita && solucoes_usadas_receita.length > 0) {
                for (let item of solucoes_usadas_receita) {
                    await client.query(`INSERT INTO solucoes_solucoes (solucao_destino_id, solucao_origem_id, qtd_usada) VALUES ($1, $2, $3)`, [solucaoId, item.solucao_origem_id, item.qtd_usada]);
                    await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_origem_id]);
                }
            }
        }

        await client.query('COMMIT'); 
        await registrarLog(req, "EDITOU SOLUÇÃO", `Alterou o registo / receita da solução ${codSol}: ${nome}`);

        res.json({ success: true, message: "Solução atualizada com sucesso!" });

    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error("Erro ao editar solução:", error);
        res.status(500).json({ error: "Erro interno ao atualizar a solução." });
    } finally {
        client.release(); 
    }
});


// =========================================================================
// 5. LISTAR HISTÓRICO DE USO NAS ANÁLISES (CABEÇALHOS)
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
// 🔥 6. ROTA PARA O GRÁFICO (ITENS DE USO PLANIFICADOS)
// =========================================================================
router.get('/uso/itens', async (req, res) => {
    try {
        // Busca os usos das Análises Normais
        const queryUsos = `
            SELECT usi.solucao_id, usi.qtd_usada as quantidade, us.data_registro as data_uso, s.unidade 
            FROM uso_solucoes_itens usi
            JOIN uso_solucoes us ON usi.uso_id = us.id
            JOIN solucoes s ON usi.solucao_id = s.id
        `;
        
        // Busca os Descartes Manuais (se a tabela já existir)
        const queryDescartes = `
            SELECT h.solucao_id, h.quantidade, h.data_descarte as data_uso, s.unidade 
            FROM historico_descarte_solucoes h
            JOIN solucoes s ON h.solucao_id = s.id
        `;

        let itensConsumidos = [];

        try {
            const resultUsos = await pool.query(queryUsos);
            itensConsumidos = resultUsos.rows;
        } catch(e) {}

        try {
            const resultDescartes = await pool.query(queryDescartes);
            itensConsumidos = [...itensConsumidos, ...resultDescartes.rows];
        } catch(e) {}

        res.json(itensConsumidos);
    } catch (error) {
        console.error("Erro ao buscar itens para o gráfico:", error);
        res.status(500).json({ error: "Erro ao carregar dados do gráfico." });
    }
});


// =========================================================================
// 7. LER DETALHES DE UM USO REGISTRADO
// =========================================================================
router.get('/uso/:id/detalhes', async (req, res) => {
    try {
        const usoId = req.params.id;
        const resultUso = await pool.query('SELECT * FROM uso_solucoes WHERE id = $1', [usoId]);
        if (resultUso.rows.length === 0) return res.status(404).json({ error: "Registro não encontrado" });

        const resReag = await pool.query('SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        const resSol = await pool.query('SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);

        res.json({ cabecalho: resultUso.rows[0], reagentes: resReag.rows, solucoes: resSol.rows });
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
});

// =========================================================================
// 8. REGISTRAR USO EM ANÁLISE E DESCONTAR ESTOQUE
// =========================================================================
router.post('/uso', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); 

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

        await client.query('COMMIT'); 
        await registrarLog(req, "REGISTROU USO DIÁRIO", `Consumiu materiais associados à Análise: ${analise_codigo}`);
        res.status(201).json({ success: true, message: "Uso registrado com sucesso!", id: novoUsoId });

    } catch (error) {
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: "Erro interno ao abater estoque." });
    } finally {
        client.release();
    }
});

// =========================================================================
// 9. EDITAR UM USO REGISTRADO
// =========================================================================
router.put('/uso/:id', async (req, res) => {
    const usoId = req.params.id;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const { analise_codigo, observacoes, reagentes_usados, solucoes_usadas } = req.body;
        const usoRes = await client.query("SELECT analise_codigo FROM uso_solucoes WHERE id = $1", [usoId]);
        const codUsoAntigo = usoRes.rows.length > 0 ? usoRes.rows[0].analise_codigo : `ID ${usoId}`;

        await client.query('UPDATE uso_solucoes SET analise_codigo = $1, observacoes = $2 WHERE id = $3', [analise_codigo, observacoes, usoId]);

        // Restaura estoques antigos
        const oldReagentes = await client.query('SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        for (let item of oldReagentes.rows) {
            await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
        }
        
        const oldSolucoes = await client.query('SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);
        for (let item of oldSolucoes.rows) {
            await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
        }

        // Limpa usos velhos
        await client.query('DELETE FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        await client.query('DELETE FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);

        // Insere novos
        if (reagentes_usados && reagentes_usados.length > 0) {
            for (let item of reagentes_usados) {
                await client.query(`INSERT INTO uso_analise_reagentes (uso_id, reagente_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.reagente_id, item.qtd_usada]);
                await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
            }
        }
        if (solucoes_usadas && solucoes_usadas.length > 0) {
            for (let item of solucoes_usadas) {
                await client.query(`INSERT INTO uso_solucoes_itens (uso_id, solucao_id, qtd_usada) VALUES ($1, $2, $3)`, [usoId, item.solucao_id, item.qtd_usada]);
                await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
            }
        }

        await client.query('COMMIT'); 
        await registrarLog(req, "EDITOU USO DIÁRIO", `Ajustou os consumos da análise ${codUsoAntigo}`);

        res.json({ success: true, message: "Uso atualizado com sucesso!" });

    } catch (error) {
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: "Erro interno ao atualizar a edição de uso." });
    } finally {
        client.release();
    }
});

// =========================================================================
// 🔥 10. ESTORNAR UM USO (RESTITUI O ESTOQUE)
// =========================================================================
router.delete("/uso/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const usoId = req.params.id;

        const usoRes = await client.query("SELECT analise_codigo FROM uso_solucoes WHERE id = $1", [usoId]);
        const codUso = usoRes.rows.length > 0 ? usoRes.rows[0].analise_codigo : `ID ${usoId}`;

        // Devolve os Reagentes
        const oldReagentes = await client.query('SELECT reagente_id, qtd_usada FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        for (let item of oldReagentes.rows) {
            await client.query(`UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2`, [item.qtd_usada, item.reagente_id]);
        }
        
        // Devolve as Soluções
        const oldSolucoes = await client.query('SELECT solucao_id, qtd_usada FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);
        for (let item of oldSolucoes.rows) {
            await client.query(`UPDATE solucoes SET saldo_total = saldo_total + $1 WHERE id = $2`, [item.qtd_usada, item.solucao_id]);
        }

        // Apaga o uso principal
        await client.query('DELETE FROM uso_analise_reagentes WHERE uso_id = $1', [usoId]);
        await client.query('DELETE FROM uso_solucoes_itens WHERE uso_id = $1', [usoId]);
        await client.query('DELETE FROM uso_solucoes WHERE id = $1', [usoId]);

        await client.query('COMMIT');

        await registrarLog(req, "ESTORNOU USO DIÁRIO", `Cancelou o uso da análise ${codUso} e devolveu os itens ao estoque.`);

        res.json({ success: true });
    } catch (error) { 
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: "Erro ao excluir uso" }); 
    } finally {
        client.release();
    }
});

// =========================================================================
// 11. EXCLUIR SOLUÇÃO DA BASE DE DADOS
// =========================================================================
router.delete("/:id", async (req, res) => {
    try {
        const solRes = await pool.query("SELECT nome, codigo FROM solucoes WHERE id = $1", [req.params.id]);
        const nomeSol = solRes.rows.length > 0 ? `${solRes.rows[0].codigo} - ${solRes.rows[0].nome}` : `ID ${req.params.id}`;

        await pool.query('DELETE FROM solucoes WHERE id = $1', [req.params.id]);
        await registrarLog(req, "EXCLUIU SOLUÇÃO", `Apagou a solução do inventário: ${nomeSol}`);

        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Erro ao excluir" }); }
});

// =========================================================================
// 🔥 12. REGISTRAR DESCARTE E GRAVAR NA TABELA DE HISTÓRICO
// =========================================================================
router.post('/descarte', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { solucao_id, quantidade, motivo } = req.body;

        if (!solucao_id || !quantidade) return res.status(400).json({ error: "ID e quantidade são obrigatórios." });

        const solRes = await client.query("SELECT codigo, nome, saldo_total, unidade FROM solucoes WHERE id = $1", [solucao_id]);
        if (solRes.rows.length === 0) throw new Error("Solução não encontrada.");
        const sol = solRes.rows[0];

        if (parseFloat(sol.saldo_total) < parseFloat(quantidade)) {
            return res.status(400).json({ error: `Saldo insuficiente. Disponível: ${sol.saldo_total} ${sol.unidade}` });
        }

        // Abate o saldo principal
        await client.query(`UPDATE solucoes SET saldo_total = saldo_total - $1 WHERE id = $2`, [quantidade, solucao_id]);

        // Grava na tabela para o Gráfico ler
        const responsavel = await getUsuarioNome(req);
        await client.query(`
            INSERT INTO historico_descarte_solucoes (solucao_id, quantidade, motivo, responsavel, data_descarte)
            VALUES ($1, $2, $3, $4, NOW())
        `, [solucao_id, quantidade, motivo, responsavel]);

        await client.query('COMMIT');

        await registrarLog(req, "DESCARTOU SOLUÇÃO", `Descarte de ${quantidade}${sol.unidade} da solução ${sol.codigo} - ${sol.nome}.`);

        res.status(200).json({ success: true, message: "Descarte registrado com sucesso!" });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message || "Erro ao registrar descarte." });
    } finally {
        client.release();
    }
});

module.exports = router;