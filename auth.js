// auth.js - Sistema de autenticação com token de 1 hora e funções de API
// Atualizado com warmUpServer robusto + utilitários ensureSession/getCurrentUser/requireAuthGuard

// =========================
// CONFIGURAÇÕES SUPABASE
// =========================
const SUPABASE_URL = 'https://sutprwpsketwdcdmpswo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1dHByd3Bza2V0d2RjZG1wc3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzI3ODAsImV4cCI6MjA3NzgwODc4MH0.TyTfO6o6YJUm947LHfl81i82V2R12sqcnFBhYHsoDZc';

const MAX_RETRIES = 2;
const WARMUP_DELAY_MS = 4000;

// =========================
// Inicialização do cliente Supabase
// =========================
if (window.supabase) {
  try {
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabase = supabaseClient; // Agora window.supabase é o cliente inicializado (tem o .from)
  } catch (e) {
    console.error("Falha ao inicializar o cliente Supabase:", e);
  }
} else {
  console.error("Supabase CDN não carregado! Verifique a tag <script> em seus arquivos HTML.");
}

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userProfile = null;
    this.tokenExpiryTime = 60 * 60 * 1000; // 1 hora
    this.init();
  }

  // =========================
  // UTILIDADES DE TOKEN / SESSÃO
  // =========================
  setTokenExpiry() {
    const expiryTime = Date.now() + this.tokenExpiryTime;
    localStorage.setItem('tokenExpiry', expiryTime);
  }

  isTokenValid() {
    const expiry = localStorage.getItem('tokenExpiry');
    return expiry && Date.now() < parseInt(expiry, 10);
  }

  /**
   * NOVO: força a sessão a existir/estar válida no Supabase.
   * Lança erro se não houver sessão (para fluxos que exigem login).
   */
  async ensureSession() {
    const { data, error } = await window.supabase.auth.getSession();
    if (error || !data?.session) {
      throw new Error('Sem sessão válida. Faça login novamente.');
    }
    return data.session;
  }

  /**
   * NOVO: obtém o usuário atual (ou null).
   */
  async getCurrentUser() {
    const { data } = await window.supabase.auth.getSession();
    return data?.session?.user ?? null;
  }

  /**
   * ATUALIZADO: Warm-up do servidor. Qualquer 2xx–4xx (exceto 5xx) “acorda” o container.
   * 404/401/403 são tratados como OK (não poluir console com error).
   */
  async warmUpServer() {
    try {
      const base = (window.API_BASE || '').replace(/\/+$/, '');
      if (!base) {
        console.warn('[AUTH] API_BASE não definido, pulando warm-up');
        return false;
      }

      // Liste primeiro um endpoint real seu (tende a responder 200 ou 401/403)
      const probes = [
        `${base}/api/users/status`, // existe no seu backend
        `${base}/api/health`,       // pode não existir no Render
        `${base}/health`,           // idem
        `${base}/`                  // fallback
      ];

      for (const url of probes) {
        try {
          console.log('[AUTH] Tentando aquecer servidor em:', url);
          const res = await fetch(url, { method: 'GET', cache: 'no-store', mode: 'cors' });
          if (res.ok || res.status === 404 || res.status === 401 || res.status === 403) {
            console.log('[AUTH] Warm-up OK via', url, 'status:', res.status);
            return true;
          }
        } catch {
          // tenta a próxima rota
        }
      }
    } catch (e) {
      console.warn('[AUTH] warmUpServer erro:', e);
    }
    return false;
  }

  // =========================
  // AUTENTICAÇÃO
  // =========================
  async init() {
    // Tenta reautenticar ao carregar a página
    if (!window.supabase || typeof window.supabase.auth === 'undefined') {
      return;
    }

    try {
      const session = await window.supabase.auth.getSession();
      this.currentUser = session?.data?.session?.user || null;

      // Novo: listener para mudanças na sessão
      window.supabase.auth.onAuthStateChange(async (event, sessionObj) => {
        this.currentUser = sessionObj?.user || null;
        if (!this.currentUser) {
          // saiu
          localStorage.removeItem('accessToken');
          localStorage.removeItem('tokenExpiry');
          this.userProfile = null;
        } else {
          // logou/refresh
          localStorage.setItem('accessToken', sessionObj.access_token);
          this.setTokenExpiry();
          try {
            await this.loadUserProfile(this.currentUser.id);
          } catch (e) {
            console.warn("onAuthStateChange: não consegui carregar perfil:", e.message);
          }
        }
      });

      if (this.currentUser) {
        // Captura erro para evitar Uncaught Promise rejections durante init
        try {
          await this.loadUserProfile(this.currentUser.id);
        } catch (e) {
          console.warn("Não foi possível carregar perfil no init:", e.message);
          // manter execução (perfil pode ser carregado mais tarde)
        }
      }
    } catch (e) {
      console.error("Erro ao obter sessão Supabase:", e);
    }
  }

  isAuthenticated() {
    // Mantém seu mecanismo atual (token em localStorage + validade)
    const token = localStorage.getItem('accessToken');
    const tokenValid = this.isTokenValid();
    return !!token && tokenValid;
  }

  redirectToLogin() {
    if (!window.location.href.includes('index.html')) {
      window.location.href = 'index.html';
    }
  }

  /**
   * Mantido: retorna access_token e renova a expiração local.
   * Se não houver sessão, faz logout.
   */
  async getAccessToken() {
    if (this.isAuthenticated()) {
      return localStorage.getItem('accessToken');
    }

    const { data: { session }, error } = await window.supabase.auth.getSession();

    if (error || !session || !session.access_token) {
      await this.logout();
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    localStorage.setItem('accessToken', session.access_token);
    this.setTokenExpiry();
    return session.access_token;
  }

  async login(email, password) {
    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });

    if (error) {
      throw new Error(`Falha no login: ${error.message}`);
    }

    const user = data.user;

    localStorage.setItem('accessToken', data.session.access_token);
    this.setTokenExpiry();
    this.currentUser = user;

    await this.loadUserProfile(user.id);

    if (!this.userProfile || (this.userProfile.status && this.userProfile.status !== 'ativo')) {
      await this.logout();
      throw new Error('Conta inativa ou não autorizada. Contate o administrador.');
    }

    console.log("Login realizado com sucesso. Perfil:", this.userProfile ? this.userProfile.nivel || this.userProfile.nivel_acesso : 'desconhecido');
  }

  async logout() {
    try {
      await window.supabase.auth.signOut();
    } catch (e) {
      console.warn("signOut falhou:", e);
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('tokenExpiry');
    this.currentUser = null;
    this.userProfile = null;
    this.redirectToLogin();
  }

  // =========================
  // PERFIL (Supabase → fallback API externa)
  // =========================
  async loadUserProfile(userId) {
    if (!userId) {
      throw new Error('ID do usuário necessário para carregar perfil.');
    }

    // 1) Tenta direto no Supabase (tabela 'usuarios', auth_id)
    if (window.supabase && typeof window.supabase.from === 'function') {
      try {
        const { data, error } = await window.supabase
          .from('usuarios')
          .select('*')
          .eq('auth_id', userId)
          .single();

        if (!error && data) {
          this.userProfile = data;
          return;
        }
        console.warn("Perfil não encontrado via Supabase ou erro; tentando API externa. Detalhe:", error ? error.message : 'nenhum dado');
      } catch (e) {
        console.warn("Falha ao buscar perfil via Supabase:", e.message);
      }
    }

    // 2) Se não achar via Supabase, tenta API externa com retries e warm-up
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const token = await this.getAccessToken();

        // Tentamos os dois caminhos comuns
        const endpoints = [
          `${window.API_BASE}/api/admin/profile`,
          `${window.API_BASE}/admin/profile`
        ];

        let response = null;
        let lastError = null;

        for (const url of endpoints) {
          try {
            response = await fetch(url, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            // Qualquer resposta nos dá sinal de vida; paramos de variar a rota
            break;
          } catch (fetchErr) {
            lastError = fetchErr;
          }
        }

        if (!response) {
          throw lastError || new Error('Nenhuma resposta do servidor ao tentar carregar perfil.');
        }

        if (response.ok) {
          const profileData = await response.json();
          // admite formato { data: {...} } ou {...}
          this.userProfile = profileData.data || profileData;
          return;
        }

        if (response.status === 401 || response.status === 403) {
          await this.logout();
          throw new Error('Não autorizado. Verifique suas permissões ou faça login novamente.');
        }

        throw new Error(`Erro ${response.status}: Falha ao buscar perfil`);
      } catch (error) {
        console.error("Erro ao carregar perfil:", error.message);

        if (attempt === 0 && (error.message.includes('Failed to fetch') || error.name === 'AbortError')) {
          await this.warmUpServer();
          await new Promise(resolve => setTimeout(resolve, WARMUP_DELAY_MS));
          continue;
        }

        if (document.getElementById('welcome-message')) {
          document.getElementById('welcome-message').textContent = 'Erro ao carregar perfil do usuário';
        }
        throw error;
      }
    }
  }

  // =========================
  // NOVO: guard simples para páginas protegidas
  // =========================
  async requireAuthGuard() {
    try {
      await this.ensureSession();
      // Se você quiser reforçar o perfil: await this.loadUserProfile((await this.getCurrentUser())?.id)
    } catch {
      this.redirectToLogin();
      throw new Error('Protegido: sem sessão.');
    }
  }
}

// =========================
// Inicializar gerenciador de autenticação
// =========================
const authManager = new AuthManager();

// Funções globais
window.logout = async function () {
  await authManager.logout();
};

// Proteção automática + warm-up ao carregar páginas protegidas
document.addEventListener('DOMContentLoaded', function () {
  authManager.warmUpServer();

  const isLoginPage = window.location.href.includes('index.html');
  if (!isLoginPage) {
    setTimeout(() => {
      if (!authManager.isAuthenticated()) {
        authManager.redirectToLogin();
      }
    }, 1000);
  }
});

// Exportar para uso em outros arquivos (como data-access.js)
window.authManager = authManager;
