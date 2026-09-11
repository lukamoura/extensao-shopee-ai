/**
 * campos.js — controles que NÃO são <input>.
 *
 * Categoria e atributos no Seller Center são componentes customizados:
 * cascata de colunas, dropdowns que renderizam a lista só depois do clique,
 * e um painel de atributos que nem existe no DOM antes da categoria ser
 * escolhida. Nada disso responde a setter nativo — precisa de clique
 * simulado e espera pela renderização.
 */
globalThis.FEC3D = globalThis.FEC3D || {};

globalThis.FEC3D.campos = (() => {
  'use strict';

  const { dom, config } = globalThis.FEC3D;
  const { normalizar, esperar } = dom;

  /** Elementos que costumam ser opção de lista em qualquer design system. */
  const SELETORES_OPCAO = [
    '[role="option"]',
    'li[class*="option"]',
    'li[class*="item"]',
    'div[class*="option"]',
    'div[class*="cascader"] li',
    '[class*="dropdown"] li',
    '[class*="select"] li',
  ].join(',');

  const SELETORES_CONFIRMAR = ['button', '[role="button"]', '[class*="btn"]'].join(',');

  /** Contêineres que a Shopee usa para modal, popover e dropdown. */
  const SELETORES_POPUP = [
    '[role="dialog"]',
    '[role="listbox"]',
    '[class*="modal"]',
    '[class*="Modal"]',
    '[class*="popover"]',
    '[class*="dropdown"]',
    '[class*="cascader"]',
    '[class*="select-menu"]',
  ].join(',');

  const visivel = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  /**
   * Clique que passa por componentes que escutam mousedown/pointerdown em
   * vez de click (Ant Design, Semi, e o design system da Shopee fazem isso).
   */
  function clicar(el) {
    if (!el) return false;
    const opcoes = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opcoes));
    el.dispatchEvent(new MouseEvent('mousedown', opcoes));
    el.dispatchEvent(new PointerEvent('pointerup', opcoes));
    el.dispatchEvent(new MouseEvent('mouseup', opcoes));
    el.dispatchEvent(new MouseEvent('click', opcoes));
    return true;
  }

  const instantaneoPopups = () => new Set(document.querySelectorAll(SELETORES_POPUP));

  /**
   * Espera um contêiner que NÃO existia antes do clique.
   *
   * Isso é o que separa o modal de categoria do resto da página. A tela de
   * cadastro tem "Categorias Recomendadas" com caminhos de categoria escritos
   * soltos; buscar no documento inteiro casava com esse texto e a cascata
   * parava no primeiro nível.
   */
  async function esperarPopup(antes, { timeout = 4000 } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      for (const el of document.querySelectorAll(SELETORES_POPUP)) {
        if (!antes.has(el) && visivel(el) && el.textContent.trim().length > 20) {
          return el;
        }
      }
      await esperar(120);
    }
    return null;
  }

  /**
   * Procura uma opção visível com o texto dado.
   *
   * `raiz` limita a busca ao popup aberto. Sem raiz, exige texto exato —
   * casar parcialmente no documento inteiro é como a cascata errava antes.
   */
  async function acharOpcao(texto, { timeout = 6000, raiz = null } = {}) {
    const alvo = normalizar(texto);
    if (!alvo) return null;
    const inicio = Date.now();
    const escopo = raiz || document;

    while (Date.now() - inicio < timeout) {
      const candidatos = [...escopo.querySelectorAll(SELETORES_OPCAO)].filter(visivel);

      // exato primeiro — evita casar "Casa" quando o alvo é "Casa e Jardim"
      const exato = candidatos.find((el) => normalizar(el.textContent) === alvo);
      if (exato) return exato;

      if (raiz) {
        const parcial = candidatos.find((el) => {
          const t = normalizar(el.textContent);
          return t.length < alvo.length + 25 && t.includes(alvo);
        });
        if (parcial) return parcial;
      }

      await esperar(180);
    }
    return null;
  }

  /** Acha o campo de busca dentro do seletor de categoria, se existir. */
  async function acharBusca({ timeout = 2500, raiz = document } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const campo = [...raiz.querySelectorAll('input[type="text"], input:not([type])')]
        .filter(visivel)
        .find((el) => {
          const dica = normalizar(el.placeholder || el.getAttribute('aria-label') || '');
          return dica.includes('buscar') || dica.includes('pesquis') || dica.includes('search');
        });
      if (campo) return campo;
      await esperar(150);
    }
    return null;
  }

  /** Clica no botão de confirmação de um modal, se houver. */
  async function confirmar(raiz = document) {
    await esperar(300);
    const rotulos = ['confirmar', 'confirm', 'ok', 'salvar', 'aplicar'];
    const botao = [...raiz.querySelectorAll(SELETORES_CONFIRMAR)]
      .filter(visivel)
      .find((el) => {
        const t = normalizar(el.textContent);
        return t.length < 20 && rotulos.some((r) => t === r || t.startsWith(r));
      });
    if (botao) {
      clicar(botao);
      await esperar(500);
      return true;
    }
    return false;
  }

  function fecharPopup() {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    clicar(document.body);
  }

  /**
   * Define a categoria percorrendo o caminho completo.
   *
   * Tenta a busca primeiro (um passo, muito mais confiável) e cai para a
   * cascata coluna a coluna se não houver campo de busca.
   *
   * @param {string[]} caminho ex.: ['Casa e Decoração', 'Decoração', 'Estatuetas']
   * @returns {{ok: boolean, via?: string, parouEm?: string}}
   */
  async function definirCategoria(caminho) {
    if (!caminho?.length) return { ok: false, parouEm: 'caminho vazio' };

    const gatilho = dom.acharCampoPorRotulo(config.campos.categoria, {
      incluirSelecao: true,
    });
    if (!gatilho) return { ok: false, parouEm: 'campo de categoria não encontrado' };

    const antes = instantaneoPopups();
    clicar(gatilho);

    let popup = await esperarPopup(antes);

    // Alguns layouts só abrem o modal pelo ícone de lápis ao lado do campo.
    if (!popup) {
      const lapis = gatilho
        .closest('[class*="form-item"], [class*="FormItem"], div')
        ?.querySelector('[class*="edit"], [class*="pencil"], svg');
      if (lapis) {
        clicar(lapis);
        popup = await esperarPopup(antes);
      }
    }

    if (!popup) {
      return { ok: false, parouEm: 'o seletor de categoria não abriu' };
    }

    // --- caminho A: busca pela folha ---------------------------------------
    const folha = caminho[caminho.length - 1];
    const busca = await acharBusca({ raiz: popup });
    if (busca) {
      dom.definirValor(busca, folha);
      await esperar(800);
      const resultado = await acharOpcao(folha, { timeout: 4000, raiz: popup });
      if (resultado) {
        clicar(resultado);
        await confirmar(popup);
        return { ok: true, via: 'busca' };
      }
    }

    // --- caminho B: cascata nível a nível -----------------------------------
    for (const nivel of caminho) {
      const opcao = await acharOpcao(nivel, { timeout: 6000, raiz: popup });
      if (!opcao) {
        fecharPopup();
        return { ok: false, via: 'cascata', parouEm: nivel };
      }
      clicar(opcao);
      await esperar(600); // a coluna seguinte só renderiza depois do fetch
    }

    await confirmar(popup);
    return { ok: true, via: 'cascata' };
  }

  /** Um campo é "gatilho de seleção" se não aceita digitação direta. */
  const ehSelecao = (el) =>
    el.readOnly ||
    el.tagName === 'DIV' ||
    el.getAttribute('role') === 'combobox' ||
    el.getAttribute('aria-haspopup') === 'listbox';

  /**
   * Preenche o painel de atributos. Só existe depois da categoria escolhida,
   * então este passo espera o painel aparecer.
   *
   * @param {{nome: string, valor: string}[]} atributos
   * @returns {{nome: string, estado: 'ok'|'sem-campo'|'sem-opcao'}[]}
   */
  async function preencherAtributos(atributos) {
    const resultados = [];
    if (!atributos?.length) return resultados;

    await esperar(1200); // painel de atributos renderiza após a categoria

    for (const { nome, valor } of atributos) {
      const campo = dom.acharCampoPorRotulo([nome], { incluirSelecao: true });

      if (!campo) {
        resultados.push({ nome, estado: 'sem-campo' });
        continue;
      }

      if (ehSelecao(campo)) {
        const antes = instantaneoPopups();
        clicar(campo);
        const popup = await esperarPopup(antes, { timeout: 2500 });
        const opcao = await acharOpcao(valor, { timeout: 2500, raiz: popup });
        if (opcao) {
          clicar(opcao);
          resultados.push({ nome, estado: 'ok' });
        } else {
          fecharPopup();
          resultados.push({ nome, estado: 'sem-opcao' });
        }
      } else {
        dom.definirValor(campo, valor);
        resultados.push({ nome, estado: 'ok' });
      }

      await esperar(250);
    }

    return resultados;
  }

  return { clicar, acharOpcao, definirCategoria, preencherAtributos, visivel };
})();
