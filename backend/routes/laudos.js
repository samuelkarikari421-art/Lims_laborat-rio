const express = require("express");
const router = express.Router();
const pool = require("../db");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer"); 
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para identificar quem faz as ações
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

// =========================================================================
// 🔥 MOTOR SILENCIOSO DE AUDITORIA (LOG DE ATIVIDADES)
// =========================================================================
async function registrarLog(req, acao, detalhes, userIdDireto = null) {
    let usuarioNome = "Sistema / Desconhecido";
    try {
        if (userIdDireto) {
            const userRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [userIdDireto]);
            if (userRes.rows.length > 0) usuarioNome = userRes.rows[0].nome;
        } else {
            const authHeader = req.headers.authorization;
            if (authHeader) {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, SECRET);
                const userRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [decoded.id]);
                if (userRes.rows.length > 0) usuarioNome = userRes.rows[0].nome;
            }
        }
    } catch (e) {
        // Ignora erro de identificação para não quebrar o sistema
    }

    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade (Laudos):", e.message);
    }
}

// =========================================================================
// ✉️ CONFIGURAÇÃO DO E-MAIL
// =========================================================================
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, 
    auth: {
        user: 'kari@karikari.com.br', 
        pass: '@batata2024'        
    },
    tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
    }
});

// =========================================================================
// 1. Listar todos os Laudos
// =========================================================================
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
                   p.nome_produto as produto_nome,
                   l.emitido_por
            FROM amostras a
            JOIN produtos p ON p.id = a.produto_id
            LEFT JOIN laudos l ON l.amostra_id = a.id
            WHERE a.status IN ('CONFORME', 'REPROVADA', 'REPROVADO', 'APROVADO', 'NÃO CONFORME')
            ORDER BY a.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar laudos:", err);
        res.status(500).send("Erro interno");
    }
});

