const XLSX = require('xlsx');
const pool = require('./db');

async function importarPlanilhaKariKari() {
    try {
        // 1. Carrega o arquivo produtos.xlsx
        const workbook = XLSX.readFile('produtos.xlsx');
        const sheetName = workbook.SheetNames[0];
        const dados = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        console.log(`📊 Total de linhas identificadas na planilha: ${dados.length}`);
        
        let inseridos = 0;
        let pulados = 0;

        for (const item of dados) {
            // A query utiliza ON CONFLICT para ignorar códigos que já existem (graças ao seu ALTER TABLE)
            const query = `
                INSERT INTO produtos (
                    cod_produto, 
                    nome_produto, 
                    categoria, 
                    ativo, 
                    tipo, 
                    peso_embalagem, 
                    status, 
                    observacoes, 
                    tem_preferencia
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (cod_produto) DO NOTHING
                RETURNING id;
            `;

            // Mapeamento: O nome entre aspas (ex: item['codigo']) deve ser IGUAL ao topo da sua coluna no Excel
            const values = [
                item['codigo'] || item['cod_produto'], 
                item['nome'] || item['nome_produto'],     
                item['categoria'] || 'Matéria-prima', 
                true, // ativo por padrão
                item['tipo'] || 'EMBALAGEM', 
                item['peso'] || 0, // peso_embalagem
                'Disponível', // status padrão
                item['observacoes'] || null, 
                false // tem_preferencia padrão
            ];

            const res = await pool.query(query, values);

            // Se o banco retornar um ID, a inserção foi feita. Se não, o item já existia.
            if (res.rows.length > 0) {
                inseridos++;
            } else {
                pulados++;
            }
        }

        console.log("--- RELATÓRIO DE IMPORTAÇÃO ---");
        console.log(`✅ Realizados com sucesso: ${inseridos}`);
        console.log(`🟡 Ignorados (já existentes): ${pulados}`);
        console.log(`🚀 Total processado: ${dados.length}`);
        console.log("-------------------------------");

    } catch (error) {
        console.error("❌ Erro ao processar a planilha:", error.message);
    } finally {
        pool.end(); // Encerra o pool de conexões com o banco
    }
}

importarPlanilhaKariKari();