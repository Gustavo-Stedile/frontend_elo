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
  enquetes: [],
  comunicados: [],
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
  secoesLaterais: {
    canais: localStorage.getItem('elo_secao_canais') !== '0',
    comunicados: localStorage.getItem('elo_secao_comunicados') === '1',
    enquetes: localStorage.getItem('elo_secao_enquetes') === '1',
  },
  cacheLateral: {
    enquetes: new Set(),
    comunicados: new Set(),
  },
  requisicoesLaterais: {
    enquetes: new Map(),
    comunicados: new Map(),
  },
};

// Descarta respostas atrasadas quando o usuário já navegou para outro lugar.
let seqGremio = 0;
let seqCanal = 0;

// ---------------------------------------------------------------------
// Permissões (só controlam o que a UI mostra; quem decide é o servidor)
// ---------------------------------------------------------------------
const ehAdmin = () =>
  state.perms.fundador || state.perms.permissoes.includes('ADMINISTRADOR');
const temPermissaoObjeto = (codigo, tipo, id) =>
  (state.perms.permissoes_objeto ?? []).some((p) =>
    p.codigo === codigo &&
    (tipo === undefined || p.recurso_tipo === tipo) &&
    (id === undefined || p.recurso_id === id)
  );
const podeGremio = (p) =>
  ehAdmin() ||
  state.perms.permissoes.includes(p) ||
  temPermissaoObjeto(p, 'GREMIO', state.gremio?.id);
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

  const cpfInput = $('#cad-cpf');
  cpfInput.addEventListener('input', () => {
    cpfInput.value = cpfInput.value
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
      .slice(0, 14);
  });

  const raInput = $('#cad-ra');
  raInput.addEventListener('blur', async () => {
    const info = $('#cad-ra-dados');
    info.textContent = '';
    if (!raInput.value.trim()) return;
    try {
      const dados = await api.resolverRA(raInput.value.trim());
      if (dados.instituicao) {
        info.textContent = `Instituição: ${dados.instituicao} · Etapa: ${dados.etapa_ensino}`;
      }
    } catch (err) {
      info.textContent = '';
    }
  });

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
    const dados = {
      nome: d.nome,
      email: d.email,
      cpf: d.cpf.replace(/\D/g, ''),
      senha: d.senha,
    };
    if (d.ra) dados.ra = d.ra;
    const resultado = await api.cadastrar(dados);
    await entrar(d.email, d.senha);
    const usuario = resultado.usuario;
    if (usuario.instituicao && usuario.etapa_ensino) {
      toast(`Conta criada e vinculada a ${usuario.instituicao}, etapa ${usuario.etapa_ensino}.`, 'success');
    } else {
      toast('Conta criada. Bem-vindo ao ELO!', 'success');
    }
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
  state.enquetes = [];
  state.comunicados = [];
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

function podeCriarGremio() {
  if (!state.me?.ra) return false;

  const instituicao = state.me.instituicao || 'IFSP';
  const etapa = Number(state.me.etapa_ensino || 3);
  return !state.gremios.some((g) =>
    g.instituicao === instituicao && Number(g.etapa_ensino) === etapa
  );
}

async function novoGremio() {
  if (!state.me?.ra) {
    toast('Cadastre um RA antes de criar um grêmio.', 'error');
    return;
  }

  let criado;
  const etapa = state.me.etapa_ensino === 1
    ? 'Ensino Fundamental'
    : state.me.etapa_ensino === 2
      ? 'Ensino Médio'
      : 'Ensino Superior';
  const ok = await formDialog({
    titulo: 'Criar grêmio',
    texto: `Você será o fundador. Instituição: ${state.me.instituicao || 'IFSP'} · Etapa: ${etapa}. O grêmio já nasce com o canal #geral e os cargos Membro e Administrador.`,
    fields: [{ name: 'nome', label: 'Nome do grêmio', required: true, min: 2, max: 255 }],
    enviar: 'Criar grêmio',
    onSubmit: async (v) => {
      criado = await api.criarGremio(v.nome);
    },
  });
  if (ok) await carregarGremios(criado.id);
}

