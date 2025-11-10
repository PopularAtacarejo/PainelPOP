// Configurações globais
const CONFIG = {
    API_BASE: "https://formulariobk.onrender.com",
    ADMIN_TOKEN: "admin-secret-token",
    ITEMS_PER_PAGE: 10
};

// Estado global da aplicação
const APP_STATE = {
    currentPage: 1,
    currentFilters: {},
    editingVagaId: null
};

// Utilitários
const Utils = {
    formatarData(dataString) {
        const data = new Date(dataString);
        return data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    },
    
    formatarNumero(numero) {
        return new Intl.NumberFormat('pt-BR').format(numero);
    },
    
    mostrarLoading(elemento) {
        elemento.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem;">
                    <i class="fas fa-spinner fa-spin"></i> Carregando dados...
                </td>
            </tr>
        `;
    },
    
    mostrarErro(elemento, mensagem) {
        elemento.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--error-color);">
                    <i class="fas fa-exclamation-triangle"></i> ${mensagem}
                </td>
            </tr>
        `;
    }
};

// Gerenciamento de API
const API = {
    async call(endpoint, options = {}) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${CONFIG.ADMIN_TOKEN}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`Erro ${response.status}: ${response.statusText}`);
            }

            return response.json();
        } catch (error) {
            console.error('Erro na chamada da API:', error);
            throw error;
        }
    }
};

// Gerenciamento de temas
const ThemeManager = {
    init() {
        const themeToggle = document.getElementById('themeToggle');
        themeToggle.addEventListener('click', this.toggleTheme);
        
        // Carregar tema salvo
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);
    },
    
    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        ThemeManager.setTheme(newTheme);
    },
    
    setTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        const icon = document.querySelector('#themeToggle i');
        
        if (theme === 'dark') {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
        
        localStorage.setItem('theme', theme);
    }
};
