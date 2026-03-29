const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta, se existir no middleware
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
        } else if (req.body && req.body.responsavel_coleta) {
            usuarioNome = req.body.responsavel_coleta; // Fallback
        }
    } catch (e) {
        console.error("Aviso: Não foi possível identificar o autor para o log.");
    }

    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade:", e.message);
    }
}


// 1. Listar todas as Amostras
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, p.nome_produto, p.cod_produto, p.tem_preferencia,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt,
                   to_char(a.data_coleta, 'DD/MM/YYYY') as data_coleta_fmt,
                   CASE 
                       WHEN l.id IS NOT NULL THEN 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0')
                       ELSE NULL 
                   END as laudo_numero, 
                   l.resultado as laudo_resultado,
                   to_char(l.data_emissao, 'DD/MM/YYYY HH24:MI') as data_saida_fmt,
                   u.nome as analista_nome
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            LEFT JOIN usuarios u ON u.id = l.emitido_por
            ORDER BY 
                CASE 
                    WHEN a.linha_producao = 'Matéria-prima' THEN 1
                    WHEN a.linha_producao = 'Filme' THEN 2
                    WHEN p.tem_preferencia = true THEN 3
                    ELSE 4 
                END ASC,
                a.data_entrada ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar amostras:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// 2. Detalhes Específicos (Com Certificado e Anexos Isolados)
router.get("/:id/detalhes", async (req, res) => {
    try {
        const amostraRes = await pool.query(`
            SELECT a.*, p.nome_produto,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt,
                   to_char(a.data_coleta, 'DD/MM/YYYY') as data_coleta_fmt
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            WHERE a.id = $1
        `, [req.params.id]);

        if (amostraRes.rows.length === 0) return res.status(404).send("Amostra não encontrada");
        
        const amostra = amostraRes.rows[0];

        const anexosRes = await pool.query(`
            SELECT id, nome_arquivo, arquivo_base64, tipo_anexo 
            FROM amostras_anexos 
            WHERE amostra_id = $1
        `, [req.params.id]);
        
        const certificado = anexosRes.rows.find(a => a.tipo_anexo === 'CERTIFICADO');
        const evidencias = anexosRes.rows.filter(a => a.tipo_anexo === 'EVIDENCIA');

        amostra.certificado_nome = certificado ? certificado.nome_arquivo : null;
        amostra.certificado_base64 = certificado ? certificado.arquivo_base64 : null;
        amostra.anexos_entrada = evidencias;

        const resultadosRes = await pool.query(`SELECT id as analise_id, parametro, valor_encontrado, conforme, metodo, unidade FROM analises WHERE amostra_id = $1`, [req.params.id]);
        const resultados = resultadosRes.rows;

        for (let analise of resultados) {
            const anexosAnaliseRes = await pool.query(`SELECT id, nome_arquivo, arquivo_base64 FROM analises_anexos WHERE analise_id = $1`, [analise.analise_id]);
            analise.anexos = anexosAnaliseRes.rows; 
        }

        res.json({ amostra: amostra, resultados: resultados });
    } catch (err) {
        console.error("Erro ao carregar detalhes:", err);
        res.status(500).send("Erro interno");
    }
});

// 3. Cadastrar Nova Amostra 
router.post("/", async (req, res) => {
    try {
        const { 
            produto_id, lote, linha_producao, quantidade_recebida, 
            data_fabricacao, data_coleta, data_validade, hora_coleta, 
            responsavel_coleta, tipo_analise, desvio, observacoes, 
            certificado_nome, certificado_base64, anexos 
        } = req.body;

        const d_col = (data_fabricacao && data_fabricacao !== "") ? data_fabricacao : ((data_coleta && data_coleta !== "") ? data_coleta : null);
        const d_val = (data_validade && data_validade !== "") ? data_validade : null;

        const seqRes = await pool.query("SELECT COALESCE(MAX(id), 10) + 1 AS next_id FROM amostras");
        const nextId = seqRes.rows[0].next_id;

        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const codigoGerado = `${ano}${mes}-${String(nextId).padStart(4, '0')}`;

        const insertAmostra = await pool.query(
            `INSERT INTO amostras 
            (codigo, produto_id, lote, status, linha_producao, quantidade_recebida, data_coleta, data_validade, hora_coleta, responsavel_coleta, tipo_analise, desvio, observacoes, data_entrada) 
            VALUES ($1, $2, $3, 'PENDENTE', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) RETURNING id`,
            [codigoGerado, produto_id, lote, linha_producao || 'Geral', quantidade_recebida || 1, d_col, d_val, hora_coleta || '00:00', responsavel_coleta || 'Sistema', tipo_analise || 'Rotina', desvio || 'Não', observacoes || null]
        );
        
        const novaAmostraId = insertAmostra.rows[0].id;

        if (certificado_base64 && certificado_nome) {
            await pool.query(
                `INSERT INTO amostras_anexos (amostra_id, nome_arquivo, arquivo_base64, tipo_anexo) VALUES ($1, $2, $3, 'CERTIFICADO')`,
                [novaAmostraId, certificado_nome, certificado_base64]
            );
        }

        if (anexos && anexos.length > 0) {
            for (let anexo of anexos) {
                await pool.query(
                    `INSERT INTO amostras_anexos (amostra_id, nome_arquivo, arquivo_base64, tipo_anexo) VALUES ($1, $2, $3, 'EVIDENCIA')`, 
                    [novaAmostraId, anexo.nome_arquivo, anexo.arquivo_base64]
                );
            }
        }

        await registrarLog(req, "CRIOU AMOSTRA", `Deu entrada na amostra ${codigoGerado} (Lote: ${lote || 'N/A'})`);

        res.json({ success: true, message: "Amostra registrada com sucesso!", codigoGerado });
    } catch (err) {
        console.error("Erro ao registrar amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao registrar amostra" });
    }
});

