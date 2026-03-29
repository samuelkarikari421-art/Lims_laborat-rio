const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. Rota para listar todos os parâmetros disponíveis no sistema para o filtro
router.get("/parametros", async (req, res) => {
    try {
        const result = await pool.query(`SELECT DISTINCT parametro FROM produto_specs ORDER BY parametro ASC`);
        res.json(result.rows.map(r => r.parametro));
    } catch (err) {
        console.error("Erro ao buscar parâmetros:", err);
        res.status(500).send("Erro interno");
    }
});

// 2. Buscar dados para o gráfico de tendência (Filtro: Produtos, Meses, Ano e PARÂMETRO)
router.get("/grafico", async (req, res) => {
    try {
        const { produtos, meses, ano, parametro } = req.query; 

        if (!produtos || !meses || !ano || !parametro) {
            return res.status(400).json({ error: "Faltam filtros obrigatórios (produtos, meses, ano, parametro)" });
        }

        const produtosArray = produtos.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        const mesesArray = meses.split(',').map(m => parseInt(m, 10)).filter(m => !isNaN(m));

        const result = await pool.query(`
            SELECT a.lote, 
                   p.nome_produto,
                   to_char(a.data_entrada, 'DD/MM') as data_curta,
                   an.valor_encontrado,
                   an.valor_max,
                   an.valor_min
            FROM amostras a
            JOIN analises an ON an.amostra_id = a.id
            JOIN produtos p ON p.id = a.produto_id
            WHERE a.produto_id = ANY($1::int[])
              AND an.parametro ILIKE $4
              AND EXTRACT(MONTH FROM a.data_entrada) = ANY($2::int[]) 
              AND EXTRACT(YEAR FROM a.data_entrada) = $3
              AND a.status IN ('CONFORME', 'REPROVADA', 'APROVADO', 'REPROVADO')
            ORDER BY a.data_entrada ASC
        `, [produtosArray, mesesArray, ano, parametro]);

        const dadosProcessados = result.rows.map(row => {
            let valorFloat = parseFloat(String(row.valor_encontrado).replace(',', '.'));
            
            return {
                lote: row.lote || 'Sem Lote',
                produto_nome: row.nome_produto, 
                data: row.data_curta,
                label: `Lote: ${row.lote || 'S/L'} (${row.data_curta})`,
                valor: isNaN(valorFloat) ? 0 : valorFloat,
                limite_max: row.valor_max
            };
        });

        res.json(dadosProcessados);
    } catch (err) {
        console.error("Erro ao buscar dados do monitoramento:", err);
        res.status(500).send("Erro interno");
    }
});

module.exports = router;