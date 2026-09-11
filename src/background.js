/**
 * background.js — service worker (MV3, módulo ES).
 *
 * Guarda os anúncios capturados, controla qual está selecionado e faz a
 * chamada de IA para reescrever título e descrição.
 */

const CHAVE_PRODUTOS = 'produtos';
const CHAVE_SELECIONADO = 'selecionadoId';
const CHAVE_PROVEDOR = 'provedor';   // 'gemini' | 'openrouter' | 'anthropic'
const CHAVE_CHAVES = 'chaves';       // { gemini: '...', anthropic: '...' }
const CHAVE_MODELOS = 'modelos';     // { gemini: '...', anthropic: '...' }
const MAX_GUARDADOS = 50;

// ---- armazenamento --------------------------------------------------------
async function lerProdutos() {
  const { [CHAVE_PRODUTOS]: p } = await chrome.storage.local.get(CHAVE_PRODUTOS);
  return Array.isArray(p) ? p : [];
}

/**
 * Escolhe entre dois valores do mesmo campo.
 *
 * Um spread simples (`{...antigo, ...novo}`) destruía dados: a captura que
 * chega depois costuma ser parcial, e sobrescrevia categoria e atributos
 * bons com arrays vazios. Aqui o mais completo sempre ganha.
 */
function melhorValor(antigo, novo) {
  if (novo === null || novo === undefined || novo === '') return antigo;
  if (Array.isArray(antigo) || Array.isArray(novo)) {
    return (novo?.length ?? 0) >= (antigo?.length ?? 0) ? novo : antigo;
  }
  if (typeof antigo === 'string' && typeof novo === 'string') {
    return novo.length >= antigo.length ? novo : antigo;
  }
  return novo;
}

/** Campos que a pessoa editou: nunca sobrescrever com dado de captura. */
const CAMPOS_DO_USUARIO = ['nomeGerado', 'descricaoGerada'];

function mesclar(antigo, novo) {
  const saida = { ...antigo };
  for (const [chave, valor] of Object.entries(novo)) {
    if (CAMPOS_DO_USUARIO.includes(chave)) {
      saida[chave] = antigo[chave] || valor;
    } else if (chave === 'capturadoEm' || chave === 'origem') {
      saida[chave] = valor;
    } else {
      saida[chave] = melhorValor(antigo[chave], valor);
    }
  }
  return saida;
}

async function salvarProduto(produto) {
  const produtos = await lerProdutos();
  const i = produtos.findIndex((p) => p.id === produto.id);

  let final = produto;
  if (i >= 0) {
    final = mesclar(produtos[i], produto);
    produtos[i] = final;
  } else {
    produtos.unshift(produto);
  }

  await chrome.storage.local.set({
    [CHAVE_PRODUTOS]: produtos.slice(0, MAX_GUARDADOS),
  });
  return final;
}

async function removerProduto(id) {
  const produtos = (await lerProdutos()).filter((p) => p.id !== id);
  await chrome.storage.local.set({ [CHAVE_PRODUTOS]: produtos });
}

async function obterSelecionado() {
  const { [CHAVE_SELECIONADO]: id } = await chrome.storage.local.get(CHAVE_SELECIONADO);
  if (!id) return null;
  return (await lerProdutos()).find((p) => p.id === id) || null;
}

// ---- IA -------------------------------------------------------------------
/**
 * Dois provedores. A diferença que importa aqui não é qualidade de texto —
 * é que o Gemini tem camada gratuita de API e a Anthropic não.
 *
 * Contrapartida do gratuito do Google: os prompts podem ser usados para
 * treinar os modelos deles. Para título e descrição de produto isso é
 * irrelevante; para dado sensível, não seria.
 */
const PROVEDORES = {
  anthropic: {
    nome: 'Anthropic',
    modeloPadrao: 'claude-sonnet-5',
    ondePegar: 'console.anthropic.com → API keys (exige crédito pago)',
  },
  gemini: {
    nome: 'Gemini',
    modeloPadrao: 'gemini-flash-latest',
    ondePegar: 'aistudio.google.com/apikey (tem camada gratuita)',
  },
  openrouter: {
    nome: 'OpenRouter',
    modeloPadrao: 'openai/gpt-oss-20b:free',
    ondePegar: 'openrouter.ai/keys — escolha um modelo com sufixo :free (grátis)',
  },
};

function montarInstrucao(produto) {
  return `Você escreve anúncios para a Shopee Brasil.

Produto de referência:
- Nome atual: ${produto.nome}
- Categoria: ${produto.categoria || 'não informada'}
- Preço: R$ ${produto.preco ?? '?'}
- Descrição atual: ${(produto.descricao || '').slice(0, 1200)}

Escreva um anúncio NOVO e original, não copie o texto acima.

Regras:
- Título: até 120 caracteres, com as palavras-chave de busca na frente,
  sem emoji, sem CAIXA ALTA gritada, sem promessa não verificável.
- Descrição: até 2500 caracteres, em blocos curtos, com medidas, material
  e cuidados. Termine com o que vem na embalagem.
- Português do Brasil.

Responda SÓ com JSON, sem cercas de código e sem preâmbulo:
{"titulo": "...", "descricao": "..."}`;
}

