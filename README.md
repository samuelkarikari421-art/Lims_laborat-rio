# 🔬 Laboratory information management system
**Laboratory Information Management System (Sistema de Gestão Laboratorial)**

Um sistema completo, robusto e responsivo desenvolvido exclusivamente para o Laboratório de Controle de Qualidade da **Kari Kari Alimentos**. O objetivo principal é garantir rastreabilidade total (do recebimento da amostra até à emissão do laudo final), automação de cálculos analíticos complexos e rigor no controle de qualidade.

---

## ✨ Principais Funcionalidades (Módulos)

### 📦 Controle de Amostras (FIFO & Rastreabilidade)
* Registro de entrada de matérias-primas e produtos acabados.
* Anexo de **Certificados de Análise (CoA)** em PDF e evidências fotográficas na entrada da amostra.
* Priorização visual (Fila VIP) para produtos críticos ou que necessitam de liberação rápida.

### 🧮 Calculadora Analítica Inteligente (Smart Workbench)
Mesa de trabalho digital que substitui calculadoras manuais e planilhas de Excel.
* Cálculo automatizado de múltiplas réplicas com geração de **Médias, Desvio Absoluto e RSD% (Desvio Padrão Relativo)**.
* Auto-Save (Rascunho local) para não perder dados caso o navegador seja fechado.
* Integração direta: Envio do resultado validado diretamente para a tela da Bancada de Análises.
* **Métodos incluídos:**
    * Umidade Gravimétrica (Snacks e Gordura de Palma).
    * Acidez Aquo-Solúvel e Índice de Acidez Livre.
    * Índice de Peróxido.
    * Impurezas Insolúveis (Éter de Petróleo).
    * Densidade Relativa a 25°C.

### 📄 Emissão de Laudos
* Geração automática de Laudos Técnicos em formato PDF.
* **Assinatura Digital Eletrônica** (Bloqueia o laudo contra alterações futuras).
* Geração de relatórios com paginação inteligente: Página principal (resultados), página do Certificado do Fabricante anexado, e páginas seguintes com galeria das evidências fotográficas.
* Disparo automático de **E-mail de Alerta** aos gestores caso um laudo seja assinado como NÃO CONFORME (Reprovado).

### 💧 Monitoramento de Água
* Painel dedicado ao controle Físico-Químico da água da fábrica.
* Seleção rápida de Pontos de Coleta (Poço, Caixa D'água, Caldeira, Produção).
* Calculadoras de titulação integradas na tela para Cloro Residual Livre, Dureza Total e Resíduo por Evaporação, além de inputs de leitura direta (pH, Condutividade).

### 🧪 Gestão de Soluções e Reagentes
* Controle de estoque de insumos químicos com alertas de validade.
* Ferramenta de Criação de Soluções (Misturas), com baixa automática no estoque dos reagentes "pais".
* Registro de uso diário nas análises e registro de descartes com justificativas.

### 🛡️ Motor de Auditoria e Segurança
* Controle de acesso por Perfis (Admin, Gestor, Químico, Analista).
* Logs silenciosos registram todas as ações sensíveis (Quem fez, o que fez e a que horas fez).

---

## 🛠️ Stack Tecnológico

O sistema foi construído com tecnologias modernas, garantindo que seja rápido, leve e não exija instalações pesadas nos computadores do laboratório:

* **Frontend:** HTML5, CSS3, JavaScript (Vanilla), Bootstrap 5.3.
* **Backend:** Node.js, Express.js.
* **Banco de Dados:** PostgreSQL (`pg`).
* **Autenticação:** JSON Web Tokens (JWT).
* **Geração de PDFs:** PDFKit.
* **Envio de E-mails:** Nodemailer (SMTP).

---

## 🚀 Como Executar o Projeto Localmente

### 1. Pré-requisitos
* [Node.js](https://nodejs.org/) (v16 ou superior)
* [PostgreSQL](https://www.postgresql.org/) (v13 ou superior) + pgAdmin (recomendado)

### 2. Configuração do Banco de Dados
1. Abra o PostgreSQL (pgAdmin).
2. Crie um banco de dados chamado `karikari_lims`.
3. Execute os scripts SQL localizados na pasta `/database` (ou fornecidos pela equipe de TI) para criar a estrutura das tabelas (`usuarios`, `amostras`, `laudos`, `analises`, `amostras_anexos`, `log_atividades`, etc.).

### 3. Configuração do Servidor (Backend)
1. Pelo terminal, navegue até a pasta do backend:
   ```bash
   cd backend