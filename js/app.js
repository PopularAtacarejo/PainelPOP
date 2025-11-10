// Aplicação Principal
class App {
    constructor() {
        this.currentTab = 'dashboard';
        this.init();
    }

    init() {
        ThemeManager.init();
        this.setupEventListeners();
        this.loadDashboard();
    }

    setupEventListeners() {
        // Navegação por tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(tab.getAttribute('data-tab'));
            });
        });
    }

    switchTab(tabId) {
        this.currentTab = tabId;
        
        // Atualizar UI
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(tabId).classList.add('active');

        // Carregar conteúdo específico da aba
        this.loadTabContent(tabId);
    }

    loadTabContent(tabId) {
        switch(tabId) {
            case 'dashboard':
                Dashboard.load();
                break;
            case 'curriculos':
                Curriculos.load();
                break;
            case 'vagas':
                Vagas.load();
                break;
        }
    }

    loadDashboard() {
        Dashboard.load();
    }
}

// Inicializar aplicação quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