async function chamarAnthropic(chave, modelo, instrucao) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 2000,
      messages: [{ role: 'user', content: instrucao }],
    }),
  });

  if (!r.ok) throw await descreverErro(r);

  const dados = await r.json();
  return dados.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

async function chamarGemini(chave, modelo, instrucao) {
  // A chave vai no cabeçalho, não na query string: URL entra em log de
  // proxy e histórico, cabeçalho não.
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instrucao }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          // JSON nativo: evita ter que limpar cercas de markdown na mão.
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!r.ok) throw await descreverErro(r);

  const dados = await r.json();
  const partes = dados.candidates?.[0]?.content?.parts || [];
  const texto = partes.map((p) => p.text || '').join('\n');

  if (!texto) {
    const motivo = dados.candidates?.[0]?.finishReason || 'resposta vazia';
    throw new Error(`Gemini não devolveu texto (${motivo}).`);
  }
  return texto;
}

async function chamarOpenRouter(chave, modelo, instrucao) {
  // OpenRouter fala o protocolo da OpenAI: chave no header Authorization.
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chave}`,
      // Opcionais; o OpenRouter recomenda para identificar o app.
      'HTTP-Referer': 'https://github.com/molde-shopee',
      'X-Title': 'Molde Shopee',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 2000,
      messages: [{ role: 'user', content: instrucao }],
    }),
  });

  if (!r.ok) throw await descreverErro(r);

  const dados = await r.json();
  // Modelos free às vezes devolvem erro no corpo com HTTP 200.
  if (dados.error) throw new Error(dados.error.message || 'Erro do OpenRouter.');

  const texto = dados.choices?.[0]?.message?.content || '';
  if (!texto) {
    throw new Error('OpenRouter não devolveu texto. Tente outro modelo :free.');
  }
  return texto;
}

async function descreverErro(r) {
  const corpo = await r.text().catch(() => '');
  let msg;
  if (r.status === 401 || r.status === 403) msg = 'Chave inválida ou sem permissão.';
  else if (r.status === 429) msg = 'Limite de uso atingido. Espere um pouco e tente de novo.';
  else if (r.status === 400 && /model/i.test(corpo)) msg = 'Modelo não existe ou não está disponível para esta chave.';
  else if (r.status === 503) msg = 'Modelo sobrecarregado no provedor (503). Tentei repetir e ainda não deu — espere um instante e mande de novo.';
  else msg = `Erro ${r.status}. ${corpo.slice(0, 320)}`;
  const erro = new Error(msg);
  // Transitórios: sobrecarga/instabilidade do provedor. Cota (429) e chave/modelo não repetem.
  erro.retryable = [500, 502, 503].includes(r.status);
  return erro;
}

/**
 * Repete a chamada em erro transitório, com espera crescente (1,5s, 3s).
 * Só repete o que foi marcado retryable; erro de chave, modelo ou cota sobe
 * na hora.
 */
async function comRetentativa(fn, tentativas = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (erro) {
      if (!erro.retryable || i >= tentativas - 1) throw erro;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

/**
 * Recorta o objeto JSON da resposta. Modelos free às vezes embrulham em
 * cercas de markdown ou colocam preâmbulo antes do JSON; aqui limpamos as
 * cercas e, se preciso, recortamos do primeiro { ao último }.
 */
function extrairJson(bruto) {
  const limpo = bruto.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const ini = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');
    if (ini >= 0 && fim > ini) return JSON.parse(limpo.slice(ini, fim + 1));
    throw new Error('sem json');
  }
}

/** Lê o provedor/chave/modelo salvos e chama a IA com retry. Devolve texto cru. */
async function chamarIA(instrucao) {
  const cfg = await chrome.storage.local.get([CHAVE_PROVEDOR, CHAVE_CHAVES, CHAVE_MODELOS]);
  const provedor = cfg[CHAVE_PROVEDOR] || 'gemini';
  const chave = (cfg[CHAVE_CHAVES] || {})[provedor];

  if (!chave) {
    throw new Error(`Sem chave do ${PROVEDORES[provedor].nome}. Configure nas opções.`);
  }

  const modelo =
    (cfg[CHAVE_MODELOS] || {})[provedor] || PROVEDORES[provedor].modeloPadrao;

  return await comRetentativa(() =>
    provedor === 'gemini'
      ? chamarGemini(chave, modelo, instrucao)
      : provedor === 'openrouter'
        ? chamarOpenRouter(chave, modelo, instrucao)
        : chamarAnthropic(chave, modelo, instrucao)
  );
}

async function gerarTexto(produto) {
  const bruto = await chamarIA(montarInstrucao(produto));

  let titulo;
  let descricao;
  try {
    ({ titulo, descricao } = extrairJson(bruto));
  } catch {
    throw new Error('A resposta não veio em JSON válido. Tente de novo.');
  }

  return await salvarProduto({
    ...produto,
    nomeGerado: titulo || '',
    descricaoGerada: descricao || '',
  });
}

function montarInstrucaoPesquisa(produto) {
  return `Você é analista de mercado da Shopee Brasil. Estime o mercado deste produto.