// =========================================================================
// 2. Visualizar Detalhes (COM CERTIFICADOS E FOTOS)
// =========================================================================
router.get("/:id/detalhes", async (req, res) => {
    try {
        const cabecalhoRes = await pool.query(`
            SELECT a.id as id, 
                   'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero, 
                   COALESCE(l.resultado, a.status) as resultado, 
                   to_char(COALESCE(l.data_emissao, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') as data_emissao_fmt,
                   a.codigo as amostra_cod, a.lote,
                   a.obs_analise as observacoes,
                   to_char(a.data_validade, 'DD/MM/YYYY') as validade_fmt,
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
        
        let cabecalho = cabecalhoRes.rows[0];
        const amostraId = cabecalho.amostra_id;

        // 🔥 2.1 BUSCA O CERTIFICADO E AS FOTOS DA AMOSTRA 
        const anexosAmostraRes = await pool.query(`
            SELECT nome_arquivo, arquivo_base64, tipo_anexo 
            FROM amostras_anexos 
            WHERE amostra_id = $1
        `, [amostraId]);
        
        const certificado = anexosAmostraRes.rows.find(a => a.tipo_anexo === 'CERTIFICADO');
        const evidencias = anexosAmostraRes.rows.filter(a => a.tipo_anexo === 'EVIDENCIA');

        cabecalho.certificado_nome = certificado ? certificado.nome_arquivo : null;
        cabecalho.certificado_base64 = certificado ? certificado.arquivo_base64 : null;
        cabecalho.anexos_entrada = evidencias;

        // 🔥 2.2 BUSCA OS RESULTADOS FÍSICO-QUÍMICOS
        const resultadosRes = await pool.query(`SELECT * FROM analises WHERE amostra_id = $1`, [amostraId]);
        let resultados = resultadosRes.rows;

        // 🔥 2.3 BUSCA AS EVIDÊNCIAS DOS TESTES (CADINHOS, ETC)
        for (let analise of resultados) {
            const anexosAnaliseRes = await pool.query(`SELECT id, nome_arquivo, arquivo_base64 FROM analises_anexos WHERE analise_id = $1`, [analise.id]);
            analise.anexos = anexosAnaliseRes.rows; 
        }

        res.json({ cabecalho: cabecalho, resultados: resultados });
    } catch (err) {
        console.error("Erro ao carregar detalhes:", err);
        res.status(500).send("Erro interno");
    }
});

// =========================================================================
// FUNÇÃO INTERNA: DISPARAR E-MAIL DE REPROVAÇÃO
// =========================================================================
async function dispararEmailReprovacao(idParam, numeroLaudo, amostraData) {
    try {
        const destinatariosResult = await pool.query("SELECT email FROM usuarios WHERE recebe_alertas = true AND email IS NOT NULL AND email != ''");
        
        if (destinatariosResult.rows.length > 0) {
            const listaEmails = destinatariosResult.rows.map(u => u.email).join(', ');

            const falhasRes = await pool.query(`
                SELECT id, parametro, valor_min, valor_max, unidade, valor_encontrado 
                FROM analises 
                WHERE amostra_id = $1 AND conforme = false
            `, [idParam]);

            let htmlFalhas = '';
            let anexosEmail = [];

            for (const falha of falhasRes.rows) {
                let spec = '-';
                if (falha.valor_min !== null && falha.valor_max !== null) spec = `${falha.valor_min} a ${falha.valor_max}`;
                else if (falha.valor_min !== null) spec = `Mín: ${falha.valor_min}`;
                else if (falha.valor_max !== null) spec = `Máx: ${falha.valor_max}`;
                const unid = falha.unidade ? ` ${falha.unidade}` : '';

                htmlFalhas += `
                    <li style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed #ccc;">
                        <strong>Parâmetro:</strong> ${falha.parametro}<br>
                        <strong>Especificação:</strong> ${spec}${unid}<br>
                        <strong>Resultado Encontrado:</strong> <span style="color: #dc3545; font-weight: bold; font-size: 1.1em;">${falha.valor_encontrado}${unid}</span>
                    </li>
                `;

                const anexosRes = await pool.query(`SELECT nome_arquivo, arquivo_base64 FROM analises_anexos WHERE analise_id = $1`, [falha.id]);
                for (const anexo of anexosRes.rows) {
                    const base64Content = anexo.arquivo_base64.split(';base64,').pop();
                    anexosEmail.push({
                        filename: `${falha.parametro}_${anexo.nome_arquivo}`, 
                        content: Buffer.from(base64Content, 'base64')
                    });
                }
            }

            const mailOptions = {
                from: 'kari@karikari.com.br', 
                to: listaEmails,
                subject: `🚨 ALERTA DE QUALIDADE: Laudo NÃO CONFORME (${numeroLaudo})`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #dc3545; border-radius: 8px;">
                        <h2 style="color: #dc3545; margin-top: 0;">⚠️ Alerta de Produto Não Conforme</h2>
                        <p>O Laboratório de Controle de Qualidade acaba de assinar um laudo com resultado <strong>REPROVADO</strong>.</p>
                        
                        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; background-color: #f9f9f9;">
                            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Nº do Laudo:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${numeroLaudo}</td></tr>
                            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Código da Amostra:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amostraData.amostra_cod}</td></tr>
                            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Produto:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amostraData.nome_produto}</td></tr>
                            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Lote:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amostraData.lote || 'N/A'}</td></tr>
                        </table>

                        <h3 style="color: #dc3545; margin-top: 20px; border-bottom: 2px solid #dc3545; display: inline-block;">Detalhes da Falha</h3>
                        <ul style="list-style-type: none; padding-left: 0;">
                            ${htmlFalhas || '<li>Detalhes não encontrados.</li>'}
                        </ul>

                        <div style="background-color: #fff3cd; padding: 15px; border-left: 5px solid #ffc107; margin-top: 15px;">
                            <strong style="color: #856404;">Observações do Analista:</strong><br>
                            <span style="color: #533f03;">${amostraData.observacoes ? amostraData.observacoes.replace(/\n/g, '<br>') : 'Nenhuma observação registrada.'}</span>
                        </div>
                    </div>
                `,
                attachments: anexosEmail
            };

            await transporter.sendMail(mailOptions);
        }
    } catch(err) {
        console.error("Erro interno no disparo de e-mail:", err);
    }
}

