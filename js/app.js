import * as api from './api.js';
import {
  h, clear, toast, formDialog, confirmar, openModal,
  initials, colorFor, formatTime, formatDia, PERMISSOES,
} from './ui.js';

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 3000;
const LIMITE = 50;

const state = {
  me: null,
  gremios: [],
  gremio: null,
  perms: { fundador: false, cargos: [], permissoes: [] },
  canais: [],
  canal: null,
  canalPerms: [],
  mensagens: [],
  temMais: false,
  carregando: false,
  editandoId: null,
  membros: [],
  cargos: [],
  pollTimer: null,
  membrosAberto: localStorage.getItem('elo_membros') !== '0',
};

// Descarta respostas atrasadas quando o usuário já navegou para outro lugar.
let seqGremio = 0;
let seqCanal = 0;

// ---------------------------------------------------------------------
// Permissões (só controlam o que a UI mostra; quem decide é o servidor)
// ---------------------------------------------------------------------
const ehAdmin = () =>
  state.perms.fundador || state.perms.permissoes.includes('ADMINISTRADOR');
const podeGremio = (p) => ehAdmin() || state.perms.permissoes.includes(p);
const podeCanal = (p) => ehAdmin() || state.canalPerms.includes(p);

// ---------------------------------------------------------------------
// Inicialização e autenticação
// ---------------------------------------------------------------------
function mostrarAuth() {
  pararPolling();
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
  $('#server-url').textContent = api.getBaseUrl();
}

function mostrarApp() {
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
}

function sair(mensagem) {
  api.setToken(null);
  Object.assign(state, {
    me: null, gremios: [], gremio: null, canais: [], canal: null,
    mensagens: [], membros: [], cargos: [], canalPerms: [],
  });
  mostrarAuth();
  if (mensagem) toast(mensagem, 'error');
}

api.setUnauthorizedHandler(() => sair('Sua sessão expirou. Entre novamente.'));

async function iniciar() {
  state.me = await api.me();
  mostrarApp();
  renderUsuario();
  await carregarGremios();
}

function ligarAuth() {
  $('#server-url').textContent = api.getBaseUrl();

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      const alvo = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => {
        const ativa = t === tab;
        t.classList.toggle('active', ativa);
        t.setAttribute('aria-selected', ativa);
      });
      $('#login-form').hidden = alvo !== 'login';
      $('#cadastro-form').hidden = alvo !== 'cadastro';
    })
  );

  $('#change-server').addEventListener('click', () => {
    const url = prompt('Endereço da API do ELO:', api.getBaseUrl());
    if (url) {
      api.setBaseUrl(url.trim());
      $('#server-url').textContent = api.getBaseUrl();
    }
  });

  ligarFormAuth($('#login-form'), $('#login-erro'), async (d) => {
    await entrar(d.email, d.senha);
  });

  ligarFormAuth($('#cadastro-form'), $('#cadastro-erro'), async (d) => {
    const dados = { nome: d.nome, email: d.email, cpf: d.cpf, senha: d.senha };
    if (d.ra) dados.ra = d.ra;
    await api.cadastrar(dados);
    await entrar(d.email, d.senha);
    toast('Conta criada. Bem-vindo ao ELO!', 'success');
  });
}

function ligarFormAuth(form, erroEl, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroEl.hidden = true;
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(form)));
      form.reset();
    } catch (err) {
      erroEl.textContent = err.message;
      erroEl.hidden = false;
    } finally {
      botao.disabled = false;
    }
  });
}

async function entrar(email, senha) {
  const { access_token } = await api.login(email, senha);
  api.setToken(access_token);
  await iniciar();
}

// ---------------------------------------------------------------------
// Grêmios
// ---------------------------------------------------------------------
async function carregarGremios(selecionarId) {
  state.gremios = await api.listarGremios();
  const desejado = selecionarId ?? Number(localStorage.getItem('elo_gremio'));
  const g = state.gremios.find((x) => x.id === desejado) ?? state.gremios[0];
  if (g) {
    await selecionarGremio(g.id);
  } else {
    state.gremio = null;
    state.canais = [];
    state.canal = null;
    pararPolling();
    renderTudo();
  }
}

