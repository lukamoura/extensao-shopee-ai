/**
 * selectors.js — o único arquivo que você deve precisar mexer quando a
 * Shopee mudar o layout. A lógica não referencia classe CSS em lugar nenhum:
 * tudo é localizado por rótulo visível.
 *
 * Cada campo lista rótulos em ordem de preferência. O primeiro que casar vence.
 */
globalThis.FEC3D = globalThis.FEC3D || {};

globalThis.FEC3D.config = {
  /** URLs onde o painel de preenchimento deve aparecer. */
  rotasCadastro: [
    /\/portal\/product\/new/i,
    /\/portal\/product\/\d+\/edit/i,
    /\/portal\/product\/create/i,
  ],

  /** URLs de onde dá para extrair um anúncio. */
  rotasExtracao: [
    /shopee\.com\.br\/.*-i\.\d+\.\d+/i, // página pública de produto
    /\/portal\/product\/list/i,
    /\/portal\/product\/\d+/i,
  ],

  /**
   * Mapa campo → rótulos aceitos no formulário.
   * Comparação é case-insensitive, sem acento e por "contém".
   */
  campos: {
    nome: ['nome do produto', 'nome do item', 'product name'],
    descricao: ['descrição do produto', 'descricao', 'description'],
    categoria: ['categoria', 'category'],
    marca: ['marca', 'brand'],
    preco: ['preço', 'preco', 'price'],
    estoque: ['estoque', 'quantidade', 'stock'],
    sku: ['sku', 'código do produto', 'codigo de referencia'],
    peso: ['peso', 'weight'],
    comprimento: ['comprimento', 'length'],
    largura: ['largura', 'width'],
    altura: ['altura', 'height'],
    prazoEnvio: ['prazo de envio', 'dias para envio'],
  },

  /** Container que envolve rótulo + input no design system da Shopee. */
  containersFormItem: [
    '[class*="form-item"]',
    '[class*="FormItem"]',
    '[class*="edit-row"]',
    '.shopee-form-item',
    'label',
  ],

  /** Input de arquivo das imagens do produto. */
  inputImagens: 'input[type="file"][accept*="image"]',

  /** Limites da Shopee BR (usados só para avisar, nunca para bloquear). */
  limites: {
    tituloMax: 120,
    descricaoMax: 3000,
    imagensMax: 9,
  },
};
