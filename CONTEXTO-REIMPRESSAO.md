# CONTEXTO DA FUNCAO DE REIMPRESSAO

Arquivo criado para retomar amanha a implementacao de impressao manual/reimpressao sem depender do historico da conversa.

## Pedido do usuario

Implementar uma funcao para imprimir quando quiser pelo painel do caixa.

O usuario quer:

- Manter a impressao automatica de pedidos online.
- Ter botao para imprimir/reimprimir pedidos online quando quiser.
- Ter botao para imprimir comprovante de vendas feitas no proprio caixa (`cashSales`).
- Usar isso quando o cliente presencial quiser saber ou levar o resumo do que comprou.
- Garantir que itens cancelados/trocados nao saiam errados na impressao.

## Entendimento aprovado

O navegador nao deve falar direto com a impressora.

O painel do caixa deve criar uma solicitacao de impressao no Firestore, e o script local `teste.mjs`, rodando no computador da impressora, deve ouvir essa fila e imprimir.

## Plano tecnico

### 1. Criar fila de impressao

Criar colecao no Firestore, sugestao: `printRequests`.

Documento sugerido:

```js
{
  status: "pending", // pending, printed, failed
  source: "order" | "cashSale",
  sourceId: "id do documento original",
  sourceCode: "codigo do pedido/venda",
  payload: {
    orderCode: "...",
    items: [...],
    subtotal: 0,
    discount: 0,
    surcharge: 0,
    total: 0,
    customer: {...}, // pedido online
    customerName: "...", // venda caixa
    payment: "...",
    notes: "...",
    createdAt: ...
  },
  requestedByName: "...",
  requestedByEmail: "...",
  requestedAt: serverTimestamp(),
  printedAt: null,
  errorMessage: ""
}
```

Guardar um `payload` com snapshot do pedido/venda no momento do clique evita depender de leitura extra no script local.

### 2. Atualizar painel do caixa

Arquivo principal: `components/cash-page.js`.

Na secao "Pedidos e vendas da sessao", cada card de movimento deve ter botao:

- `Imprimir` para venda do caixa.
- `Reimprimir` para pedido online ou qualquer movimento ja impresso.

Ao clicar:

- Criar doc em `printRequests`.
- Usar dados atuais do pedido/venda.
- Filtrar/normalizar itens ativos antes de montar payload ou deixar isso para `teste.mjs`; o mais seguro e fazer nos dois lugares.
- Exibir aviso de sucesso/erro no modal de aviso ja existente.

### 3. Atualizar script local de impressao

Arquivo principal: `teste.mjs`.

Hoje ele escuta `orders` e imprime automaticamente pedidos online.

Alterar para:

- Continuar ouvindo `orders` para impressao automatica dos pedidos online.
- Tambem ouvir `printRequests` com `status == "pending"` ou filtrar no callback se a query simples for mais compativel.
- Ao receber um request pendente:
  - Montar recibo a partir de `payload`.
  - Imprimir.
  - Atualizar request para `status: "printed"`, `printedAt`, limpar erro.
  - Se falhar, atualizar para `status: "failed"` e salvar `errorMessage`.

### 4. Adaptar recibo para pedido online e venda no caixa

Hoje `buildReceiptBuffer(order)` trabalha pensando em `orders`.

Precisa aceitar tambem payload de `cashSales`.

Campos:

- Pedido online:
  - cliente em `customer`;
  - endereco completo;
  - pagamento em `customer.payment`.

- Venda do caixa:
  - cliente em `customerName` ou "Balcao";
  - pagamento em `payment`;
  - observacoes em `notes`;
  - nao precisa endereco.

No titulo pode continuar "BOLO DE MAE JP", mas subtitulo pode variar:

- `NOVO PEDIDO` para automatico online.
- `COMPROVANTE` ou `REIMPRESSAO` para printRequests.

### 5. Filtrar itens ativos na impressao

Obrigatorio ajustar `normalizeItems(items = [])` em `teste.mjs`.

Itens cancelados ou trocados ficam no historico com `status: "cancelled"` ou `status: "replaced"`.

A impressao deve considerar apenas:

```js
!item.status || item.status === "active"
```

Isso evita imprimir item cancelado/trocado em reimpressao.

### 6. Atualizar regras do Firestore

Arquivo: `firestore.rules`.

Adicionar validacao para `printRequests`.

Regras sugeridas:

- `canAccessCash()` pode criar solicitacao.
- `canAccessCash()` pode ler suas solicitacoes ou a fila.
- Atualizacao de status deve ser pensada com cuidado:
  - se `teste.mjs` rodar com Admin SDK/service account, rules nao bloqueiam;
  - se cair no modo client sem login, atualizacao pode ser bloqueada, como ja acontece hoje com marcacao de pedido impresso.

Observacao importante: o projeto ja recomenda service account para impressao local. Manter essa recomendacao.

### 7. Pontos de cuidado

- Nao reimprimir automaticamente quando pedido/venda for alterado por cancelamento/troca.
- Botao manual deve criar `printRequests`; automatico de pedido online continua usando fluxo atual.
- Se um pedido online foi cancelado/trocado antes da reimpressao, recibo deve sair com itens ativos atuais.
- Vendas do caixa nao precisam imprimir automaticamente, a menos que o usuario peca depois.
- Nao incluir `CONTEXTO.md` nem este arquivo em commit/push se o usuario pedir para subir para git, a menos que ele diga explicitamente que quer versionar os contextos.

## Checklist para implementar amanha

- [x] Adicionar helper para montar payload de impressao em `components/cash-page.js`.
- [x] Adicionar botao de imprimir/reimprimir nos cards de pedidos/vendas.
- [x] Criar doc em `printRequests` ao clicar.
- [x] Ajustar `teste.mjs` para filtrar itens ativos.
- [x] Ajustar `teste.mjs` para imprimir payload de `cashSales`.
- [x] Fazer listener de `printRequests`.
- [x] Marcar request como `printed` ou `failed`.
- [x] Atualizar `firestore.rules`.
- [x] Atualizar `CONTEXTO.md`.
- [x] Rodar `npm run build`.
- [ ] Testar com a impressora fisica assim que ela estiver disponivel.

## Status da implementacao em 2026-04-27

Implementado sem commit, por pedido do usuario.

Arquivos alterados:

- `components/cash-page.js`
- `teste.mjs`
- `firestore.rules`
- `app/globals.css`
- `CONTEXTO.md`
- `CONTEXTO-REIMPRESSAO.md`

Validacoes executadas:

- `node --check teste.mjs`
- `git diff --check`
- `npm run build`

Pendente:

- Subir `firestore.rules` no Firebase depois de autenticar o Firebase CLI.
- Testar impressao fisica com a impressora termica quando ela estiver disponivel.
- Fazer commit somente se o usuario permitir.

## Arquivos provavelmente alterados

- `components/cash-page.js`
- `teste.mjs`
- `firestore.rules`
- `CONTEXTO.md`
- possivelmente `app/globals.css` se o botao precisar de estilo novo
