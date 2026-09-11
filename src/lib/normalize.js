/**
 * normalize.js — traduz o JSON cru da API interna da Shopee para um objeto
 * de produto estável.
 *
 * A Shopee muda o envelope da resposta com frequência (data.item, data.data,
 * response.item...). Em vez de fixar um caminho, a gente varre a árvore
 * procurando o primeiro nó que "parece um produto".
 */
globalThis.FEC3D = globalThis.FEC3D || {};

globalThis.FEC3D.normalize = (() => {
  'use strict';

  const CDN = 'https://down-br.img.susercontent.com/file/';

  /** Preço da Shopee vem em micros. 2990000 → 29.90 */
  const dinheiro = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 100000 ? +(n / 100000).toFixed(2) : +n.toFixed(2);
  };

  const imagem = (hash) =>
    !hash ? null : String(hash).startsWith('http') ? String(hash) : CDN + hash;

  /**
   * Um nó é produto se tem nome E um itemid.
   *
   * Antes bastava nome + preço, e isso deixava entrar opção de frete:
   * "Expresso Aéreo" tem nome e tem preço. Canal de entrega usa channelid,
   * cupom usa promotionid — nenhum tem itemid. O itemid é o que separa
   * produto de qualquer outra coisa que a página carrega.
   */
  const pareceProduto = (o) =>
    o &&
    typeof o === 'object' &&
    typeof o.name === 'string' &&
    o.name.length > 3 &&
    (o.itemid !== undefined || o.item_id !== undefined);

  /**
   * Quão completo é este nó.
   *
   * A resposta da página de produto vem cheia de objetos "leves" —
   * recomendações, similares, "quem viu também viu" — que têm nome e preço
   * mas nenhum detalhe. Pegar o primeiro que casa é errado: quase sempre é
   * um desses. Então pontuamos e ficamos com o mais rico.
   */
  function riqueza(o) {
    let p = 0;
    if (o.description?.length > 40) p += 10;
    if (o.categories?.length) p += 10 * o.categories.length;
    if (o.attributes?.length) p += 6 * o.attributes.length;
    if (o.models?.length) p += 3 * o.models.length;
    if (o.dimension) p += 5;
    if (o.weight) p += 3;
    if (o.brand || o.brand_name) p += 2;
    p += Math.min((o.images || o.image_list || []).length, 9) * 2;
    return p;
  }

  /** Extrai o itemid da URL do anúncio: .../nome-i.SHOPID.ITEMID */
  function idDaUrl(url) {
    const m = /-i\.(\d+)\.(\d+)/.exec(String(url || location.href));
    return m ? { shopid: m[1], itemid: m[2] } : null;
  }

  /**
   * Varre a árvore inteira, junta todos os candidatos e devolve o melhor.
   * Se a URL informa o itemid, o nó com esse id ganha de qualquer outro —
   * é a única forma de ter certeza de que não pegamos um "similar".
   */
  function acharNoProduto(raiz, url, limite = 8000) {
    const alvo = idDaUrl(url);
    const candidatos = [];
    const fila = [raiz];
    let visitados = 0;

    while (fila.length && visitados < limite) {
      const atual = fila.shift();
      visitados++;
      if (pareceProduto(atual)) candidatos.push(atual);
      if (atual && typeof atual === 'object') {
        for (const v of Object.values(atual)) {
          if (v && typeof v === 'object') fila.push(v);
        }
      }
    }

    if (!candidatos.length) return null;

    // Se a URL diz qual é o item, só ele serve. Sem esse corte, qualquer
    // objeto solto da página virava "anúncio capturado".
    if (alvo) {
      const exatos = candidatos.filter(
        (c) => String(c.itemid ?? c.item_id ?? '') === alvo.itemid
      );
      return exatos.length
        ? exatos.sort((a, b) => riqueza(b) - riqueza(a))[0]
        : null;
    }

    return candidatos.sort((a, b) => riqueza(b) - riqueza(a))[0];
  }

  function variacoes(item) {
    const modelos = Array.isArray(item.models) ? item.models : [];
    return modelos
      .map((m) => ({
        nome: m.name || '',
        preco: dinheiro(m.price ?? m.price_min),
        estoque: Number(m.stock ?? m.normal_stock ?? 0) || 0,
        sku: m.sku || '',
      }))
      .filter((v) => v.nome);
  }

  function caminhoCategoria(item) {
    const cats = item.categories || item.category_path || [];
    return cats
      .map((c) => (typeof c === 'string' ? c : c.display_name || c.name || ''))
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function atributos(item) {
    // A Shopee já usou pelo menos três nomes para esta lista.
    const attrs = [
      ...(Array.isArray(item.attributes) ? item.attributes : []),
      ...(Array.isArray(item.product_attributes) ? item.product_attributes : []),
      ...(Array.isArray(item.attribute_list) ? item.attribute_list : []),
    ];

    const valorDe = (a) => {
      const v =
        a.value ?? a.attribute_value ?? a.value_name ?? a.display_value ?? null;
      if (v) return String(v);
      const lista = a.values || a.value_list || [];
      const primeiro = lista[0];
      if (!primeiro) return '';
      return String(primeiro.value ?? primeiro.name ?? primeiro);
    };

    return attrs
      .map((a) => ({
        nome: String(a.name || a.attribute_name || a.display_name || '').trim(),
        valor: valorDe(a).trim(),
      }))
      .filter((a) => a.nome && a.valor);
  }

  /**
   * @param {object} bruto  JSON cru capturado pelo net-hook
   * @param {string} url    URL de origem, guardada como procedência
   * @returns {object|null} produto normalizado
   */
  function paraProduto(bruto, url) {
    const item = acharNoProduto(bruto, url);
    if (!item) return null;

    const imagens = (item.images || item.image_list || [])
      .map(imagem)
      .filter(Boolean)
      .slice(0, globalThis.FEC3D.config.limites.imagensMax);

    if (!imagens.length && item.image) imagens.push(imagem(item.image));

    const dim = item.dimension || {};

    return {
      id: `${item.shopid ?? item.shop_id ?? 0}_${item.itemid ?? item.item_id ?? Date.now()}`,
      capturadoEm: new Date().toISOString(),
      origem: url,

      nome: (item.name || '').trim(),
      descricao: (item.description || '').trim(),
      marca: item.brand || item.brand_name || '',
      categoria: caminhoCategoria(item).join(' > '),
      /** Cada nível separado — é o que a cascata do Seller Center precisa. */
      categoriaPath: caminhoCategoria(item),
      categoriaIds: (item.categories || [])
        .map((c) => c.catid ?? c.category_id)
        .filter(Boolean),

      preco: dinheiro(item.price ?? item.price_min),
      precoMin: dinheiro(item.price_min),
      precoMax: dinheiro(item.price_max),
      estoque: Number(item.stock ?? item.normal_stock ?? 0) || 0,
      sku: item.item_sku || item.sku || '',

      peso: Number(item.weight ?? 0) || null,
      comprimento: Number(dim.length ?? 0) || null,
      largura: Number(dim.width ?? 0) || null,
      altura: Number(dim.height ?? 0) || null,

      imagens,
      variacoes: variacoes(item),
      atributos: atributos(item),

      /** Preenchido depois, se a pessoa gerar texto com IA. */
      nomeGerado: '',
      descricaoGerada: '',
    };
  }

  return { paraProduto, dinheiro, imagem };
})();
