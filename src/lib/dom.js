/**
 * dom.js — utilitários compartilhados pelos content scripts.
 *
 * O ponto central: o Seller Center é React. Atribuir `input.value = x`
 * altera o DOM mas não o estado do componente, e o valor some no primeiro
 * re-render. Por isso todo preenchimento passa por `definirValor`, que usa
 * o setter nativo do prototype e depois dispara os eventos que o React
 * escuta.
 */
globalThis.FEC3D = globalThis.FEC3D || {};

globalThis.FEC3D.dom = (() => {
  'use strict';

  const normalizar = (t) =>
    String(t ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Espera um elemento aparecer. Resolve com null se estourar o tempo. */
  async function esperarElemento(seletor, { timeout = 10000, raiz = document } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const el = raiz.querySelector(seletor);
      if (el) return el;
      await esperar(150);
    }
    return null;
  }

  /** Escreve num input/textarea de forma que o React perceba. */
  function definirValor(el, valor) {
    if (!el) return false;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return false;

      el.focus();
      setter.call(el, String(valor));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }

    // Editores ricos (a descrição às vezes é contenteditable)
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, String(valor));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    return false;
  }

  /**
   * Acha o input associado a um rótulo visível.
   * Estratégia em camadas, da mais confiável para a mais tosca.
   *
   * @param {string[]} rotulos
   * @param {{incluirSelecao?: boolean}} opcoes
   *   incluirSelecao: aceita também gatilhos de dropdown (readOnly, div com
   *   role=combobox). Necessário para categoria e atributos.
   */
  function acharCampoPorRotulo(rotulos, { incluirSelecao = false } = {}) {
    const alvos = rotulos.map(normalizar);
    const { containersFormItem } = globalThis.FEC3D.config;
    const serve = (el) => ehPreenchivel(el, incluirSelecao);

    const seletorCampos = incluirSelecao
      ? 'input, textarea, [contenteditable="true"], [role="combobox"], [class*="select"] > div, [aria-haspopup="listbox"]'
      : 'input, textarea, [contenteditable="true"]';

    // 1. <label for="id">
    for (const label of document.querySelectorAll('label[for]')) {
      if (alvos.some((a) => normalizar(label.textContent).includes(a))) {
        const el = document.getElementById(label.getAttribute('for'));
        if (el && serve(el)) return el;
      }
    }

    // 2. rótulo dentro de um container de form-item
    for (const seletorContainer of containersFormItem) {
      for (const container of document.querySelectorAll(seletorContainer)) {
        const texto = normalizar(container.textContent).slice(0, 120);
        if (!alvos.some((a) => texto.includes(a))) continue;
        const el = [...container.querySelectorAll(seletorCampos)].find(serve);
        if (el) return el;
      }
    }

    // 3. placeholder ou aria-label
    for (const el of document.querySelectorAll(seletorCampos)) {
      const dica = normalizar(
        el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''
      );
      if (dica && alvos.some((a) => dica.includes(a)) && serve(el)) return el;
    }

    return null;
  }

  function ehPreenchivel(el, incluirSelecao = false) {
    if (el.disabled) return false;
    if (el.type === 'hidden' || el.type === 'file') return false;
    if (el.readOnly && !incluirSelecao) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * Injeta arquivos num <input type="file"> como se o usuário tivesse
   * escolhido pelo seletor do sistema.
   */
  function injetarArquivos(input, arquivos) {
    if (!input || !arquivos?.length) return false;
    const dt = new DataTransfer();
    for (const arq of arquivos) dt.items.add(arq);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Baixa uma URL de imagem e devolve um File pronto para o input. */
  async function urlParaArquivo(url, nome) {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`Imagem não baixou (HTTP ${resp.status})`);
    const blob = await resp.blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    return new File([blob], `${nome}.${ext}`, { type: blob.type || 'image/jpeg' });
  }

  return {
    normalizar,
    esperar,
    esperarElemento,
    definirValor,
    acharCampoPorRotulo,
    injetarArquivos,
    urlParaArquivo,
  };
})();
