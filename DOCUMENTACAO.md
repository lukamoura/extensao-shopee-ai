# Molde — Cadastro Shopee

Extensão Chrome (Manifest V3) que extrai dados de um anúncio da Shopee e
preenche o formulário de cadastro no Seller Center.

O caso de uso não é clonar anúncio: é **aproveitar a estrutura e refazer o
conteúdo**. Categoria e características são taxonomia da plataforma e dão
muito trabalho manual; título, descrição e fotos são autorais e devem ser
seus. A interface reflete isso — os grupos autorais vêm desmarcados.

---

## 1. Instalação

1. Descompactar numa pasta **definitiva**. O Chrome lê os arquivos desse
   local a cada inicialização; mover ou apagar quebra a extensão.
2. `chrome://extensions` → **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecionar a pasta que contém o
   `manifest.json` direto dentro dela
4. Fixar o ícone na barra (opcional — há também um botão flutuante na página)

Após editar código: botão de recarregar no cartão da extensão.

---

## 2. Fluxo

```
Anúncio público da Shopee
   ↓  net-hook intercepta as chamadas da própria página
   ↓  normalize escolhe o nó de produto e traduz
   ↓  extractor completa com raspagem do DOM
   ↓  background mescla com o que já havia e persiste
Seller Center → /portal/product/new
   ↓  filler: categoria (cascata) → características → campos simples
   ↓  painel mostra o que entrou, o que faltou e por quê
Você escreve título, descrição, sobe fotos e publica
```

---

## 3. Estrutura

```
manifest.json
src/
  inject/net-hook.js      captura na camada de rede (MAIN world)
  content/extractor.js    normaliza, raspa DOM, persiste
  content/filler.js       painel e preenchimento no Seller Center
  content/lancador.js     botão flutuante arrastável e gaveta
  lib/dom.js              setters React-safe, busca por rótulo, upload
  lib/campos.js           cascata de categoria e dropdowns de atributo
  lib/normalize.js        JSON cru da Shopee → objeto de produto
  config/selectors.js     rótulos e rotas  ← ponto de manutenção
  background.js           storage, mesclagem, chamadas de IA
popup/                    lista de capturados e configuração
```

---

## 4. Decisões técnicas

### 4.1 Captura pela rede, não pelo DOM

As classes CSS da Shopee são geradas no build e mudam com frequência.
Raspar HTML como fonte primária quebraria toda semana.

`net-hook.js` roda no **MAIN world**, embrulha `fetch` e `XMLHttpRequest` e
escuta as respostas que a própria página já faz para a API interna. O JSON
chega inteiro — preço, estoque, dimensões, variações, hashes das imagens.

O DOM é usado só como **reserva**, para o que a API não trouxer.

### 4.2 Preenchimento React-safe

O Seller Center é React. `input.value = x` altera o DOM mas não o estado do
componente: o valor desaparece no primeiro re-render.

`dom.definirValor()` usa o setter nativo do prototype e dispara
`input` → `change` → `blur`, que é o que o React escuta.

```js
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;
setter.call(el, valor);
el.dispatchEvent(new Event('input', { bubbles: true }));
```

### 4.3 Categoria e características não são inputs

Categoria é cascata que carrega cada coluna sob demanda. Características são
um painel que **só existe no DOM depois** da categoria ser escolhida. Por
isso a ordem de preenchimento é forçada: categoria sempre primeiro, e se ela
falhar, as características são puladas com aviso explícito.

`campos.js` simula a sequência real de eventos — `pointerdown` →
`mousedown` → `pointerup` → `mouseup` → `click` — porque esses componentes
escutam `mousedown`, não `click`.

Para a categoria, tenta primeiro o campo de busca do seletor com o nome da
folha (um passo, mais confiável) e cai para a cascata coluna a coluna.

### 4.4 Nenhuma classe CSS na lógica

A busca de campo é por rótulo visível, em camadas:
`<label for>` → container de form-item → `placeholder`/`aria-label`.
Os rótulos aceitos ficam todos em `config/selectors.js`.

### 4.5 Zero falha silenciosa

Todo campo que não é encontrado, toda característica cujo valor não existe
na lista da categoria e toda etapa que trava aparecem no log do painel, com
o motivo. O cadastro é da pessoa; ela precisa saber o que ficou de fora
antes de publicar.

---

## 5. Bugs encontrados e corrigidos

Vale registrar, porque explicam por que o código está como está.

| Sintoma | Causa | Correção |
|---|---|---|
| Só título e 1 foto eram capturados | `ultimoId` descartava capturas repetidas do mesmo item — e a captura pobre chega primeiro, bloqueando a boa | Removido o bloqueio; todas as respostas passam e são mescladas |
| Categoria e atributos sumiam depois de aparecer | `{...antigo, ...novo}` no background sobrescrevia arrays cheios com vazios | `mesclar()` compara campo a campo; o mais completo vence em qualquer ordem de chegada |
| Vinha um produto "similar" em vez do certo | Pegava o primeiro nó que parecia produto — quase sempre uma recomendação | Pontuação por riqueza + casamento por `itemid` da URL |
| Anúncios fantasma "Expresso Aéreo" | `pareceProduto` exigia só nome + preço, e opção de frete tem os dois | Passou a exigir `itemid`; frete usa `channelid`, cupom usa `promotionid` |
| Cascata parava no primeiro nível | `acharOpcao` varria o documento inteiro e casava com "Categorias Recomendadas", que tem caminhos escritos soltos na página | Busca escopada ao popup que apareceu **depois** do clique; fora dele, só texto exato |
| Características não vinham | A Shopee usa três nomes diferentes para a lista de atributos | Lê `attributes`, `product_attributes` e `attribute_list`, com valor em quatro formatos |
| Raspagem do DOM não achava nada | As respostas da API chegam antes da página renderizar | Passadas tardias em 2s, 5s e 9s; só salvam se melhorarem a captura |
| Chamada de IA falhava com chave válida | Identificador de modelo desatualizado no código | Atualizado; modelo agora é editável na interface |

