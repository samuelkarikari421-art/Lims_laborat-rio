document.addEventListener("DOMContentLoaded", function() {
    // 1. Recupera o usuário do localStorage (salvo no login)
    const user = JSON.parse(localStorage.getItem("limsUser"));
    
    // Se não houver usuário logado, redireciona para o login
    if (!user) { 
        window.location.href = "login.html"; 
        return; 
    }

    // 2. Seleção de Elementos para o Toggle (Recolher)
    const btnToggle = document.getElementById("btnToggle");
    const sidebar = document.querySelector(".sidebar");
    const mainContent = document.querySelector(".main-content");
    const menuLinks = document.querySelectorAll(".nav-link");

    // --- NOVA LÓGICA DE PERMISSÕES GRANULARES ---
    // Mapeamos cada página HTML para a permissão correspondente criada no banco
    const rotasPermissoes = {
        "dashboard.html": "dashboard_view",
        "amostras.html": "amostras_view",
        "analises.html": "analises_view",
        "laudos.html": "laudos_view",
        "reagentes.html": "reagentes_view",
        "relatorios.html": "dashboard_view", // Relatórios usam a mesma permissão do Dashboard
        "produtos.html": "produtos_edit",
        "usuarios.html": "users_edit"
    };

    const permissoes = user.permissoes || {};

    menuLinks.forEach(link => {
        const destino = link.getAttribute("href");
        const permissaoNecessaria = rotasPermissoes[destino];

        // 1. O perfil ADMIN tem passe livre (mecanismo de segurança)
        if (user.perfil === 'ADMIN') {
            link.style.display = "flex";
            return;
        }

        // 2. Se a rota precisa de permissão, verifica no objeto de permissões do usuário
        if (permissaoNecessaria) {
            if (permissoes[permissaoNecessaria] === true) {
                link.style.display = "flex"; // Tem permissão, mostra no menu
            } else {
                link.style.display = "none"; // Não tem permissão, esconde do menu
            }
        }
    });

    // Ocultar o rótulo "Gestão" se o usuário não tiver acesso a nada daquela seção
    if (user.perfil !== 'ADMIN' && !permissoes.dashboard_view && !permissoes.produtos_edit && !permissoes.users_edit) {
        const labels = document.querySelectorAll(".sidebar-label");
        labels.forEach(label => {
            if (label.innerText.includes("Gestão")) {
                label.style.display = "none";
            }
        });
    }

    // --- LÓGICA DO BOTÃO RECOLHER (TOGGLE) MANTIDA ---
    if (btnToggle && sidebar && mainContent) {
        btnToggle.addEventListener("click", function(e) {
            e.preventDefault();
            
            // Alterna a classe 'collapsed' na sidebar e 'expanded' no conteúdo
            sidebar.classList.toggle("collapsed");
            mainContent.classList.toggle("expanded");
            
            // Salva a preferência do usuário no localStorage
            const isCollapsed = sidebar.classList.contains("collapsed");
            localStorage.setItem("sidebarCollapsed", isCollapsed);
        });

        // Recupera a preferência salva ao carregar a página
        const savedState = localStorage.getItem("sidebarCollapsed");
        if (savedState === "true") {
            sidebar.classList.add("collapsed");
            mainContent.classList.add("expanded");
        }
    } else {
        console.warn("Elementos do menu lateral não encontrados no HTML desta página.");
    }
});