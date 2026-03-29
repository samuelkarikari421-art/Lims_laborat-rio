const express = require("express");
const router = express.Router();
const pool = require("../db");
const PDFDocument = require("pdfkit");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para identificar o autor no log
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
        }
    } catch (e) {}

    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade (Ponto):", e.message);
    }
}

// 1. Listar todos os Pontos
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, p.usuario_id, u.nome as usuario_nome, u.perfil,
                   to_char(p.data_registro, 'YYYY-MM-DD') as data_registro_raw,
                   to_char(p.data_registro, 'DD/MM/YYYY') as data_registro_fmt,
                   to_char(p.hora_entrada, 'HH24:MI') as hora_entrada,
                   to_char(p.hora_saida, 'HH24:MI') as hora_saida,
                   p.observacoes,
                   p.tipo_registro
            FROM controle_ponto p
            JOIN usuarios u ON p.usuario_id = u.id
            ORDER BY p.data_registro DESC, p.hora_entrada DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar ponto:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

// 2. Registrar Novo Ponto
router.post("/", async (req, res) => {
    try {
        const { usuario_id, data_registro, hora_entrada, hora_saida, observacoes, tipo_registro } = req.body;
        
        await pool.query(
            `INSERT INTO controle_ponto (usuario_id, data_registro, hora_entrada, hora_saida, observacoes, tipo_registro) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [usuario_id, data_registro, hora_entrada, hora_saida || null, observacoes, tipo_registro || 'Manual']
        );

        // Puxa o nome do colaborador alvo para o log
        const uRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [usuario_id]);
        const nomeAlvo = uRes.rows.length > 0 ? uRes.rows[0].nome : `ID ${usuario_id}`;

        // 🔥 REGISTA A AÇÃO
        await registrarLog(req, "REGISTROU PONTO", `Marcou o ponto de ${nomeAlvo} (Ref: ${data_registro})`);

        res.json({ success: true, message: "Ponto registrado!" });
    } catch (err) {
        console.error("Erro ao registrar ponto:", err);
        res.status(500).json({ error: "Erro ao registrar ponto" });
    }
});

// 3. Editar Ponto
router.put("/:id", async (req, res) => {
    try {
        const { usuario_id, data_registro, hora_entrada, hora_saida, observacoes, tipo_registro } = req.body;
        
        await pool.query(
            `UPDATE controle_ponto 
             SET usuario_id = $1, data_registro = $2, hora_entrada = $3, hora_saida = $4, observacoes = $5, tipo_registro = $6
             WHERE id = $7`,
            [usuario_id, data_registro, hora_entrada, hora_saida || null, observacoes, tipo_registro || 'Manual', req.params.id]
        );

        // Puxa o nome do colaborador alvo para o log
        const uRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [usuario_id]);
        const nomeAlvo = uRes.rows.length > 0 ? uRes.rows[0].nome : `ID ${usuario_id}`;

        // 🔥 REGISTA A AÇÃO
        await registrarLog(req, "EDITOU PONTO", `Alterou o registo de ponto de ${nomeAlvo} (Ref: ${data_registro})`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao atualizar ponto" });
    }
});

// 4. Excluir Ponto
router.delete("/:id", async (req, res) => {
    try {
        // Puxa os dados antes de apagar para gravar no log
        const pRes = await pool.query("SELECT u.nome, to_char(p.data_registro, 'DD/MM/YYYY') as d_fmt FROM controle_ponto p JOIN usuarios u ON p.usuario_id = u.id WHERE p.id = $1", [req.params.id]);
        const detalhe = pRes.rows.length > 0 ? `ponto de ${pRes.rows[0].nome} do dia ${pRes.rows[0].d_fmt}` : `ID ${req.params.id}`;

        await pool.query(`DELETE FROM controle_ponto WHERE id = $1`, [req.params.id]);
        
        // 🔥 REGISTA A AÇÃO
        await registrarLog(req, "EXCLUIU PONTO", `Apagou o registo de ${detalhe}`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao excluir" });
    }
});

// =========================================================================
// 5. GERAR PDF E SALVAR NO BANCO DE DADOS (NOVO FLUXO)
// =========================================================================
router.post("/relatorio/salvar", async (req, res) => {
    try {
        const { usuario_id, mesano, responsavel_id } = req.body;

        const funcRes = await pool.query("SELECT nome, cargo, perfil FROM usuarios WHERE id = $1", [usuario_id]);
        if (funcRes.rows.length === 0) return res.status(404).json({ success: false, message: "Usuário não encontrado." });
        const funcionario = funcRes.rows[0];

        const respRes = await pool.query("SELECT nome, cargo, assinatura FROM usuarios WHERE id = $1", [responsavel_id]);
        const responsavel = respRes.rows[0] || {};

        const pontosRes = await pool.query(`
            SELECT to_char(data_registro, 'DD/MM/YYYY') as data_fmt,
                   to_char(hora_entrada, 'HH24:MI') as entrada,
                   to_char(hora_saida, 'HH24:MI') as saida
            FROM controle_ponto
            WHERE usuario_id = $1 AND to_char(data_registro, 'YYYY-MM') = $2
            ORDER BY data_registro ASC, hora_entrada ASC
        `, [usuario_id, mesano]);

        const pontos = pontosRes.rows;

        // Inicia a geração do PDF em Memória
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let buffers = [];
        
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            const base64Pdf = 'data:application/pdf;base64,' + pdfData.toString('base64');
            
            // Grava na nova tabela
            const check = await pool.query("SELECT id FROM folhas_ponto_assinadas WHERE usuario_id = $1 AND mesano = $2", [usuario_id, mesano]);
            
            if (check.rows.length > 0) {
                await pool.query("UPDATE folhas_ponto_assinadas SET arquivo_base64 = $1, responsavel_id = $2, data_geracao = CURRENT_TIMESTAMP WHERE id = $3", [base64Pdf, responsavel_id, check.rows[0].id]);
            } else {
                await pool.query("INSERT INTO folhas_ponto_assinadas (usuario_id, responsavel_id, mesano, arquivo_base64) VALUES ($1, $2, $3, $4)", [usuario_id, responsavel_id, mesano, base64Pdf]);
            }

            // 🔥 REGISTA A AÇÃO
            await registrarLog(req, "ASSINOU FOLHA MENSAL", `Gerou e arquivou a folha de ponto de ${funcionario.nome} (Ref: ${mesano})`);

            res.json({ success: true, message: "Folha assinada e salva com sucesso!" });
        });

        // DESENHO DO PDF
        doc.fontSize(16).font('Helvetica-Bold').text('Kari Kari Alimentos', { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('gray').text('Laboratório de Controle de Qualidade', { align: 'center' });
        doc.moveDown(2);

        doc.fillColor('black').fontSize(14).font('Helvetica-Bold').text(`FOLHA DE PONTO MENSAL - ${mesano.split('-').reverse().join('/')}`, { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(10).font('Helvetica-Bold').text('DADOS DO COLABORADOR', { underline: true });
        doc.font('Helvetica').text(`Nome: `, { continued: true }).font('Helvetica-Bold').text(funcionario.nome);
        doc.font('Helvetica').text(`Cargo / Perfil: `, { continued: true }).font('Helvetica-Bold').text(`${funcionario.cargo || 'Não definido'} (${funcionario.perfil})`);
        doc.moveDown(2);

        let y = doc.y;
        const col1 = 50, col2 = 150, col3 = 250, col4 = 350, tableWidth = 400;

        doc.rect(col1, y, tableWidth, 20).fillAndStroke('#f4f6f9', '#000');
        doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
        doc.text('Data', col1 + 5, y + 5);
        doc.text('Entrada', col2 + 5, y + 5);
        doc.text('Saída', col3 + 5, y + 5);
        doc.text('Horas Trab.', col4 + 5, y + 5);
        y += 20;

        let totalMinutosMes = 0;

        doc.font('Helvetica').fontSize(10);
        pontos.forEach(p => {
            doc.rect(col1, y, tableWidth, 20).stroke();
            doc.moveTo(col2, y).lineTo(col2, y + 20).stroke();
            doc.moveTo(col3, y).lineTo(col3, y + 20).stroke();
            doc.moveTo(col4, y).lineTo(col4, y + 20).stroke();

            let txtHoras = "Em aberto";
            if (p.entrada && p.saida) {
                const [hE, mE] = p.entrada.split(':').map(Number);
                const [hS, mS] = p.saida.split(':').map(Number);
                let diff = (hS * 60 + mS) - (hE * 60 + mE);
                if (diff < 0) diff += 24 * 60;
                totalMinutosMes += diff;
                const h = Math.floor(diff / 60);
                const m = diff % 60;
                txtHoras = `${h}h ${String(m).padStart(2, '0')}m`;
            }

            doc.text(p.data_fmt, col1 + 5, y + 5);
            doc.text(p.entrada || '--:--', col2 + 5, y + 5);
            doc.text(p.saida || '--:--', col3 + 5, y + 5);
            doc.text(txtHoras, col4 + 5, y + 5);
            y += 20;
        });

        const totalH = Math.floor(totalMinutosMes / 60);
        const totalM = totalMinutosMes % 60;

        doc.rect(col1, y, tableWidth, 20).fillAndStroke('#e9ecef', '#000');
        doc.fillColor('black').font('Helvetica-Bold').text('TOTAL MENSAL DE HORAS:', col1 + 5, y + 5);
        doc.text(`${totalH}h ${String(totalM).padStart(2, '0')}m`, col4 + 5, y + 5);

        y += 80;
        if (y > 700) { doc.addPage(); y = 50; }

        doc.font('Helvetica').fontSize(10);
        doc.moveTo(80, y).lineTo(250, y).stroke();
        doc.text("Assinatura do Colaborador", 80, y + 5, { width: 170, align: 'center' });

        if (responsavel.assinatura) {
            try {
                const base64Data = responsavel.assinatura.split(';base64,').pop();
                const imageBuffer = Buffer.from(base64Data, 'base64');
                doc.image(imageBuffer, 320, y - 50, { height: 45, width: 170, align: 'center' });
            } catch (e) {}
        } else {
            doc.fillColor('gray').fontSize(8).text("(Assinado Digitalmente)", 320, y - 15, { width: 170, align: 'center' });
        }

        doc.fillColor('black').fontSize(10);
        doc.moveTo(320, y).lineTo(490, y).stroke();
        doc.text("Supervisor / Responsável", 320, y + 5, { width: 170, align: 'center' });
        doc.fontSize(8).text(responsavel.nome || 'Gestor LIMS', 320, y + 20, { width: 170, align: 'center' });

        doc.end();

    } catch (err) {
        console.error("Erro ao gerar e salvar PDF:", err);
        res.status(500).json({ success: false, message: "Erro ao processar PDF." });
    }
});

// =========================================================================
// 6. LISTAR E EXCLUIR FOLHAS ASSINADAS
// =========================================================================
router.get("/folhas-assinadas", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT f.id, f.mesano, f.arquivo_base64, 
                   to_char(f.data_geracao, 'DD/MM/YYYY HH24:MI') as data_geracao_fmt,
                   u.nome as colaborador_nome, u.perfil,
                   r.nome as responsavel_nome
            FROM folhas_ponto_assinadas f
            JOIN usuarios u ON f.usuario_id = u.id
            LEFT JOIN usuarios r ON f.responsavel_id = r.id
            ORDER BY f.data_geracao DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar folhas assinadas:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

router.delete("/folhas-assinadas/:id", async (req, res) => {
    try {
        const fRes = await pool.query("SELECT f.mesano, u.nome FROM folhas_ponto_assinadas f JOIN usuarios u ON f.usuario_id = u.id WHERE f.id = $1", [req.params.id]);
        const detalhe = fRes.rows.length > 0 ? `Folha de ${fRes.rows[0].nome} (${fRes.rows[0].mesano})` : `ID ${req.params.id}`;

        await pool.query("DELETE FROM folhas_ponto_assinadas WHERE id = $1", [req.params.id]);
        
        // 🔥 REGISTA A AÇÃO
        await registrarLog(req, "EXCLUIU FOLHA DE PONTO", `Removeu do arquivo digital a ${detalhe}`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao excluir folha" });
    }
});

module.exports = router;