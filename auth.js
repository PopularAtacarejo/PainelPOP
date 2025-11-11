// auth.js - Sistema de autenticação com token de 1 hora e funções de API
const SUPABASE_URL = 'https://sutprwpsketwdcdmpswo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1dHByd3Bza2V0d2RjZG1wc3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzI3ODAsImV4cCI6MjA3NzgwODc4MH0.TyTfO6o6oYJUm947LHfl81i82V2R12sqcnFBhYHsoDZc';

// Inicializar Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.tokenExpiryTime = 60 * 60 * 1000; // 1 hora em milissegundos
        this.init();
    }

    async init() {
        // Verificar sessão atual
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            this.currentUser = session.user;
            this.setTokenExpiry();
            await this.loadUserProfile();
        }

        // Escutar mudanças de autenticação
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Evento de autenticação:', event);
            
            if (event === 'SIGNED_IN') {
                this.currentUser = session.user;
                this.setTokenExpiry();
                await this.loadUserProfile();
                console.log('Usuário autenticado:', this.currentUser);
            } else if (event === 'SIGNED_OUT') {
                console.log('Usuário deslogado');
                this.currentUser = null;
                this.userProfile = null;
                this.clearTokenExpiry();
                this.redirectToLogin();
            } else if (event === 'TOKEN_REFRESHED') {
                console.log('Token atualizado');
                this.setTokenExpiry();
            } else if (event === 'USER_UPDATED') {
                await this.loadUserProfile();
            }
        });

        // Verificar expiração do token periodicamente
        this.startTokenExpiryCheck();
    }

    /* =========================
       FUNÇÕES DE AUTENTICAÇÃO
    ========================= */

    // Configurar expiração do token
    setTokenExpiry() {
        const expiryTime = Date.now() + this.tokenExpiryTime;
        localStorage.setItem('tokenExpiry', expiryTime.toString());
    }

    // Limpar expiração do token
    clearTokenExpiry() {
        localStorage.removeItem('tokenExpiry');
        localStorage.removeItem('authToken');
        localStorage.removeItem('userName');
    }

    // Verificar se o token expirou
    isTokenExpired() {
        const expiryTime = localStorage.getItem('tokenExpiry');
        if (!expiryTime) return true;
        
        const now = Date.now();
        const isExpired = now > parseInt(expiryTime);
        
        if (isExpired) {
            console.log('Token expirado. Fazendo logout...');
            this.logout();
        }
        
        return isExpired;
    }

    // Verificar periodicamente a expiração do token
    startTokenExpiryCheck() {
        setInterval(() => {
            if (this.isAuthenticated()) {
                this.isTokenExpired();
            }
        }, 30000); // Verificar a cada 30 segundos
    }

    // Carregar perfil do usuário da API
    async loadUserProfile() {
        try {
            const token = await this.getAccessToken();
            if (!token) return;

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
        const hasToken = localStorage.getItem('authToken');
        const isExpired = this.isTokenExpired();
        
        return this.currentUser !== null && hasToken && !isExpired;
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

        // Salvar o token de acesso no localStorage
        if (data.session && data.session.access_token) {
            localStorage.setItem('authToken', data.session.access_token);
            localStorage.setItem('userName', data.user.user_metadata?.name || data.user.email);
            
            // Configurar expiração do token
            this.setTokenExpiry();
        }

        // Carregar perfil após login bem-sucedido
        await this.loadUserProfile();
        
        return data;
    }

    // Fazer logout
    async logout() {
        console.log('Executando logout...');
        
        // Limpar dados do localStorage
        this.clearTokenExpiry();
        
        // Fazer logout do Supabase Auth
        const { error } = await supabase.auth.signOut();
        if (!error) {
            this.currentUser = null;
            this.userProfile = null;
            console.log('Logout realizado com sucesso');
        } else {
            console.error('Erro no logout:', error);
        }
        
        this.redirectToLogin();
        return { error };
    }

    // Redirecionar para página de login
    redirectToLogin() {
        const loginUrl = 'index.html';
        if (!window.location.href.includes(loginUrl)) {
            console.log('Redirecionando para login...');
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
        if (this.isTokenExpired()) {
            return null;
        }
        
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token || localStorage.getItem('authToken');
    }

    /* =========================
       FUNÇÕES DE PERMISSÕES
    ========================= */

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

    // Obter tempo restante do token (para debug)
    getTokenTimeRemaining() {
        const expiryTime = localStorage.getItem('tokenExpiry');
        if (!expiryTime) return 0;
        
        const now = Date.now();
        const remaining = parseInt(expiryTime) - now;
        return Math.max(0, remaining);
    }

    /* =========================
       FUNÇÕES DE API - CANDIDATURAS
    ========================= */

    // Buscar candidaturas com filtros
    async getCandidaturas(filters = {}) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const queryParams = new URLSearchParams();
        
        // Adicionar filtros aos parâmetros
        Object.keys(filters).forEach(key => {
            if (filters[key]) {
                queryParams.append(key, filters[key]);
            }
        });

        const response = await fetch(`/api/users/candidaturas?${queryParams}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar candidaturas: ${response.statusText}`);
        }

        return await response.json();
    }

    // Buscar candidatura específica
    async getCandidatura(id) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/candidaturas/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar candidatura: ${response.statusText}`);
        }

        return await response.json();
    }

    // Atualizar status da candidatura
    async updateCandidaturaStatus(candidaturaId, status, observacao = '') {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/candidaturas/${candidaturaId}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status, observacao })
        });

        if (!response.ok) {
            throw new Error(`Erro ao atualizar status: ${response.statusText}`);
        }

        return await response.json();
    }

    // Buscar histórico de status da candidatura
    async getCandidaturaStatusHistory(candidaturaId) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/candidaturas/${candidaturaId}/status`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar histórico: ${response.statusText}`);
        }

        return await response.json();
    }

    /* =========================
       FUNÇÕES DE API - COMENTÁRIOS
    ========================= */

    // Buscar comentários de uma candidatura
    async getComentarios(candidaturaId) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/comentarios/${candidaturaId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar comentários: ${response.statusText}`);
        }

        return await response.json();
    }

    // Adicionar comentário
    async addComentario(candidaturaId, comentario, tipo = 'observacao') {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users/comentarios', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ candidatura_id: candidaturaId, comentario, tipo })
        });

        if (!response.ok) {
            throw new Error(`Erro ao adicionar comentário: ${response.statusText}`);
        }

        return await response.json();
    }

    // Atualizar comentário
    async updateComentario(comentarioId, comentario) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/comentarios/${comentarioId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ comentario })
        });

        if (!response.ok) {
            throw new Error(`Erro ao atualizar comentário: ${response.statusText}`);
        }

        return await response.json();
    }

    // Excluir comentário
    async deleteComentario(comentarioId) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/comentarios/${comentarioId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao excluir comentário: ${response.statusText}`);
        }

        return await response.json();
    }

    /* =========================
       FUNÇÕES DE API - ADMIN (apenas admin)
    ========================= */

    // Buscar estatísticas (apenas admin)
    async getAdminStats(filters = {}) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const queryParams = new URLSearchParams();
        
        Object.keys(filters).forEach(key => {
            if (filters[key]) {
                queryParams.append(key, filters[key]);
            }
        });

        const response = await fetch(`/api/admin/stats?${queryParams}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar estatísticas: ${response.statusText}`);
        }

        return await response.json();
    }

    // Calcular distância (apenas admin)
    async calcularDistancia(enderecoCandidato, enderecoTrabalho = null) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const payload = { enderecoCandidato };
        
        if (enderecoTrabalho) {
            payload.enderecoTrabalho = enderecoTrabalho;
        }

        const response = await fetch('/api/admin/calcular-distancia', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Erro ao calcular distância: ${response.statusText}`);
        }

        return await response.json();
    }

    // Buscar opções de filtro (apenas admin)
    async getAdminFiltros() {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/admin/filtros', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar filtros: ${response.statusText}`);
        }

        return await response.json();
    }

    // Buscar vagas (admin)
    async getAdminVagas() {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/admin/vagas', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar vagas: ${response.statusText}`);
        }

        return await response.json();
    }

    // Criar vaga (admin)
    async createVaga(nome, ativa = true) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/admin/vagas', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nome, ativa })
        });

        if (!response.ok) {
            throw new Error(`Erro ao criar vaga: ${response.statusText}`);
        }

        return await response.json();
    }

    // Atualizar vaga (admin)
    async updateVaga(id, nome, ativa) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/admin/vagas/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nome, ativa })
        });

        if (!response.ok) {
            throw new Error(`Erro ao atualizar vaga: ${response.statusText}`);
        }

        return await response.json();
    }

    // Excluir vaga (admin)
    async deleteVaga(id) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/admin/vagas/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao excluir vaga: ${response.statusText}`);
        }

        return await response.json();
    }

    /* =========================
       FUNÇÕES DE API - USUÁRIOS (apenas admin)
    ========================= */

    // Buscar todos os usuários (apenas admin)
    async getUsers() {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar usuários: ${response.statusText}`);
        }

        return await response.json();
    }

    // Criar usuário (apenas admin)
    async createUser(userData) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        if (!response.ok) {
            throw new Error(`Erro ao criar usuário: ${response.statusText}`);
        }

        return await response.json();
    }

    // Atualizar usuário (apenas admin)
    async updateUser(id, userData) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        if (!response.ok) {
            throw new Error(`Erro ao atualizar usuário: ${response.statusText}`);
        }

        return await response.json();
    }

    // Excluir usuário (apenas admin)
    async deleteUser(id) {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch(`/api/users/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao excluir usuário: ${response.statusText}`);
        }

        return await response.json();
    }

    // Sincronizar usuários (apenas admin)
    async syncUsers() {
        if (!this.isAuthenticated() || !this.isAdmin()) {
            throw new Error('Acesso não autorizado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users/sync', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao sincronizar usuários: ${response.statusText}`);
        }

        return await response.json();
    }

    /* =========================
       FUNÇÕES DE API - GERAIS
    ========================= */

    // Buscar vagas disponíveis (público)
    async getVagas() {
        const response = await fetch('/api/vagas');
        
        if (!response.ok) {
            throw new Error(`Erro ao buscar vagas: ${response.statusText}`);
        }

        return await response.json();
    }

    // Alterar senha do usuário
    async changePassword(currentPassword, newPassword) {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users/change-password', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        if (!response.ok) {
            throw new Error(`Erro ao alterar senha: ${response.statusText}`);
        }

        return await response.json();
    }

    // Buscar status disponíveis
    async getStatusOptions() {
        if (!this.isAuthenticated()) {
            throw new Error('Usuário não autenticado');
        }

        const token = await this.getAccessToken();
        const response = await fetch('/api/users/status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao buscar opções de status: ${response.statusText}`);
        }

        return await response.json();
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
    const isLoginPage = window.location.href.includes('index.html');
    
    if (!isLoginPage) {
        // Verificar autenticação após um breve delay para garantir inicialização
        setTimeout(() => {
            if (!authManager.isAuthenticated()) {
                console.log('Usuário não autenticado, redirecionando para login...');
                authManager.redirectToLogin();
            } else {
                console.log('Usuário autenticado, tempo restante:', 
                    Math.round(authManager.getTokenTimeRemaining() / 1000 / 60) + ' minutos');
            }
        }, 1000);
    }
});

// Exportar para uso em outros arquivos
window.authManager = authManager;