async function editarGremio() {
  const campos = [];
  const podeNome = podeGremio('GREMIO_EDITAR_NOME');
  const podeDescricao = podeGremio('GREMIO_EDITAR_DESCRICAO');
  if (podeNome) {
    campos.push({
      name: 'nome',
      label: 'Nome',
      required: true,
      min: 2,
      max: 255,
      value: state.gremio.nome,
    });
  }
  if (podeDescricao) {
    campos.push({
      name: 'descricao',
      label: 'Descrição',
      type: 'textarea',
      max: 1000,
      value: state.gremio.descricao ?? '',
    });
  }
  const ok = await formDialog({
    titulo: 'Editar grêmio',
    texto: state.canal && (ehAdmin() || temPermissaoObjeto(
      'CANAL_GERENCIAR_PERMISSOES', 'CANAL', state.canal.id
    )) ? 'Edite os dados do grêmio ou gerencie as permissões do canal selecionado.' : undefined,
    fields: campos,
    enviar: campos.length ? 'Salvar' : 'Fechar',
    acoes: state.canal && (ehAdmin() || temPermissaoObjeto(
      'CANAL_GERENCIAR_PERMISSOES', 'CANAL', state.canal.id
    )) ? [{
      rotulo: 'Permissões',
      executar: editarPermissoesCanal,
    }] : [],
    onSubmit: async (valores) => {
      if (!campos.length) return;
      const atualizado = await api.atualizarGremio(state.gremio.id, {
        ...(podeNome ? { nome: valores.nome } : {}),
        ...(podeDescricao ? { descricao: valores.descricao } : {}),
      });
      state.gremio = { ...state.gremio, ...atualizado };
      state.gremios = state.gremios.map((g) =>
        g.id === state.gremio.id ? state.gremio : g
      );
    },
  });
  if (ok) renderTudo();
}

// ---------------------------------------------------------------------
// Enquetes e comunicados
// ---------------------------------------------------------------------
async function abrirEnquetes() {
  const corpo = h('div', { class: 'cargos' });
  const modal = openModal('Enquetes', corpo, { largo: true });

  try {
    await carregarEnquetes();
  } catch (err) {
    return toast(err.message, 'error');
  }

  const podeCriar = podeGremio('GREMIO_CRIAR_ENQUETE') ||
    (state.canal && temPermissaoObjeto(
      'CANAL_CRIAR_ENQUETE', 'CANAL', state.canal.id
    ));
  if (podeCriar) {
    corpo.append(h('div', { class: 'cargos-top' },
      h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: () => criarEnquete(modal.close),
      }, 'Nova enquete')));
  }

  if (!state.enquetes.length) {
    corpo.append(h('p', { class: 'muted pad center' }, 'Nenhuma enquete.'));
    return;
  }

  state.enquetes.forEach((enquete) => {
    const nomeCanal = state.canais.find((canal) =>
      canal.id === enquete.canal_id
    )?.nome;
    const escopo = enquete.canal_id ? `#${nomeCanal ?? enquete.canal_id}` : 'Grêmio';
    const item = h('div', { class: 'cargo-item' },
      h('div', { class: 'cargo-info' },
        h('strong', {}, enquete.pergunta),
        h('span', { class: 'muted' },
          `${escopo} · ${enquete.tipo_votacao === 'MULTIPLA' ? 'Escolha múltipla' : 'Escolha única'} · ${enquete.votos_visiveis ? 'Votos visíveis' : 'Votos ocultos'}`)));

    const podeVotar = temPermissaoObjeto('ENQUETE_VOTAR', 'ENQUETE', enquete.id);
    if (podeVotar) {
      item.append(h('button', {
        class: 'btn primary sm',
        type: 'button',
        onclick: () => votarEnquete(enquete, modal.close),
      }, 'Votar'));
    }
    enquete.opcoes.forEach((opcao) => {
      item.append(h('div', { class: 'poll-option' },
        h('span', {}, opcao.texto, enquete.votos_visiveis && opcao.votos !== null
          ? ` (${opcao.votos})`
          : ''),
        enquete.votos_visiveis && opcao.participantes?.length
          ? h('span', { class: 'muted' }, `Participantes: ${opcao.participantes.join(', ')}`)
          : null));
    });
    corpo.append(item);
  });
}