---

## 6. Manutenção

A fragilidade está isolada em dois arquivos:

**Nada é capturado** → a Shopee mudou as rotas da API.
Ajustar `PADROES` em `src/inject/net-hook.js`. Para descobrir a rota nova:
DevTools → Network → filtro `api/v4` → ver qual chamada retorna os dados do
produto.

**Captura mas não preenche** → mudaram os rótulos do formulário.
Ajustar `campos` em `src/config/selectors.js`.

O array `RUIDO` no `net-hook.js` bloqueia endpoints de recomendação
(`recommend`, `hot_sale`, `similar`, `also_like`). Se voltarem a aparecer
capturas estranhas, é candidato a receber mais um padrão.

---

## 7. Configuração de IA (opcional)

Serve só para o botão **Reescrever**. Todo o resto funciona sem chave.

| Provedor | Onde pegar | Custo |
|---|---|---|
| **Gemini** (padrão) | `aistudio.google.com/apikey` | camada gratuita, sem cartão |
| Anthropic | `console.anthropic.com` → API keys | crédito pré-pago, mínimo US$ 5 |

Assinatura de consumidor **não** dá acesso de API — vale tanto para
Claude.ai Pro quanto para Google AI Plus. São produtos e medidores
separados. A camada gratuita do Gemini existe por conta própria,
independente de assinatura.

Detalhes de implementação:

- A chave do Gemini vai no cabeçalho `x-goog-api-key`, **não** em `?key=` na
  URL: URL entra em log de proxy e histórico do navegador.
- `responseMimeType: application/json` no Gemini, para receber JSON de
  verdade em vez de markdown com cerca.
- Erros HTTP traduzidos para texto legível (chave inválida, cota estourada,
  modelo inexistente) em vez do erro cru da API.
- Chaves dos dois provedores guardadas em separado; trocar de aba não apaga
  a outra.

A camada gratuita do Google pode usar os prompts para treinar os modelos
deles. Para título e descrição de produto isso é irrelevante; para dado
sensível, não seria.

---

## 8. Segurança

**Chaves de API** ficam em `chrome.storage.local`, sem criptografia.
Decisão consciente: criptografar sem uma senha que não esteja guardada é
teatro — se a extensão descriptografa sozinha, quem tem acesso ao código
chama a função de decrypt. Proteção real aqui é outra:

- Chave é descartável — revogar e gerar outra leva trinta segundos e
  invalida qualquer cópia vazada
- Não habilitar faturamento no projeto do Gemini: sem billing, o teto é
  erro 429, não cobrança

Se um dia entrar chave com crédito pré-pago, a conta muda e vale reavaliar.

**Uso.** A extensão só preenche o formulário; quem publica é a pessoa. Não
burla captcha, não faz login automático, não dispara cadastro em massa.

Categoria e características são taxonomia da plataforma — copiar é seguro.
Título, descrição e fotos de outro vendedor são conteúdo autoral: clonar e
publicar como seu dá denúncia de propriedade intelectual, e a Shopee costuma
derrubar o anúncio antes de perguntar. Por isso esses grupos vêm
desmarcados e existe o botão de reescrever.

---

## 9. Limitações conhecidas

- **Atributo obrigatório muda por nicho.** O valor do anúncio de referência
  nem sempre existe na lista da categoria escolhida. Cada falha é reportada
  como `sem-campo` (o campo não existe nessa categoria) ou `sem-opcao` (o
  valor não está no dropdown). Não é automatizável; a Shopee valida no
  submit.
- **Variações não são preenchidas.** São copiadas para consulta e o painel
  avisa quantas o original tinha, mas configurar exige mexer numa aba
  separada com estrutura própria.
- **Uma aba por vez.** A captura é por página; não há varredura em lote.
- **Sem testes de integração.** Os testes escritos cobrem normalização,
  mesclagem, descarte de fantasmas e raspagem do DOM com DOM simulado. Não
  há como testar contra a Shopee real sem uma conta de vendedor de teste.

---

## 10. Próximos passos possíveis

- **Perfis de atributo.** Se as peças caem sempre nas mesmas 2 ou 3
  categorias, salvar conjuntos prontos (material PLA, acabamento, faixa
  etária) e aplicar direto, sem precisar de anúncio de referência.
- **Origem no catálogo próprio.** Puxar dados da API do fec3d em vez de
  capturar da Shopee — vira cadastro a partir do catálogo, não cópia.
- **Preenchimento das variações.** A aba tem estrutura própria; exige
  mapear a grade de combinações.
- **Exportar a captura em JSON**, para reaproveitar fora da extensão.
