const express = require("express");
const router = express.Router();
const pool = require("../db");

// A Rota agora atende exatamente o que o Frontend pede: /api/dashboard/estatisticas
router.get("/estatisticas", async (req, res) => {
    try {
        // ==========================================
        // 1. CÁLCULO DOS KPIs DO TOPO
        // ==========================================
        
        // Amostras no Mês Atual
        const amostrasMesRes = await pool.query(`
            SELECT COUNT(*) FROM amostras 
            WHERE date_trunc('month', data_entrada) = date_trunc('month', CURRENT_DATE)
        `);
        const amostrasMes = parseInt(amostrasMesRes.rows[0].count);

        // Laudos Emitidos (Total Histórico)
        const laudosRes = await pool.query(`SELECT COUNT(*) FROM laudos`);
        const laudosEmitidos = parseInt(laudosRes.rows[0].count);

        // Reagentes em Alerta (Baixo ou Vence em <= 30 dias)
        const reagentesRes = await pool.query(`
            SELECT COUNT(*) FROM reagentes 
            WHERE (quantidade <= COALESCE(estoque_minimo, 0)) 
               OR (validade <= CURRENT_DATE + INTERVAL '30 days')
        `);
        const reagentesAlerta = parseInt(reagentesRes.rows[0].count);

        // Aprovação Geral (Percentual de Laudos Conformes em relação ao total)
        const aprovacaoRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN resultado IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovados
            FROM laudos
        `);
        const totalLaudosAnalise = parseInt(aprovacaoRes.rows[0].total) || 1; // Evita divisão por zero
        const totalAprovados = parseInt(aprovacaoRes.rows[0].aprovados) || 0;
        const aprovacaoGeral = Math.round((totalAprovados / totalLaudosAnalise) * 100);

        // ==========================================
        // 2. DADOS PARA O GRÁFICO: Desempenho por Produto
        // ==========================================
        const grafProdutosRes = await pool.query(`
            SELECT 
                p.nome_produto as produto,
                SUM(CASE WHEN l.resultado IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovadas,
                SUM(CASE WHEN l.resultado IN ('REPROVADA', 'REPROVADO') THEN 1 ELSE 0 END) as reprovadas
            FROM laudos l
            JOIN amostras a ON l.amostra_id = a.id
            JOIN produtos p ON a.produto_id = p.id
            GROUP BY p.nome_produto
            ORDER BY (SUM(CASE WHEN l.resultado IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) + SUM(CASE WHEN l.resultado IN ('REPROVADA', 'REPROVADO') THEN 1 ELSE 0 END)) DESC
            LIMIT 5
        `);

        // ==========================================
        // 3. DADOS PARA O GRÁFICO: Tendência Mensal
        // ==========================================
        const grafTendenciaRes = await pool.query(`
            SELECT 
                to_char(data_emissao, 'Mon/YY') as mes_ano,
                to_char(data_emissao, 'YYYY-MM') as ordenacao,
                COUNT(*) as total,
                SUM(CASE WHEN resultado IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovadas
            FROM laudos
            GROUP BY mes_ano, ordenacao
            ORDER BY ordenacao ASC
            LIMIT 6
        `);

        // ==========================================
        // 4. EMPACOTAMENTO E ENVIO
        // ==========================================
        res.json({
            kpis: {
                aprovacao_geral: aprovacaoGeral,
                amostras_mes: amostrasMes,
                laudos_emitidos: laudosEmitidos,
                reagentes_alerta: reagentesAlerta
            },
            desempenho_produtos: grafProdutosRes.rows,
            tendencia_mensal: grafTendenciaRes.rows
        });

    } catch (err) {
        console.error("Erro ao gerar estatísticas do Dashboard:", err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

module.exports = router;