async function votarEnquete(enquete, fecharModal) {
  const fields = [{
    name: 'opcoes',
    label: 'Selecione suas opções',
    type: 'checks',
    options: enquete.opcoes.map((opcao) => ({
      value: String(opcao.id),
      label: opcao.texto,
    })),
  }];
  const ok = await formDialog({
    titulo: 'Votar na enquete',
    texto: enquete.tipo_votacao === 'MULTIPLA'
      ? 'Você pode escolher mais de uma opção.'
      : 'Escolha uma opção.',
    fields,
    enviar: 'Registrar voto',
    onSubmit: async ({ opcoes }) => {
      if (!opcoes.length) throw new Error('Selecione ao menos uma opção.');
      if (enquete.tipo_votacao === 'UNICA' && opcoes.length !== 1) {
        throw new Error('Esta enquete permite escolher apenas uma opção.');
      }
      await api.votarEnquete(
        state.gremio.id,
        enquete.id,
        opcoes.map(Number)
      );
    },
  });
  if (ok) {
    fecharModal();
    abrirEnquetes();
  }
}

async function criarEnquete(fecharModal) {
  const escopos = [];
  if (podeGremio('GREMIO_CRIAR_ENQUETE')) {
    escopos.push({ value: 'GREMIO', label: 'No grêmio' });
  }
  if (state.canal && temPermissaoObjeto(
    'CANAL_CRIAR_ENQUETE', 'CANAL', state.canal.id
  )) {
    escopos.push({ value: 'CANAL', label: `No canal #${state.canal.nome}` });
  }
  const ok = await formDialog({
    titulo: 'Nova enquete',
    fields: [
      { name: 'pergunta', label: 'Pergunta', required: true, max: 255 },
      { name: 'opcao1', label: 'Opção 1', required: true, max: 255 },
      { name: 'opcao2', label: 'Opção 2', required: true, max: 255 },
      { name: 'opcao3', label: 'Opção 3', required: false, max: 255 },
      ...(escopos.length > 1 ? [{
        name: 'escopo',
        label: 'Onde publicar',
        type: 'select',
        options: escopos,
        value: escopos[0].value,
      }] : []),
      { name: 'tipo_votacao', label: 'Tipo', type: 'select', options: [
        { value: 'UNICA', label: 'Escolha única' },
        { value: 'MULTIPLA', label: 'Escolha múltipla' },
      ] },
      { name: 'votos_visiveis', label: 'Mostrar participantes e votos', type: 'checkbox', value: true },
    ],
    enviar: 'Criar enquete',
    onSubmit: async (v) => {
      const opcoes = [v.opcao1, v.opcao2, v.opcao3].filter(Boolean);
      const escopo = escopos.length === 1 ? escopos[0].value : v.escopo;
      if (escopo === 'CANAL') {
        await api.criarEnqueteCanal(state.canal.id, {
          pergunta: v.pergunta,
          opcoes,
          tipo_votacao: v.tipo_votacao,
          votos_visiveis: v.votos_visiveis,
        });
      } else {
        await api.criarEnqueteGremio(state.gremio.id, {
          pergunta: v.pergunta,
          opcoes,
          tipo_votacao: v.tipo_votacao,
          votos_visiveis: v.votos_visiveis,
        });
      }
      state.cacheLateral.enquetes.clear();
    },
  });
  if (ok) {
    fecharModal();
    abrirEnquetes();
  }
}

