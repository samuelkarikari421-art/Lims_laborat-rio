const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para podermos ler o crachá do utilizador
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

// =========================================================================
// 🔥 MOTOR SILENCIOSO DE AUDITORIA (LOG DE ATIVIDADES)
// =========================================================================
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
    } catch (e) { }

    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) { }
}

// =========================================================================
// 1. BANCADA DE ANÁLISES (FIFO)
// =========================================================================

// LISTAR PENDENTES (COM INTELIGÊNCIA DE CÁLCULO RECEBIDO)
router.get("/pendentes", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, a.codigo as codigo_amostra, a.lote, a.linha_producao,
                   p.nome_produto as produto, p.cod_produto, p.tem_preferencia,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt,
                   a.codigo,
                   EXISTS (
                       SELECT 1 FROM calculos_historico ch 
                       WHERE ch.codigo_amostra = a.codigo 
                       AND ch.enviado_bancada = TRUE
                   ) as tem_calculo_recebido
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            WHERE UPPER(a.status) IN ('PENDENTE', 'EM ANÁLISE')
            ORDER BY 
                CASE 
                    WHEN a.linha_producao = 'Matéria-prima' THEN 1
                    WHEN a.linha_producao = 'Filme' THEN 2
                    WHEN p.tem_preferencia = true THEN 3
                    ELSE 4 
                END ASC,
                a.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send("Erro interno");
    }
});

// PUXAR OS CÁLCULOS VINCULADOS A UMA AMOSTRA ESPECÍFICA
router.get("/pendentes/:codigo/calculos", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT analise, resultado 
            FROM calculos_historico 
            WHERE codigo_amostra = $1 AND enviado_bancada = TRUE 
            ORDER BY id ASC
        `, [req.params.codigo]);
        res.json(result.rows);
    } catch(e) {
        res.status(500).json({ error: "Erro ao buscar calculos vinculados" });
    }
});

// INICIAR ANÁLISE
router.post("/iniciar/:id", async (req, res) => {
    try { res.json({ success: true, hora_inicio: new Date().toISOString() }); } catch (err) { res.status(500).send("Erro interno"); }
});

// BUSCAR TEMPLATE DE REGRAS
router.get("/template/:amostraId", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ps.parametro, ps.metodo, ps.valor_min, ps.valor_max, ps.unidade
            FROM amostras a
            JOIN produto_specs ps ON ps.produto_id = a.produto_id
            WHERE a.id = $1 ORDER BY ps.id ASC
        `, [req.params.amostraId]); 
        res.json(result.rows);
    } catch (err) { res.status(500).send("Erro interno"); }
});

