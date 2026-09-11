# Molde — Cadastro Shopee

Extensão Chrome (MV3) que extrai os dados de um anúncio da Shopee e preenche o
formulário de cadastro no Seller Center, deixando tudo editável antes de publicar.

## Instalar

1. Descompactar o `.zip` numa pasta que vá **ficar onde está** — o Chrome lê
   os arquivos desse local toda vez que abre. Se apagar ou mover, a extensão
   quebra. Sugestão: `Documentos/molde-shopee`
2. Abrir `chrome://extensions` (digitar na barra de endereço)
3. Ligar **Modo do desenvolvedor**, no canto superior direito
4. Clicar em **Carregar sem compactação**
5. Selecionar a **pasta** descompactada — a que contém o `manifest.json`
   direto dentro dela, não uma pasta acima
6. O cartão "Molde — Cadastro Shopee" aparece na lista
7. Clicar no ícone de peça de quebra-cabeça na barra do Chrome e fixar o Molde

Para atualizar depois de mexer no código: voltar em `chrome://extensions` e
clicar no ícone de recarregar no cartão da extensão.

### O botão flutuante

Fica na página, arrastável, e guarda a posição em `chrome.storage.local`.
É arrastável de propósito: o canto inferior direito é onde a Shopee coloca o
próprio chat e o "voltar ao topo", então uma posição fixa uma hora sobrepõe.
Nasce um pouco acima do canto para já escapar disso.

Clique curto aciona; arraste move. A diferença é um limiar de 4 px — abaixo
disso conta como clique.

Numa página pública, abre a gaveta com os anúncios capturados. No Seller
Center, abre o painel de preenchimento; fora da tela de cadastro, leva até
ela. O ícone da barra do Chrome continua funcionando como caminho reserva.

### Trocar o nome

`manifest.json` → campo `name`. Para o rótulo dentro da interface,
`popup/popup.html` e `src/content/filler.js`, ambos na tag `marca`.

## Usar

1. Abrir um anúncio de referência em `shopee.com.br` — aparece um selo
   confirmando a captura, e o contador do botão flutuante sobe
2. Clicar no **botão flutuante** → escolher o anúncio na lista
3. No painel do Seller Center, marcar o que aproveitar:

   | Grupo | Padrão | O que faz |
   |---|---|---|
   | Categoria | marcado | percorre a cascata até a folha |
   | Características | marcado | preenche o painel de atributos |
   | Peso e dimensões | marcado | campos numéricos de logística |
   | Preço e estoque | desmarcado | |
   | Título e descrição | desmarcado | conteúdo autoral do original |
   | Fotos do original | desmarcado | conteúdo autoral do original |

4. **Preencher formulário** → escrever título, descrição e subir suas fotos
5. Revisar → publicar

O bloco **Dados do original** fica sempre no painel, mesmo para os grupos
desmarcados: título, descrição completa, características, preço, medidas,
variações e miniaturas das fotos, com botão de copiar. Serve para consultar
como o original descreve material e embalagem enquanto você escreve o seu.

Os dois últimos grupos vêm desmarcados de propósito: é conteúdo de outro
vendedor. Marque só se o anúncio de referência for seu.

## Como funciona

O ponto delicado deste tipo de extensão é *de onde vêm os dados*. Raspar o HTML
da Shopee é frágil: as classes CSS são geradas no build e mudam sem aviso.

Então a captura acontece na camada de rede. `src/inject/net-hook.js` roda no
*main world*, embrulha `fetch` e `XMLHttpRequest`, e escuta as respostas que a
**própria página** já faz para a API interna da Shopee. O JSON chega inteiro,
com preço, estoque, dimensões, variações e hashes das imagens.

### Categoria e características

Estes dois não são `<input>`. A categoria é uma cascata que carrega cada
coluna sob demanda; as características são um painel que **só existe no DOM
depois** da categoria ser escolhida. Setter nativo não resolve — `campos.js`
simula a sequência real de eventos (`pointerdown` → `mousedown` → `mouseup` →
`click`, porque esses componentes escutam `mousedown`, não `click`) e espera a
renderização entre os níveis.

Para a categoria, tenta primeiro o campo de busca do seletor com o nome da
folha — um passo, muito mais confiável. Só cai para a cascata coluna a coluna
se não houver busca. Se travar num nível, informa **qual** e pula as
características, já que elas dependem da categoria.

