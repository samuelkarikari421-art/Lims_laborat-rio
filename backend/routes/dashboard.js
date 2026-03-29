const express = require("express");
const router = express.Router();
const pool = require("../db");

// A Rota atende: /api/dashboard/estatisticas
router.get("/estatisticas", async (req, res) => {
    try {
        // 🔥 LÓGICA DO FILTRO DE PRODUTOS
        let params = [];
        let produtoFilter = "";
        
        if (req.query.produtos) {
            const idsStr = req.query.produtos;
            const prodIds = idsStr.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            
            if (prodIds.length > 0) {
                params.push(prodIds);
                produtoFilter = ` AND a.produto_id = ANY($1::int[]) `;
            }
        }

        // ==========================================
        // 1. CÁLCULO DOS KPIs DO TOPO
        // ==========================================
        
        // Amostras no Mês Atual
        const amostrasMesRes = await pool.query(`
            SELECT COUNT(*) FROM amostras a
            WHERE date_trunc('month', a.data_entrada) = date_trunc('month', CURRENT_DATE)
            ${produtoFilter}
        `, params);
        const amostrasMes = parseInt(amostrasMesRes.rows[0].count);

        // Laudos Emitidos - TOTAL
        const laudosRes = await pool.query(`
            SELECT COUNT(*) FROM laudos l
            JOIN amostras a ON l.amostra_id = a.id
            WHERE 1=1 ${produtoFilter}
        `, params);
        const laudosEmitidos = parseInt(laudosRes.rows[0].count);

        // Laudos Emitidos no Mês Atual
        const laudosMesRes = await pool.query(`
            SELECT COUNT(*) FROM laudos l
            JOIN amostras a ON l.amostra_id = a.id
            WHERE date_trunc('month', l.data_emissao) = date_trunc('month', CURRENT_DATE)
            ${produtoFilter}
        `, params);
        const laudosMes = parseInt(laudosMesRes.rows[0].count);

        // Amostras na Fila FIFO
        const filaFifoRes = await pool.query(`
            SELECT COUNT(*) FROM amostras a
            WHERE a.status IN ('PENDENTE', 'EM ANÁLISE')
            ${produtoFilter}
        `, params);
        const amostrasFila = parseInt(filaFifoRes.rows[0].count);

        // Reagentes em Alerta (Estático, não usa filtro de produto)
        const reagentesRes = await pool.query(`
            SELECT COUNT(*) FROM reagentes 
            WHERE (quantidade <= COALESCE(estoque_minimo, 0)) 
               OR (validade <= CURRENT_DATE + INTERVAL '30 days')
        `);
        const reagentesAlerta = parseInt(reagentesRes.rows[0].count);

        // 🔥 NOVO: Materiais em Alerta (Estático, não usa filtro de produto)
        const materiaisRes = await pool.query(`
            SELECT COUNT(*) FROM materiais 
            WHERE quantidade <= COALESCE(estoque_minimo, 0)
        `);
        const materiaisAlerta = parseInt(materiaisRes.rows[0].count);

        // Aprovação Geral Histórica
        const aprovacaoRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN a.status IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovados
            FROM amostras a
            WHERE a.status IN ('CONFORME', 'APROVADO', 'REPROVADA', 'REPROVADO', 'NÃO CONFORME')
            ${produtoFilter}
        `, params);
        
        const totalLaudosAnalise = parseInt(aprovacaoRes.rows[0].total) || 0;
        const totalAprovados = parseInt(aprovacaoRes.rows[0].aprovados) || 0;
        
        let aprovacaoGeral = 0;
        if (totalLaudosAnalise > 0) {
            aprovacaoGeral = Math.round((totalAprovados / totalLaudosAnalise) * 100);
        }

        // ==========================================
        // 2. DADOS PARA O GRÁFICO: Desempenho por Produto
        // ==========================================
        const grafProdutosRes = await pool.query(`
            SELECT 
                p.nome_produto as produto,
                SUM(CASE WHEN a.status IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovadas,
                SUM(CASE WHEN a.status IN ('REPROVADA', 'REPROVADO', 'NÃO CONFORME') THEN 1 ELSE 0 END) as reprovadas
            FROM amostras a
            JOIN produtos p ON a.produto_id = p.id
            WHERE a.status IN ('CONFORME', 'APROVADO', 'REPROVADA', 'REPROVADO', 'NÃO CONFORME')
            ${produtoFilter}
            GROUP BY p.nome_produto
            ORDER BY (SUM(CASE WHEN a.status IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) + SUM(CASE WHEN a.status IN ('REPROVADA', 'REPROVADO', 'NÃO CONFORME') THEN 1 ELSE 0 END)) DESC
        `, params);

        // ==========================================
        // 3. DADOS PARA O GRÁFICO: Tendência Mensal
        // ==========================================
        const grafTendenciaRes = await pool.query(`
            SELECT 
                to_char(a.data_conclusao, 'Mon/YY') as mes_ano,
                to_char(a.data_conclusao, 'YYYY-MM') as ordenacao,
                COUNT(*) as total,
                SUM(CASE WHEN a.status IN ('CONFORME', 'APROVADO') THEN 1 ELSE 0 END) as aprovadas
            FROM amostras a
            WHERE a.data_conclusao IS NOT NULL 
              AND a.status IN ('CONFORME', 'APROVADO', 'REPROVADA', 'REPROVADO', 'NÃO CONFORME')
              AND a.data_conclusao >= NOW() - INTERVAL '12 months'
              ${produtoFilter}
            GROUP BY mes_ano, ordenacao
            ORDER BY ordenacao ASC
        `, params);

        // ==========================================
        // 4. EMPACOTAMENTO E ENVIO
        // ==========================================
        res.json({
            kpis: {
                aprovacao_geral: aprovacaoGeral,
                amostras_mes: amostrasMes,
                laudos_emitidos: laudosEmitidos,
                laudos_mes: laudosMes,       
                amostras_fila: amostrasFila, 
                reagentes_alerta: reagentesAlerta,
                materiais_alerta: materiaisAlerta // 🔥 ENVIANDO O NOVO DADO
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