async function abrirComunicados() {
  const corpo = h('div', { class: 'cargos' });
  const modal = openModal('Comunicados', corpo, { largo: true });

  try {
    await carregarComunicados();
  } catch (err) {
    return toast(err.message, 'error');
  }

  const podeCriar = podeGremio('GREMIO_CRIAR_COMUNICADO') ||
    (state.canal && temPermissaoObjeto(
      'CANAL_CRIAR_COMUNICADO', 'CANAL', state.canal.id
    ));
  if (podeCriar) {
    corpo.append(h('div', { class: 'cargos-top' },
      h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: () => criarComunicado(modal.close),
      }, 'Novo comunicado')));
  }

  if (!state.comunicados.length) {
    corpo.append(h('p', { class: 'muted pad center' }, 'Nenhum comunicado válido.'));
    return;
  }

  state.comunicados.forEach((c) => {
    const nomeCanal = state.canais.find((canal) =>
      canal.id === c.canal_id
    )?.nome;
    const escopo = c.canal_id ? `#${nomeCanal ?? c.canal_id}` : 'Grêmio';
    corpo.append(
      h('div', { class: 'cargo-item' },
        h('div', { class: 'cargo-info' },
          h('strong', {}, c.titulo),
          h('span', {}, c.texto),
          h('span', { class: 'muted' },
            `${escopo} · ${c.autor_nome ?? 'Autor'} · válido até ${new Date(c.valido_ate).toLocaleString('pt-BR')}`)))
    );
  });
}

async function criarComunicado(fecharModal) {
  const escopos = [];
  if (podeGremio('GREMIO_CRIAR_COMUNICADO')) {
    escopos.push({ value: 'GREMIO', label: 'No grêmio' });
  }
  if (state.canal && temPermissaoObjeto(
    'CANAL_CRIAR_COMUNICADO', 'CANAL', state.canal.id
  )) {
    escopos.push({ value: 'CANAL', label: `No canal #${state.canal.nome}` });
  }
  const ok = await formDialog({
    titulo: 'Novo comunicado',
    fields: [
      { name: 'titulo', label: 'Título', required: true, max: 255 },
      { name: 'texto', label: 'Texto', type: 'textarea', required: true, max: 4000 },
      { name: 'valido_ate', label: 'Válido até', type: 'datetime-local', required: true },
      ...(escopos.length > 1 ? [{
        name: 'escopo',
        label: 'Onde publicar',
        type: 'select',
        options: escopos,
        value: escopos[0].value,
      }] : []),
    ],
    enviar: 'Publicar',
    onSubmit: async (v) => {
      const dados = {
        titulo: v.titulo,
        texto: v.texto,
        valido_ate: new Date(v.valido_ate).toISOString(),
      };
      const escopo = escopos.length === 1 ? escopos[0].value : v.escopo;
      if (escopo === 'CANAL') {
        await api.criarComunicadoCanal(state.canal.id, dados);
      } else {
        await api.criarComunicado(state.gremio.id, dados);
      }
      state.cacheLateral.comunicados.clear();
    },
  });
  if (ok) {
    fecharModal();
    abrirComunicados();
  }
}

async function carregarEnquetes() {
  if (!state.gremio) return;
  const gremioId = state.gremio.id;
  const canalId = state.canal?.id;
  const chave = `${gremioId}:${canalId ?? ''}`;
  if (state.cacheLateral.enquetes.has(chave)) return;
  const emAndamento = state.requisicoesLaterais.enquetes.get(chave);
  if (emAndamento) return emAndamento;

  const requisicao = (async () => {
    let enquetes;
    if (canalId) {
      const [doGremio, doCanal] = await Promise.all([
        api.listarEnquetesGremio(gremioId),
        api.listarEnquetesCanal(canalId),
      ]);
      enquetes = [...doGremio, ...doCanal];
    } else {
      enquetes = await api.listarEnquetesGremio(gremioId);
    }
    if (state.gremio?.id !== gremioId || state.canal?.id !== canalId) return;
    state.enquetes = enquetes;
    state.cacheLateral.enquetes.add(chave);
    renderSidebar();
  })();
  state.requisicoesLaterais.enquetes.set(chave, requisicao);
  try {
    await requisicao;
  } finally {
    state.requisicoesLaterais.enquetes.delete(chave);
  }
}

