// data-access.js
// Versão completa com:
// - consultas diretas ao Supabase para candidaturas e comentários
// - escrita direta (update de status, criar/editar/apagar comentários) respeitando RLS
// - presets e estatísticas existentes
// - sugestões de nomes
// - histórico de status com quem alterou e quando
// - gestão de experiência de trabalho para funcionários contratados
// - renovação de experiência por mais 40 dias
// - visualização de perfil completo do funcionário
// - NOVO: Armazenamento de última visualização

// Cache simples para opções de status (reduz chamadas e melhora latência)
let __statusOptionsCache = null;
let __statusOptionsCacheAt = 0;
const __STATUS_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function fetchData(endpoint, method = 'GET', body = null) {
  if (method === 'GET') {
    throw new Error('Função fetchData não deve ser usada para GET. Use as funções Supabase diretas.');
  }
  if (!window.authManager || !window.authManager.isAuthenticated()) {
    window.authManager.redirectToLogin();
    throw new Error('Usuário não autenticado. Redirecionando...');
  }

  const API_BASE = window.API_BASE;
  const MAX_RETRIES = 2;
  const WARMUP_DELAY_MS = 4000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const token = await window.authManager.getAccessToken();
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      const config = { method, headers };

      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        config.body = JSON.stringify(body);
      }

      let finalEndpoint = endpoint;
      if (endpoint.includes('${')) {
        // permite string template do tipo `/api/x/${id}`
        finalEndpoint = eval('`' + endpoint + '`');
      }

      const url = `${API_BASE}${finalEndpoint}`;
      const response = await fetch(url, config);

      if (response.ok) {
        if (response.status === 204) return {};
        return await response.json();
      }

      if (attempt === 0 && (response.status === 503 || response.status === 504 || response.status === 401)) {
        console.warn(`Status ${response.status} recebido. Aquecendo e tentando novamente...`);
        await window.authManager.warmUpServer();
        await new Promise(resolve => setTimeout(resolve, WARMUP_DELAY_MS));
        continue;
      }

      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`Erro na API (${response.status} ${response.statusText}): ${errorData.message || 'Erro desconhecido'}`);

    } catch (error) {
      if (attempt === 0 && (error.message.includes('Failed to fetch') || error.name === 'AbortError')) {
        console.warn(`Falha de rede. Aquecendo e tentando novamente...`);
        await window.authManager.warmUpServer();
        await new Promise(resolve => setTimeout(resolve, WARMUP_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
}

function checkSupabaseClient() {
  if (!window.supabase || typeof window.supabase.from !== 'function') {
    throw new Error('Cliente Supabase não inicializado. Verifique auth.js/config.js.');
  }
}

/* =========================
   Filtros (vagas, cidades, status)
========================= */
async function getFilterOptions() {
  checkSupabaseClient();

  const fetchUnique = async (column) => {
    const { data, error } = await window.supabase
      .from('candidaturas')
      .select(column);

    if (error) throw error;
    const uniqueValues = [...new Set(data.map(item => item[column]))]
      .filter(value => value !== null && value !== undefined && value !== '');

    return uniqueValues.sort();
  };

  try {
    const [vagas, cidades, status] = await Promise.all([
      fetchUnique('vaga'),
      fetchUnique('cidade'),
      fetchUnique('status')
    ]);

    return { vagas, cidades, status, bairros: [] };
  } catch (error) {
    console.error("Erro ao buscar opções de filtro diretamente no Supabase:", error);
    throw new Error(`Falha ao carregar opções de filtro: ${error.message}`);
  }
}

function normalizeCandidatura(rec) {
  return {
    ...rec,
    nome_completo: rec.nome || rec.nome_completo || '',
    criado_em: rec.enviado_em || rec.criado_em || rec.created_at || null
  };
}

/* =========================
   Candidaturas (listagem/consulta)
========================= */
async function getCandidaturas(filters = {}) {
  checkSupabaseClient();

  // Modificação: Adiciona a coluna ultima_visualizacao à seleção
  let query = window.supabase
    .from('candidaturas')
    .select('*, ultima_visualizacao') // <-- Adicionado ultima_visualizacao
    .order('enviado_em', { ascending: false });

  if (filters.vaga) { query = query.eq('vaga', filters.vaga); }
  if (filters.cidade) { query = query.ilike('cidade', `%${filters.cidade}%`); }
  if (filters.status) { query = query.eq('status', filters.status); }
  if (filters.bairro) { query = query.ilike('bairro', `%${filters.bairro}%`); }
  if (filters.rua) { query = query.ilike('rua', `%${filters.rua}%`); }
  if (filters.cpf) {
    const cpfNorm = String(filters.cpf).replace(/\D/g, '');
    if (cpfNorm) query = query.ilike('cpf', `%${cpfNorm}%`);
  }
  if (filters.nome) { query = query.ilike('nome', `%${filters.nome}%`); }

  if (filters.search) {
    const searchText = `%${filters.search}%`;
    query = query.or(`nome.ilike.${searchText},email.ilike.${searchText},cpf.ilike.${searchText}`);
  }

  if (filters.data_inicio) {
    try {
      const inicio = new Date(filters.data_inicio);
      query = query.gte('enviado_em', inicio.toISOString());
    } catch {}
  }
  if (filters.data_fim) {
    try {
      const end = new Date(filters.data_fim);
      end.setHours(23, 59, 59, 999);
      query = query.lte('enviado_em', end.toISOString());
    } catch {}
  }

  if (filters.page && filters.limit) {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await query.range(from, to);
    if (error) {
      console.error("Erro ao carregar candidaturas:", error);
      throw new Error(`Falha ao carregar candidaturas: ${error.message}`);
    }
    const normalized = (data || []).map(normalizeCandidatura);
    return {
      data: normalized,
      page: Number(page),
      limit: Number(limit),
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit) || 1
    };
  }

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Erro ao carregar candidaturas diretamente do Supabase:", error);
    throw new Error(`Falha ao carregar candidaturas: ${error.message}`);
  }

  const normalized = (data || []).map(normalizeCandidatura);
  return { data: normalized };
}

async function getCandidaturaById(id) {
  checkSupabaseClient();

  // Modificação: Adiciona a coluna ultima_visualizacao à seleção
  const { data, error } = await window.supabase
    .from('candidaturas')
    .select('*, ultima_visualizacao') // <-- Adicionado ultima_visualizacao
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error('Candidatura não encontrada.');
    }
    console.error("Erro ao carregar candidatura por ID:", error);
    throw new Error(`Falha ao buscar candidatura: ${error.message}`);
  }

  return { data: normalizeCandidatura(data) };
}