// FINALIZAR E SALVAR ANÁLISE
router.post("/finalizar", async (req, res) => {
    try {
        const { amostra_id, observacoes, resultados } = req.body;
        if (!resultados || resultados.length === 0) return res.status(400).json({ success: false, message: "Nenhum parâmetro recebido." });

        await pool.query(`DELETE FROM analises WHERE amostra_id = $1`, [amostra_id]);
        let laudoReprovado = false;

        for (const r of resultados) {
            const valOriginal = String(r.valor_encontrado).trim().toUpperCase();
            const valLimpo = valOriginal.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
            const valMath = parseFloat(valLimpo.replace(',', '.'));
            let conforme = true;

            if (r.valor_min === null && r.valor_max === null) {
                if (valLimpo.includes("NAO CONFORME") || valLimpo.includes("REPROVAD")) conforme = false; 
            } else if (isNaN(valMath)) conforme = false; 
            else {
                if (r.valor_min !== null && valMath < r.valor_min) conforme = false;
                if (r.valor_max !== null && valMath > r.valor_max) conforme = false;
            }

            if (!conforme) laudoReprovado = true;

            const insertAnalise = await pool.query(`
                INSERT INTO analises (amostra_id, parametro, metodo, valor_min, valor_max, unidade, valor_encontrado, conforme)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
            `, [amostra_id, r.parametro, r.metodo, r.valor_min, r.valor_max, r.unidade, r.valor_encontrado, conforme]);

            if (!conforme && r.anexos && r.anexos.length > 0) {
                for (const anexo of r.anexos) {
                    await pool.query(`INSERT INTO analises_anexos (analise_id, nome_arquivo, arquivo_base64) VALUES ($1, $2, $3)`, [insertAnalise.rows[0].id, anexo.nome_arquivo, anexo.arquivo_base64]);
                }
            }
        }

        const statusFinal = laudoReprovado ? 'REPROVADA' : 'CONFORME';
        await pool.query(`UPDATE amostras SET status = $1, obs_analise = $2, data_conclusao = CURRENT_TIMESTAMP WHERE id = $3`, [statusFinal, observacoes, amostra_id]);

        const checkLaudo = await pool.query(`SELECT id, amostra_id FROM laudos WHERE amostra_id = $1`, [amostra_id]);
        
        const hoje = new Date();
        const codigo_gerado = `ANL-${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(amostra_id).padStart(4, '0')}`;
        
        if (checkLaudo.rows.length === 0) await pool.query(`INSERT INTO laudos (amostra_id, resultado, data_emissao) VALUES ($1, $2, CURRENT_TIMESTAMP)`, [amostra_id, statusFinal]);
        else await pool.query(`UPDATE laudos SET resultado = $1, data_emissao = CURRENT_TIMESTAMP WHERE amostra_id = $2`, [statusFinal, amostra_id]);

        await registrarLog(req, laudoReprovado ? "REPROVOU AMOSTRA" : "APROVOU AMOSTRA", `Finalizou a análise do código: ${codigo_gerado}`);
        res.json({ success: true, codigo_analise: codigo_gerado });

    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// HISTÓRICO DE ANÁLISES FINALIZADAS
router.get("/historico", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id as amostra_id, a.codigo as amostra_cod, p.nome_produto as produto_nome, COALESCE(l.resultado, a.status) as status,
                   'ANL-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as codigo_analise,
                   to_char(COALESCE(a.data_conclusao, l.data_emissao, a.data_entrada), 'DD/MM/YYYY HH24:MI') as data_conclusao_fmt
            FROM amostras a JOIN produtos p ON p.id = a.produto_id LEFT JOIN laudos l ON l.amostra_id = a.id
            WHERE a.status IN ('CONFORME', 'REPROVADA', 'APROVADO', 'REPROVADO') ORDER BY a.id DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).send("Erro interno"); }
});

// DETALHES DE UMA ANÁLISE FINALIZADA
router.get("/detalhes/:id", async (req, res) => {
    try {
        let amostraId = req.params.id;
        if (String(amostraId).startsWith('LDO-') || String(amostraId).startsWith('ANL-')) {
            const partes = String(amostraId).split('-'); 
            if (partes.length === 3) amostraId = parseInt(partes[2], 10);
            else if (partes.length === 2) amostraId = parseInt(partes[1], 10); 
        }
        const result = await pool.query(`SELECT * FROM analises WHERE amostra_id = $1 ORDER BY id ASC`, [amostraId]);
        for (let analise of result.rows) {
            const anexosRes = await pool.query(`SELECT id, nome_arquivo, arquivo_base64 FROM analises_anexos WHERE analise_id = $1`, [analise.id]);
            analise.anexos = anexosRes.rows;
        }
        res.json(result.rows);
    } catch (err) { res.status(500).send("Erro interno"); }
});

// =========================================================================
// 2. CALCULADORA FÍSICO-QUÍMICA (HISTÓRICO COMPARTILHADO)
// =========================================================================

// LER O HISTÓRICO
router.get("/calculos/historico", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM calculos_historico ORDER BY id DESC LIMIT 150"); 
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro ao buscar histórico" }); }
});

// CRIAR UM NOVO CÁLCULO
router.post("/calculos/historico", async (req, res) => {
    try {
        const { data, amostra, codigo_amostra, lote, analises, resultado, status, dados_brutos } = req.body;
        const codSeguro = codigo_amostra || 'N/A';
        await pool.query(
            "INSERT INTO calculos_historico (data_hora, amostra, codigo_amostra, lote, analise, resultado, status, dados_brutos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            [data, amostra, codSeguro, lote, analises, resultado, status, dados_brutos]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Erro ao salvar" }); }
});

// MARCAR CÁLCULO COMO ENVIADO PARA A BANCADA
router.post("/calculos/historico/:id/enviar", async (req, res) => {
    try {
        await pool.query("UPDATE calculos_historico SET enviado_bancada = TRUE WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao enviar" });
    }
});

// APAGAR UM CÁLCULO ÚNICO
router.delete("/calculos/historico/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM calculos_historico WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Erro ao excluir" }); }
});

