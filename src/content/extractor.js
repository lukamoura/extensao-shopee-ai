/**
 * extractor.js — content script (ISOLATED world).
 *
 * Injeta o net-hook no main world, escuta o que ele captura, normaliza e
 * guarda. Também desenha um selo discreto no canto da página confirmando
 * que o anúncio foi capturado — sem isso a pessoa não tem como saber se a
 * extensão pegou os dados antes de trocar de aba.
 */
(() => {
  'use strict';

  const { normalize } = globalThis.FEC3D;
  const CANAL = 'FEC3D_SHOPEE_NET';

  const vistos = new Map(); // id -> riqueza da melhor captura até agora
  let ultimoProduto = null;

  // ---- 1. injetar o hook antes de qualquer script da página --------------
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inject/net-hook.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).prepend(script);

  // ---- 2. escutar as capturas -------------------------------------------
  window.addEventListener('message', async (evento) => {
    if (evento.source !== window) return;
    const msg = evento.data;
    if (!msg || msg.canal !== CANAL || msg.pronto) return;

    let produto;
    try {
      produto = normalize.paraProduto(msg.dados, msg.url);
    } catch (erro) {
      console.warn('[Molde] não consegui normalizar:', erro);
      return;
    }

    if (!produto?.nome) return;

    // A página faz várias chamadas e cada uma traz um pedaço. Antes daqui
    // saía um `return` para id repetido — e como a captura pobre chega
    // primeiro, ela bloqueava a boa. Agora todas passam e o background
    // mescla, ficando com o valor mais completo de cada campo.
    completarPelaPagina(produto);
    ultimoProduto = produto;

    const resposta = await chrome.runtime.sendMessage({
      tipo: 'SALVAR_PRODUTO',
      produto,
    });
    if (!resposta?.ok) return;

    // O selo só reaparece quando a captura melhora de verdade.
    const pontos = pontuar(produto);
    if (pontos > (vistos.get(produto.id) ?? -1)) {
      vistos.set(produto.id, pontos);
      mostrarSelo(resposta.produto || produto);
    }
  });

  const pontuar = (p) =>
    (p.categoriaPath?.length || 0) * 10 +
    (p.atributos?.length || 0) * 6 +
    (p.imagens?.length || 0) * 2 +
    (p.descricao?.length > 40 ? 10 : 0) +
    (p.peso ? 3 : 0);

  /**
   * Nem tudo vem pela API — e o que falta costuma ser justamente o que dá
   * mais trabalho de refazer. Categoria, características e descrição estão
   * todas visíveis na página, então valem ser raspadas como reserva.
   */
  function completarPelaPagina(produto) {
    if (!produto.categoriaPath?.length) {
      const caminho = lerTrilha();
      if (caminho.length) {
        produto.categoriaPath = caminho;
        produto.categoria = caminho.join(' > ');
      }
    }

    if (!produto.atributos?.length) {
      const lidos = lerDetalhes();
      if (lidos.length) produto.atributos = lidos;
    }

    if (!produto.descricao) {
      const texto = lerDescricao();
      if (texto) produto.descricao = texto;
    }
  }

  function lerTrilha() {
    const trilha = document.querySelector(
      '[class*="breadcrumb"], [class*="Breadcrumb"], nav[aria-label*="read"]'
    );
    if (!trilha) return [];

    return [...trilha.querySelectorAll('a, span')]
      .map((el) => el.textContent.trim())
      .filter((t) => t && t.length < 60 && !/^shopee$/i.test(t) && t !== '>')
      .filter((t, i, arr) => arr.indexOf(t) === i);
  }

  /** Acha a seção cujo título contém um dos termos. */
  function acharSecao(termos) {
    const cabecalhos = [...document.querySelectorAll('div, section, h1, h2, h3')];
    for (const el of cabecalhos) {
      const t = el.textContent.trim().toLowerCase();
      if (t.length < 60 && termos.some((termo) => t.includes(termo))) {
        // Sobe até um ancestral que contenha conteúdo além do título.
        let no = el;
        for (let i = 0; i < 4 && no.parentElement; i++) {
          no = no.parentElement;
          if (no.textContent.trim().length > t.length + 60) return no;
        }
      }
    }
    return null;
  }

  /**
   * Lê a tabela "Detalhes do Produto" como pares rótulo/valor.
   *
   * As classes da Shopee são geradas, então a heurística é estrutural:
   * um par é um elemento com exatamente dois filhos, ambos com texto curto.
   * É como esse tipo de tabela é montada em qualquer layout de duas colunas.
   */
  function lerDetalhes() {
    const secao = acharSecao(['detalhes do produto', 'especificações', 'product details']);
    if (!secao) return [];

    const pares = [];
    for (const el of secao.querySelectorAll('*')) {
      const filhos = [...el.children];
      if (filhos.length !== 2) continue;

      const rotulo = filhos[0].textContent.trim();
      const valor = filhos[1].textContent.trim();

      if (!rotulo || !valor) continue;
      if (rotulo.length > 40 || valor.length > 120) continue;
      if (rotulo === valor) continue;
      if (filhos[0].querySelector('img, svg, button')) continue;

      pares.push({ nome: rotulo, valor });
    }

    // Categoria vem como uma linha da tabela, mas já tem lugar próprio.
    const semCategoria = pares.filter((p) => !/^categoria$/i.test(p.nome));

    // O mesmo par pode aparecer em níveis aninhados diferentes.
    const vistos = new Set();
    return semCategoria.filter((p) => {
      const chave = p.nome.toLowerCase();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  function lerDescricao() {
    const secao = acharSecao(['descrição do produto', 'product description']);
    if (!secao) return '';
    const texto = secao.innerText
      .replace(/^\s*descrição do produto\s*/i, '')
      .trim();
    return texto.length > 40 ? texto.slice(0, 3000) : '';
  }

  // ---- 3. selo de confirmação -------------------------------------------
  function mostrarSelo(produto) {
    document.getElementById('fec3d-selo')?.remove();

    const selo = document.createElement('div');
    selo.id = 'fec3d-selo';
    selo.innerHTML = `
      <div class="fec3d-selo__barra"></div>
      <div class="fec3d-selo__corpo">
        <strong>Anúncio capturado</strong>
        <span>${escapar(produto.nome).slice(0, 60)}</span>
        <small>${produto.categoriaPath?.length ? 'categoria ok' : 'SEM categoria'} · ${produto.atributos.length} caract. · ${produto.imagens.length} img</small>
      </div>`;
    document.body.appendChild(selo);

    setTimeout(() => selo.classList.add('fec3d-selo--saindo'), 4200);
    setTimeout(() => selo.remove(), 4800);
  }

  const escapar = (t) =>
    String(t).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  /**
   * As respostas da API chegam antes da página terminar de renderizar, então
   * na primeira passada a raspagem não acha nada. Estas passadas tardias
   * pegam o que faltou. Só salvam se realmente melhorarem a captura.
   */
  for (const atraso of [2000, 5000, 9000]) {
    setTimeout(async () => {
      if (!ultimoProduto) return;

      const antes = pontuar(ultimoProduto);
      completarPelaPagina(ultimoProduto);
      const depois = pontuar(ultimoProduto);
      if (depois <= antes) return;

      const r = await chrome.runtime.sendMessage({
        tipo: 'SALVAR_PRODUTO',
        produto: ultimoProduto,
      });
      if (r?.ok) {
        vistos.set(ultimoProduto.id, depois);
        mostrarSelo(r.produto || ultimoProduto);
      }
    }, atraso);
  }

  // Estilo do selo vive aqui porque a página pública não carrega panel.css.
  const estilo = document.createElement('style');
  estilo.textContent = `
    #fec3d-selo {
      position: fixed; z-index: 2147483647; right: 20px; bottom: 20px;
      display: flex; overflow: hidden;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #14161A; color: #E8EAED;
      border: 1px solid #2C313A; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
      animation: fec3dEntra .22s cubic-bezier(.2,.8,.3,1);
      transition: opacity .5s, transform .5s;
    }
    #fec3d-selo.fec3d-selo--saindo { opacity: 0; transform: translateY(8px); }
    .fec3d-selo__barra { width: 3px; background: linear-gradient(#FF6B35, #4ECDC4); }
    .fec3d-selo__corpo { padding: 12px 16px; display: grid; gap: 3px; max-width: 300px; }
    .fec3d-selo__corpo strong { font-size: 13px; letter-spacing: -.01em; }
    .fec3d-selo__corpo span { font-size: 12px; color: #B8BFC9; line-height: 1.35; }
    .fec3d-selo__corpo small {
      font-size: 11px; color: #8B939F;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    @keyframes fec3dEntra { from { opacity: 0; transform: translateY(10px); } }
    @media (prefers-reduced-motion: reduce) {
      #fec3d-selo { animation: none; transition: none; }
    }`;
  (document.head || document.documentElement).appendChild(estilo);
})();