// 4. Editar Amostra (AGORA ATUALIZANDO ANEXOS)
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            produto_id, lote, linha_producao, quantidade_recebida, 
            data_fabricacao, data_validade, observacoes,
            certificado_nome, certificado_base64, novos_anexos
        } = req.body;
        
        const d_fab = (data_fabricacao && data_fabricacao !== "") ? data_fabricacao : null;
        const d_val = (data_validade && data_validade !== "") ? data_validade : null;
        const linha = linha_producao || null;
        const qtd = quantidade_recebida || 1;
        
        const amRes = await pool.query("SELECT codigo FROM amostras WHERE id = $1", [id]);
        const codAmostra = amRes.rows.length > 0 ? amRes.rows[0].codigo : `ID ${id}`;

        await pool.query(
            `UPDATE amostras 
             SET produto_id = $1, lote = $2, data_coleta = $3, data_validade = $4, linha_producao = $5, quantidade_recebida = $6, observacoes = $7 
             WHERE id = $8`,
            [produto_id, lote, d_fab, d_val, linha, qtd, observacoes, id]
        );

        // 🔥 ATUALIZA O CERTIFICADO SE UM NOVO FOR ENVIADO (Apaga o velho, insere o novo)
        if (certificado_base64 && certificado_nome) {
            await pool.query(`DELETE FROM amostras_anexos WHERE amostra_id = $1 AND tipo_anexo = 'CERTIFICADO'`, [id]);
            await pool.query(
                `INSERT INTO amostras_anexos (amostra_id, nome_arquivo, arquivo_base64, tipo_anexo) VALUES ($1, $2, $3, 'CERTIFICADO')`,
                [id, certificado_nome, certificado_base64]
            );
        }

        // 🔥 ADICIONA NOVAS EVIDÊNCIAS À GALERIA EXISTENTE
        if (novos_anexos && novos_anexos.length > 0) {
            for (let anexo of novos_anexos) {
                await pool.query(
                    `INSERT INTO amostras_anexos (amostra_id, nome_arquivo, arquivo_base64, tipo_anexo) VALUES ($1, $2, $3, 'EVIDENCIA')`, 
                    [id, anexo.nome_arquivo, anexo.arquivo_base64]
                );
            }
        }
        
        await registrarLog(req, "EDITOU AMOSTRA", `Alterou os dados/anexos da amostra ${codAmostra} (Lote: ${lote || 'N/A'})`);

        res.json({ success: true, message: "Amostra atualizada com sucesso!" });
    } catch (err) {
        console.error("Erro ao atualizar amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar amostra." });
    }
});

// 5. Excluir Amostra
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const check = await pool.query("SELECT status, codigo FROM amostras WHERE id = $1", [id]);
        
        if (check.rows.length > 0 && check.rows[0].status !== 'PENDENTE') {
            return res.status(400).json({ success: false, message: "Amostras em análise ou concluídas não podem ser excluídas." });
        }
        
        const codAmostra = check.rows.length > 0 ? check.rows[0].codigo : `ID ${id}`;

        await pool.query("DELETE FROM amostras WHERE id = $1", [id]);
        
        await registrarLog(req, "EXCLUIU AMOSTRA", `Apagou definitivamente a amostra ${codAmostra} do sistema.`);

        res.json({ success: true, message: "Amostra excluída com sucesso!" });
    } catch (err) {
        console.error("Erro ao excluir amostra:", err);
        res.status(500).json({ success: false, message: "Erro ao excluir a amostra." });
    }
});

module.exports = router;