// =========================================================================
// 3. TELA DE INVESTIGAÇÃO (RETESTES ISOLADOS)
// =========================================================================
router.get("/investigacao/amostras", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, a.codigo as codigo_amostra, a.lote, a.status, p.nome_produto, p.id as produto_id, to_char(a.data_conclusao, 'DD/MM/YYYY') as data_fmt
            FROM amostras a JOIN produtos p ON a.produto_id = p.id WHERE a.status IN ('CONFORME', 'REPROVADA', 'APROVADO', 'REPROVADO') ORDER BY a.data_conclusao DESC LIMIT 500
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro ao buscar amostras" }); }
});

router.post("/investigacao/salvar", async (req, res) => {
    try {
        const { amostra_id, codigo_amostra, lote, produto_nome, motivo, observacoes, resultados } = req.body;
        const insertInv = await pool.query(`
            INSERT INTO investigacoes (amostra_id, codigo_amostra, lote, produto_nome, motivo, observacoes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [amostra_id, codigo_amostra, lote, produto_nome, motivo, observacoes]);
        
        const investigacao_id = insertInv.rows[0].id;

        for (const r of resultados) {
            const valMath = parseFloat(String(r.valor_encontrado).replace(',', '.'));
            let conforme = true;
            if (r.valor_min === null && r.valor_max === null) { if (String(r.valor_encontrado).toUpperCase().includes("NÃO CONFORME")) conforme = false; }
            else if (isNaN(valMath)) conforme = false;
            else {
                if (r.valor_min !== null && valMath < r.valor_min) conforme = false;
                if (r.valor_max !== null && valMath > r.valor_max) conforme = false;
            }
            await pool.query(`
                INSERT INTO investigacoes_resultados (investigacao_id, parametro, metodo, valor_min, valor_max, unidade, valor_encontrado, conforme)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [investigacao_id, r.parametro, r.metodo, r.valor_min, r.valor_max, r.unidade, r.valor_encontrado, conforme]);
        }
        res.json({ success: true, investigacao_id });
    } catch (err) { res.status(500).json({ error: "Erro ao salvar" }); }
});

router.get("/investigacao/historico", async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, codigo_amostra, lote, produto_nome, motivo, observacoes, to_char(data_registro, 'DD/MM/YYYY HH24:MI') as data_fmt FROM investigacoes ORDER BY id DESC LIMIT 200`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro" }); }
});

router.get("/investigacao/:id/detalhes", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM investigacoes_resultados WHERE investigacao_id = $1 ORDER BY id ASC", [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Erro" }); }
});


// =========================================================================
// 🔥 4. INVESTIGAÇÃO MULTI-LOTES (SALVA AS FOTOS/PDFS)
// =========================================================================
router.post('/investigacao/multilotes', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const { produto, parametro, replicas, motivo, lotes } = req.body;
        
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

        const insertCabecalho = `
            INSERT INTO investigacao_multilote (produto_nome, parametro, qtd_replicas, motivo, usuario_nome)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `;
        const resCabecalho = await client.query(insertCabecalho, [produto, parametro, replicas, motivo, usuarioNome]);
        const investigacaoId = resCabecalho.rows[0].id;

        for (const loteData of lotes) {
            const valores = loteData.resultados.map(v => parseFloat(v)).filter(v => !isNaN(v));
            const media = valores.length > 0 ? (valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2) : null;

            const insertLote = `
                INSERT INTO investigacao_multilote_lotes (investigacao_id, lote, media_resultado, anexo_nome, anexo_base64)
                VALUES ($1, $2, $3, $4, $5) RETURNING id
            `;
            const resLote = await client.query(insertLote, [
                investigacaoId, 
                loteData.lote, 
                media, 
                loteData.anexo_nome || null, 
                loteData.anexo_base64 || null
            ]);
            const loteId = resLote.rows[0].id;

            for (let i = 0; i < loteData.resultados.length; i++) {
                const valorRep = parseFloat(loteData.resultados[i]);
                if (!isNaN(valorRep)) {
                    await client.query(`
                        INSERT INTO investigacao_multilote_resultados (investigacao_lote_id, replica_numero, valor)
                        VALUES ($1, $2, $3)
                    `, [loteId, i + 1, valorRep]);
                }
            }
        }

        await client.query('COMMIT');
        
        await registrarLog(req, "ESTUDO DE TENDÊNCIA", `Criou Investigação Multi-Lotes para o produto: ${produto} (Parâmetro: ${parametro})`);

        res.status(201).json({ success: true, message: "Investigação Multi-Lotes salva com sucesso!", id: investigacaoId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao salvar Multi-Lotes:", error);
        res.status(500).json({ error: "Erro interno ao processar a investigação." });
    } finally {
        client.release();
    }
});

module.exports = router;