async function carregarComunicados() {
  if (!state.gremio) return;
  const gremioId = state.gremio.id;
  const canalId = state.canal?.id;
  const chave = `${gremioId}:${canalId ?? ''}`;
  if (state.cacheLateral.comunicados.has(chave)) return;
  const emAndamento = state.requisicoesLaterais.comunicados.get(chave);
  if (emAndamento) return emAndamento;

  const requisicao = (async () => {
    let comunicados;
    if (canalId) {
      const [doGremio, doCanal] = await Promise.all([
        api.listarComunicados(gremioId),
        api.listarComunicadosCanal(canalId),
      ]);
      comunicados = [...doGremio, ...doCanal];
    } else {
      comunicados = await api.listarComunicados(gremioId);
    }
    if (state.gremio?.id !== gremioId || state.canal?.id !== canalId) return;
    state.comunicados = comunicados;
    state.cacheLateral.comunicados.add(chave);
    renderSidebar();
  })();
  state.requisicoesLaterais.comunicados.set(chave, requisicao);
  try {
    await requisicao;
  } finally {
    state.requisicoesLaterais.comunicados.delete(chave);
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
  if (state.secoesLaterais.enquetes) carregarEnquetes().catch((err) => toast(err.message, 'error'));
  if (state.secoesLaterais.comunicados) carregarComunicados().catch((err) => toast(err.message, 'error'));
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
      criado = await api.criarCanal(state.gremio.id, {
        nome: v.nome,
        descricao: v.descricao || null,
      });
    },
  });
  if (!ok) return;
  await recarregarCanais();
  await selecionarCanal(criado.id);
}

async function editarCanal() {
  const c = state.canal;
  const podeEditar = ehAdmin() || temPermissaoObjeto('CANAL_EDITAR', 'CANAL', c.id);
  const podeExcluir = ehAdmin() || temPermissaoObjeto('CANAL_EXCLUIR', 'CANAL', c.id);
  const ok = await formDialog({
    titulo: 'Editar canal',
    texto: podeEditar ? undefined : 'Você pode excluir este canal, mas não editá-lo.',
    fields: podeEditar ? [
      { name: 'nome', label: 'Nome', required: true, max: 100, value: c.nome },
      { name: 'descricao', label: 'Descrição', max: 255, value: c.descricao ?? '' },
    ] : [],
    enviar: podeEditar ? 'Salvar' : 'Fechar',
    acoes: podeExcluir ? [{
      rotulo: 'Excluir canal',
      perigo: true,
      executar: excluirCanalAtual,
    }] : [],
    onSubmit: async (v) => {
      if (!podeEditar) return;
      await api.atualizarCanal(c.id, {
        nome: v.nome,
        descricao: v.descricao || null,
      });
    },
  });
  if (!ok) return;
  if (!podeEditar) return;
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
  const disponiveis = state.cargos.filter((c) =>
    !c.padrao && !m.cargos_ids.includes(c.id) && podeAtribuirCargo(c)
  );
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

const opcoesPermissao = () => Object.entries(PERMISSOES)
  .filter(([codigo]) => [
    'GERENCIAR_MEMBROS',
    'GERENCIAR_GREMIO',
    'ADMINISTRADOR',
  ].includes(codigo))
  .map(([value, label]) => ({ value, label }));
const podeEditarCargo = (cargo) =>
  ehAdmin() || temPermissaoObjeto('CARGO_EDITAR', 'CARGO', cargo.id);
const podeAtribuirCargo = (cargo) =>
  ehAdmin() || temPermissaoObjeto('CARGO_ATRIBUIR', 'CARGO', cargo.id);

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
    fields.push({
      name: 'max_ocupantes', label: 'Máximo de ocupantes (0 = sem limite)',
      type: 'number', required: true, min: 0, value: cargo?.max_ocupantes ?? 0,
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
      if (v.max_ocupantes !== undefined) dados.max_ocupantes = Number(v.max_ocupantes);
      if (novo) await api.criarCargo(state.gremio.id, dados);
      else await api.atualizarCargo(state.gremio.id, cargo.id, dados);
    },
  });
}