Produto: ${produto.nome}
Categoria capturada: ${produto.categoria || 'não informada'}
Preço de referência: R$ ${produto.preco ?? '?'}

Responda SÓ com JSON, sem cercas de código:
{"precoMin": number, "precoMax": number, "categoria": "caminho provável de categoria na Shopee", "titulos": ["3 a 5 ideias de título otimizado para busca"]}`;
}

/** Aba 2 (fallback): estimativa de mercado quando a busca real da Shopee falha. */
async function pesquisar(produto) {
  const dados = extrairJson(await chamarIA(montarInstrucaoPesquisa(produto)));
  return {
    precoMin: Number(dados.precoMin) || null,
    precoMax: Number(dados.precoMax) || null,
    categoria: dados.categoria || '',
    titulos: Array.isArray(dados.titulos) ? dados.titulos.slice(0, 5) : [],
  };
}

// ---- roteador de mensagens ------------------------------------------------
const acoes = {
  SALVAR_PRODUTO: (msg) => salvarProduto(msg.produto).then((produto) => ({ produto })),
  LISTAR_PRODUTOS: () => lerProdutos().then((produtos) => ({ produtos })),
  REMOVER_PRODUTO: (msg) => removerProduto(msg.id).then(() => ({})),
  SELECIONAR: (msg) =>
    chrome.storage.local.set({ [CHAVE_SELECIONADO]: msg.id }).then(() => ({})),
  OBTER_SELECIONADO: () => obterSelecionado().then((produto) => ({ produto })),
  GERAR_TEXTO: (msg) => gerarTexto(msg.produto).then((produto) => ({ produto })),
  GERAR_PESQUISA: (msg) => pesquisar(msg.produto).then((pesquisa) => ({ pesquisa })),
  AJUSTAR_TEXTO: async (msg) => {
    const produtos = await lerProdutos();
    const i = produtos.findIndex((p) => p.id === msg.id);
    if (i < 0) throw new Error('Produto não encontrado.');
    produtos[i] = {
      ...produtos[i],
      nomeGerado: msg.titulo ?? produtos[i].nomeGerado,
      descricaoGerada: msg.descricao ?? produtos[i].descricaoGerada,
    };
    await chrome.storage.local.set({ [CHAVE_PRODUTOS]: produtos });
    return { produto: produtos[i] };
  },
  LER_CONFIG_IA: async () => {
    const c = await chrome.storage.local.get([CHAVE_PROVEDOR, CHAVE_CHAVES, CHAVE_MODELOS]);
    const provedor = c[CHAVE_PROVEDOR] || 'gemini';
    const chaves = c[CHAVE_CHAVES] || {};
    return {
      provedor,
      modelo: (c[CHAVE_MODELOS] || {})[provedor] || PROVEDORES[provedor].modeloPadrao,
      // Nunca devolvemos a chave em si, só se existe.
      temChave: Object.fromEntries(
        Object.keys(PROVEDORES).map((p) => [p, Boolean(chaves[p])])
      ),
      provedores: PROVEDORES,
    };
  },
  SALVAR_CONFIG_IA: async (msg) => {
    const c = await chrome.storage.local.get([CHAVE_CHAVES, CHAVE_MODELOS]);
    const chaves = c[CHAVE_CHAVES] || {};
    const modelos = c[CHAVE_MODELOS] || {};
    if (msg.chave) chaves[msg.provedor] = msg.chave;
    if (msg.apagarChave) delete chaves[msg.provedor];
    if (msg.modelo) modelos[msg.provedor] = msg.modelo;
    await chrome.storage.local.set({
      [CHAVE_PROVEDOR]: msg.provedor,
      [CHAVE_CHAVES]: chaves,
      [CHAVE_MODELOS]: modelos,
    });
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  const acao = acoes[msg?.tipo];
  if (!acao) {
    responder({ ok: false, erro: `Ação desconhecida: ${msg?.tipo}` });
    return false;
  }
  acao(msg)
    .then((resultado) => responder({ ok: true, ...resultado }))
    .catch((erro) => responder({ ok: false, erro: erro.message }));
  return true; // mantém o canal aberto para a resposta assíncrona
});
