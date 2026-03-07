const express = require("express");
const router = express.Router();
const pool = require("../db");
const PDFDocument = require("pdfkit");

// 1. Listar todos os Laudos
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, 
                   -- 🔥 NOVO PADRÃO SQL: LDO-YYYYMM-ID
                   'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero, 
                   CASE 
                       WHEN l.emitido_por IS NULL THEN 'AGUARDANDO ASSINATURA' 
                       ELSE COALESCE(l.resultado, a.status) 
                   END as resultado,
                   to_char(COALESCE(l.data_emissao, a.data_entrada), 'DD/MM/YYYY HH24:MI') as data_fmt,
                   a.codigo as amostra_cod, 
                   p.nome_produto as produto_nome
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            WHERE a.status IN ('CONFORME', 'REPROVADA', 'REPROVADO', 'APROVADO')
            ORDER BY a.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar laudos:", err);
        res.status(500).send("Erro interno");
    }
});

// 2. Visualizar Detalhes
router.get("/:id/detalhes", async (req, res) => {
    try {
        const cabecalhoRes = await pool.query(`
            SELECT a.id as id, 
                   'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero, 
                   COALESCE(l.resultado, a.status) as resultado, 
                   to_char(COALESCE(l.data_emissao, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') as data_emissao_fmt,
                   a.codigo as amostra_cod, a.lote,
                   p.nome_produto as produto_nome,
                   u.nome as responsavel_nome,
                   u.cargo as responsavel_cargo,
                   u.assinatura as responsavel_assinatura,
                   l.emitido_por,
                   a.id as amostra_id
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            LEFT JOIN usuarios u ON u.id = l.emitido_por
            WHERE a.id = $1
            LIMIT 1
        `, [req.params.id]);

        if (cabecalhoRes.rows.length === 0) return res.status(404).send("Laudo não encontrado");
        const amostraId = cabecalhoRes.rows[0].amostra_id;

        const resultadosRes = await pool.query(`SELECT * FROM analises WHERE amostra_id = $1`, [amostraId]);
        res.json({ cabecalho: cabecalhoRes.rows[0], resultados: resultadosRes.rows });
    } catch (err) {
        res.status(500).send("Erro interno");
    }
});

