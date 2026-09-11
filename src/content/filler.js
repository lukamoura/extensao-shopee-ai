/**
 * filler.js — content script do Seller Center.
 *
 * O padrão de uso é "aproveitar a estrutura, refazer o conteúdo": copiar
 * categoria e características do anúncio de referência, e escrever título,
 * descrição e fotos do zero. Por isso os campos autorais vêm desmarcados.
 */
(() => {
  'use strict';

  const { dom, campos, config } = globalThis.FEC3D;

  const naRotaDeCadastro = () =>
    config.rotasCadastro.some((r) => r.test(location.pathname));

  /**
   * O que copiar. Categoria e características entram marcadas porque são
   * taxonomia da Shopee, não conteúdo autoral — e são o que dá mais trabalho
   * de refazer à mão.
   */
  const GRUPOS = [
    { chave: 'categoria', rotulo: 'Categoria', padrao: true },
    { chave: 'atributos', rotulo: 'Características', padrao: true },
    { chave: 'dimensoes', rotulo: 'Peso e dimensões', padrao: true },
    { chave: 'comercial', rotulo: 'Preço e estoque', padrao: true },
    { chave: 'texto', rotulo: 'Título e descrição', padrao: true },
    { chave: 'fotos', rotulo: 'Fotos do original', padrao: true },
  ];

  let painel = null;
  let produtoAtual = null;

  // ---- painel ------------------------------------------------------------
  function montarPainel() {
    if (painel || !naRotaDeCadastro()) return;

    painel = document.createElement('div');
    painel.id = 'fec3d-painel';
    painel.innerHTML = `
      <header class="fec3d-painel__topo">
        <span class="fec3d-painel__marca">Molde</span>
        <button class="fec3d-painel__fechar" type="button" aria-label="Fechar painel">×</button>
      </header>
      <div class="fec3d-painel__conteudo">
        <p class="fec3d-painel__vazio">Nenhum anúncio selecionado. Abra a extensão e escolha um.</p>
      </div>
      <footer class="fec3d-painel__base">
        <button class="fec3d-btn fec3d-btn--principal" type="button" data-acao="preencher" disabled>
          Preencher formulário
        </button>
      </footer>`;
    document.body.appendChild(painel);

    painel.querySelector('.fec3d-painel__fechar').onclick = () => {
      painel.remove();
      painel = null;
    };
    painel.querySelector('[data-acao="preencher"]').onclick = preencher;

    carregarSelecionado();
  }

  async function carregarSelecionado() {
    const { ok, produto } = await chrome.runtime.sendMessage({ tipo: 'OBTER_SELECIONADO' });
    if (!ok || !produto || !painel) return;
    produtoAtual = produto;

    const disponivel = {
      categoria: produto.categoriaPath?.length > 0,
      atributos: produto.atributos?.length > 0,
      dimensoes: Boolean(produto.peso || produto.comprimento),
      comercial: Boolean(produto.preco || produto.estoque),
      texto: Boolean(produto.nome),
      fotos: produto.imagens?.length > 0,
    };

    const opcoes = GRUPOS.map(({ chave, rotulo, padrao }) => {
      const tem = disponivel[chave];
      return `
        <label class="fec3d-opcao${tem ? '' : ' fec3d-opcao--inativa'}">
          <input type="checkbox" value="${chave}"
            ${padrao && tem ? 'checked' : ''} ${tem ? '' : 'disabled'}>
          <span>${rotulo}</span>
          <em>${detalhe(chave, produto)}</em>
        </label>`;
    }).join('');

    const faltando = ['categoria', 'atributos'].filter((c) => !disponivel[c]);
    const aviso = faltando.length
      ? `<div class="fec3d-alerta">
           <strong>Captura incompleta</strong>
           Não vieram: ${faltando.map((f) => f === 'atributos' ? 'características' : f).join(' e ')}.
           Volte no anúncio, recarregue a página (F5) e espere carregar tudo
           antes de trocar de aba.
         </div>`
      : '';

    painel.querySelector('.fec3d-painel__conteudo').innerHTML = `
      <div class="fec3d-card">
        <div>
          <strong>${escapar(produto.nome)}</strong>
          <span class="fec3d-meta">${escapar(produto.categoria || 'sem categoria')}</span>
        </div>
      </div>
      ${aviso}
      <div class="fec3d-opcoes">${opcoes}</div>
      ${montarReferencia(produto)}
      <div class="fec3d-log" role="status" aria-live="polite"></div>`;

    ligarReferencia();
    painel.querySelector('[data-acao="preencher"]').disabled = false;
  }

  /**
   * Bloco de consulta. Fica sempre visível, mesmo para os grupos que você
   * escolheu NÃO preencher: você continua precisando ver como o original
   * descreve as medidas, o material e a embalagem enquanto escreve o seu.
   */
  function montarReferencia(p) {
    const linha = (rotulo, valor) =>
      valor ? `<div class="fec3d-ref__linha"><span>${rotulo}</span><em>${escapar(valor)}</em></div>` : '';

    const caracteristicas = (p.atributos || [])
      .map((a) => linha(escapar(a.nome), a.valor))
      .join('');

    const fotos = (p.imagens || [])
      .map(
        (url, i) =>
          `<a href="${url}" target="_blank" rel="noopener" title="Abrir foto ${i + 1}">
             <img src="${url}" alt="Foto ${i + 1} do original" loading="lazy"></a>`
      )
      .join('');

    return `
      <details class="fec3d-ref">
        <summary>Dados do original</summary>

        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho">
            <span>Título</span>
            <button class="fec3d-copiar" type="button" data-copiar="nome">copiar</button>
          </div>
          <p class="fec3d-ref__texto">${escapar(p.nome)}</p>
        </div>

        ${p.descricao ? `
        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho">
            <span>Descrição</span>
            <button class="fec3d-copiar" type="button" data-copiar="descricao">copiar</button>
          </div>
          <p class="fec3d-ref__texto fec3d-ref__texto--longo">${escapar(p.descricao)}</p>
        </div>` : ''}

        ${caracteristicas ? `
        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho"><span>Características</span></div>
          ${caracteristicas}
        </div>` : ''}

        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho"><span>Números</span></div>
          ${linha('Preço', p.preco ? `R$ ${p.preco.toFixed(2).replace('.', ',')}` : '')}
          ${linha('Faixa', p.precoMin && p.precoMax && p.precoMin !== p.precoMax
            ? `R$ ${p.precoMin.toFixed(2)} – ${p.precoMax.toFixed(2)}` : '')}
          ${linha('Estoque', p.estoque || '')}
          ${linha('Peso', p.peso ? `${p.peso} g` : '')}
          ${linha('Medidas', p.comprimento
            ? `${p.comprimento} × ${p.largura} × ${p.altura} cm` : '')}
          ${linha('Marca', p.marca)}
          ${linha('SKU', p.sku)}
        </div>

        ${p.variacoes?.length ? `
        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho"><span>Variações</span></div>
          ${p.variacoes.map((v) => linha(escapar(v.nome),
            `${v.preco ? 'R$ ' + v.preco.toFixed(2) : ''} ${v.estoque ? '· ' + v.estoque + ' un' : ''}`
          )).join('')}
        </div>` : ''}

        ${fotos ? `
        <div class="fec3d-ref__bloco">
          <div class="fec3d-ref__cabecalho"><span>Fotos do original</span></div>
          <div class="fec3d-ref__fotos">${fotos}</div>
        </div>` : ''}

        <a class="fec3d-ref__origem" href="${p.origem}" target="_blank" rel="noopener">
          ver anúncio de origem
        </a>
      </details>`;
  }

  function ligarReferencia() {
    for (const botao of painel.querySelectorAll('.fec3d-copiar')) {
      botao.onclick = async () => {
        const texto = produtoAtual?.[botao.dataset.copiar] || '';
        try {
          await navigator.clipboard.writeText(texto);
          botao.textContent = 'copiado';
        } catch {
          botao.textContent = 'falhou';
        }
        setTimeout(() => (botao.textContent = 'copiar'), 1600);
      };
    }
  }

  function detalhe(chave, p) {
    switch (chave) {
      case 'categoria':
        return p.categoriaPath?.length ? `${p.categoriaPath.length} níveis` : '—';
      case 'atributos':
        return p.atributos?.length ? `${p.atributos.length} campos` : '—';
      case 'dimensoes':
        return p.peso ? `${p.peso} g` : p.comprimento ? 'parcial' : '—';
      case 'comercial':
        return p.preco ? `R$ ${p.preco.toFixed(2).replace('.', ',')}` : '—';
      case 'texto':
        return p.nomeGerado ? 'reescrito pela IA' : 'do original (sem reescrita)';
      case 'fotos':
        return p.imagens?.length ? `${p.imagens.length} img` : '—';
      default:
        return '';
    }
  }

  const selecionados = () =>
    new Set(
      [...painel.querySelectorAll('.fec3d-opcoes input:checked')].map((i) => i.value)
    );

  const logar = (texto, estado = 'ok') => {
    const log = painel?.querySelector('.fec3d-log');
    if (!log) return;
    const linha = document.createElement('div');
    linha.className = `fec3d-log__linha fec3d-log__linha--${estado}`;
    linha.textContent = texto;
    log.appendChild(linha);
    log.scrollTop = log.scrollHeight;
  };

  // ---- preenchimento -----------------------------------------------------
  async function preencher() {
    if (!produtoAtual) return;

    const botao = painel.querySelector('[data-acao="preencher"]');
    const quer = selecionados();
    botao.disabled = true;
    botao.textContent = 'Preenchendo…';
    painel.querySelector('.fec3d-log').innerHTML = '';

    const p = produtoAtual;

    // A categoria vem primeiro sempre: o painel de características só é
    // renderizado depois que ela é definida.
    if (quer.has('categoria')) {
      logar(`categoria: ${p.categoria}`);
      const r = await campos.definirCategoria(p.categoriaPath);
      if (r.ok) {
        logar(`categoria definida (via ${r.via})`);
      } else {
        logar(`categoria parou em "${r.parouEm}" — escolha à mão`, 'erro');
        quer.delete('atributos');
        logar('características puladas: dependem da categoria', 'aviso');
      }
    }

    if (quer.has('atributos')) {
      const resultados = await campos.preencherAtributos(p.atributos);
      const ok = resultados.filter((r) => r.estado === 'ok');
      logar(`${ok.length} de ${resultados.length} características preenchidas`);

      for (const r of resultados.filter((r) => r.estado !== 'ok')) {
        const motivo = r.estado === 'sem-campo'
          ? 'campo não existe nesta categoria'
          : 'valor não está na lista';
        logar(`${r.nome}: ${motivo}`, 'aviso');
      }
    }

    const simples = [];
    if (quer.has('dimensoes')) {
      simples.push(
        ['peso', p.peso], ['comprimento', p.comprimento],
        ['largura', p.largura], ['altura', p.altura]
      );
    }
    if (quer.has('comercial')) {
      simples.push(['preco', p.preco], ['estoque', p.estoque], ['sku', p.sku]);
    }
    if (quer.has('texto')) {
      // Título e marca são campos simples. A descrição é tratada à parte
      // (função preencherDescricao) porque costuma ficar em outra aba e num
      // editor rico — preencher aqui, no meio do laço, não funcionava.
      simples.push(
        ['nome', p.nomeGerado || p.nome],
        ['marca', p.marca]
      );
    }

    for (const [chave, valor] of simples) {
      if (valor === null || valor === undefined || valor === '') continue;
      const campo = dom.acharCampoPorRotulo(config.campos[chave]);
      if (!campo) {
        logar(`${chave}: campo não encontrado`, 'aviso');
        continue;
      }
      dom.definirValor(campo, valor);
      logar(`${chave} preenchido`);
      await dom.esperar(120);
    }

    if (quer.has('fotos')) await enviarImagens(p);

    if (quer.has('texto')) {
      const desc = p.descricaoGerada || p.descricao;
      if (desc) await preencherDescricao(desc);
    }

    if (p.variacoes.length && !quer.has('comercial')) {
      logar(`original tinha ${p.variacoes.length} variações`, 'aviso');
    }

    logar('Revise tudo antes de publicar.', 'aviso');
    botao.textContent = 'Preencher de novo';
    botao.disabled = false;
  }

  async function enviarImagens(p) {
    const input = document.querySelector(config.inputImagens);
    if (!input) {
      logar('campo de imagens não encontrado', 'aviso');
      return;
    }
    try {
      const arquivos = [];
      for (const [i, url] of p.imagens.entries()) {
        arquivos.push(await dom.urlParaArquivo(url, `foto-${i + 1}`));
      }
      dom.injetarArquivos(input, arquivos);
      logar(`${arquivos.length} imagens enviadas`);
    } catch (erro) {
      logar(`imagens falharam: ${erro.message}`, 'erro');
    }
  }

  /**
   * A descrição fica na aba/seção "Descrição", que muitas vezes só é
   * renderizada depois de clicada. Abre essa aba antes de preencher.
   * Procura primeiro entre elementos que parecem aba; depois, qualquer
   * elemento cujo texto seja exatamente "Descrição".
   */
  async function abrirAbaDescricao() {
    const exato = (el) => {
      const t = dom.normalizar(el.textContent);
      return (t === 'descricao' || t === 'descricao do produto') &&
        el.getBoundingClientRect().width > 0;
    };
    const abas = [...document.querySelectorAll(
      '[role="tab"], [class*="tab"], [class*="Tab"], nav a, nav li'
    )].filter(exato);
    const outros = [...document.querySelectorAll('a, button, li, span, div')].filter(exato);
    const alvo = abas[0] || outros[0];
    if (!alvo) return false;
    alvo.click();
    await dom.esperar(700);
    return true;
  }

  async function preencherDescricao(texto) {
    let campo = dom.acharCampoPorRotulo(config.campos.descricao);
    if (!campo) {
      logar('procurando o editor de descrição…');
      await abrirAbaDescricao();
      campo = dom.acharCampoPorRotulo(config.campos.descricao);
    }
    if (!campo) {
      logar('descrição: editor não encontrado — abra a aba Descrição e cole à mão', 'aviso');
      return;
    }
    dom.definirValor(campo, texto);
    logar(`descrição preenchida${produtoAtual.descricaoGerada ? ' (texto da IA)' : ''}`);
  }

  const escapar = (t) =>
    String(t).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  // ---- ciclo de vida -----------------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tipo === 'ABRIR_PAINEL') {
      montarPainel();
      carregarSelecionado();
    }
  });

  // O botão flutuante avisa por evento, não por mensagem: os dois scripts
  // rodam no mesmo content world.
  window.addEventListener('fec3d:abrir-painel', () => {
    // Em outra tela do Seller Center, o botão leva para o cadastro.
    if (!naRotaDeCadastro()) {
      location.href = 'https://seller.shopee.com.br/portal/product/new';
      return;
    }
    if (painel) {
      painel.remove();
      painel = null;
      return;
    }
    montarPainel();
  });

  let urlAnterior = location.href;
  new MutationObserver(() => {
    if (location.href === urlAnterior) return;
    urlAnterior = location.href;
    if (naRotaDeCadastro()) montarPainel();
  }).observe(document.body, { childList: true, subtree: true });

  montarPainel();
})();
