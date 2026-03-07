const express = require("express");
const router = express.Router();
const pool = require("../db");
const PDFDocument = require("pdfkit");

// 1. Listar todos os Laudos
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, 
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

// 4. GERAR O ARQUIVO PDF (🔥 AGORA COM VISUAL IDÊNTICO AO HTML)
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

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-disposition', `attachment; filename="${cab.numero}_KariKari.pdf"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // CABEÇALHO DO DOCUMENTO
        doc.fontSize(18).font('Helvetica-Bold').text('Kari Kari Alimentos', { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('gray').text('Laboratório de Controle de Qualidade', { align: 'center' });
        doc.fillColor('black').moveDown(2);

        doc.fontSize(14).font('Helvetica-Bold').text(`CERTIFICADO DE ANÁLISE Nº ${cab.numero}`, { align: 'center' });
        doc.moveDown(2);

        // INFORMAÇÕES DA AMOSTRA
        doc.fontSize(10).font('Helvetica');
        doc.text(`Produto: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.produto_nome}`);
        doc.font('Helvetica').text(`Lote: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.lote || '-'}`);
        doc.font('Helvetica').text(`Código da Amostra: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.amostra_cod}`);
        doc.font('Helvetica').text(`Data de Emissão: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.data_emissao_fmt}`);
        doc.moveDown(2);

        let y = doc.y;

        // 🔥 LÓGICA DE REDIMENSIONAMENTO INTELIGENTE DA TABELA
        const qtdResultados = resultados.length;
        let fontSizeTabela = 9;
        let rowHeight = 22;

        if (qtdResultados > 25) { fontSizeTabela = 7; rowHeight = 14; } 
        else if (qtdResultados > 15) { fontSizeTabela = 8; rowHeight = 18; }

        // Posições das Colunas na folha A4 (Largura total disponível: 495px)
        const col1 = 50, col2 = 230, col3 = 360, col4 = 450, tableWidth = 495;

        // Função que desenha o Cabeçalho da Tabela
        const drawTableHeader = (startY) => {
            // Fundo Cinza e Borda Externa
            doc.rect(col1, startY, tableWidth, rowHeight + 4).fillAndStroke('#f4f6f9', '#000');
            doc.fillColor('black').font('Helvetica-Bold').fontSize(fontSizeTabela);
            
            // Textos
            const textY = startY + (rowHeight - fontSizeTabela) / 2;
            doc.text('Parâmetro Analisado', col1 + 5, textY);
            doc.text('Especificação Mín/Máx', col2 + 5, textY);
            doc.text('Resultado', col3 + 5, textY);
            doc.text('Status', col4 + 5, textY);
            
            // Linhas divisórias verticais
            doc.moveTo(col2, startY).lineTo(col2, startY + rowHeight + 4).stroke();
            doc.moveTo(col3, startY).lineTo(col3, startY + rowHeight + 4).stroke();
            doc.moveTo(col4, startY).lineTo(col4, startY + rowHeight + 4).stroke();
            
            return startY + rowHeight + 4;
        };

        y = drawTableHeader(y); // Desenha o cabeçalho da tabela
        doc.font('Helvetica').fontSize(fontSizeTabela);

        // PREENCHIMENTO DOS DADOS (Com bordas!)
        resultados.forEach(r => {
            // Se a linha for passar do limite da folha, cria nova página e repete o cabeçalho
            if (y + rowHeight > 750) {
                doc.addPage();
                y = 50;
                y = drawTableHeader(y); 
                doc.font('Helvetica').fontSize(fontSizeTabela);
            }

            // 1. Desenha o Retângulo da Linha
            doc.rect(col1, y, tableWidth, rowHeight).stroke();
            
            // 2. Desenha as Linhas Verticais
            doc.moveTo(col2, y).lineTo(col2, y + rowHeight).stroke();
            doc.moveTo(col3, y).lineTo(col3, y + rowHeight).stroke();
            doc.moveTo(col4, y).lineTo(col4, y + rowHeight).stroke();

            // 3. Prepara e escreve os Textos centralizados verticalmente
            const temMin = r.valor_min !== undefined && r.valor_min !== null;
            const temMax = r.valor_max !== undefined && r.valor_max !== null;
            let spec = '-';
            if (temMin && temMax) spec = `${r.valor_min} a ${r.valor_max}`;
            else if (temMin) spec = `Mín: ${r.valor_min}`;
            else if (temMax) spec = `Máx: ${r.valor_max}`;

            const statusStr = r.conforme ? 'CONFORME' : 'NÃO CONFORME';
            const textY = y + (rowHeight - fontSizeTabela) / 2 - 1; // Centraliza o texto na célula

            doc.font('Helvetica-Bold').text(r.parametro || '-', col1 + 5, textY, { width: col2 - col1 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').text(spec, col2 + 5, textY, { width: col3 - col2 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica-Bold').text(r.valor_encontrado || '-', col3 + 5, textY, { width: col4 - col3 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica-Bold').text(statusStr, col4 + 5, textY, { width: 545 - col4 - 10, lineBreak: false, ellipsis: true });

            y += rowHeight;
        });

        // 🔥 CAIXA DO PARECER TÉCNICO (Igual ao HTML)
        if (y + 50 > 750) { doc.addPage(); y = 50; } // Pula página se não couber a caixa
        
        y += 15; // Espaço antes da caixa
        doc.rect(col1, y, tableWidth, 25).stroke();
        doc.font('Helvetica-Bold').fontSize(11).text(`PARECER TÉCNICO:  ${cab.resultado}`, col1, y + 8, { align: 'center', width: tableWidth });

        // 🔥 ÁREA DE ASSINATURA
        y += 80;
        if (y + 80 > 800) { doc.addPage(); y = 80; } // Empurra para a próxima folha se estiver muito no fundo

        // Assinatura (Usando fonte itálica grande para simular a assinatura real)
        doc.font('Times-Italic').fontSize(22).text(cab.responsavel_nome || 'Analista', col1, y - 25, { align: 'center', width: tableWidth });
        
        // Linha da Assinatura
        doc.lineWidth(1).moveTo(150, y).lineTo(445, y).stroke();
        doc.moveDown(0.5);
        
        // Nome e Cargo
        doc.font('Helvetica-Bold').fontSize(10).text(cab.responsavel_nome || 'Analista', { align: 'center' });
        doc.font('Helvetica').fontSize(9).text(cab.responsavel_cargo || 'Controle de Qualidade', { align: 'center' });
        doc.moveDown(0.5);
        
        // Texto de Segurança
        doc.fontSize(8).fillColor('gray').text(`Documento emitido e assinado eletronicamente via LIMS em ${cab.data_emissao_fmt}`, { align: 'center' });

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