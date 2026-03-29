document.addEventListener("DOMContentLoaded", () => {
    // ==========================================
    // 1. LÓGICA VISUAL DO MENU (ABRIR E FECHAR)
    // ==========================================
    const btnToggle = document.getElementById('btnToggle');
    if (btnToggle) {
        btnToggle.addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('collapsed');
            document.querySelector('.main-content').classList.toggle('expanded');
        });
    }

    // ==========================================
    // 🔥 2. TRAVA GLOBAL DE ACESSOS E PERMISSÕES 🔥
    // ==========================================
    const userStr = localStorage.getItem('limsUser');
    
    // Se não tiver usuário logado e não estiver na tela de login, expulsa pro login
    if (!userStr) {
        if(!window.location.pathname.includes('login.html')){
            window.location.href = 'login.html';
        }
        return;
    }

    const user = JSON.parse(userStr);
    const perfilUser = String(user.perfil || "").toUpperCase().trim();
    const isAdmin = (perfilUser === 'ADMIN' || perfilUser === 'ADMINISTRADOR');
    const p = user.permissoes || {};

    // Se NÃO for Admin, aplica a tesoura no menu
    if (!isAdmin) {
        
        // 🔥 MAPA RETROCOMPATÍVEL: Lê as chaves novas e as antigas para ninguém ficar travado!
        const menuMapping = {
            'dashboard.html': p.dashboard_view,
            'amostras.html': p.amostras_view || p.amostras_create || p.amostras_edit || p.amostras_delete,
            'analises.html': p.fifo_view || p.fifo_execute || p.analises_view || p.analises_register,
            'calculos.html': p.calc_start || p.calc_send || p.analises_view || p.analises_register,
            'investigacao.html': p.inv_view || p.inv_start || p.investigacao_view,
            'laudos.html': p.laudos_view,
            'monitoramento_agua.html': p.agua_view || p.agua_start || p.agua_edit,
            'reagentes.html': p.reag_reg || p.reag_edit || p.reag_baixa || p.reag_del || p.reagentes_edit,
            'solucoes.html': p.sol_create || p.sol_edit || p.sol_baixa || p.sol_desc || p.sol_del || p.solucoes_edit,
            'coas.html': p.coa_reg || p.coa_down || p.coa_del || p.coas_view,
            'materiais.html': p.mat_reg || p.mat_uso || p.mat_edit || p.mat_del || p.materiais_edit,
            'monitoramento.html': p.monitoramento_view,
            'relatorios.html': p.dashboard_view || p.monitoramento_view,
            'produtos.html': p.prod_view || p.prod_reg || p.prod_edit || p.prod_regras || p.prod_del || p.produtos_edit,
            'ponto.html': p.ponto_view || p.registra_ponto,
            'usuarios.html': p.users_edit
        };

        // A. Esconde os links proibidos do Menu Lateral
        document.querySelectorAll('.sidebar-menu a.nav-link').forEach(link => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('#')) {
                const pageName = href.split('/').pop().split('?')[0]; 
                
                if (menuMapping[pageName] === false || menuMapping[pageName] === undefined) {
                    link.style.display = 'none';
                    link.classList.add('bloqueado'); 
                }
            }
        });

        // B. Limpeza Visual Inteligente (Esconde as Pastas Vazias)
        document.querySelectorAll('.sidebar-menu .collapse').forEach(collapseDiv => {
            const linksAtivos = collapseDiv.querySelectorAll('a.nav-link:not(.bloqueado)');
            
            if (linksAtivos.length === 0) {
                collapseDiv.classList.remove('show');
                collapseDiv.style.display = 'none';
                
                const id = collapseDiv.getAttribute('id');
                const btnPai = document.querySelector(`a[data-bs-target="#${id}"], a[href="#${id}"]`);
                if (btnPai) btnPai.style.display = 'none';
            }
        });

        // C. Trava de Segurança na Barra de Endereços (URL)
        const currentPage = window.location.pathname.split('/').pop().split('?')[0];
        if (currentPage && menuMapping[currentPage] === false) {
            alert("Acesso Negado: O seu perfil não possui permissão para acessar esta tela.");
            window.location.href = "dashboard.html"; 
        }
    }
});