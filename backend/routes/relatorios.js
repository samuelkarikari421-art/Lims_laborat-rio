const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Dados de Qualidade (KPIs e Tendência)
router.get("/qualidade", async (req, res) => {
    try {
        const { data_inicio, data_fim, produto_id } = req.query;
        const params = [];
        let filtro = " WHERE 1=1 ";
        let count = 1;

        if (data_inicio) { filtro += ` AND data_entrada >= $${count++}`; params.push(data_inicio); }
        if (data_fim) { filtro += ` AND data_entrada <= $${count++}`; params.push(data_fim); }
        if (produto_id) { filtro += ` AND produto_id = $${count++}`; params.push(produto_id); }

        // KPI: Totais por Status
        const kpiRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'CONFORME' THEN 1 ELSE 0 END) as aprovados,
                SUM(CASE WHEN status = 'REPROVADO' THEN 1 ELSE 0 END) as reprovados
            FROM amostras ${filtro}
        `, params);

        // Gráfico: Tendência por Dia (Últimos 30 dias ou filtro)
        // Agrupa por data para mostrar a linha do tempo
        const chartRes = await pool.query(`
            SELECT to_char(data_entrada, 'DD/MM') as dia,
                   COUNT(*) as total,
                   SUM(CASE WHEN status = 'REPROVADO' THEN 1 ELSE 0 END) as reprovados
            FROM amostras ${filtro}
            GROUP BY 1
            ORDER BY MIN(data_entrada) ASC
        `, params);

        const dados = kpiRes.rows[0];
        const total = parseInt(dados.total) || 0;
        const reprovados = parseInt(dados.reprovados) || 0;
        
        // Cálculos de Porcentagem
        const percConformidade = total > 0 ? ((parseInt(dados.aprovados) / total) * 100).toFixed(1) : 0;
        const indiceReprovacao = total > 0 ? ((reprovados / total) * 100).toFixed(1) : 0;

        res.json({
            kpi: { percConformidade, indiceReprovacao, total },
            grafico: chartRes.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao gerar relatórios de qualidade");
    }
});

// 2. Dados de Performance (Tempos e Volume)
router.get("/performance", async (req, res) => {
    try {
        // Tempo Médio: Diferença entre Data de Entrada da Amostra e Data de Emissão do Laudo
        // Usamos EXTRACT(EPOCH FROM ...) para pegar segundos, depois dividimos por 3600 (horas) ou 86400 (dias)
        
        const tempoRes = await pool.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (l.data_emissao - a.data_entrada))/3600) as horas_medias
            FROM laudos l
            JOIN amostras a ON a.id = l.amostra_id
            WHERE l.data_emissao >= NOW() - INTERVAL '30 days'
        `);

        // Volume Mensal (Últimos 6 meses)
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

module.exports = router;