Características cujo valor não existe na lista daquela categoria são
reportadas uma a uma. Categoria da Shopee tem atributo obrigatório que muda
por nicho — não dá para assumir que o valor do original serve.

### Preenchimento dos campos simples

Do outro lado, o Seller Center é React. Atribuir `input.value = x` muda o DOM
mas não o estado do componente — o valor some no primeiro re-render. Por isso
`dom.definirValor()` usa o setter nativo do prototype e depois dispara
`input`/`change`/`blur`, que é o que o React escuta.

As imagens são baixadas do CDN, viram `File` e entram no `<input type="file">`
via `DataTransfer`, exatamente como se você tivesse escolhido pelo Finder.

```
manifest.json
src/
  inject/net-hook.js      captura na rede (main world)
  content/extractor.js    normaliza e salva
  content/filler.js       painel + preenchimento no Seller Center
  content/lancador.js     botão flutuante arrastável e gaveta
  lib/dom.js              setters React-safe, busca por rótulo, upload
  lib/campos.js           cascata de categoria e dropdowns de atributos
  lib/normalize.js        JSON cru da Shopee → produto
  config/selectors.js     <- mexa aqui quando a Shopee mudar o layout
  background.js           storage + chamada de IA
popup/                    lista de anúncios capturados
```

## Quando quebrar

Vai quebrar em algum momento. O desenho separa os dois motivos possíveis:

- **Nada é capturado** → a Shopee mudou as rotas da API.
  Ajustar `PADROES` em `net-hook.js`.
- **Captura mas não preenche** → mudaram os rótulos do formulário.
  Ajustar `campos` em `config/selectors.js`. Nenhuma classe CSS é usada na
  lógica — a busca é por texto de rótulo, `for`/`id`, `placeholder` e
  `aria-label`, nessa ordem.

Campos que não forem encontrados aparecem listados no painel. Nunca falham em
silêncio.

## Avisos

**A chave da API é opcional.** Serve só para o botão **Reescrever**, que gera
título e descrição originais. Captura, categoria, características e
preenchimento funcionam sem ela.

Dois provedores, escolhidos na engrenagem do popup:

| | Onde pegar | Custo |
|---|---|---|
| **Gemini** (padrão) | `aistudio.google.com/apikey` | camada gratuita, sem cartão |
| Anthropic | `console.anthropic.com` → API keys | crédito pré-pago, mín. US$ 5 |

Modelos padrão: `gemini-2.5-flash` e `claude-sonnet-5`, ambos editáveis no
mesmo painel — os nomes de modelo mudam com frequência.

Cuidado com o gratuito do Google: os prompts podem ser usados para treinar
os modelos deles. Para título e descrição de produto isso não importa; para
dado sensível, importaria.

Nenhuma das chaves vai na query string. A do Gemini vai no cabeçalho
`x-goog-api-key`, não em `?key=`, porque URL entra em log de proxy e
histórico do navegador.

**Chave da API.** Fica em `chrome.storage.local`, sem criptografia. Qualquer
código com acesso ao perfil do Chrome consegue ler. Use uma chave dedicada com
limite de gasto baixo no console da Anthropic, não a chave principal.

**Categoria e características são seguras de copiar** — é taxonomia da
Shopee, não obra de ninguém. É o grosso do trabalho manual e onde a extensão
mais economiza tempo.

**Copiar anúncio dos outros.** Título e descrição alheios são texto de autoria
de terceiros, e foto de produto de outro vendedor é obra protegida. Clonar o
anúncio de um concorrente e publicar como seu dá denúncia por violação de
propriedade intelectual na Shopee — e a plataforma costuma derrubar o anúncio
antes de perguntar. Use a extração como referência de estrutura e o botão
**Reescrever** para gerar texto original; para as fotos, use as suas.

Para clonar os **seus próprios** anúncios — o caso de variação de cor, tamanho
ou kit — não há esse problema, e é onde a extensão realmente economiza tempo.

**Automação.** A extensão só preenche o formulário; quem clica em publicar é
você. Nada aqui burla captcha, faz login automático ou dispara cadastro em
massa — isso violaria os termos de uso da Shopee e arriscaria a conta.