/* =========================
   Atualização de status (direto no Supabase)
========================= */
async function updateCandidatura(id, updateData) {
  if (!id) throw new Error('ID é obrigatório para atualizar candidatura.');
  return await fetchData(`/api/admin/candidaturas/${encodeURIComponent(id)}`, 'PUT', updateData);
}

async function updateCandidaturaStatus(id, status, observacao = null) {
  checkSupabaseClient();
  if (!id) throw new Error('ID é obrigatório.');
  if (!status) throw new Error('Status é obrigatório.');

  // Primeiro, obter o status atual para registrar no histórico
  const { data: currentData, error: currentDataError } = await window.supabase
    .from('candidaturas')
    .select('status')
    .eq('id', id)
    .single();

  if (currentDataError) {
    console.warn('Não foi possível obter status atual:', currentDataError);
  }

  const statusAnterior = currentData?.status || null;

  const payload = { status };
  // Observação: só ADMIN consegue persistir; o trigger no DB garante.
  if (observacao !== null && observacao !== undefined) {
    payload.observacao = observacao;
  }

  const { data, error } = await window.supabase
    .from('candidaturas')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Registrar no histórico de status
  try {
    await createStatusHistoryEntry(id, statusAnterior, status);
  } catch (historyError) {
    console.warn('Não foi possível registrar no histórico:', historyError);
  }

  // Se o status for "Contratado", iniciar experiência de trabalho
  if (status === 'Contratado') {
    try {
      await window.experienceManager.startExperience(id);
    } catch (expError) {
      console.warn('Não foi possível iniciar experiência de trabalho:', expError);
    }
  }

  return { data };
}

