// Camada de acesso à API do ELO. Nenhuma dependência.

const DEFAULT_URL = 'http://localhost:8000';

let baseUrl = (localStorage.getItem('elo_api') || DEFAULT_URL).replace(/\/+$/, '');
let token = localStorage.getItem('elo_token');
let onUnauthorized = () => {};

export const getBaseUrl = () => baseUrl;
export const hasToken = () => !!token;

export function setBaseUrl(url) {
  baseUrl = (url || DEFAULT_URL).replace(/\/+$/, '');
  localStorage.setItem('elo_api', baseUrl);
}

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('elo_token', t);
  else localStorage.removeItem('elo_token');
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// FastAPI devolve `detail` como string (erros de negócio) ou lista (422).
function extrairMensagem(dados, status) {
  const d = dados && dados.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        const campo = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : '';
        return campo ? `${campo}: ${e.msg}` : e.msg;
      })
      .join('\n');
  }
  return `Erro ${status}`;
}

async function request(method, path, { body, query } = {}) {
  let url = baseUrl + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const s = qs.toString();
    if (s) url += '?' + s;
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Não foi possível conectar à API em ${baseUrl}.`, 0);
  }

  if (res.status === 204) return null;

  let dados = null;
  try {
    dados = await res.json();
  } catch {
    /* corpo vazio ou não-JSON */
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(extrairMensagem(dados, res.status), res.status);
  }
  return dados;
}

const get = (p, query) => request('GET', p, { query });
const post = (p, body) => request('POST', p, { body });
const put = (p, body) => request('PUT', p, { body });
const patch = (p, body) => request('PATCH', p, { body });
const del = (p) => request('DELETE', p);

// ---- Autenticação e usuário ----
export const login = (email, senha) => post('/auth/', { email, senha });
export const cadastrar = (dados) => post('/usuario/', dados);
export const me = () => get('/usuario/me').then((r) => r.usuario);

// ---- Grêmios ----
export const listarGremios = () => get('/gremio/').then((r) => r.gremios);
export const criarGremio = (nome_gremio) => post('/gremio/', { nome_gremio }).then((r) => r.gremio);
export const minhasPermissoes = (gremioId) => get(`/gremio/${gremioId}/permissoes/me`);

// ---- Canais ----
export const listarCanais = (gremioId) => get(`/gremio/${gremioId}/canais/`);
export const criarCanal = (gremioId, dados) => post(`/gremio/${gremioId}/canais/`, dados);
export const obterCanal = (canalId) => get(`/canal/${canalId}`);
export const atualizarCanal = (canalId, dados) => patch(`/canal/${canalId}`, dados);
export const excluirCanal = (canalId) => del(`/canal/${canalId}`);

// ---- Mensagens ----
export const listarMensagens = (canalId, query) => get(`/canal/${canalId}/mensagens/`, query);
export const enviarMensagem = (canalId, conteudo) => post(`/canal/${canalId}/mensagens/`, { conteudo });
export const editarMensagem = (canalId, msgId, conteudo) =>
  patch(`/canal/${canalId}/mensagens/${msgId}`, { conteudo });
export const apagarMensagem = (canalId, msgId) => del(`/canal/${canalId}/mensagens/${msgId}`);

// ---- Membros ----
export const listarMembros = (gremioId) => get(`/gremio/${gremioId}/membros/`);
export const adicionarMembro = (gremioId, usuario_id) => post(`/gremio/${gremioId}/membros/`, { usuario_id });
export const removerMembro = (gremioId, alvoId) => del(`/gremio/${gremioId}/membros/${alvoId}`);
export const atribuirCargo = (gremioId, alvoId, cargoId) =>
  put(`/gremio/${gremioId}/membros/${alvoId}/cargos/${cargoId}`);
export const removerCargoDoMembro = (gremioId, alvoId, cargoId) =>
  del(`/gremio/${gremioId}/membros/${alvoId}/cargos/${cargoId}`);

// ---- Cargos ----
export const listarCargos = (gremioId) => get(`/gremio/${gremioId}/cargos/`);
export const criarCargo = (gremioId, dados) => post(`/gremio/${gremioId}/cargos/`, dados);
export const atualizarCargo = (gremioId, cargoId, dados) => patch(`/gremio/${gremioId}/cargos/${cargoId}`, dados);
export const excluirCargo = (gremioId, cargoId) => del(`/gremio/${gremioId}/cargos/${cargoId}`);
