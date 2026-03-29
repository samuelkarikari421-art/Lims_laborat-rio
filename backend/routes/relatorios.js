const express = require("express");
const router = express.Router();
const pool = require("../db");

// =========================================================================
// 1. Dados de Qualidade (KPIs e Tendência)
// =========================================================================
router.get("/qualidade", async (req, res) => {
    try {
        const { data_inicio, data_fim, produto_id } = req.query;
        const params = [];
        
        // 🔥 CORREÇÃO: Conta APENAS amostras que já têm um resultado final (exclui PENDENTE e EM ANÁLISE)
        let filtro = " WHERE status IN ('CONFORME', 'APROVADO', 'REPROVADA', 'REPROVADO', 'NÃO CONFORME') ";
        let count = 1;

        if (data_inicio) { filtro += ` AND data_entrada >= $${count++}`; params.push(data_inicio); }
        if (data_fim) { filtro += ` AND data_entrada <= $${count++}`; params.push(data_fim); }
        if (produto_id) { filtro += ` AND produto_id = $${count++}`; params.push(produto_id); }

        const kpiRes = await pool.query(`
            SELECT 
                COUNT(*) as total_finalizadas,
                SUM(CASE WHEN status IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovados,
                SUM(CASE WHEN status IN ('REPROVADA', 'REPROVADO', 'NÃO CONFORME') THEN 1 ELSE 0 END) as reprovados
            FROM amostras ${filtro}
        `, params);

        // Gráfico: Tendência por Dia (também ajustado para o mesmo filtro)
        const chartRes = await pool.query(`
            SELECT to_char(data_entrada, 'DD/MM') as dia,
                   COUNT(*) as total,
                   SUM(CASE WHEN status IN ('REPROVADA', 'REPROVADO', 'NÃO CONFORME') THEN 1 ELSE 0 END) as reprovados
            FROM amostras ${filtro}
            GROUP BY 1
            ORDER BY MIN(data_entrada) ASC
        `, params);

        const dados = kpiRes.rows[0];
        
        // 🔥 MATEMÁTICA CORRIGIDA (Baseia-se apenas nas que já foram julgadas)
        const totalFinalizadas = parseInt(dados.total_finalizadas) || 0;
        const aprovados = parseInt(dados.aprovados) || 0;
        const reprovados = parseInt(dados.reprovados) || 0;
        
        const percConformidade = totalFinalizadas > 0 ? ((aprovados / totalFinalizadas) * 100).toFixed(1) : 0;
        const indiceReprovacao = totalFinalizadas > 0 ? ((reprovados / totalFinalizadas) * 100).toFixed(1) : 0;

        res.json({
            kpi: { percConformidade, indiceReprovacao, total: totalFinalizadas },
            grafico: chartRes.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar relatórios de qualidade");
    }
});

// =========================================================================
// 2. Dados de Performance (Tempos e Volume)
// =========================================================================
router.get("/performance", async (req, res) => {
    try {
        const tempoRes = await pool.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (l.data_emissao - a.data_entrada))/3600) as horas_medias
            FROM laudos l
            JOIN amostras a ON a.id = l.amostra_id
            WHERE l.data_emissao >= NOW() - INTERVAL '30 days'
        `);

        const volumeRes = await pool.query(`
            SELECT to_char(data_entrada, 'Mon/YY') as mes, COUNT(*) as qtd
            FROM amostras
            WHERE data_entrada >= NOW() - INTERVAL '6 months'
            GROUP BY 1, to_char(data_entrada, 'YYYY-MM')
            ORDER BY to_char(data_entrada, 'YYYY-MM') ASC
        `);

        const horas = parseFloat(tempoRes.rows[0].horas_medias || 0).toFixed(1);

        res.json({
            tempoMedioHoras: horas,
            volumeMensal: volumeRes.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar performance");
    }
});

// =========================================================================
// 3. EXPORTAR DADOS COMPLETOS PARA EXCEL
// =========================================================================
router.get("/exportar", async (req, res) => {
    try {
        const { data_inicio, data_fim } = req.query;

        let dateFilter = "";
        const queryParams = [];

        if (data_inicio && data_fim) {
            dateFilter = "AND a.data_entrada::date BETWEEN $1 AND $2";
            queryParams.push(data_inicio, data_fim);
        }

        const result = await pool.query(`
            SELECT 
                a.id as "ID Amostra",
                a.codigo as "Cód. Amostra",
                a.lote as "Lote / O.P.",
                p.nome_produto as "Produto",
                to_char(a.data_entrada, 'DD/MM/YYYY HH24:MI') as "Data Entrada",
                to_char(a.data_conclusao, 'DD/MM/YYYY HH24:MI') as "Data Finalização",
                a.status as "Status do Lote",
                an.parametro as "Parâmetro Analisado",
                an.metodo as "Método",
                an.valor_min as "L.I.",
                an.valor_max as "L.S.",
                an.valor_encontrado as "Resultado",
                CASE WHEN an.conforme = TRUE THEN 'Aprovado' ELSE 'Reprovado' END as "Status da Análise",
                a.observacoes as "Observações"
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            JOIN analises an ON an.amostra_id = a.id
            WHERE a.status IN ('CONFORME', 'REPROVADA', 'APROVADO', 'REPROVADO', 'NÃO CONFORME')
            ${dateFilter}
            ORDER BY a.data_entrada DESC, a.id DESC, an.id ASC
        `, queryParams);

        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao gerar extracao excel:", err);
        res.status(500).send("Erro interno");
    }
});

module.exports = router;