/* =========================
   Histórico de Status
========================= */
async function createStatusHistoryEntry(candidaturaId, statusAnterior, statusNovo) {
  checkSupabaseClient();
  
  const sess = await window.supabase.auth.getSession();
  const user = sess?.data?.session?.user;

  if (!user) throw new Error('Usuário não autenticado.');
  if (!candidaturaId) throw new Error('candidaturaId é obrigatório.');

  const payload = {
    candidatura_id: candidaturaId,
    usuario_id: user.id,
    status_anterior: statusAnterior,
    status_novo: statusNovo,
    criado_em: new Date().toISOString()
  };

  const { data, error } = await window.supabase
    .from('status_history')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function getStatusHistory(candidaturaId) {
  checkSupabaseClient();

  try {
    // Tentativa 1: Usando a relação direta com auth.users
    const { data, error } = await window.supabase
      .from('status_history')
      .select(`
        *,
        auth.users!inner(nome, email)
      `)
      .eq('candidatura_id', candidaturaId)
      .order('criado_em', { ascending: false });

    if (!error) {
      return (data || []).map(item => ({
        ...item,
        usuario_nome: item.auth?.users?.nome || item.auth?.users?.email || 'Sistema'
      }));
    }
  } catch (e) {
    console.warn('Tentativa 1 falhou:', e.message);
  }

  try {
    // Tentativa 2: Buscar separadamente e combinar
    const { data: historyData, error: historyError } = await window.supabase
      .from('status_history')
      .select('*')
      .eq('candidatura_id', candidaturaId)
      .order('criado_em', { ascending: false });

    if (historyError) {
      console.error('[STATUS_HISTORY] Erro ao buscar histórico:', historyError);
      throw new Error(`Falha ao carregar histórico de status: ${historyError.message}`);
    }

    // Se não houver histórico, retorna array vazio
    if (!historyData || historyData.length === 0) {
      return [];
    }

    // Obter informações dos usuários separadamente
    const userIds = [...new Set(historyData.map(item => item.usuario_id).filter(Boolean))];
    
    if (userIds.length === 0) {
      return historyData.map(item => ({
        ...item,
        usuario_nome: 'Sistema'
      }));
    }

    const { data: usersData, error: usersError } = await window.supabase.auth.admin.listUsers();
    
    if (usersError) {
      console.warn('Não foi possível obter dados dos usuários:', usersError);
      return historyData.map(item => ({
        ...item,
        usuario_nome: 'Usuário'
      }));
    }

    // Criar mapa de ID para nome/email
    const userMap = {};
    (usersData?.users || []).forEach(user => {
      userMap[user.id] = user.user_metadata?.nome || user.user_metadata?.name || user.email || 'Usuário';
    });

    // Combinar dados
    return historyData.map(item => ({
      ...item,
      usuario_nome: userMap[item.usuario_id] || 'Sistema'
    }));
    
  } catch (error) {
    console.error('[STATUS_HISTORY] Erro ao buscar histórico:', error);
    throw new Error(`Falha ao carregar histórico de status: ${error.message}`);
  }
}

/* =========================
   Opções de status (cache)
========================= */
async function getStatusOptions() {
  if (__statusOptionsCache && (Date.now() - __statusOptionsCacheAt) < __STATUS_TTL_MS) {
    return __statusOptionsCache;
  }
  if (!window.authManager) throw new Error('authManager não inicializado');
  const token = await window.authManager.getAccessToken();
  const url = `${window.API_BASE}/api/users/status`;
  const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) { await window.authManager.logout(); }
    const txt = await res.text().catch(() => null);
    throw new Error(`Falha ao obter status (${res.status}): ${txt || res.statusText}`);
  }
  const json = await res.json().catch(() => null);
  const list = (json && json.status) ? json.status : [];
  __statusOptionsCache = list;
  __statusOptionsCacheAt = Date.now();
  return list;
}

/* =========================
   Currículo (URL assinada via sua API)
========================= */
async function getSignedCurriculo(id) {
  if (!id) throw new Error('ID da candidatura é necessário para obter currículo.');
  if (!window.authManager) throw new Error('authManager não inicializado');

  const token = await window.authManager.getAccessToken();
  const url = `${window.API_BASE}/api/admin/curriculo/${encodeURIComponent(id)}`;

  const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) await window.authManager.logout();
    const txt = await res.text().catch(() => null);
    throw new Error(`Falha ao obter currículo (${res.status}): ${txt || res.statusText}`);
  }

  const json = await res.json().catch(() => { throw new Error('Resposta inválida ao buscar currículo.'); });
  return json;
}