async function selecionarGremio(id) {
  const seq = ++seqGremio;
  ++seqCanal;
  pararPolling();
  state.gremio = state.gremios.find((g) => g.id === id);
  localStorage.setItem('elo_gremio', id);
  state.canal = null;
  state.mensagens = [];
  state.membros = [];
  state.cargos = [];
  document.querySelector('.app').classList.remove('nav-open');
  renderRail();

  try {
    const [perms, canais] = await Promise.all([api.minhasPermissoes(id), api.listarCanais(id)]);
    if (seq !== seqGremio) return;
    state.perms = perms;
    state.canais = canais;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  renderTudo();
  carregarMembros(seq);

  const ultimo = Number(localStorage.getItem(`elo_canal_${id}`));
  const c = state.canais.find((x) => x.id === ultimo) ?? state.canais[0];
  if (c) await selecionarCanal(c.id);
}

async function novoGremio() {
  let criado;
  const ok = await formDialog({
    titulo: 'Criar grêmio',
    texto: 'Você será o fundador. O grêmio já nasce com o canal #geral e os cargos Membro e Administrador.',
    fields: [{ name: 'nome', label: 'Nome do grêmio', required: true, min: 2, max: 255 }],
    enviar: 'Criar grêmio',
    onSubmit: async (v) => {
      criado = await api.criarGremio(v.nome);
    },
  });
  if (ok) await carregarGremios(criado.id);
}

async function sairDoGremio() {
  const ok = await confirmar(
    `Sair de ${state.gremio.nome}?`,
    'Você perde o acesso aos canais deste grêmio.',
    'Sair do grêmio'
  );
  if (!ok) return;
  try {
    await api.removerMembro(state.gremio.id, state.me.id);
    await carregarGremios();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------
async function recarregarCanais() {
  state.canais = await api.listarCanais(state.gremio.id);
  renderSidebar();
}

async function selecionarCanal(id) {
  const seq = ++seqCanal;
  pararPolling();
  state.canal = state.canais.find((c) => c.id === id);
  state.mensagens = [];
  state.temMais = false;
  state.editandoId = null;
  state.canalPerms = [];
  state.carregando = true;
  localStorage.setItem(`elo_canal_${state.gremio.id}`, id);
  document.querySelector('.app').classList.remove('nav-open');
  renderSidebar();
  renderChat();

  try {
    const detalhe = await api.obterCanal(id);
    if (seq !== seqCanal) return;
    state.canal = detalhe;
    state.canalPerms = detalhe.minhas_permissoes ?? [];

    if (podeCanal('LER_HISTORICO')) {
      const msgs = await api.listarMensagens(id, { limite: LIMITE });
      if (seq !== seqCanal) return;
      state.mensagens = msgs;
      state.temMais = msgs.length === LIMITE;
    }
  } catch (err) {
    if (seq !== seqCanal) return;
    state.carregando = false;
    toast(err.message, 'error');
    if (err.status === 404) {
      // Canal removido ou ficou privado: atualiza a lista.
      await recarregarCanais();
      state.canal = null;
      renderChat();
    }
    return;
  }

  state.carregando = false;
  renderChat();
  iniciarPolling();
}

async function novoCanal() {
  let criado;
  const ok = await formDialog({
    titulo: 'Novo canal',
    fields: [
      { name: 'nome', label: 'Nome', required: true, max: 100, placeholder: 'avisos' },
      { name: 'descricao', label: 'Descrição', max: 255 },
    ],
    enviar: 'Criar canal',
    onSubmit: async (v) => {
      criado = await api.criarCanal(state.gremio.id, { nome: v.nome, descricao: v.descricao || null });
    },
  });
  if (!ok) return;
  await recarregarCanais();
  await selecionarCanal(criado.id);
}

async function editarCanal() {
  const c = state.canal;
  const ok = await formDialog({
    titulo: 'Editar canal',
    fields: [
      { name: 'nome', label: 'Nome', required: true, max: 100, value: c.nome },
      { name: 'descricao', label: 'Descrição', max: 255, value: c.descricao ?? '' },
    ],
    onSubmit: async (v) => {
      await api.atualizarCanal(c.id, { nome: v.nome, descricao: v.descricao || null });
    },
  });
  if (!ok) return;
  await recarregarCanais();
  await selecionarCanal(c.id);
}

async function excluirCanalAtual() {
  const c = state.canal;
  const ok = await confirmar(
    `Excluir #${c.nome}?`,
    'Todas as mensagens deste canal serão apagadas. Não dá para desfazer.',
    'Excluir canal'
  );
  if (!ok) return;
  try {
    await api.excluirCanal(c.id);
    await recarregarCanais();
    state.canal = null;
    if (state.canais[0]) await selecionarCanal(state.canais[0].id);
    else renderChat();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------
function iniciarPolling() {
  pararPolling();
  state.pollTimer = setInterval(buscarNovas, POLL_MS);
}

function pararPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function buscarNovas() {
  if (document.hidden || !state.canal || !podeCanal('LER_HISTORICO')) return;
  const id = state.canal.id;
  const ultimo = state.mensagens.length ? state.mensagens[state.mensagens.length - 1].id : null;
  try {
    const novas = await api.listarMensagens(id, { limite: 100, depois_de: ultimo });
    if (!state.canal || state.canal.id !== id) return;
    adicionarMensagens(novas);
  } catch {
    /* falha momentânea de rede: tenta de novo no próximo ciclo */
  }
}

function adicionarMensagens(novas) {
  const existentes = new Set(state.mensagens.map((m) => m.id));
  const realmente = novas.filter((m) => !existentes.has(m.id));
  if (!realmente.length) return;
  state.mensagens.push(...realmente);
  renderMensagens('auto');
}

async function enviarMensagem() {
  const campo = $('#composer-input');
  const texto = campo.value.trim();
  if (!texto || !state.canal) return;
  campo.disabled = true;
  try {
    const m = await api.enviarMensagem(state.canal.id, texto);
    campo.value = '';
    campo.style.height = '';
    adicionarMensagens([m]);
    renderMensagens('fim');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    campo.disabled = false;
    campo.focus();
  }
}

async function carregarAnteriores() {
  const primeiro = state.mensagens[0];
  if (!primeiro) return;
  try {
    const antigas = await api.listarMensagens(state.canal.id, { limite: LIMITE, antes_de: primeiro.id });
    state.temMais = antigas.length === LIMITE;
    state.mensagens = [...antigas, ...state.mensagens];
    renderMensagens('topo');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function salvarEdicao(m, texto) {
  texto = texto.trim();
  state.editandoId = null;
  if (!texto || texto === m.conteudo) return renderMensagens('manter');
  try {
    const atualizada = await api.editarMensagem(state.canal.id, m.id, texto);
    const i = state.mensagens.findIndex((x) => x.id === m.id);
    if (i >= 0) state.mensagens[i] = atualizada;
  } catch (err) {
    toast(err.message, 'error');
  }
  renderMensagens('manter');
}

async function apagarMensagem(m) {
  const ok = await confirmar('Apagar mensagem?', 'Esta ação não pode ser desfeita.', 'Apagar');
  if (!ok) return;
  try {
    await api.apagarMensagem(state.canal.id, m.id);
    state.mensagens = state.mensagens.filter((x) => x.id !== m.id);
    renderMensagens('manter');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------
// Membros e cargos
// ---------------------------------------------------------------------
async function carregarMembros(seq = seqGremio) {
  try {
    const [membros, cargos] = await Promise.all([
      api.listarMembros(state.gremio.id),
      api.listarCargos(state.gremio.id),
    ]);
    if (seq !== seqGremio) return;
    state.membros = membros;
    state.cargos = cargos;
    renderMembros();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function adicionarMembro() {
  const ok = await formDialog({
    titulo: 'Adicionar membro',
    texto: 'Peça o ID da pessoa: ele aparece no canto inferior esquerdo, abaixo do nome dela.',
    fields: [{ name: 'usuario_id', label: 'ID do usuário', type: 'number', required: true, min: 1 }],
    enviar: 'Adicionar',
    onSubmit: (v) => api.adicionarMembro(state.gremio.id, v.usuario_id),
  });
  if (ok) {
    toast('Membro adicionado.', 'success');
    carregarMembros();
  }
}

async function removerMembro(m) {
  const ok = await confirmar(`Remover ${m.nome ?? 'membro'}?`, 'A pessoa perde o acesso ao grêmio.', 'Remover');
  if (!ok) return;
  try {
    await api.removerMembro(state.gremio.id, m.usuario_id);
    carregarMembros();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function darCargo(m) {
  const disponiveis = state.cargos.filter((c) => !c.padrao && !m.cargos_ids.includes(c.id));
  if (!disponiveis.length) return toast('Não há outros cargos para atribuir.', 'info');
  const ok = await formDialog({
    titulo: `Cargo para ${m.nome ?? 'membro'}`,
    fields: [{ name: 'cargo', label: 'Cargo', type: 'select', options: disponiveis.map((c) => ({ value: c.id, label: c.nome })) }],
    enviar: 'Atribuir',
    onSubmit: (v) => api.atribuirCargo(state.gremio.id, m.usuario_id, Number(v.cargo)),
  });
  if (ok) carregarMembros();
}

async function tirarCargo(m, cargo) {
  try {
    await api.removerCargoDoMembro(state.gremio.id, m.usuario_id, cargo.id);
    carregarMembros();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const opcoesPermissao = () => Object.entries(PERMISSOES).map(([value, label]) => ({ value, label }));

async function formCargo(cargo) {
  const novo = !cargo;
  const fields = [
    { name: 'nome', label: 'Nome', required: true, min: 2, max: 50, value: cargo?.nome ?? '' },
    { name: 'cor', label: 'Cor', type: 'color', value: cargo?.cor ?? '#99AAB5' },
  ];
  if (!cargo?.padrao) {
    fields.push({
      name: 'prioridade', label: 'Prioridade (1–1000)', type: 'number', required: true, min: 1, max: 1000,
      value: cargo?.prioridade ?? 10,
    });
  }
  fields.push({ name: 'permissoes', label: 'Permissões', type: 'checks', options: opcoesPermissao(), value: cargo?.permissoes ?? [] });

  return formDialog({
    titulo: novo ? 'Novo cargo' : `Editar ${cargo.nome}`,
    texto: 'Cargos com prioridade maior ficam acima na hierarquia. Você só gerencia cargos abaixo do seu.',
    fields,
    enviar: novo ? 'Criar cargo' : 'Salvar',
    onSubmit: async (v) => {
      const dados = { nome: v.nome, cor: v.cor.toUpperCase(), permissoes: v.permissoes };
      if (v.prioridade !== undefined) dados.prioridade = v.prioridade;
      if (novo) await api.criarCargo(state.gremio.id, dados);
      else await api.atualizarCargo(state.gremio.id, cargo.id, dados);
    },
  });
}

function abrirCargos() {
  const corpo = h('div', { class: 'cargos' });
  openModal('Cargos', corpo, { largo: true });

  async function desenhar() {
    try {
      state.cargos = await api.listarCargos(state.gremio.id);
    } catch (err) {
      return toast(err.message, 'error');
    }
    const gerencia = podeGremio('GERENCIAR_CARGOS');
    clear(corpo);
    if (gerencia) {
      corpo.append(
        h('div', { class: 'cargos-top' },
          h('button', {
            class: 'btn primary', type: 'button',
            onclick: async () => { if (await formCargo(null)) { desenhar(); carregarMembros(); } },
          }, 'Novo cargo'))
      );
    }
    const lista = [...state.cargos].sort((a, b) => b.prioridade - a.prioridade);
    corpo.append(
      h('ul', { class: 'cargo-list' }, lista.map((c) =>
        h('li', { class: 'cargo-item' },
          h('span', { class: 'dot', style: { background: c.cor } }),
          h('div', { class: 'cargo-info' },
            h('strong', {}, c.nome, c.padrao ? h('span', { class: 'badge' }, 'todos') : null),
            h('span', { class: 'muted' },
              c.permissoes.length ? c.permissoes.map((p) => PERMISSOES[p] ?? p).join(', ') : 'Sem permissões'),
          ),
          h('span', { class: 'muted prio' }, c.padrao ? '' : `prioridade ${c.prioridade}`),
          gerencia
            ? h('div', { class: 'row-actions' },
                h('button', {
                  class: 'btn ghost sm', type: 'button',
                  onclick: async () => { if (await formCargo(c)) { desenhar(); carregarMembros(); } },
                }, 'Editar'),
                c.padrao ? null : h('button', {
                  class: 'btn ghost sm danger-text', type: 'button',
                  onclick: async () => {
                    if (!(await confirmar(`Excluir o cargo ${c.nome}?`, 'Quem o tem perde as permissões dele.', 'Excluir'))) return;
                    try { await api.excluirCargo(state.gremio.id, c.id); desenhar(); carregarMembros(); }
                    catch (err) { toast(err.message, 'error'); }
                  },
                }, 'Excluir'))
            : null)
      ))
    );
  }
  desenhar();
}

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------
function renderTudo() {
  renderRail();
  renderSidebar();
  renderChat();
  renderMembros();
}

function renderUsuario() {
  const me = state.me;
  clear($('#user-box')).append(
    h('span', { class: 'avatar', style: { background: colorFor(me.id) } }, initials(me.nome)),
    h('div', { class: 'user-info' },
      h('strong', {}, me.nome),
      h('button', {
        class: 'link-btn', type: 'button', title: 'Copiar ID',
        onclick: () => navigator.clipboard?.writeText(String(me.id)).then(() => toast('ID copiado.', 'success')),
      }, `ID ${me.id}`)),
    h('button', { class: 'icon-btn', type: 'button', title: 'Sair da conta', 'aria-label': 'Sair da conta', onclick: () => sair() }, 'Sair')
  );
}

function renderRail() {
  const rail = clear($('#rail'));
  rail.append(h('div', { class: 'rail-logo', 'aria-hidden': 'true' }, 'elo'));
  state.gremios.forEach((g) =>
    rail.append(
      h('button', {
        class: `rail-item${state.gremio?.id === g.id ? ' active' : ''}`,
        type: 'button', title: g.nome, 'aria-label': g.nome,
        onclick: () => selecionarGremio(g.id),
      }, initials(g.nome))
    )
  );
  rail.append(h('button', { class: 'rail-item add', type: 'button', title: 'Criar grêmio', 'aria-label': 'Criar grêmio', onclick: novoGremio }, '+'));
}

function renderSidebar() {
  const head = clear($('#sidebar-head'));
  const lista = clear($('#channel-list'));

  if (!state.gremio) {
    head.append(h('strong', {}, 'ELO'));
    lista.append(h('p', { class: 'muted pad' }, 'Você ainda não participa de nenhum grêmio.'));
    return;
  }

  head.append(h('strong', { class: 'truncate', title: state.gremio.nome }, state.gremio.nome));

  lista.append(
    h('div', { class: 'section-title' },
      h('span', {}, 'Canais'),
      podeGremio('GERENCIAR_CANAIS')
        ? h('button', { class: 'icon-btn', type: 'button', title: 'Novo canal', 'aria-label': 'Novo canal', onclick: novoCanal }, '+')
        : null)
  );

  if (!state.canais.length) lista.append(h('p', { class: 'muted pad' }, 'Nenhum canal disponível para você.'));

  state.canais.forEach((c) =>
    lista.append(
      h('button', {
        class: `channel${state.canal?.id === c.id ? ' active' : ''}`,
        type: 'button', onclick: () => selecionarCanal(c.id),
      }, h('span', { class: 'hash' }, '#'), h('span', { class: 'truncate' }, c.nome))
    )
  );

  lista.append(h('button', { class: 'link-btn leave', type: 'button', onclick: sairDoGremio }, 'Sair do grêmio'));
}

function renderChat() {
  const chat = clear($('#chat'));

  if (!state.gremio) {
    chat.append(
      h('div', { class: 'empty' },
        h('h2', {}, 'Comece criando um grêmio'),
        h('p', { class: 'muted' }, 'Ou peça a alguém para adicionar você usando o seu ID.'),
        h('button', { class: 'btn primary', type: 'button', onclick: novoGremio }, 'Criar grêmio'))
    );
    return;
  }

  const c = state.canal;
  const menu = h('button', {
    class: 'btn ghost sm nav-toggle', type: 'button',
    onclick: () => document.querySelector('.app').classList.toggle('nav-open'),
  }, 'Menu');

  if (!c) {
    chat.append(
      h('header', { class: 'chat-head' }, menu),
      h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'Selecione um canal para começar a conversar.'))
    );
    return;
  }

  chat.append(
    h('header', { class: 'chat-head' },
      menu,
      h('div', { class: 'chat-title' },
        h('h2', {}, h('span', { class: 'hash' }, '#'), c.nome),
        c.descricao ? h('p', { class: 'muted truncate' }, c.descricao) : null),
      h('div', { class: 'row-actions' },
        podeGremio('GERENCIAR_CANAIS') ? h('button', { class: 'btn ghost sm', type: 'button', onclick: editarCanal }, 'Editar canal') : null,
        podeGremio('GERENCIAR_CANAIS') ? h('button', { class: 'btn ghost sm danger-text', type: 'button', onclick: excluirCanalAtual }, 'Excluir') : null,
        h('button', {
          class: 'btn ghost sm', type: 'button', 'aria-pressed': state.membrosAberto,
          onclick: alternarMembros,
        }, 'Membros'))
    ),
    h('div', { class: 'messages', id: 'msg-list', role: 'log', 'aria-live': 'polite' }),
    renderComposer()
  );
  renderMensagens('fim');
}

function renderComposer() {
  const pode = !state.carregando && podeCanal('ENVIAR_MENSAGENS');
  const campo = h('textarea', {
    id: 'composer-input', rows: 1, maxlength: 4000, disabled: !pode,
    placeholder: state.carregando ? '' : pode ? `Mensagem em #${state.canal.nome}` : 'Você não tem permissão para enviar mensagens aqui.',
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        enviarMensagem();
      }
    },
    oninput: (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
    },
  });
  return h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); enviarMensagem(); } },
    campo,
    h('button', { class: 'btn primary', type: 'submit', disabled: !pode }, 'Enviar'));
}

/**
 * modo: 'fim'   → rola até a última mensagem
 *       'auto'  → rola só se o usuário já estava perto do fim
 *       'topo'  → mantém a posição após carregar mensagens antigas
 *       'manter'→ mantém o scroll
 */
function renderMensagens(modo = 'manter') {
  const box = $('#msg-list');
  if (!box) return;
  const alturaAntes = box.scrollHeight;
  const topoAntes = box.scrollTop;
  const colado = alturaAntes - topoAntes - box.clientHeight < 80;

  clear(box);

  if (state.carregando) {
    box.append(h('p', { class: 'muted pad center' }, 'Carregando mensagens…'));
    return;
  }

  if (!podeCanal('LER_HISTORICO')) {
    box.append(h('p', { class: 'muted pad center' }, 'Você não tem permissão para ler o histórico deste canal.'));
    return;
  }

  if (state.temMais) {
    box.append(h('button', { class: 'btn ghost sm more', type: 'button', onclick: carregarAnteriores }, 'Carregar mensagens anteriores'));
  }

  if (!state.mensagens.length) {
    box.append(
      h('div', { class: 'empty small' },
        h('h3', {}, `Este é o começo de #${state.canal.nome}`),
        h('p', { class: 'muted' }, 'Nenhuma mensagem ainda.'))
    );
    return;
  }

  let anterior = null;
  for (const m of state.mensagens) {
    const dia = new Date(m.criada_em).toDateString();
    const novoDia = !anterior || new Date(anterior.criada_em).toDateString() !== dia;
    if (novoDia) box.append(h('div', { class: 'day' }, h('span', {}, formatDia(m.criada_em))));
    const agrupa =
      !novoDia && anterior.autor_id === m.autor_id &&
      new Date(m.criada_em) - new Date(anterior.criada_em) < 5 * 60 * 1000;
    box.append(mensagemEl(m, agrupa));
    anterior = m;
  }

  if (modo === 'fim' || (modo === 'auto' && colado)) box.scrollTop = box.scrollHeight;
  else if (modo === 'topo') box.scrollTop = box.scrollHeight - alturaAntes + topoAntes;
  else box.scrollTop = topoAntes;
}

function mensagemEl(m, agrupada) {
  const minha = m.autor_id === state.me.id;
  const podeEditar = minha && podeCanal('ENVIAR_MENSAGENS');
  const podeApagar = minha || podeCanal('GERENCIAR_MENSAGENS');
  const nome = m.autor_nome ?? `Usuário ${m.autor_id}`;
  const editando = state.editandoId === m.id;

  let corpo;
  if (editando) {
    const ta = h('textarea', {
      class: 'edit-input', rows: 2, maxlength: 4000, value: m.conteudo,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); salvarEdicao(m, ta.value); }
        if (e.key === 'Escape') { state.editandoId = null; renderMensagens('manter'); }
      },
    });
    corpo = h('div', {},
      ta,
      h('div', { class: 'edit-hint muted' }, 'Enter para salvar · Esc para cancelar'));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  } else {
    corpo = h('p', { class: 'text' }, m.conteudo, m.editada_em ? h('span', { class: 'edited', title: formatTime(m.editada_em) }, ' (editada)') : null);
  }

  return h('article', { class: `msg${agrupada ? ' grouped' : ''}${minha ? ' mine' : ''}` },
    agrupada
      ? h('span', { class: 'avatar-gap' })
      : h('span', { class: 'avatar', style: { background: colorFor(m.autor_id) }, 'aria-hidden': 'true' }, initials(nome)),
    h('div', { class: 'msg-body' },
      agrupada ? null : h('div', { class: 'msg-meta' }, h('strong', {}, nome), h('time', { class: 'muted', datetime: m.criada_em }, formatTime(m.criada_em))),
      corpo),
    !editando && (podeEditar || podeApagar)
      ? h('div', { class: 'msg-actions' },
          podeEditar ? h('button', { class: 'link-btn', type: 'button', onclick: () => { state.editandoId = m.id; renderMensagens('manter'); } }, 'Editar') : null,
          podeApagar ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: () => apagarMensagem(m) }, 'Apagar') : null)
      : null
  );
}

function alternarMembros() {
  state.membrosAberto = !state.membrosAberto;
  localStorage.setItem('elo_membros', state.membrosAberto ? '1' : '0');
  renderMembros();
  const btn = document.querySelector('.chat-head [aria-pressed]');
  if (btn) btn.setAttribute('aria-pressed', state.membrosAberto);
}

function renderMembros() {
  const painel = clear($('#members'));
  painel.hidden = !state.membrosAberto || !state.gremio;
  if (painel.hidden) return;

  const cargosPorId = new Map(state.cargos.map((c) => [c.id, c]));
  const gerCargos = podeGremio('GERENCIAR_CARGOS');
  const gerMembros = podeGremio('GERENCIAR_MEMBROS');

  painel.append(
    h('div', { class: 'section-title' },
      h('span', {}, `Membros (${state.membros.length})`),
      gerMembros ? h('button', { class: 'icon-btn', type: 'button', title: 'Adicionar membro', 'aria-label': 'Adicionar membro', onclick: adicionarMembro }, '+') : null),
    h('button', { class: 'btn ghost sm block', type: 'button', onclick: abrirCargos }, 'Ver cargos')
  );

  const ordenados = [...state.membros].sort((a, b) => (b.fundador - a.fundador) || String(a.nome).localeCompare(String(b.nome)));

  painel.append(
    h('ul', { class: 'member-list' }, ordenados.map((m) => {
      const nome = m.nome ?? `Usuário ${m.usuario_id}`;
      const cargos = m.cargos_ids.map((id) => cargosPorId.get(id)).filter((c) => c && !c.padrao);
      const podeMexer = !m.fundador;
      return h('li', { class: 'member' },
        h('span', { class: 'avatar sm', style: { background: colorFor(m.usuario_id) } }, initials(nome)),
        h('div', { class: 'member-info' },
          h('strong', { class: 'truncate' }, nome, m.fundador ? h('span', { class: 'badge' }, 'fundador') : null, m.usuario_id === state.me.id ? h('span', { class: 'muted' }, ' (você)') : null),
          h('div', { class: 'chips' },
            cargos.map((c) =>
              h('span', { class: 'chip' },
                h('span', { class: 'dot', style: { background: c.cor } }), c.nome,
                gerCargos && podeMexer
                  ? h('button', { class: 'chip-x', type: 'button', title: `Remover cargo ${c.nome}`, 'aria-label': `Remover cargo ${c.nome}`, onclick: () => tirarCargo(m, c) }, '×')
                  : null)),
            gerCargos && podeMexer
              ? h('button', { class: 'chip add', type: 'button', onclick: () => darCargo(m) }, '+ cargo')
              : null)),
        gerMembros && podeMexer && m.usuario_id !== state.me.id
          ? h('button', { class: 'link-btn danger-text', type: 'button', onclick: () => removerMembro(m) }, 'Remover')
          : null
      );
    }))
  );
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
ligarAuth();

// No celular, tocar fora do menu lateral o fecha.
$('#chat').addEventListener('click', (e) => {
  if (!e.target.closest('.nav-toggle')) document.querySelector('.app').classList.remove('nav-open');
});

if (api.hasToken()) {
  iniciar().catch((err) => {
    // Token inválido/expirado ou API fora do ar.
    if (err.status === 0) {
      mostrarAuth();
      toast(err.message, 'error');
    } else {
      sair();
    }
  });
} else {
  mostrarAuth();
}
