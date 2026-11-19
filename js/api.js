// Camada de acesso ÃƒÂ  API do ELO. Nenhuma dependÃƒÂªncia.

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

// FastAPI devolve `detail` como string (erros de negÃƒÂ³cio) ou lista (422).
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
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`NÃƒÂ£o foi possÃƒÂ­vel conectar ÃƒÂ  API em ${baseUrl}.`, 0);
  }

  if (res.status === 204) return null;

  let dados = null;
  try {
    dados = await res.json();
  } catch {
    /* corpo vazio ou nÃƒÂ£o-JSON */
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

// ---- AutenticaÃƒÂ§ÃƒÂ£o e usuÃƒÂ¡rio ----
export const login = (email, senha) => post('/auth/', { email, senha });
export const cadastrar = (dados) => post('/usuario/', dados);
export const resolverRA = (ra) => get(`/usuario/ra/${encodeURIComponent(ra)}`);
export const me = () => get('/usuario/me').then((r) => r.usuario);

// ---- GrÃƒÂªmios ----
export const listarGremios = () => get('/gremio/').then((r) => r.gremios);
export const criarGremio = (nome_gremio) => post('/gremio/', { nome_gremio }).then((r) => r.gremio);
export const atualizarGremio = (gremioId, dados) =>
  patch(`/gremio/${gremioId}`, dados).then((r) => r.gremio);
export const legitimarGremio = (gremioId) =>
  patch(`/gremio/${gremioId}/legitimar`).then((r) => r.gremio);
export const minhasPermissoes = (gremioId) => get(`/gremio/${gremioId}/permissoes/me`);
export const verificarDisponibilidadeCriacao = () => get('/gremio/disponibilidade/me');

// ---- Canais ----
export const listarCanais = (gremioId) => get(`/gremio/${gremioId}/canais/`);
export const criarCanal = (gremioId, dados) => post(`/gremio/${gremioId}/canais/`, dados);
export const obterCanal = (canalId) => get(`/canal/${canalId}`);
export const atualizarCanal = (canalId, dados) => patch(`/canal/${canalId}`, dados);
export const excluirCanal = (canalId) => del(`/canal/${canalId}`);
export const listarPermissoesCanal = (canalId) => get(`/canal/${canalId}/permissoes`);
export const definirPermissaoCargoCanal = (canalId, cargoId, permitir, negar) =>
  put(`/canal/${canalId}/permissoes/cargos/${cargoId}`, { permitir, negar });
export const listarPermissoesRelacionaisCanal = (canalId, cargoId) =>
  get(`/canal/${canalId}/permissoes-relacionais`, { cargo_id: cargoId })
    .then((r) => r.permissoes);
export const concederPermissaoRelacionalCanal = (canalId, cargoId, permissaoId) =>
  put(`/canal/${canalId}/permissoes-relacionais/cargos/${cargoId}/${permissaoId}`);
export const revogarPermissaoRelacionalCanal = (canalId, cargoId, permissaoId) =>
  del(`/canal/${canalId}/permissoes-relacionais/cargos/${cargoId}/${permissaoId}`);

// ---- Mensagens ----
export const listarMensagens = (canalId, query) => get(`/canal/${canalId}/mensagens/`, query);
export const enviarMensagem = (canalId, conteudo) => post(`/canal/${canalId}/mensagens/`, { conteudo });
export const editarMensagem = (canalId, msgId, conteudo) =>
  patch(`/canal/${canalId}/mensagens/${msgId}`, { conteudo });
export const apagarMensagem = (canalId, msgId) => del(`/canal/${canalId}/mensagens/${msgId}`);

// ---- Enquetes e comunicados ----
export const listarEnquetesGremio = (gremioId) => get(`/gremio/${gremioId}/enquetes`);
export const criarEnqueteGremio = (gremioId, dados) =>
  post(`/gremio/${gremioId}/enquetes`, dados);
export const votarEnquete = (gremioId, enqueteId, opcaoIds) =>
  post(`/gremio/${gremioId}/enquetes/${enqueteId}/votos`, { opcao_ids: opcaoIds });
export const listarEnquetesCanal = (canalId) => get(`/canal/${canalId}/enquetes`);
export const criarEnqueteCanal = (canalId, dados) =>
  post(`/canal/${canalId}/enquetes`, dados);
export const criarComunicadoCanal = (canalId, dados) =>
  post(`/canal/${canalId}/comunicados`, dados);
export const listarComunicadosCanal = (canalId) =>
  get(`/canal/${canalId}/comunicados`);

export const listarComunicados = (gremioId) => get(`/gremio/${gremioId}/comunicados`);
export const criarComunicado = (gremioId, dados) =>
  post(`/gremio/${gremioId}/comunicados`, dados);

// ---- Membros ----
export const listarMembros = (gremioId) => get(`/gremio/${gremioId}/membros/`);
export const atribuirCargo = (gremioId, alvoId, cargoId) =>
  put(`/gremio/${gremioId}/membros/${alvoId}/cargos/${cargoId}`);
export const removerCargoDoMembro = (gremioId, alvoId, cargoId) =>
  del(`/gremio/${gremioId}/membros/${alvoId}/cargos/${cargoId}`);

// ---- Cargos ----
export const listarCargos = (gremioId) => get(`/gremio/${gremioId}/cargos/`);
export const criarCargo = (gremioId, dados) => post(`/gremio/${gremioId}/cargos/`, dados);
export const atualizarCargo = (gremioId, cargoId, dados) => patch(`/gremio/${gremioId}/cargos/${cargoId}`, dados);
export const excluirCargo = (gremioId, cargoId) => del(`/gremio/${gremioId}/cargos/${cargoId}`);
export const listarPermissoesRelacionaisCargo = (gremioId, cargoId) =>
  get(`/gremio/${gremioId}/cargos/${cargoId}/permissoes-relacionais`)
    .then((r) => r.permissoes);
export const concederPermissaoRelacionalCargo = (gremioId, cargoId, permissaoId) =>
  put(`/gremio/${gremioId}/cargos/${cargoId}/permissoes-relacionais/${permissaoId}`);
export const revogarPermissaoRelacionalCargo = (gremioId, cargoId, permissaoId) =>
  del(`/gremio/${gremioId}/cargos/${cargoId}/permissoes-relacionais/${permissaoId}`);
