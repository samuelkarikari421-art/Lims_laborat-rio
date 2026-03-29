const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require('jsonwebtoken');

// Tenta importar a chave secreta para identificar o autor no log
let SECRET = "karikari_secreto_123";
try {
    const auth = require('../middleware/authMiddleware');
    if(auth.SECRET_KEY) SECRET = auth.SECRET_KEY;
} catch(e) {}

// Função auxiliar para descobrir quem está logado
async function getUsuarioNome(req) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, SECRET);
            const userRes = await pool.query("SELECT nome FROM usuarios WHERE id = $1", [decoded.id]);
            if (userRes.rows.length > 0) return userRes.rows[0].nome;
        }
    } catch(e) {}
    return "Sistema";
}

// =========================================================================
// 🔥 MOTOR SILENCIOSO DE AUDITORIA (LOG DE ATIVIDADES DE TEXTO)
// =========================================================================
async function registrarLog(req, acao, detalhes) {
    const usuarioNome = await getUsuarioNome(req);
    try {
        await pool.query(
            "INSERT INTO log_atividades (usuario_nome, acao, detalhes) VALUES ($1, $2, $3)",
            [usuarioNome, acao, detalhes]
        );
    } catch (e) {
        console.error("Erro ao salvar log de atividade (Reagentes):", e.message);
    }
}

// =========================================================================
// 1. LISTAR REAGENTES (ESTOQUE)
// =========================================================================
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT *, 
                   to_char(validade, 'DD/MM/YYYY') as validade_fmt,
                   to_char(validade, 'YYYY-MM-DD') as validade_input,
                   to_char(data_entrada, 'DD/MM/YYYY HH24:MI') as entrada_fmt,
                   to_char(data_ultimo_uso, 'DD/MM/YYYY HH24:MI') as ultimo_uso_fmt
            FROM reagentes 
            ORDER BY validade ASC, id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro ao listar reagentes" });
    }
});

// =========================================================================
// 2. CADASTRAR ENTRADA DE MATERIAL
// =========================================================================
router.post("/", async (req, res) => {
    try {
        const { nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, controlado_pf, responsavel, observacoes } = req.body;

        const seqRes = await pool.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM reagentes");
        const nextId = seqRes.rows[0].next_id;

        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const codGerado = `RGT-${ano}${mes}-${String(nextId).padStart(4, '0')}`;

        await pool.query(
            `INSERT INTO reagentes 
            (codigo, nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, controlado_pf, status, observacoes, responsavel, data_entrada) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'OK', $16, $17, NOW())`,
            [codGerado, nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, controlado_pf, observacoes, responsavel]
        );

        await registrarLog(req, "CRIOU REAGENTE", `Cadastrou o reagente: ${codGerado} - ${nome} (Lote: ${lote})`);

        res.json({ success: true, message: "Reagente registrado com sucesso!", codigoGerado: codGerado });
    } catch (err) {
        console.error("Erro ao cadastrar reagente:", err);
        res.status(500).json({ success: false, message: "Erro ao salvar no banco." });
    }
});

// =========================================================================
// 3. EDITAR REAGENTE
// =========================================================================
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, controlado_pf, observacoes } = req.body;

        await pool.query(
            `UPDATE reagentes 
             SET nome = $1, grau_pureza = $2, fabricante = $3, lote = $4, cas = $5, unidade = $6, 
                 quantidade = $7, estoque_minimo = $8, validade = $9, local_armazenamento = $10, 
                 faixa_uso = $11, metodo_analitico = $12, periculosidade = $13, controlado_pf = $14, observacoes = $15
             WHERE id = $16`,
            [nome, grau_pureza, fabricante, lote, cas, unidade, quantidade, estoque_minimo, validade, local_armazenamento, faixa_uso, metodo_analitico, periculosidade, controlado_pf, observacoes, id]
        );

        await registrarLog(req, "EDITOU REAGENTE", `Alterou os dados cadastrais do reagente ID ${id}: ${nome}`);

        res.json({ success: true, message: "Reagente atualizado com sucesso!" });
    } catch (err) {
        console.error("Erro ao atualizar reagente:", err);
        res.status(500).json({ success: false, message: "Erro ao atualizar." });
    }
});

// =========================================================================
// 4. EXCLUIR REAGENTE
// =========================================================================
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const regRes = await pool.query("SELECT nome, codigo FROM reagentes WHERE id = $1", [id]);
        const nomeReg = regRes.rows.length > 0 ? `${regRes.rows[0].codigo} - ${regRes.rows[0].nome}` : `ID ${id}`;

        await pool.query("DELETE FROM reagentes WHERE id = $1", [id]);

        await registrarLog(req, "EXCLUIU REAGENTE", `Apagou o reagente do estoque: ${nomeReg}`);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao excluir." });
    }
});

