// auth.js - Sistema de autenticação e proteção de páginas
const SUPABASE_URL = 'https://sutprwpsketwdcdmpswo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1dHByd3Bza2V0d2RjZG1wc3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzI3ODAsImV4cCI6MjA3NzgwODc4MH0.TyTfO6o6YJUm947LHfl81i82V2R12sqcnFBhYHsoDZc';

// Inicializar Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.init();
    }

    async init() {
        // Verificar sessão atual
        const { data: { session } } = await supabase.auth.getSession();
        this.currentUser = session?.user || null;

        // Escutar mudanças de autenticação
        supabase.auth.onAuthStateChange((event, session) => {
            this.currentUser = session?.user || null;
            
            if (event === 'SIGNED_IN') {
                console.log('Usuário autenticado:', this.currentUser);
            } else if (event === 'SIGNED_OUT') {
                console.log('Usuário deslogado');
                this.redirectToLogin();
            }
        });
    }

    // Verificar se usuário está autenticado
    isAuthenticated() {
        return this.currentUser !== null;
    }

    // Obter usuário atual
    getCurrentUser() {
        return this.currentUser;
    }

    // Fazer logout
    async logout() {
        const { error } = await supabase.auth.signOut();
        if (!error) {
            this.currentUser = null;
            this.redirectToLogin();
        }
        return { error };
    }

    // Redirecionar para página de login
    redirectToLogin() {
        const loginUrl = 'https://popularatacarejo.github.io/Formulario/login.html';
        if (window.location.href !== loginUrl) {
            window.location.href = loginUrl;
        }
    }

    // Proteger página - usar no início de cada página protegida
    protectPage() {
        if (!this.isAuthenticated()) {
            this.redirectToLogin();
            return false;
        }
        return true;
    }

    // Obter token de acesso
    async getAccessToken() {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token || null;
    }

    // Verificar permissões específicas (se necessário)
    hasPermission(requiredPermission) {
        // Implemente lógica de permissões baseada no usuário
        // Pode usar user_metadata ou outra lógica
        return this.isAuthenticated();
    }
}

// Inicializar gerenciador de autenticação
const authManager = new AuthManager();

// Função global para logout
window.logout = async function() {
    await authManager.logout();
};

// Proteção automática para páginas que requerem autenticação
document.addEventListener('DOMContentLoaded', function() {
    // Verificar se a página atual não é a página de login
    const isLoginPage = window.location.href.includes('login.html');
    
    if (!isLoginPage) {
        // Verificar autenticação após um breve delay para garantir inicialização
        setTimeout(() => {
            if (!authManager.isAuthenticated()) {
                authManager.redirectToLogin();
            }
        }, 100);
    }
});
