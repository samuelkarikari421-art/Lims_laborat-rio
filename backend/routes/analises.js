const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. LISTAR AMOSTRAS PENDENTES
router.get("/pendentes", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, a.codigo as codigo_amostra, a.lote, 
                   p.nome_produto as produto,
                   to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as data_entrada_fmt
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            WHERE UPPER(a.status) IN ('PENDENTE', 'EM ANÁLISE')
            ORDER BY a.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar fila:", err);
        res.status(500).send("Erro interno");
    }
});

// 2. INICIAR ANÁLISE
router.post("/iniciar/:id", async (req, res) => {
    try {
        res.json({ success: true, hora_inicio: new Date().toISOString() });
    } catch (err) {
        res.status(500).send("Erro interno");
    }
});

// 3. BUSCAR TEMPLATE DE REGRAS
router.get("/template/:amostraId", async (req, res) => {
    try {
        const amostraId = req.params.amostraId;
        const result = await pool.query(`
            SELECT ps.parametro, ps.metodo, ps.valor_min, ps.valor_max, ps.unidade
            FROM amostras a
            JOIN produto_specs ps ON ps.produto_id = a.produto_id
            WHERE a.id = $1
            ORDER BY ps.id ASC
        `, [amostraId]); // 🔥 O ERRO ESTAVA AQUI! Faltava o [, amostraId]
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar template:", err);
        res.status(500).send("Erro interno");
    }
});

// 4. FINALIZAR E SALVAR ANÁLISE
router.post("/finalizar", async (req, res) => {
    try {
        const { amostra_id, observacoes, resultados } = req.body;

        await pool.query(`DELETE FROM analises WHERE amostra_id = $1`, [amostra_id]);

        let laudoReprovado = false;

        for (const r of resultados) {
            const val = parseFloat(String(r.valor_encontrado).replace(',', '.'));
            let conforme = true;

            if (r.valor_min === null && r.valor_max === null) {
                conforme = true;
            } else if (isNaN(val)) {
                conforme = false;
            } else {
                if (r.valor_min !== null && val < r.valor_min) conforme = false;
                if (r.valor_max !== null && val > r.valor_max) conforme = false;
            }

            if (!conforme) laudoReprovado = true;

            await pool.query(`
                INSERT INTO analises 
                (amostra_id, parametro, metodo, valor_min, valor_max, unidade, valor_encontrado, conforme)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                amostra_id, r.parametro, r.metodo, 
                r.valor_min, r.valor_max, r.unidade, 
                r.valor_encontrado, conforme
            ]);
        }

        const statusFinal = laudoReprovado ? 'REPROVADA' : 'CONFORME';

        await pool.query(`
            UPDATE amostras 
            SET status = $1, observacoes = $2, data_conclusao = CURRENT_TIMESTAMP 
            WHERE id = $3
        `, [statusFinal, observacoes, amostra_id]);

        const checkLaudo = await pool.query(`SELECT id FROM laudos WHERE amostra_id = $1`, [amostra_id]);
        
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const idFormatado = String(amostra_id).padStart(4, '0');
        let codigo_gerado = `ANL-${ano}${mes}-${idFormatado}`;
        
        if (checkLaudo.rows.length === 0) {
            await pool.query(`
                INSERT INTO laudos (amostra_id, resultado, data_emissao) 
                VALUES ($1, $2, CURRENT_TIMESTAMP)
            `, [amostra_id, statusFinal]);
        } else {
            await pool.query(`UPDATE laudos SET resultado = $1, data_emissao = CURRENT_TIMESTAMP WHERE amostra_id = $2`, [statusFinal, amostra_id]);
        }

        res.json({ success: true, codigo_analise: codigo_gerado });

    } catch (err) {
        console.error("Erro ao finalizar análise:", err);
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

// 5. HISTÓRICO DE ANÁLISES CONCLUÍDAS
router.get("/historico", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id as amostra_id, a.codigo as amostra_cod, p.nome_produto as produto_nome,
                   COALESCE(l.resultado, a.status) as status,
                   
                   'ANL-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as codigo_analise,
                   
                   to_char(COALESCE(a.data_conclusao, l.data_emissao, a.data_entrada), 'DD/MM/YYYY HH24:MI') as data_conclusao_fmt
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            WHERE a.status IN ('CONFORME', 'REPROVADA', 'APROVADO', 'REPROVADO')
            ORDER BY a.id DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        res.status(500).send("Erro interno");
    }
});

// 6. BUSCAR DETALHES DE UMA ANÁLISE JÁ FEITA
router.get("/detalhes/:id", async (req, res) => {
    try {
        const idParam = req.params.id;
        let amostraId = idParam;

        if (String(idParam).startsWith('LDO-') || String(idParam).startsWith('ANL-')) {
            const partes = String(idParam).split('-'); 
            if (partes.length === 3) {
                amostraId = parseInt(partes[2], 10);
            } else if (partes.length === 2) {
                amostraId = parseInt(partes[1], 10); 
            }
        }

        const result = await pool.query(`
            SELECT * FROM analises WHERE amostra_id = $1 ORDER BY id ASC
        `, [amostraId]);
        
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar detalhes da análise:", err);
        res.status(500).send("Erro interno");
    }
});

module.exports = router;