/**
 * lancador.js — botão flutuante + painel de 3 abas na página.
 *
 * O botão é arrastável e guarda a posição (o canto inferior direito é onde a
 * Shopee coloca o próprio chat). Nas páginas públicas de produto ele abre um
 * painel com três abas, escopado ao produto que está aberto na tela:
 *   1. Dados     — o que foi capturado desse produto
 *   2. Relacionados — busca real na Shopee (com fallback de IA)
 *   3. Ação      — reescrever (com revisão) ou usar, e ir ao cadastro
 *
 * No Seller Center o botão apenas dispara o painel de preenchimento (filler).
 */
(() => {
  'use strict';

  const CHAVE_POSICAO = 'lancadorPos';
  const TAMANHO = 44;
  const MARGEM = 12;
  const LIMIAR_ARRASTE = 4; // px, para separar clique de arraste

  let puck = null;
  let gaveta = null;
  let abaAtual = 'dados';

  const noSellerCenter = () => location.hostname.startsWith('seller.');

  const enviar = (msg) => chrome.runtime.sendMessage(msg);

  const escapar = (t) =>
    String(t).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const moeda = (v) =>
    typeof v === 'number' && Number.isFinite(v)
      ? `R$ ${v.toFixed(2).replace('.', ',')}`
      : '—';

  // ---- posição -----------------------------------------------------------
  const posicaoPadrao = () => ({
    x: window.innerWidth - TAMANHO - 20,
    y: window.innerHeight - TAMANHO - 96, // acima do chat da Shopee
  });

  const limitar = ({ x, y }) => ({
    x: Math.min(Math.max(x, MARGEM), window.innerWidth - TAMANHO - MARGEM),
    y: Math.min(Math.max(y, MARGEM), window.innerHeight - TAMANHO - MARGEM),
  });

  function aplicarPosicao(pos) {
    const { x, y } = limitar(pos);
    puck.style.left = `${x}px`;
    puck.style.top = `${y}px`;
    puck.dataset.lado = x > window.innerWidth / 2 ? 'esquerda' : 'direita';
    puck.dataset.vertical = y > window.innerHeight / 2 ? 'cima' : 'baixo';
  }

  // ---- montagem ----------------------------------------------------------
  async function montar() {
    if (puck || !document.body) return;

    puck = document.createElement('div');
    puck.id = 'fec3d-puck';
    puck.setAttribute('role', 'button');
    puck.setAttribute('tabindex', '0');
    puck.setAttribute('aria-label', 'Abrir Molde');
    puck.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 17.5 19 6.5" />
        <path d="M5 12.5 19 1.5" opacity=".55" />
      </svg>
      <span class="fec3d-puck__contador" hidden></span>`;
    document.body.appendChild(puck);

    const guardado = await chrome.storage.local.get(CHAVE_POSICAO);
    aplicarPosicao(guardado[CHAVE_POSICAO] || posicaoPadrao());

    ligarArraste();
    puck.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        acionar();
      }
    });

    window.addEventListener('resize', () =>
      aplicarPosicao({ x: parseFloat(puck.style.left), y: parseFloat(puck.style.top) })
    );

    atualizarContador();
  }

  // ---- arraste -----------------------------------------------------------
  function ligarArraste() {
    let arrastando = false;
    let moveu = false;
    let deslocX = 0;
    let deslocY = 0;

    puck.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      arrastando = true;
      moveu = false;
      const r = puck.getBoundingClientRect();
      deslocX = e.clientX - r.left;
      deslocY = e.clientY - r.top;
      puck.setPointerCapture(e.pointerId);
      puck.classList.add('fec3d-puck--arrastando');
    });

    puck.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      const x = e.clientX - deslocX;
      const y = e.clientY - deslocY;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) {
        const r = puck.getBoundingClientRect();
        if (Math.hypot(x - r.left, y - r.top) > LIMIAR_ARRASTE) moveu = true;
      }
      aplicarPosicao({ x, y });
    });

    puck.addEventListener('pointerup', async (e) => {
      if (!arrastando) return;
      arrastando = false;
      puck.releasePointerCapture(e.pointerId);
      puck.classList.remove('fec3d-puck--arrastando');

      if (moveu) {
        await chrome.storage.local.set({
          [CHAVE_POSICAO]: {
            x: parseFloat(puck.style.left),
            y: parseFloat(puck.style.top),
          },
        });
      } else {
        acionar();
      }
    });
  }

  // ---- ação --------------------------------------------------------------
  function acionar() {
    if (noSellerCenter()) {
      window.dispatchEvent(new CustomEvent('fec3d:abrir-painel'));
      return;
    }
    alternarGaveta();
  }

  // ---- painel de 3 abas (páginas de produto) -----------------------------
  function itemidDaUrl() {
    const m = /-i\.(\d+)\.(\d+)/.exec(location.href);
    return m ? m[2] : null;
  }

  async function produtoDaTela() {
    const { produtos = [] } = await enviar({ tipo: 'LISTAR_PRODUTOS' });
    const itemid = itemidDaUrl();
    if (itemid) {
      const achado = produtos.find((p) => String(p.id).endsWith('_' + itemid));
      if (achado) return achado;
    }
    return produtos[0] || null; // cai para o mais recente
  }

  async function alternarGaveta() {
    if (gaveta) {
      gaveta.remove();
      gaveta = null;
      return;
    }

    const p = await produtoDaTela();

    gaveta = document.createElement('div');
    gaveta.id = 'fec3d-gaveta';
    gaveta.dataset.lado = puck.dataset.lado;
    gaveta.dataset.vertical = puck.dataset.vertical;

    if (!p) {
      gaveta.innerHTML = `
        <header class="fec3d-p3__topo"><span>Molde</span></header>
        <p class="fec3d-gaveta__vazio">
          Abra um anúncio de produto da Shopee e ele é capturado sozinho.
          Depois volte aqui.
        </p>`;
      document.body.appendChild(gaveta);
      posicionarGaveta();
      registrarFecharFora();
      return;
    }

    gaveta.produto = p;
    gaveta.cacheRel = null;
    gaveta.innerHTML = `
      <header class="fec3d-p3__topo">
        <span>Molde</span>
        <button class="fec3d-p3__fechar" type="button" aria-label="Fechar">×</button>
      </header>
      <nav class="fec3d-p3__abas" role="tablist">
        <button class="fec3d-p3__aba" data-aba="dados" role="tab" type="button">Dados</button>
        <button class="fec3d-p3__aba" data-aba="relacionados" role="tab" type="button">Relacionados</button>
        <button class="fec3d-p3__aba" data-aba="acao" role="tab" type="button">Ação</button>
      </nav>
      <div class="fec3d-p3__corpo"></div>`;
    document.body.appendChild(gaveta);
    posicionarGaveta();

    const fecharBtn = gaveta.querySelector('.fec3d-p3__fechar');
    const aoEsc = (e) => {
      if (e.key === 'Escape') fecharPainel(e);
    };
    function fecharPainel(e) {
      if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
      }
      if (gaveta) {
        gaveta.remove();
        gaveta = null;
      }
      document.removeEventListener('keydown', aoEsc, true);
    }
    // pointerdown fecha na hora (o click às vezes é interceptado pela Shopee);
    // click e Esc são reforços.
    fecharBtn.addEventListener('pointerdown', fecharPainel);
    fecharBtn.addEventListener('click', fecharPainel);
    document.addEventListener('keydown', aoEsc, true);
    for (const ab of gaveta.querySelectorAll('.fec3d-p3__aba')) {
      ab.onclick = () => trocarAba(ab.dataset.aba);
    }
    trocarAba(abaAtual === 'relacionados' || abaAtual === 'acao' ? abaAtual : 'dados');
    registrarFecharFora();
  }

  const corpo = () => gaveta?.querySelector('.fec3d-p3__corpo');

  function trocarAba(nome) {
    if (!gaveta) return;
    abaAtual = nome;
    for (const ab of gaveta.querySelectorAll('.fec3d-p3__aba')) {
      ab.classList.toggle('fec3d-p3__aba--ativa', ab.dataset.aba === nome);
    }
    const p = gaveta.produto;
    if (nome === 'dados') renderDados(p);
    else if (nome === 'relacionados') renderRelacionados(p);
    else renderAcao(p);
  }

  // ---- Aba 1: dados capturados -------------------------------------------
  function renderDados(p) {
    const c = corpo();
    if (!c) return;
    const lin = (r, v) =>
      v || v === 0
        ? `<div class="fec3d-p3__lin"><span>${r}</span><em>${escapar(String(v))}</em></div>`
        : '';
    const carac = (p.atributos || [])
      .slice(0, 12)
      .map((a) => lin(a.nome, a.valor))
      .join('');
    const fotos = (p.imagens || [])
      .slice(0, 9)
      .map((u, i) => `<img src="${u}" alt="foto ${i + 1}" loading="lazy">`)
      .join('');
    const incompleto = !p.preco || (p.imagens?.length || 0) < 2;

    c.innerHTML = `
      <div class="fec3d-p3__nome">${escapar(p.nomeGerado || p.nome)}</div>
      ${p.nomeGerado ? '<div class="fec3d-p3__tag fec3d-p3__tag--ia">título reescrito pela IA</div>' : ''}
      <div class="fec3d-p3__grade">
        ${lin('Preço', moeda(p.preco))}
        ${lin('Faixa', p.precoMin && p.precoMax && p.precoMin !== p.precoMax ? `${moeda(p.precoMin)} – ${moeda(p.precoMax)}` : '')}
        ${lin('Estoque', p.estoque || '')}
        ${lin('Categoria', p.categoria || '—')}
        ${lin('Marca', p.marca)}
        ${lin('Peso', p.peso ? `${p.peso} g` : '')}
        ${lin('Medidas', p.comprimento ? `${p.comprimento}×${p.largura}×${p.altura} cm` : '')}
        ${lin('Fotos', `${p.imagens?.length || 0} capturada(s)`)}
        ${lin('Características', `${p.atributos?.length || 0} campo(s)`)}
        ${lin('Variações', p.variacoes?.length ? String(p.variacoes.length) : '')}
      </div>
      ${carac ? `<details class="fec3d-p3__det"><summary>Características</summary><div class="fec3d-p3__grade">${carac}</div></details>` : ''}
      ${fotos ? `<div class="fec3d-p3__fotos">${fotos}</div>` : ''}
      ${incompleto ? `<div class="fec3d-p3__aviso">Captura incompleta (preço ou fotos). Dê F5 no anúncio, espere carregar tudo e role até as fotos, depois reabra este painel.</div>` : ''}`;
  }

  // ---- Aba 2: relacionados (real na Shopee + fallback IA) -----------------
  function renderRelacionados(p) {
    const c = corpo();
    if (!c) return;
    if (gaveta.cacheRel) {
      c.innerHTML = gaveta.cacheRel;
      return;
    }
    c.innerHTML = `<div class="fec3d-p3__carregando">Buscando relacionados na Shopee…</div>`;
    carregarRelacionados(p);
  }

  async function carregarRelacionados(p) {
    let html;
    try {
      const real = await buscarShopee(p);
      html = real && real.itens.length ? htmlReal(real) : await htmlIA(p);
    } catch {
      html = await htmlIA(p);
    }
    if (gaveta) gaveta.cacheRel = html;
    if (abaAtual === 'relacionados' && corpo()) corpo().innerHTML = html;
  }

  const palavrasChave = (nome) =>
    String(nome || '').split(/\s+/).slice(0, 6).join(' ').trim();

  async function buscarShopee(p) {
    const kw = palavrasChave(p.nome);
    if (!kw) return null;
    // Same-origin: rodamos dentro de shopee.com.br, então a chamada leva os
    // cookies da sessão e tem chance real de passar.
    const url =
      `https://shopee.com.br/api/v4/search/search_items` +
      `?by=relevancy&keyword=${encodeURIComponent(kw)}&limit=40&newest=0` +
      `&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (!r.ok) return null;
    const d = await r.json();
    const bruto = d.items || d.data?.items || [];
    const itens = bruto
      .map((it) => it.item_basic || it)
      .filter((it) => it && it.name)
      .map((it) => ({
        nome: it.name,
        preco: it.price != null ? it.price / 100000 : null,
        vendidos: it.historical_sold ?? it.sold ?? 0,
      }))
      .filter((it) => it.preco && it.preco > 0);
    return { kw, itens };
  }

  function htmlReal({ kw, itens }) {
    const precos = itens.map((i) => i.preco).sort((a, b) => a - b);
    const min = precos[0];
    const max = precos[precos.length - 1];
    const mediana = precos[Math.floor(precos.length / 2)];
    const amostra = itens
      .slice()
      .sort((a, b) => (b.vendidos || 0) - (a.vendidos || 0))
      .slice(0, 6)
      .map(
        (i) =>
          `<div class="fec3d-p3__rel"><strong>${escapar(i.nome.slice(0, 90))}</strong><em>${moeda(i.preco)} · ${i.vendidos} vend.</em></div>`
      )
      .join('');
    return `
      <div class="fec3d-p3__tag">Dados reais da Shopee · "${escapar(kw)}"</div>
      <div class="fec3d-p3__grade">
        <div class="fec3d-p3__lin"><span>Anúncios</span><em>${itens.length}</em></div>
        <div class="fec3d-p3__lin"><span>Menor preço</span><em>${moeda(min)}</em></div>
        <div class="fec3d-p3__lin"><span>Preço mediano</span><em>${moeda(mediana)}</em></div>
        <div class="fec3d-p3__lin"><span>Maior preço</span><em>${moeda(max)}</em></div>
      </div>
      <div class="fec3d-p3__sub">Mais vendidos com esse termo</div>
      ${amostra}`;
  }

  async function htmlIA(p) {
    const resp = await enviar({ tipo: 'GERAR_PESQUISA', produto: p });
    if (!resp.ok) {
      return `<div class="fec3d-p3__aviso">A busca na Shopee não passou e a IA também não respondeu: ${escapar(resp.erro || '')}. Configure a chave da IA no ícone da extensão (⚙).</div>`;
    }
    const q = resp.pesquisa;
    const titulos = (q.titulos || [])
      .map((t) => `<div class="fec3d-p3__rel"><strong>${escapar(t)}</strong></div>`)
      .join('');
    return `
      <div class="fec3d-p3__tag fec3d-p3__tag--ia">Estimativa da IA (busca real indisponível)</div>
      <div class="fec3d-p3__grade">
        <div class="fec3d-p3__lin"><span>Faixa de preço</span><em>${moeda(q.precoMin)} – ${moeda(q.precoMax)}</em></div>
        <div class="fec3d-p3__lin"><span>Categoria provável</span><em>${escapar(q.categoria || '—')}</em></div>
      </div>
      <div class="fec3d-p3__sub">Ideias de título</div>
      ${titulos || '<div class="fec3d-p3__aviso">Sem sugestões.</div>'}`;
  }

  // ---- Aba 3: ação (reescrever com revisão / usar) -----------------------
  function renderAcao(p) {
    const c = corpo();
    if (!c) return;
    c.innerHTML = `
      <p class="fec3d-p3__info">Leve este produto para o cadastro. "Reescrever" gera título e descrição com IA para você revisar; "Usar" leva o texto original.</p>
      <div class="fec3d-p3__botoes">
        <button class="fec3d-p3__btn fec3d-p3__btn--sec" data-a="reescrever" type="button">Reescrever com IA</button>
        <button class="fec3d-p3__btn fec3d-p3__btn--prim" data-a="usar" type="button">Usar como está</button>
      </div>
      <div class="fec3d-p3__revisao" hidden></div>`;
    c.querySelector('[data-a="usar"]').onclick = () => irParaCadastro(gaveta.produto);
    c.querySelector('[data-a="reescrever"]').onclick = (e) => reescrever(gaveta.produto, e.target);
  }

  async function irParaCadastro(p) {
    await enviar({ tipo: 'SELECIONAR', id: p.id });
    window.open('https://seller.shopee.com.br/portal/product/new', '_blank');
    if (gaveta) {
      gaveta.remove();
      gaveta = null;
    }
  }

  async function reescrever(p, botao) {
    const rev = gaveta.querySelector('.fec3d-p3__revisao');
    botao.disabled = true;
    rev.hidden = false;
    rev.innerHTML = `<div class="fec3d-p3__carregando">Reescrevendo com IA…</div>`;

    const resp = await enviar({ tipo: 'GERAR_TEXTO', produto: p });
    botao.disabled = false;

    if (!resp.ok) {
      rev.innerHTML = `<div class="fec3d-p3__aviso">${escapar(resp.erro)}</div>`;
      return;
    }

    const np = resp.produto;
    gaveta.produto = np;
    rev.innerHTML = `
      <div class="fec3d-p3__sub">Revise o texto da IA (dá para editar)</div>
      <label class="fec3d-p3__rot">Título</label>
      <textarea class="fec3d-p3__ta" data-c="titulo" rows="2">${escapar(np.nomeGerado || '')}</textarea>
      <label class="fec3d-p3__rot">Descrição</label>
      <textarea class="fec3d-p3__ta" data-c="descricao" rows="7">${escapar(np.descricaoGerada || '')}</textarea>
      <div class="fec3d-p3__botoes">
        <button class="fec3d-p3__btn fec3d-p3__btn--sec" data-a="regerar" type="button">Gerar de novo</button>
        <button class="fec3d-p3__btn fec3d-p3__btn--prim" data-a="confirmar" type="button">Confirmar e ir pro cadastro</button>
      </div>`;
    rev.querySelector('[data-a="regerar"]').onclick = (e) => reescrever(gaveta.produto, e.target);
    rev.querySelector('[data-a="confirmar"]').onclick = () => confirmar(np, rev);
  }

  async function confirmar(np, rev) {
    const titulo = rev.querySelector('[data-c="titulo"]').value.trim();
    const descricao = rev.querySelector('[data-c="descricao"]').value.trim();
    const { ok, produto } = await enviar({
      tipo: 'AJUSTAR_TEXTO',
      id: np.id,
      titulo,
      descricao,
    });
    await irParaCadastro(ok ? produto : np);
  }

  // ---- posicionamento e fechar-fora --------------------------------------
  function posicionarGaveta() {
    const r = puck.getBoundingClientRect();
    const larguraGaveta = 380;

    const esquerda =
      puck.dataset.lado === 'esquerda'
        ? Math.max(MARGEM, r.right - larguraGaveta)
        : Math.min(r.left, window.innerWidth - larguraGaveta - MARGEM);

    gaveta.style.left = `${Math.max(MARGEM, esquerda)}px`;

    if (puck.dataset.vertical === 'cima') {
      gaveta.style.bottom = `${window.innerHeight - r.top + 10}px`;
      gaveta.style.top = 'auto';
    } else {
      gaveta.style.top = `${r.bottom + 10}px`;
      gaveta.style.bottom = 'auto';
    }
  }

  function registrarFecharFora() {
    setTimeout(() => {
      document.addEventListener('pointerdown', fecharSeFora, { once: true });
    }, 0);
  }

  function fecharSeFora(e) {
    if (!gaveta) return;
    if (gaveta.contains(e.target) || puck.contains(e.target)) {
      document.addEventListener('pointerdown', fecharSeFora, { once: true });
      return;
    }
    gaveta.remove();
    gaveta = null;
  }

  // ---- contador ----------------------------------------------------------
  async function atualizarContador() {
    if (!puck) return;
    const { produtos = [] } = await enviar({ tipo: 'LISTAR_PRODUTOS' });
    const contador = puck.querySelector('.fec3d-puck__contador');
    contador.textContent = produtos.length > 99 ? '99+' : String(produtos.length);
    contador.hidden = produtos.length === 0;
  }

  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'local' || !mudancas.produtos) return;
    atualizarContador();
    if (!puck) return;
    puck.classList.add('fec3d-puck--pulso');
    setTimeout(() => puck.classList.remove('fec3d-puck--pulso'), 700);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar, { once: true });
  } else {
    montar();
  }
})();