// =========================================================================
// 5. REGISTRAR DESCARTE/BAIXA DE REAGENTE E GERAR HISTÓRICO
// =========================================================================
router.post('/descarte', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { reagente_id, quantidade, motivo } = req.body;

        if (!reagente_id || !quantidade) {
            return res.status(400).json({ error: "ID e quantidade são obrigatórios." });
        }

        const regRes = await client.query("SELECT codigo, nome, quantidade as saldo_atual, unidade FROM reagentes WHERE id = $1", [reagente_id]);
        if (regRes.rows.length === 0) throw new Error("Reagente não encontrado.");
        const reg = regRes.rows[0];

        if (parseFloat(reg.saldo_atual) < parseFloat(quantidade)) {
            return res.status(400).json({ error: `Saldo insuficiente. Disponível: ${reg.saldo_atual} ${reg.unidade}` });
        }

        // Abate o saldo no estoque principal
        await client.query(`UPDATE reagentes SET quantidade = quantidade - $1 WHERE id = $2`, [quantidade, reagente_id]);

        // 🔥 GRAVA O HISTÓRICO ESTRUTURADO PARA A NOVA TABELA
        const responsavel = await getUsuarioNome(req);
        await client.query(`
            INSERT INTO historico_uso_reagentes (reagente_id, quantidade, motivo, responsavel, data_uso)
            VALUES ($1, $2, $3, $4, NOW())
        `, [reagente_id, quantidade, motivo || "Consumo/Descarte", responsavel]);

        await client.query('COMMIT');

        // Mantém também o log de texto clássico por segurança
        await registrarLog(req, "DESCARTOU REAGENTE", 
            `Descarte de ${quantidade} ${reg.unidade} do reagente ${reg.codigo} - ${reg.nome}. Motivo: ${motivo || 'Não informado'}`
        );

        res.status(200).json({ success: true, message: "Descarte registrado com sucesso!" });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao descartar reagente:", error);
        res.status(500).json({ error: error.message || "Erro interno ao registrar descarte." });
    } finally {
        client.release();
    }
});

// =========================================================================
// 6. BUSCAR HISTÓRICO DE USO (A ROTA QUE FALTAVA)
// =========================================================================
router.get('/uso', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT h.id, h.reagente_id, h.quantidade, h.motivo, h.responsavel, h.data_uso,
                   r.nome as reagente_nome, r.codigo as reagente_codigo, r.unidade
            FROM historico_uso_reagentes h
            JOIN reagentes r ON h.reagente_id = r.id
            ORDER BY h.data_uso DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar histórico de uso:", err);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
});

// =========================================================================
// 7. ESTORNAR USO (DEVOLVER PARA O ESTOQUE)
// =========================================================================
router.delete('/uso/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        const usoRes = await client.query("SELECT * FROM historico_uso_reagentes WHERE id = $1", [id]);
        if(usoRes.rows.length === 0) throw new Error("Registo de uso não encontrado");
        const uso = usoRes.rows[0];

        // Devolve o valor ao estoque original
        await client.query("UPDATE reagentes SET quantidade = quantidade + $1 WHERE id = $2", [uso.quantidade, uso.reagente_id]);

        // Apaga a linha do histórico
        await client.query("DELETE FROM historico_uso_reagentes WHERE id = $1", [id]);

        await client.query('COMMIT');
        
        await registrarLog(req, "ESTORNOU REAGENTE", `Estornou uso ID ${id} e devolveu ${uso.quantidade} para o reagente ID ${uso.reagente_id}`);
        
        res.json({ success: true, message: "Estornado com sucesso!" });
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// ==========================================
// 8. MAPAS POLÍCIA FEDERAL (MANTIDO INTACTO)
// ==========================================
router.get("/mapas", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, tipo, 
                   to_char(data_envio, 'DD/MM/YYYY HH24:MI') as data_envio_fmt, 
                   nome_arquivo, arquivo_base64 
            FROM mapas_pf 
            ORDER BY data_envio DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erro ao listar mapas" });
    }
});

router.post("/mapas", async (req, res) => {
    try {
        const { tipo, data_envio, nome_arquivo, arquivo_base64 } = req.body;
        await pool.query(
            `INSERT INTO mapas_pf (tipo, data_envio, nome_arquivo, arquivo_base64) VALUES ($1, $2, $3, $4)`,
            [tipo, data_envio, nome_arquivo, arquivo_base64]
        );
        await registrarLog(req, "ANEXOU MAPA PF", `Anexou um novo ficheiro de Mapa da Polícia Federal (Tipo: ${tipo})`);
        res.json({ success: true, message: "Mapa salvo com sucesso!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao salvar mapa." });
    }
});

module.exports = router;