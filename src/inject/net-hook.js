/**
 * net-hook.js — roda no MAIN world da página.
 *
 * A Shopee monta a página de produto com as próprias chamadas internas
 * (/api/v4/pdp/..., /api/v4/item/..., /api/selleraccount/...). Em vez de
 * raspar o DOM — que muda de classe toda semana — a gente escuta essas
 * respostas e repassa o JSON cru para o content script via postMessage.
 *
 * Nada aqui interpreta os dados. Só captura e entrega.
 */
(() => {
  'use strict';

  const CANAL = 'FEC3D_SHOPEE_NET';

  // Rotas que interessam. Propositalmente frouxas: se a Shopee renomear
  // "get_pc" para "get_pc_v2", o filtro continua pegando.
  const PADROES = [
    /\/api\/v\d+\/pdp\//i,
    /\/api\/v\d+\/item\/get/i,
    /\/api\/v\d+\/product\//i,
    /\/api\/.*\/product\/get_product_info/i,
    /get_item_detail/i,
  ];

  // Endpoints que SÓ trazem produto leve. Deixar passar polui a captura com
  // recomendações que têm nome e preço mas nenhum detalhe.
  const RUIDO = [
    /recommend/i,
    /hot_sale/i,
    /similar/i,
    /also_?like/i,
    /bundle_deal/i,
    /you_?may_?like/i,
    /search_items/i,
  ];

  const interessa = (url) => {
    try {
      const u = String(url);
      if (RUIDO.some((p) => p.test(u))) return false;
      return PADROES.some((p) => p.test(u));
    } catch {
      return false;
    }
  };

  const entregar = (url, texto) => {
    if (!texto || texto.length > 4_000_000) return;
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      return; // não era JSON, ignora
    }
    window.postMessage({ canal: CANAL, url: String(url), dados }, window.location.origin);
  };

  // ---- fetch ---------------------------------------------------------------
  const fetchOriginal = window.fetch;
  window.fetch = async function (...args) {
    const resposta = await fetchOriginal.apply(this, args);
    try {
      const url = args[0]?.url ?? args[0];
      if (interessa(url)) {
        resposta
          .clone()
          .text()
          .then((t) => entregar(url, t))
          .catch(() => {});
      }
    } catch {
      /* nunca quebrar a página do usuário por causa do hook */
    }
    return resposta;
  };

  // ---- XMLHttpRequest ------------------------------------------------------
  const abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__fec3dUrl = url;
    return abrirOriginal.call(this, metodo, url, ...resto);
  };

  const enviarOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (interessa(this.__fec3dUrl) && typeof this.responseText === 'string') {
          entregar(this.__fec3dUrl, this.responseText);
        }
      } catch {
        /* idem */
      }
    });
    return enviarOriginal.apply(this, args);
  };

  // Marca presença para o content script saber que o hook subiu.
  window.postMessage({ canal: CANAL, pronto: true }, window.location.origin);
})();