// =========================================================================
// 3. ASSINAR MÚLTIPLOS LAUDOS EM LOTE
// =========================================================================
router.put("/lote/assinar", async (req, res) => {
    try {
        const { usuario_id, laudos_ids } = req.body;

        if(!laudos_ids || laudos_ids.length === 0) {
            return res.status(400).json({ success: false, message: "Nenhum laudo selecionado."});
        }

        let codigosAssinados = [];

        for(let idParam of laudos_ids) {
            const amostraRes = await pool.query(`SELECT a.status, a.codigo as amostra_cod, a.lote, a.obs_analise as observacoes, p.nome_produto, 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero FROM amostras a JOIN produtos p ON p.id = a.produto_id WHERE a.id = $1`, [idParam]);
            if (amostraRes.rows.length === 0) continue;
            
            const amostraData = amostraRes.rows[0];
            const statusFinal = amostraData.status;
            const numeroLaudo = amostraData.numero;

            const check = await pool.query(`SELECT id FROM laudos WHERE amostra_id = $1`, [idParam]);
            if (check.rows.length === 0) {
                await pool.query(`INSERT INTO laudos (amostra_id, resultado, emitido_por, data_emissao) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [idParam, statusFinal, usuario_id]);
            } else {
                await pool.query(`UPDATE laudos SET emitido_por = $1, data_emissao = CURRENT_TIMESTAMP WHERE amostra_id = $2`, [usuario_id, idParam]);
            }

            if (statusFinal === 'NÃO CONFORME' || statusFinal === 'REPROVADA' || statusFinal === 'REPROVADO') {
                await dispararEmailReprovacao(idParam, numeroLaudo, amostraData);
            }
            
            codigosAssinados.push(numeroLaudo);
        }

        await registrarLog(req, "ASSINOU LAUDOS (LOTE)", `Assinou digitalmente os laudos: ${codigosAssinados.join(', ')}`, usuario_id);

        res.json({ success: true, message: `${laudos_ids.length} laudos assinados com sucesso!` });
    } catch (err) {
        console.error("Erro ao assinar em lote:", err);
        res.status(500).json({ success: false });
    }
});

// =========================================================================
// 4. CANCELAR ASSINATURA EM LOTE
// =========================================================================
router.put("/lote/cancelar-assinatura", async (req, res) => {
    try {
        const { laudos_ids } = req.body;

        if(!laudos_ids || laudos_ids.length === 0) {
            return res.status(400).json({ success: false, message: "Nenhum laudo selecionado."});
        }

        const nomesRes = await pool.query(`SELECT 'LDO-' || to_char(data_entrada, 'YYYYMM') || '-' || LPAD(id::text, 4, '0') as numero FROM amostras WHERE id = ANY($1::int[])`, [laudos_ids]);
        const nomesCancelados = nomesRes.rows.map(r => r.numero).join(', ');

        for(let idParam of laudos_ids) {
            await pool.query("UPDATE laudos SET emitido_por = NULL, data_emissao = NULL WHERE amostra_id = $1", [idParam]);
        }

        await registrarLog(req, "CANCELOU ASSINATURA", `Removeu a assinatura dos laudos: ${nomesCancelados}`);

        res.json({ success: true, message: "Assinaturas removidas com sucesso!" });
    } catch (err) {
        console.error("Erro ao cancelar assinaturas em lote:", err);
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

// =========================================================================
// 5. ASSINAR 1 LAUDO OFICIALMENTE
// =========================================================================
router.put("/:id/assinar", async (req, res) => {
    try {
        const { usuario_id } = req.body;
        const idParam = req.params.id;

        const amostraRes = await pool.query(`SELECT a.status, a.codigo as amostra_cod, a.lote, a.obs_analise as observacoes, p.nome_produto, 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero FROM amostras a JOIN produtos p ON p.id = a.produto_id WHERE a.id = $1`, [idParam]);
        if (amostraRes.rows.length === 0) return res.status(404).json({ success: false });
        
        const amostraData = amostraRes.rows[0];
        const statusFinal = amostraData.status;
        const numeroLaudo = amostraData.numero;

        const check = await pool.query(`SELECT id FROM laudos WHERE amostra_id = $1`, [idParam]);
        if (check.rows.length === 0) {
            await pool.query(`INSERT INTO laudos (amostra_id, resultado, emitido_por, data_emissao) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [idParam, statusFinal, usuario_id]);
        } else {
            await pool.query(`UPDATE laudos SET emitido_por = $1, data_emissao = CURRENT_TIMESTAMP WHERE amostra_id = $2`, [usuario_id, idParam]);
        }

        if (statusFinal === 'NÃO CONFORME' || statusFinal === 'REPROVADA' || statusFinal === 'REPROVADO') {
            await dispararEmailReprovacao(idParam, numeroLaudo, amostraData);
        }

        await registrarLog(req, "ASSINOU LAUDO", `Emitiu e assinou eletronicamente o laudo: ${numeroLaudo}`, usuario_id);

        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao assinar:", err);
        res.status(500).json({ success: false });
    }
});

// =========================================================================
// 6. CANCELAR A ASSINATURA INDIVIDUAL
// =========================================================================
router.put("/:id/cancelar-assinatura", async (req, res) => {
    try {
        const amostraId = req.params.id; 
        
        const amRes = await pool.query(`SELECT 'LDO-' || to_char(data_entrada, 'YYYYMM') || '-' || LPAD(id::text, 4, '0') as numero FROM amostras WHERE id = $1`, [amostraId]);
        const nomeLaudo = amRes.rows.length > 0 ? amRes.rows[0].numero : `Amostra ID ${amostraId}`;

        await pool.query("UPDATE laudos SET emitido_por = NULL, data_emissao = NULL WHERE amostra_id = $1", [amostraId]);
        
        await registrarLog(req, "CANCELOU ASSINATURA", `Cancelou/Removeu a assinatura do laudo: ${nomeLaudo}`);

        res.json({ success: true, message: "Assinatura removida." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

// =========================================================================
// 7. GERAR O ARQUIVO PDF VIA NODEJS 
// =========================================================================
router.get("/:id/pdf", async (req, res) => {
    try {
        const cabecalhoRes = await pool.query(`
            SELECT 'LDO-' || to_char(a.data_entrada, 'YYYYMM') || '-' || LPAD(a.id::text, 4, '0') as numero, 
                   COALESCE(l.resultado::text, a.status::text) as resultado, 
                   to_char(COALESCE(l.data_emissao, CURRENT_TIMESTAMP), 'DD/MM/YYYY HH24:MI') as data_emissao_fmt,
                   a.codigo as amostra_cod, a.lote, a.id as amostra_id,
                   a.obs_analise as observacoes,
                   to_char(a.data_validade, 'DD/MM/YYYY') as validade_fmt,
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

        // ... O CÓDIGO DO SEU PDF EXISTENTE AQUI ...
        doc.fontSize(18).font('Helvetica-Bold').text('Kari Kari Alimentos', { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('gray').text('Laboratório de Controle de Qualidade', { align: 'center' });
        doc.fillColor('black').moveDown(2);

        doc.fontSize(14).font('Helvetica-Bold').text(`CERTIFICADO DE ANÁLISE Nº ${cab.numero}`, { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(10).font('Helvetica');
        doc.text(`Produto: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.produto_nome}`);
        doc.font('Helvetica').text(`Lote: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.lote || '-'}`);
        doc.font('Helvetica').text(`Validade: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.validade_fmt || '-'}`);
        doc.font('Helvetica').text(`Código da Amostra: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.amostra_cod}`);
        doc.font('Helvetica').text(`Data de Emissão: `, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(`${cab.data_emissao_fmt}`);
        doc.moveDown(2);

        let y = doc.y;

        const qtdResultados = resultados.length;
        let fontSizeTabela = 9;
        let rowHeight = 22;

        if (qtdResultados > 25) { fontSizeTabela = 7; rowHeight = 14; } 
        else if (qtdResultados > 15) { fontSizeTabela = 8; rowHeight = 18; }

        const col1 = 40, col2 = 170, col3 = 270, col4 = 360, col5 = 420, col6 = 470, tableWidth = 515;

        const drawTableHeader = (startY) => {
            doc.rect(col1, startY, tableWidth, rowHeight + 4).fillAndStroke('#f4f6f9', '#000');
            doc.fillColor('black').font('Helvetica-Bold').fontSize(fontSizeTabela);
            
            const textY = startY + (rowHeight - fontSizeTabela) / 2;
            doc.text('Parâmetro Analisado', col1 + 5, textY);
            doc.text('Método', col2 + 5, textY);
            doc.text('Especificação', col3 + 5, textY);
            doc.text('Resultado', col4 + 5, textY);
            doc.text('Unid.', col5 + 5, textY);
            doc.text('Status', col6 + 5, textY);
            
            doc.moveTo(col2, startY).lineTo(col2, startY + rowHeight + 4).stroke();
            doc.moveTo(col3, startY).lineTo(col3, startY + rowHeight + 4).stroke();
            doc.moveTo(col4, startY).lineTo(col4, startY + rowHeight + 4).stroke();
            doc.moveTo(col5, startY).lineTo(col5, startY + rowHeight + 4).stroke();
            doc.moveTo(col6, startY).lineTo(col6, startY + rowHeight + 4).stroke();
            
            return startY + rowHeight + 4;
        };

        y = drawTableHeader(y); 
        doc.font('Helvetica').fontSize(fontSizeTabela);

        resultados.forEach(r => {
            if (y + rowHeight > 750) {
                doc.addPage();
                y = 50;
                y = drawTableHeader(y); 
                doc.font('Helvetica').fontSize(fontSizeTabela);
            }

            doc.rect(col1, y, tableWidth, rowHeight).stroke();
            doc.moveTo(col2, y).lineTo(col2, y + rowHeight).stroke();
            doc.moveTo(col3, y).lineTo(col3, y + rowHeight).stroke();
            doc.moveTo(col4, y).lineTo(col4, y + rowHeight).stroke();
            doc.moveTo(col5, y).lineTo(col5, y + rowHeight).stroke();
            doc.moveTo(col6, y).lineTo(col6, y + rowHeight).stroke();

            const temMin = r.valor_min !== undefined && r.valor_min !== null;
            const temMax = r.valor_max !== undefined && r.valor_max !== null;
            
            let spec = '-';
            if (temMin && temMax) spec = `${r.valor_min} a ${r.valor_max}`;
            else if (temMin) spec = `Mín: ${r.valor_min}`;
            else if (temMax) spec = `Máx: ${r.valor_max}`;

            const resFinal = r.valor_encontrado ? `${r.valor_encontrado}` : '-';
            const unidadeFinal = r.unidade || '-';
            const statusStr = r.conforme ? 'CONFORME' : 'NÃO CONFORME';
            const textY = y + (rowHeight - fontSizeTabela) / 2 - 1; 

            doc.font('Helvetica-Bold').text(r.parametro || '-', col1 + 5, textY, { width: col2 - col1 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').fillColor('#555555').text(r.metodo || '-', col2 + 5, textY, { width: col3 - col2 - 10, lineBreak: false, ellipsis: true });
            doc.fillColor('black').text(spec, col3 + 5, textY, { width: col4 - col3 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica-Bold').text(resFinal, col4 + 5, textY, { width: col5 - col4 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').text(unidadeFinal, col5 + 5, textY, { width: col6 - col5 - 10, lineBreak: false, ellipsis: true });
            doc.font('Helvetica-Bold').text(statusStr, col6 + 5, textY, { width: (col1 + tableWidth) - col6 - 10, lineBreak: false, ellipsis: true });

            y += rowHeight;
        });

        if (cab.observacoes && cab.observacoes.trim() !== '') {
            y += 15;
            if (y + 40 > 750) { doc.addPage(); y = 50; }
            doc.fillColor('black').font('Helvetica-Bold').fontSize(9).text('Observações da Análise:', col1, y);
            y += 12;
            doc.font('Helvetica').fontSize(9).text(cab.observacoes, col1, y, { width: tableWidth });
            
            const textHeight = doc.heightOfString(cab.observacoes, { width: tableWidth, font: 'Helvetica', fontSize: 9 });
            y += textHeight + 15;
        } else {
            y += 15;
        }

        if (y + 50 > 750) { doc.addPage(); y = 50; } 
        
        doc.rect(col1, y, tableWidth, 25).stroke();
        doc.font('Helvetica-Bold').fontSize(11).text(`PARECER TÉCNICO:  ${cab.resultado}`, col1, y + 8, { align: 'center', width: tableWidth });

        y += 80;
        if (y + 80 > 800) { doc.addPage(); y = 80; } 

        doc.font('Times-Italic').fontSize(22).text(cab.responsavel_nome || 'Analista', col1, y - 25, { align: 'center', width: tableWidth });
        doc.lineWidth(1).moveTo(150, y).lineTo(445, y).stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(10).text(cab.responsavel_nome || 'Analista', { align: 'center' });
        doc.font('Helvetica').fontSize(9).text(cab.responsavel_cargo || 'Controle de Qualidade', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).fillColor('gray').text(`Documento emitido e assinado eletronicamente via LIMS em ${cab.data_emissao_fmt}`, { align: 'center' });

        doc.end();

    } catch (err) {
        console.error("Erro crítico ao gerar PDF:", err);
        res.status(500).send("Erro ao processar o arquivo PDF.");
    }
});

// =========================================================================
// 8. EXCLUIR LAUDO E DEVOLVER À BANCADA
// =========================================================================
router.delete("/:id", async (req, res) => {
    try {
        const amostraId = req.params.id; 
        
        const amRes = await pool.query(`SELECT 'LDO-' || to_char(data_entrada, 'YYYYMM') || '-' || LPAD(id::text, 4, '0') as numero FROM amostras WHERE id = $1`, [amostraId]);
        const nomeLaudo = amRes.rows.length > 0 ? amRes.rows[0].numero : `Amostra ID ${amostraId}`;

        await pool.query("DELETE FROM laudos WHERE amostra_id = $1", [amostraId]);
        await pool.query("UPDATE amostras SET status = 'EM ANÁLISE' WHERE id = $1", [amostraId]);
        
        await registrarLog(req, "EXCLUIU LAUDO", `O laudo ${nomeLaudo} foi deletado e devolvido à bancada (EM ANÁLISE).`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

module.exports = router;