// 3. Assinar Oficialmente o Laudo
router.put("/:id/assinar", async (req, res) => {
    try {
        const { usuario_id } = req.body;
        const idParam = req.params.id;

        const check = await pool.query(`SELECT id FROM laudos WHERE amostra_id = $1`, [idParam]);

        if (check.rows.length === 0) {
            const amostraRes = await pool.query(`SELECT status FROM amostras WHERE id = $1`, [idParam]);
            if (amostraRes.rows.length === 0) return res.status(404).json({ success: false });

            const statusFinal = amostraRes.rows[0].status;

            await pool.query(`
                INSERT INTO laudos (amostra_id, resultado, emitido_por, data_emissao)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            `, [idParam, statusFinal, usuario_id]);

        } else {
            await pool.query(`
                UPDATE laudos 
                SET emitido_por = $1, data_emissao = CURRENT_TIMESTAMP
                WHERE amostra_id = $2
            `, [usuario_id, idParam]);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao assinar:", err);
        res.status(500).json({ success: false });
    }
});

// 4. GERAR O ARQUIVO PDF
router.get("/:id/pdf", async (req, res) => {
    try {
        const cabecalhoRes = await pool.query(`
            SELECT 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero, 
                   COALESCE(l.resultado::text, a.status::text) as resultado, 
                   to_char(COALESCE(l.data_emissao, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') as data_emissao_fmt,
                   a.codigo as amostra_cod, a.lote, a.id as amostra_id,
                   p.nome_produto as produto_nome,
                   u.nome as responsavel_nome,
                   u.cargo as responsavel_cargo,
                   l.emitido_por
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            LEFT JOIN usuarios u ON u.id = l.emitido_por
            WHERE a.id = $1
            LIMIT 1
        `, [req.params.id]);

        if (cabecalhoRes.rows.length === 0) return res.status(404).send("Amostra/Laudo não encontrado.");
        const cab = cabecalhoRes.rows[0];

        if (!cab.emitido_por) {
            return res.status(403).send("ERRO: Este laudo ainda não foi assinado. Gere a assinatura no sistema antes de baixar o PDF.");
        }

        const resultadosRes = await pool.query(`SELECT * FROM analises WHERE amostra_id = $1`, [cab.amostra_id]);
        const resultados = resultadosRes.rows;

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-disposition', `attachment; filename="${cab.numero}_KariKari.pdf"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        doc.fontSize(20).font('Helvetica-Bold').text('KARI KARI ALIMENTOS', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text('Laboratório de Controle de Qualidade', { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(14).font('Helvetica-Bold').text(`CERTIFICADO DE ANÁLISE Nº ${cab.numero}`, { align: 'center', underline: true });
        doc.moveDown(2);

        doc.fontSize(11).font('Helvetica');
        doc.text(`Produto: ${cab.produto_nome}`);
        doc.text(`Lote: ${cab.lote || '-'}`);
        doc.text(`Código da Amostra: ${cab.amostra_cod}`);
        doc.text(`Data de Emissão: ${cab.data_emissao_fmt}`);
        doc.moveDown(2);

        doc.font('Helvetica-Bold').text('RESULTADOS ANALÍTICOS');
        doc.moveDown(0.5);
        
        let y = doc.y;
        doc.text('Parâmetro', 50, y);
        doc.text('Especificação', 220, y);
        doc.text('Resultado', 380, y);
        doc.text('Status', 480, y);
        doc.moveTo(50, y + 15).lineTo(540, y + 15).stroke();
        y += 25;
        doc.font('Helvetica');
        
        resultados.forEach(r => {
            const temMin = r.valor_min !== undefined && r.valor_min !== null;
            const temMax = r.valor_max !== undefined && r.valor_max !== null;
            const spec = (temMin && temMax) ? `${r.valor_min} a ${r.valor_max}` : '-';
            const statusStr = r.conforme ? 'Conforme' : 'Não Conforme';
            
            doc.text(r.parametro || '-', 50, y);
            doc.text(spec, 220, y);
            doc.font('Helvetica-Bold').text(r.valor_encontrado || '-', 380, y).font('Helvetica');
            doc.text(statusStr, 480, y);
            y += 20;
            if (y > 700) { doc.addPage(); y = 50; }
        });

        doc.moveDown(4);
        doc.y = y + 40;
        doc.font('Helvetica-Bold').fontSize(12).text(`CONCLUSÃO: ${cab.resultado}`, { align: 'center' });
        doc.moveDown(5);

        let assinaturaY = doc.y;
        doc.moveTo(150, assinaturaY).lineTo(450, assinaturaY).stroke();
        doc.moveDown(0.5);
        
        doc.fontSize(11).font('Helvetica-Bold').text(cab.responsavel_nome || 'Analista', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text(cab.responsavel_cargo || 'Controle de Qualidade', { align: 'center' });
        doc.moveDown(0.2);
        doc.fontSize(9).text('Assinado Eletronicamente', { align: 'center', color: 'gray' });

        doc.end();

    } catch (err) {
        console.error("Erro crítico ao gerar PDF:", err);
        res.status(500).send("Erro ao processar o arquivo PDF.");
    }
});

// 5. Cancelar / Excluir Laudo
router.delete("/:id", async (req, res) => {
    try {
        const amostraId = req.params.id; 
        await pool.query("DELETE FROM laudos WHERE amostra_id = $1", [amostraId]);
        await pool.query("UPDATE amostras SET status = 'EM ANÁLISE' WHERE id = $1", [amostraId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

module.exports = router;