/* =========================
   Comentários
========================= */
async function getComentarios(candidaturaId) {
  checkSupabaseClient();

  // Importante: não usamos join com usuarios — o trigger preenche owner_name
  const { data, error } = await window.supabase
    .from('comentarios')
    .select('*')
    .eq('candidatura_id', candidaturaId)
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('[COMENTARIOS] Erro ao buscar:', error);
    throw new Error(`Falha ao carregar comentários: ${error.message}`);
  }

  // Nome de exibição pronto para a UI do modal
  return (data || []).map(it => ({
    ...it,
    nome_exibicao: it.owner_name || (it.usuario_id === null ? 'Sistema' : 'Usuário'),
  }));
}

async function createComentario(candidatura_id, comentario, tipo = 'observacao') {
  checkSupabaseClient();
  const sess = await window.supabase.auth.getSession();
  const user = sess?.data?.session?.user;

  if (!user) throw new Error('Usuário não autenticado.');
  if (!candidatura_id) throw new Error('candidatura_id é obrigatório.');
  if (!comentario) throw new Error('comentário é obrigatório.');

  const payload = {
    candidatura_id,
    usuario_id: user.id, // vínculo com o usuário autenticado
    comentario,
    tipo,
  };

  const { data, error } = await window.supabase
    .from('comentarios')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function updateComentario(comentario_id, fields) {
  checkSupabaseClient();
  if (!comentario_id) throw new Error('comentario_id é obrigatório.');
  if (!fields || typeof fields !== 'object') throw new Error('fields inválido.');

  const { data, error } = await window.supabase
    .from('comentarios')
    .update(fields)
    .eq('id', comentario_id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deleteComentario(comentario_id) {
  checkSupabaseClient();
  if (!comentario_id) throw new Error('comentario_id é obrigatório.');

  const { error } = await window.supabase
    .from('comentarios')
    .delete()
    .eq('id', comentario_id);

  if (error) throw new Error(error.message);
  return true;
}

/* =========================
   NOVA FUNÇÃO: Atualiza a última visualização
========================= */
async function updateUltimaVisualizacao(id) {
  checkSupabaseClient();
  if (!id) throw new Error('ID é obrigatório para atualizar visualização.');

  // Obter informações do usuário autenticado
  let userName = 'Usuário Desconhecido';
  let userEmail = 'N/A';
  try {
    const am = window.authManager;
    if (am && am.userProfile) {
      userName = am.userProfile.nome || am.userProfile.name || 'Usuário';
      userEmail = am.currentUser?.email || 'N/A';
    } else {
      const sess = await window.supabase.auth.getSession();
      userName = sess?.data?.session?.user?.user_metadata?.nome || sess?.data?.session?.user?.user_metadata?.name || sess?.data?.session?.user?.email || userName;
      userEmail = sess?.data?.session?.user?.email || userEmail;
    }
  } catch (e) {
    console.warn('Não foi possível obter o nome do usuário para visualização:', e);
  }

  const visualizacaoData = {
    nome: userName,
    email: userEmail, // Pode ser útil para auditoria
    visto_em: new Date().toISOString(),
    data: new Date().toISOString()
  };

  const { data, error } = await window.supabase
    .from('candidaturas')
    .update({ ultima_visualizacao: visualizacaoData })
    .eq('id', id)
    .select('ultima_visualizacao')
    .single();

  if (error) {
    console.error('Erro ao atualizar ultima_visualizacao:', error);
    throw new Error(`Falha ao registrar visualização: ${error.message}`);
  }

  return data;
}


/* =========================
   Stats / evolução
========================= */
async function getTopStats({ limitVagas = 10, limitCidades = 15, limitBairros = 10, filters = {} } = {}) {
  const finalFilters = { ...filters, limit: 10000 };
  const res = await getCandidaturas(finalFilters);
  const rows = res.data || [];

  const countBy = (arr, keyFn) => {
    const counts = {};
    for (const r of arr) {
      const k = keyFn(r) || '—';
      counts[k] = (counts[k] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([k, v]) => ({ key: k, count: v }))
      .sort((a, b) => b.count - a.count);
  };

  const vagas = countBy(rows, r => r.vaga).slice(0, limitVagas);
  const cidades = countBy(rows, r => r.cidade).slice(0, limitCidades);
  const bairros = countBy(rows, r => (r.bairro ? `${r.bairro} - ${r.cidade || ''}` : r.cidade || '—')).slice(0, limitBairros);

  return { vagas, cidades, bairros, totalCandidaturas: rows.length };
}

async function getEvolution(filters = {}) {
  const finalFilters = { ...filters, limit: 10000 };
  const res = await getCandidaturas(finalFilters);
  const rows = res.data || [];

  let startDate, endDate;
  if (filters.data_inicio) startDate = new Date(filters.data_inicio);
  if (filters.data_fim) endDate = new Date(filters.data_fim);
  if (!endDate) endDate = new Date();
  if (!startDate) {
    const tmp = new Date(endDate);
    tmp.setDate(tmp.getDate() - 29);
    startDate = tmp;
  }
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const map = {};
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    map[key] = 0;
  }

  for (const r of rows) {
    const dt = r.enviado_em || r.criado_em || r.created_at;
    if (!dt) continue;
    const d = new Date(dt);
    d.setHours(0, 0, 0, 0);
    if (d >= startDate && d <= endDate) {
      const key = d.toISOString().slice(0, 10);
      map[key] = (map[key] || 0) + 1;
    }
  }

  const labels = Object.keys(map).sort();
  const counts = labels.map(l => map[l]);

  const localeLabels = labels.map(l => {
    const d = new Date(l + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
    });

  return { labels: localeLabels, counts, rawLabels: labels };
}

/* =========================
   Usuários + presets + sugestões
========================= */
async function getUsers() {
  checkSupabaseClient();
  const { data, error } = await window.supabase.from('usuarios').select('*');
  if (error) {
    console.error("Erro ao carregar usuários diretamente do Supabase:", error);
    throw new Error(`Falha ao carregar usuários: ${error.message}`);
  }
  return { data: data || [] };
}

async function createUser(userData) { return fetchData('/api/users', 'POST', userData); }
async function updateUser(id, userData) { return fetchData(`/api/users/${encodeURIComponent(id)}`, 'PUT', userData); }
async function deleteUser(id) { return fetchData(`/api/users/${encodeURIComponent(id)}`, 'DELETE'); }

async function _getCurrentUserIdAndName() {
  let user_id = null;
  let user_name = null;
  try {
    const am = window.authManager;
    if (am) {
      const up = am.userProfile;
      const cu = am.currentUser;
      if (up && (up.id || up.auth_id || up.email || up.nome)) {
        user_id = up.id || up.auth_id || (cu && cu.id) || null;
        user_name = up.nome || up.name || up.email || (cu && cu.email) || null;
      } else if (cu && cu.id) {
        user_id = cu.id;
        user_name = cu.email || null;
      }
    }
  } catch {}
  if (!user_id) {
    const sess = await window.supabase.auth.getSession();
    user_id = sess?.data?.session?.user?.id || null;
    user_name = sess?.data?.session?.user?.email || user_name;
  }
  return { user_id, user_name };
}

async function saveFilterPreset(name, filters) {
  checkSupabaseClient();
  if (!name) throw new Error('Nome do preset é obrigatório.');
  const { user_id, user_name } = await _getCurrentUserIdAndName();
  if (!user_id) throw new Error('Usuário não identificado. Faça login novamente.');

  const payload = { user_id, user_name: user_name || null, name, filters };

  const { data, error } = await window.supabase
    .from('user_filter_presets')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('Erro ao salvar preset:', error);
    throw new Error(error.message || 'Falha ao salvar preset');
  }
  return data;
}

async function getUserFilterPresets() {
  checkSupabaseClient();
  const { user_id } = await _getCurrentUserIdAndName();
  if (!user_id) return [];
  const { data, error } = await window.supabase
    .from('user_filter_presets')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Erro ao buscar presets do usuário:', error);
    throw new Error(error.message || 'Falha ao carregar presets');
  }
  return data || [];
}

async function deleteFilterPreset(presetId) {
  checkSupabaseClient();
  if (!presetId) throw new Error('presetId obrigatório');

  const { error } = await window.supabase
    .from('user_filter_presets')
    .delete()
    .eq('id', presetId);

  if (error) {
    console.error('Erro ao deletar preset:', error);
    throw new Error(error.message || 'Falha ao deletar preset');
  }
  return true;
}

async function updateFilterPreset(presetId, { name, filters }) {
  checkSupabaseClient();
  if (!presetId) throw new Error('presetId obrigatório');

  const updates = {};
  if (typeof name !== 'undefined') updates.name = name;
  if (typeof filters !== 'undefined') updates.filters = filters;

  const { data, error } = await window.supabase
    .from('user_filter_presets')
    .update(updates)
    .eq('id', presetId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao atualizar preset:', error);
    throw new Error(error.message || 'Falha ao atualizar preset');
  }
  return data;
}

async function getNameSuggestions(query, limit = 10) {
  checkSupabaseClient();
  if (!query || String(query).trim().length < 2) return [];
  try {
    const q = `%${query}%`;
    const { data, error } = await window.supabase
      .from('candidaturas')
      .select('nome')
      .ilike('nome', q)
      .limit(limit);

    if (error) {
      console.warn('getNameSuggestions: erro ao consultar Supabase', error);
      return [];
    }
    const names = [...new Set((data || []).map(r => r.nome).filter(Boolean))];
    return names;
  } catch (err) {
    console.warn('getNameSuggestions erro:', err);
    return [];
  }
}

/* =========================
   Experiência de Trabalho
========================= */
async function getExperienceEmployees(filters = {}) {
  checkSupabaseClient();

  let query = window.supabase
    .from('employee_experience')
    .select('*')
    .order('created_at', { ascending: false });

  // Aplica filtros
  if (filters.period) {
    query = query.eq('period', filters.period);
  }

  if (filters.phase) {
    query = query.eq('phase', filters.phase);
  }

  if (filters.vaga) {
    query = query.eq('vaga', filters.vaga);
  }

  if (filters.cidade) {
    query = query.ilike('cidade', `%${filters.cidade}%`);
  }

  if (filters.nome) {
    query = query.ilike('nome', `%${filters.nome}%`);
  }

  if (filters.data_inicio) {
    const startDate = new Date(filters.data_inicio);
    query = query.gte('start_date', startDate.toISOString());
  }

  if (filters.data_fim) {
    const endDate = new Date(filters.data_fim);
    endDate.setHours(23, 59, 59, 999);
    query = query.lte('end_date', endDate.toISOString());
  }

  // Paginação
  if (filters.page && filters.limit) {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    
    const processedData = processExperienceData(data || []);
    const stats = calculateStats(processedData);
    
    return { 
      data: processedData, 
      page: Number(page), 
      limit: Number(limit), 
      total: count || 0, 
      totalPages: Math.ceil((count || 0) / limit) || 1, // Garante totalPages >= 1
      stats 
    };
  }

  const { data, error } = await query;
  if (error) throw error;

  const processedData = processExperienceData(data || []);
  const stats = calculateStats(processedData);
  return { data: processedData, stats };
}

// Processa dados de experiência para calcular dias restantes e progresso
function processExperienceData(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return data.map(item => {
    const startDate = new Date(item.start_date);
    const endDate = new Date(item.end_date);
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const daysPassed = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    let period = item.period;
    let status = item.status;

    // Atualiza status baseado nas datas
    if (daysRemaining < 0) {
      status = 'expired';
      period = 'expired';
    } else if (daysRemaining === 0) {
      status = 'completed';
      period = 'completed';
    }

    // Calcula progresso
    let progress = 0;
    if (daysPassed >= 0 && totalDays > 0) {
      progress = Math.min(100, Math.max(0, (daysPassed / totalDays) * 100));
    }

    // Determina se pode ser renovado
    let canRenew = false;
    if (item.phase === 'first' && daysRemaining <= 5 && daysRemaining >= 0 && status !== 'completed') {
      canRenew = true;
    }

    return {
      ...item,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      totalDays,
      daysPassed,
      daysRemaining,
      progress: Math.round(progress),
      period,
      status,
      canRenew,
      phase: item.phase || 'unknown'
    };
  });
}

// Calcula estatísticas
function calculateStats(data) {
  const stats = {
    total: data.length,
    period40Days: 0,
    period80Days: 0,
    renewal: 0,
    completed: 0,
    expired: 0,
    firstPhase: 0,
    secondPhase: 0,
    canRenew: 0
  };

  data.forEach(item => {
    switch (item.period) {
      case '40days':
        stats.period40Days++;
        break;
      case '80days':
        stats.period80Days++;
        break;
      case 'renewal':
        stats.renewal++;
        break;
      case 'completed':
        stats.completed++;
        break;
      case 'expired':
        stats.expired++;
        break;
    }

    switch (item.phase) {
      case 'first':
        stats.firstPhase++;
        break;
      case 'second':
        stats.secondPhase++;
        break;
    }

    if (item.canRenew) {
      stats.canRenew++;
    }
  });

  return stats;
}

async function startExperience(candidaturaId, contractType = '40days') {
  checkSupabaseClient();
  if (!candidaturaId) throw new Error('ID da candidatura é obrigatório.');

  try {
    const candidatura = await getCandidaturaById(candidaturaId);
    if (!candidatura || !candidatura.data) {
      throw new Error('Candidatura não encontrada');
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    const periodDays = contractType === '80days' ? 80 : 40;
    endDate.setDate(endDate.getDate() + periodDays);

    const experienceData = {
      candidatura_id: candidaturaId,
      nome: candidatura.data.nome,
      vaga: candidatura.data.vaga,
      cidade: candidatura.data.cidade,
      contract_type: contractType,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      period: contractType,
      status: 'active',
      phase: contractType === '80days' ? 'single' : 'first', // 'first', 'second', 'single'
      created_at: new Date().toISOString()
    };

    // Salva no Supabase
    const { data, error } = await window.supabase
      .from('employee_experience')
      .insert([experienceData])
      .select()
      .single();

    if (error) {
      console.error('Erro ao iniciar experiência:', error);
      throw new Error('Falha ao iniciar período de experiência: ' + error.message);
    }

    console.log('Experiência iniciada com sucesso:', data);
    return data;
  } catch (error) {
    console.error('Erro em startExperience:', error);
    throw error;
  }
}

async function renewExperience(experienceId) {
  checkSupabaseClient();
  if (!experienceId) throw new Error('ID da experiência é obrigatório.');

  try {
    // Primeiro, obtém a experiência atual
    const { data: currentExperience, error } = await window.supabase
      .from('employee_experience')
      .select('*')
      .eq('id', experienceId)
      .single();

    if (error) {
      throw new Error('Experiência não encontrada: ' + error.message);
    }

    if (currentExperience.phase === 'second') {
      throw new Error('Esta experiência já está na segunda fase e não pode ser renovada');
    }

    if (currentExperience.phase === 'single') {
      throw new Error('Experiências de 80 dias não podem ser renovadas');
    }

    const newStartDate = new Date(currentExperience.end_date);
    const newEndDate = new Date(newStartDate);
    newEndDate.setDate(newEndDate.getDate() + 40);

    const renewalData = {
      original_experience_id: experienceId, // Referência à experiência original
      candidatura_id: currentExperience.candidatura_id,
      nome: currentExperience.nome,
      vaga: currentExperience.vaga,
      cidade: currentExperience.cidade,
      contract_type: 'renewal',
      start_date: newStartDate.toISOString(),
      end_date: newEndDate.toISOString(),
      period: 'renewal',
      status: 'active',
      phase: 'second',
      renewal_number: 1, // Primeira renovação
      created_at: new Date().toISOString()
    };

    // Insere a nova experiência (renovação)
    const { data: renewalExperience, error: renewalError } = await window.supabase
      .from('employee_experience')
      .insert([renewalData])
      .select()
      .single();

    if (renewalError) {
      throw new Error('Falha ao criar renovação: ' + renewalError.message);
    }

    // Atualiza a experiência original para 'renewed'
    const { error: updateError } = await window.supabase
      .from('employee_experience')
      .update({ 
        status: 'renewed',
        renewed_at: new Date().toISOString(),
        renewed_to_id: renewalExperience.id
      })
      .eq('id', experienceId);

    if (updateError) {
      console.warn('Erro ao atualizar experiência original:', updateError);
    }

    console.log('Experiência renovada com sucesso:', renewalExperience);
    return renewalExperience;
  } catch (error) {
    console.error('Erro em renewExperience:', error);
    throw error;
  }
}

async function updateExperienceStatus(experienceId, newStatus) {
  checkSupabaseClient();
  if (!experienceId) throw new Error('ID da experiência é obrigatório.');

  const { data, error } = await window.supabase
    .from('employee_experience')
    .update({ 
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', experienceId)
    .select()
    .single();

  if (error) {
    console.error('Erro ao atualizar status:', error);
    throw new Error('Falha ao atualizar status: ' + error.message);
  }

  return data;
}

async function removeExperience(experienceId) {
  checkSupabaseClient();
  if (!experienceId) throw new Error('ID da experiência é obrigatório.');

  const { error } = await window.supabase
    .from('employee_experience')
    .delete()
    .eq('id', experienceId);

  if (error) {
    console.error('Erro ao remover experiência:', error);
    throw new Error('Falha ao remover experiência: ' + error.message);
  }

  return true;
}

// Obtém histórico de renovações de um funcionário
async function getRenewalHistory(candidaturaId) {
  checkSupabaseClient();

  try {
    const { data, error } = await window.supabase
      .from('employee_experience')
      .select('*')
      .eq('candidatura_id', candidaturaId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Erro ao obter histórico de renovações:', error);
    throw error;
  }
}

// Obtém perfil completo do funcionário
async function getEmployeeProfile(experienceId) {
  checkSupabaseClient();
  if (!experienceId) throw new Error('ID da experiência é obrigatório.');

  try {
    // Obtém a experiência atual
    const { data: experience, error: expError } = await window.supabase
      .from('employee_experience')
      .select('*')
      .eq('id', experienceId)
      .single();

    if (expError) {
      throw new Error('Experiência não encontrada: ' + expError.message);
    }

    // Obtém a candidatura original
    const { data: candidatura, error: candError } = await window.supabase
      .from('candidaturas')
      .select('*')
      .eq('id', experience.candidatura_id)
      .single();

    if (candError) {
      throw new Error('Candidatura não encontrada: ' + candError.message);
    }

    // Obtém histórico de renovações
    const renewalHistory = await getRenewalHistory(experience.candidatura_id);

    // Obtém comentários da candidatura
    const { data: comentarios, error: commError } = await window.supabase
      .from('comentarios')
      .select('*')
      .eq('candidatura_id', experience.candidatura_id)
      .order('criado_em', { ascending: false });

    if (commError) {
      console.warn('Erro ao carregar comentários:', commError);
    }

    // Processa os comentários
    const processedComments = (comentarios || []).map(it => ({
      ...it,
      nome_exibicao: it.owner_name || (it.usuario_id === null ? 'Sistema' : 'Usuário'),
    }));

    return {
      experience: processExperienceData([experience])[0],
      candidatura: normalizeCandidatura(candidatura),
      renewalHistory: renewalHistory || [],
      comentarios: processedComments || []
    };
  } catch (error) {
    console.error('Erro ao obter perfil do funcionário:', error);
    throw new Error('Falha ao obter perfil do funcionário: ' + error.message);
  }
}

/* =========================
   Export global
========================= */
window.dataAccess = {
  getFilterOptions,
  getCandidaturas,
  getCandidaturaById,
  updateCandidatura,
  updateCandidaturaStatus,
  getStatusHistory,        // Função para obter histórico de status
  createStatusHistoryEntry, // Função para criar entrada no histórico
  getStatusOptions,
  getSignedCurriculo,
  getComentarios,          // <- sem join; já traz nome_exibicao
  createComentario,
  updateComentario,
  deleteComentario,
  getTopStats,
  getEvolution,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  saveFilterPreset,
  getUserFilterPresets,
  deleteFilterPreset,
  updateFilterPreset,
  getNameSuggestions,
  // Funções de experiência de trabalho
  getExperienceEmployees,
  startExperience,
  renewExperience,
  updateExperienceStatus,
  removeExperience,
  getRenewalHistory,
  getEmployeeProfile,
  // NOVA FUNÇÃO
  updateUltimaVisualizacao
};

// Instancia global do gerenciador de experiência (compatibilidade)
window.experienceManager = {
  startExperience,
  getExperienceEmployees,
  updateExperienceStatus,
  removeExperience,
  renewExperience,
  getRenewalHistory,
  processExperienceData,
  calculateStats
};