async function editarPermissoesCargo(cargo) {
  try {
    const permissoes = await api.listarPermissoesRelacionaisCargo(
      state.gremio.id,
      cargo.id
    );
    const editaveis = permissoes.filter((p) =>
      ehAdmin() || temPermissaoObjeto(p.codigo, p.recurso_tipo, p.recurso_id)
    );
    const marcadas = editaveis.filter((p) => p.concedida).map((p) => String(p.id));
    const ok = await formDialog({
      titulo: `Permissões de ${cargo.nome}`,
      texto: 'Selecione quais permissões este cargo concede aos seus membros.',
      fields: [{
        name: 'permissoes',
        label: 'Permissões disponíveis no grêmio',
        type: 'checks',
        value: marcadas,
        options: editaveis.map((p) => ({
          value: String(p.id),
          label: `${PERMISSOES[p.codigo] ?? p.nome} (${p.recurso_tipo}${p.recurso_tipo === 'GREMIO' ? '' : ` #${p.recurso_id}`})`,
        })),
      }],
      onSubmit: async ({ permissoes: selecionadas }) => {
        const antes = new Set(marcadas);
        const depois = new Set(selecionadas);
        await Promise.all([
          ...selecionadas.filter((id) => !antes.has(id)).map((id) =>
            api.concederPermissaoRelacionalCargo(state.gremio.id, cargo.id, Number(id))
          ),
          ...marcadas.filter((id) => !depois.has(id)).map((id) =>
            api.revogarPermissaoRelacionalCargo(state.gremio.id, cargo.id, Number(id))
          ),
        ]);
      },
    });
    if (ok) toast('Permissões atualizadas.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function editarPermissoesCanal() {
  try {
    const cargos = await api.listarCargos(state.gremio.id);
    if (!cargos.length) return;
    let cargoId;
    const escolhido = await formDialog({
      titulo: `Permissões de #${state.canal.nome}`,
      fields: [{
        name: 'cargo_id',
        label: 'Cargo',
        type: 'select',
        options: cargos.map((cargo) => ({ value: cargo.id, label: cargo.nome })),
      }],
      enviar: 'Continuar',
      onSubmit: async ({ cargo_id }) => { cargoId = Number(cargo_id); },
    });
    if (!escolhido) return;
    const permissoes = await api.listarPermissoesRelacionaisCanal(
      state.canal.id,
      cargoId
    );
    const editaveis = permissoes.filter((p) =>
      ehAdmin() || temPermissaoObjeto(p.codigo, 'CANAL', state.canal.id)
    );
    const marcadas = editaveis.filter((p) => p.concedida).map((p) => String(p.id));
    const atualizado = await formDialog({
      titulo: `Permissões do cargo`,
      fields: [{
        name: 'permissoes',
        label: 'Permissões neste canal',
        type: 'checks',
        value: marcadas,
        options: editaveis.map((p) => ({
          value: String(p.id),
          label: PERMISSOES[p.codigo] ?? p.nome,
        })),
      }],
      onSubmit: async ({ permissoes: selecionadas }) => {
        const antes = new Set(marcadas);
        const depois = new Set(selecionadas);
        await Promise.all([
          ...selecionadas.filter((id) => !antes.has(id)).map((id) =>
            api.concederPermissaoRelacionalCanal(state.canal.id, cargoId, Number(id))
          ),
          ...marcadas.filter((id) => !depois.has(id)).map((id) =>
            api.revogarPermissaoRelacionalCanal(state.canal.id, cargoId, Number(id))
          ),
        ]);
      },
    });
    if (atualizado) toast('Permissões do canal atualizadas.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
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
    const gerencia = podeGremio('GREMIO_CRIAR_CARGO');
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
          podeEditarCargo(c)
            ? h('div', { class: 'row-actions' },
                h('button', {
                  class: 'btn ghost sm', type: 'button',
                  onclick: async () => { if (await formCargo(c)) { desenhar(); carregarMembros(); } },
                }, 'Editar'),
                podeGremio('GREMIO_GERENCIAR_PERMISSOES')
                  ? h('button', {
                    class: 'btn ghost sm', type: 'button',
                    onclick: () => editarPermissoesCargo(c),
                  }, 'Permissões')
                  : null,
                c.padrao || !podeGremio('GREMIO_GERENCIAR_PERMISSOES') ? null : h('button', {
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
  if (podeCriarGremio()) {
    rail.append(h('button', { class: 'rail-item add', type: 'button', title: 'Criar grêmio', 'aria-label': 'Criar grêmio', onclick: novoGremio }, '+'));
  }
}

function renderSidebar() {
  const head = clear($('#sidebar-head'));
  const lista = clear($('#channel-list'));

  if (!state.gremio) {
    head.append(h('strong', {}, 'ELO'));
    lista.append(h('p', { class: 'muted pad' }, 'Você ainda não participa de nenhum grêmio.'));
    return;
  }

  const podeEditarGremio = Boolean(
    podeGremio('GREMIO_EDITAR_NOME') || podeGremio('GREMIO_EDITAR_DESCRICAO')
  );
  const podePermissoesCanal = Boolean(state.canal && (ehAdmin() ||
    temPermissaoObjeto('CANAL_GERENCIAR_PERMISSOES', 'CANAL', state.canal.id)));
  const podeCriarCanal = Boolean(podeGremio('GREMIO_CRIAR_CANAL'));
  const podeAdicionarEnquete = Boolean(podeGremio('GREMIO_CRIAR_ENQUETE') ||
    (state.canal && temPermissaoObjeto('CANAL_CRIAR_ENQUETE', 'CANAL', state.canal.id)));
  const podeAdicionarComunicado = Boolean(podeGremio('GREMIO_CRIAR_COMUNICADO') ||
    (state.canal && temPermissaoObjeto('CANAL_CRIAR_COMUNICADO', 'CANAL', state.canal.id)));
  const acoesAdicionar = [
    podeCriarCanal
      ? h('button', {
        type: 'button',
        onclick: (event) => {
          event.currentTarget.closest('details').open = false;
          novoCanal();
        },
      }, 'Criar canal')
      : null,
    podeAdicionarComunicado
      ? h('button', {
        type: 'button',
        onclick: (event) => {
          event.currentTarget.closest('details').open = false;
          criarComunicado(() => {});
        },
      }, 'Adicionar comunicado')
      : null,
    podeAdicionarEnquete
      ? h('button', {
        type: 'button',
        onclick: (event) => {
          event.currentTarget.closest('details').open = false;
          criarEnquete(() => {});
        },
      }, 'Adicionar enquete')
      : null,
  ].filter(Boolean);
  const menuAdicionar = acoesAdicionar.length
    ? h('details', { class: 'sidebar-add-menu' },
      h('summary', {
        class: 'icon-btn',
        title: 'Adicionar',
        'aria-label': 'Adicionar canal, comunicado ou enquete',
      }, '+'),
      h('div', { class: 'sidebar-popover' }, acoesAdicionar))
    : null;
  head.append(...[
    h('strong', { class: 'truncate', title: state.gremio.nome }, state.gremio.nome),
    menuAdicionar,
    (podeEditarGremio || podePermissoesCanal)
      ? h('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Editar grêmio',
        'aria-label': 'Editar grêmio',
        onclick: editarGremio,
      }, '✎')
      : null
  ].filter(Boolean));

  const canaisConteudo = h('div', { class: 'sidebar-section-content' },
    podeGremio('GREMIO_CRIAR_CANAL')
      ? h('button', {
        class: 'sidebar-entry sidebar-create',
        type: 'button',
        onclick: novoCanal,
      }, '+ Novo canal')
      : null,
    !state.canais.length
      ? h('p', { class: 'muted pad' }, 'Nenhum canal disponível para você.')
      : state.canais.map((c) => h('button', {
        class: `channel${state.canal?.id === c.id ? ' active' : ''}`,
        type: 'button', onclick: () => selecionarCanal(c.id),
      }, h('span', { class: 'hash' }, '#'), h('span', { class: 'truncate' }, c.nome))),
  );
  lista.append(criarSecaoLateral('canais', 'Canais', canaisConteudo));

  const comunicadosConteudo = h('div', { class: 'sidebar-section-content' },
    ...(state.comunicados.length
      ? state.comunicados.slice(0, 5).map((comunicado) => h('button', {
        class: 'sidebar-entry sidebar-preview',
        type: 'button',
        title: comunicado.titulo,
        onclick: abrirComunicados,
      }, comunicado.titulo))
      : [h('p', { class: 'muted pad' }, 'Nenhum comunicado.')]),
  );
  lista.append(criarSecaoLateral(
    'comunicados',
    'Comunicados',
    comunicadosConteudo,
    () => carregarComunicados().catch((err) => toast(err.message, 'error')),
    state.comunicados.length
  ));

  const enquetesConteudo = h('div', { class: 'sidebar-section-content' },
    ...(state.enquetes.length
      ? state.enquetes.slice(0, 5).map((enquete) => h('button', {
        class: 'sidebar-entry sidebar-preview',
        type: 'button',
        title: enquete.pergunta,
        onclick: abrirEnquetes,
      }, enquete.pergunta))
      : [h('p', { class: 'muted pad' }, 'Nenhuma enquete.')]),
  );
  lista.append(criarSecaoLateral(
    'enquetes',
    'Enquetes',
    enquetesConteudo,
    () => carregarEnquetes().catch((err) => toast(err.message, 'error')),
    state.enquetes.length
  ));
}

function criarSecaoLateral(chave, titulo, conteudo, aoAbrir, quantidade) {
  const secao = h('details', {
    class: 'sidebar-section',
    open: state.secoesLaterais[chave],
    ontoggle: () => {
      state.secoesLaterais[chave] = secao.open;
      localStorage.setItem(`elo_secao_${chave}`, secao.open ? '1' : '0');
      if (secao.open && aoAbrir) aoAbrir();
    },
  },
  h('summary', { class: 'section-title' },
    h('span', {}, titulo, quantidade ? ` (${quantidade})` : ''),
    h('span', { class: 'section-chevron', 'aria-hidden': 'true' }, '›')),
  conteudo);
  return secao;
}

function renderChat() {
  const chat = clear($('#chat'));

  if (!state.gremio) {
    const conteudo = [
      h('h2', {}, 'Você ainda não participa de um grêmio'),
      h('p', { class: 'muted' }, 'Peça a alguém para adicionar você usando o seu ID.')
    ];
    if (podeCriarGremio()) {
      conteudo.push(h('button', {
        class: 'btn primary',
        type: 'button',
        onclick: novoGremio,
      }, 'Criar grêmio'));
    }
    chat.append(
      h('div', { class: 'empty' }, ...conteudo)
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
        (ehAdmin() || temPermissaoObjeto('CANAL_EDITAR', 'CANAL', c.id) ||
          temPermissaoObjeto('CANAL_EXCLUIR', 'CANAL', c.id))
          ? h('button', { class: 'btn ghost sm', type: 'button', onclick: editarCanal }, 'Editar canal')
          : null,
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
                podeAtribuirCargo(c) && podeMexer
                  ? h('button', { class: 'chip-x', type: 'button', title: `Remover cargo ${c.nome}`, 'aria-label': `Remover cargo ${c.nome}`, onclick: () => tirarCargo(m, c) }, '×')
                  : null)),
            state.cargos.some((cargo) =>
              !cargo.padrao &&
              !m.cargos_ids.includes(cargo.id) &&
              podeAtribuirCargo(cargo)
            ) && podeMexer
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
