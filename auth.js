// auth.js - Sistema de autenticação atualizado para Supabase
const SUPABASE_URL = 'https://sutprwpsketwdcdmpswo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1dHByd3Bza2V0d2RjZG1wc3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzI3ODAsImV4cCI6MjA3NzgwODc4MH0.TyTfO6o6oYJUm947LHfl81i82V2R12sqcnFBhYHsoDZc';

// Inicializar Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.init();
    }

    async init() {
        // Verificar sessão atual
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            this.currentUser = session.user;
            await this.loadUserProfile();
        }

        // Escutar mudanças de autenticação
        supabase.auth.onAuthStateChange(async (event, session) => {
            this.currentUser = session?.user || null;
            
            if (event === 'SIGNED_IN') {
                console.log('Usuário autenticado:', this.currentUser);
                await this.loadUserProfile();
            } else if (event === 'SIGNED_OUT') {
                console.log('Usuário deslogado');
                this.userProfile = null;
                this.redirectToLogin();
            } else if (event === 'USER_UPDATED') {
                await this.loadUserProfile();
            }
        });
    }

    // Carregar perfil do usuário da API
    async loadUserProfile() {
        try {
            const token = await this.getAccessToken();
            const response = await fetch('/api/users/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.userProfile = data.user;
                console.log('Perfil do usuário carregado:', this.userProfile);
            } else {
                console.error('Erro ao carregar perfil do usuário');
                this.userProfile = null;
            }
        } catch (error) {
            console.error('Erro ao carregar perfil:', error);
            this.userProfile = null;
        }
    }

    // Verificar se usuário está autenticado
    isAuthenticated() {
        return this.currentUser !== null && this.userProfile !== null;
    }

    // Obter usuário atual
    getCurrentUser() {
        return this.userProfile || this.currentUser;
    }

    // Fazer login
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw error;
        }

        // Salvar o token de acesso no localStorage para ser usado pelo painel administrativo
        if (data.session && data.session.access_token) {
            localStorage.setItem('authToken', data.session.access_token);
            // Salvar nome/email para exibição no painel
            localStorage.setItem('userName', data.user.user_metadata?.name || data.user.email);
        }
        return data;
    }

    // Fazer logout
    async logout() {
        // Fazer logout via API para limpar sessão do backend
        try {
            const token = await this.getAccessToken();
            await fetch('/api/users/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (error) {
            console.error('Erro no logout da API:', error);
        }

        // Fazer logout do Supabase Auth
        const { error } = await supabase.auth.signOut();
        if (!error) {
            this.currentUser = null;
            this.userProfile = null;
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

    // Verificar permissões específicas
    hasPermission(requiredPermission) {
        if (!this.userProfile) return false;
        
        const userNivel = this.userProfile.nivel;
        const niveis = {
            'admin': ['admin', 'lider', 'analista'],
            'lider': ['lider', 'analista'],
            'analista': ['analista']
        };

        return niveis[userNivel]?.includes(requiredPermission) || false;
    }

    // Verificar se é admin
    isAdmin() {
        return this.userProfile?.nivel === 'admin';
    }

    // Verificar se é líder
    isLider() {
        return this.userProfile?.nivel === 'lider';
    }

    // Verificar se é analista
    isAnalista() {
        return this.userProfile?.nivel === 'analista';
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
        }, 500);
    }
});
