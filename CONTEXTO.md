# CONTEXTO DO PROJETO ONLY

Este arquivo deve ser lido antes de mexer no projeto. Ele serve como memoria curta do app e como historico de decisoes/alteracoes feitas com o Codex.

## O que e o app

App da Bolo de Mae JP Confeitaria.

Ele funciona como:

- Cardapio online para clientes.
- Carrinho e checkout com endereco, CEP, telefone, pagamento e observacoes.
- Envio do pedido para o Firestore e abertura de mensagem pronta no WhatsApp.
- Painel administrativo para cadastrar, editar, excluir e ativar/desativar produtos.
- Sistema de caixa para abrir/fechar sessao, registrar vendas presenciais, ver dashboard do dia e historico.
- Impressao automatica local de pedidos em Windows usando PM2 e impressora termica.

## Stack e execucao

- Next.js 15 com App Router.
- React 19.
- Firebase client SDK para Auth e Firestore.
- Firebase Admin SDK opcional no script local de impressao.
- Export estatico configurado em `next.config.mjs` com `output: "export"`.
- Scripts principais:
  - `npm run dev`: servidor local Next.
  - `npm run build`: build/export de producao.
  - `npm run printer`: roda `teste.mjs`.
  - `npm run printer:monitor`: roda `monitor-server.mjs`.

## Mapa dos arquivos

- `components/menu-page.js`: cardapio publico, carrinho, checkout, pedido online e WhatsApp.
- `components/admin-page.js`: login admin, cadastro/edicao/exclusao de produtos, upload/otimizacao de foto.
- `components/cash-page.js`: sistema de caixa, sessoes, vendas presenciais, dashboard e historico.
- `lib/firebase.js`: inicializacao do Firebase e validacao das envs publicas.
- `lib/access-control.js`: sincronizacao do usuario e calculo de permissoes.
- `lib/store-utils.js`: WhatsApp da loja, categorias, preco, CEP, telefone, ViaCEP e erros de auth.
- `firestore.rules`: regras e validacoes de `users`, `products`, `orders`, `cashSales`, `cashSessions`.
- `storage.rules`: Storage bloqueado; imagens de produto hoje ficam em URL/base64 no Firestore.
- `app/globals.css`: estilos globais de cardapio, admin, caixa e modais.
- `app/layout.js`: layout raiz, fontes, metadata e PWA.
- `app/admin/page.js` e `app/caixa/page.js`: entradas das rotas internas.
- `app/admin/layout.js` e `app/caixa/layout.js`: layouts gerados que ainda tem metadata padrao "Next.js"; revisar se mexer em layout/SEO.
- `public/sw.js`, `public/manifest.webmanifest`, `components/pwa-register.js`: PWA/cache.
- `teste.mjs`: listener local de pedidos e impressao ESC/POS.
- `monitor-server.mjs` e `monitor.html`: painel local para controlar PM2/impressora.
- `README-INSTALACAO.md`: guia de instalacao da impressora no Windows.
- `CONTEXTO-REIMPRESSAO.md`: contexto separado com plano para implementar impressao manual/reimpressao de pedidos online e vendas do caixa.

## Pontos de cuidado

- Qualquer campo novo salvo no Firestore provavelmente exige ajuste em `firestore.rules`.
- Produto aceita `title`, `category`, `price`, `image`, `details`, `subProducts`, `available`, `trackStock`, `stock`, `minStock`, `createdAt`.
- Pedido online aceita `orderCode`, `items`, `subtotal`, `discount`, `surcharge`, `total`, `customer`, `createdAt`, e campos de impressao opcionais.
- Venda de caixa aceita `orderCode`, `sessionId`, `items`, `subtotal`, `discount`, `surcharge`, `total`, `payment`, `customerName`, `notes`, `source`, `createdAt`.
- Itens de pedido/venda agora podem guardar `lineId`, `productId`, `productTitle`, `option` e `status` para cancelamento/troca por item.
- Movimentos de estoque ficam em `stockMovements` com `productId`, `qty`, `delta`, `type`, `reason`, `source`, referencia e ator.
- Estoque e controlado por produto principal; variacoes/subprodutos baixam o estoque do produto pai.
- Sessao de caixa tem criacao aberta e update para fechamento com resumo.
- O cardapio publico consegue criar pedidos sem login; isso e intencional para clientes, mas aumenta risco de spam.
- O script de impressao deve rodar preferencialmente com service account via `FIREBASE_SERVICE_ACCOUNT_KEY_PATH` ou `GOOGLE_APPLICATION_CREDENTIALS`.
- Sem service account, `teste.mjs` cai em modo client e pode ter leitura/update bloqueados pelas rules.
- `STORE_WHATSAPP` e `SEND_TO_CUSTOMER` ficam em `lib/store-utils.js`.
- Impressora configurada hoje em `teste.mjs`: `LOCAL_PRINTER_NAME = 'elgin-i7'`.
- Evitar mexer em `.env.local` e nunca expor valores das envs.
- Quando o usuario pedir para subir/commitar no git, nao incluir `CONTEXTO.md` no commit/push.
- Tambem nao incluir `CONTEXTO-REIMPRESSAO.md` no commit/push, salvo pedido explicito para versionar contextos.
- Nao adicionar `CONTEXTO.md` ao `.gitignore`, por pedido explicito do usuario.
- Antes de finalizar alteracoes importantes, rodar `npm run build`.

## Regra de historico para o Codex

Sempre que o Codex mexer no projeto, atualizar a secao "Historico de alteracoes" neste arquivo.

Registrar:

- Data.
- Pedido do usuario.
- Arquivos alterados.
- O que foi feito.
- Validacao executada.
- Se o usuario nao gostou ou pediu para desfazer, registrar tambem o motivo e o que foi revertido/ajustado.

Manutencao quando o arquivo crescer:

- Manter o contexto fixo curto e objetivo.
- Manter as alteracoes recentes com detalhes.
- Usar 250 linhas como limite pratico recomendado para o arquivo.
- Se passar de 250 linhas, revisar e compactar o historico antigo.
- Quando o historico ficar grande, consolidar entradas antigas em resumos por periodo ou por tema.
- Nao apagar decisoes importantes, regras do usuario, riscos conhecidos ou mudancas grandes.
- Se consolidar historico antigo, registrar uma nova entrada dizendo que a compactacao foi feita.

Formato recomendado:

```md
### YYYY-MM-DD - Titulo curto

- Pedido: ...
- Arquivos alterados: ...
- Feito: ...
- Validacao: ...
- Observacao/feedback do usuario: ...
```

## Historico consolidado

Ainda nao ha historico antigo consolidado.

## Historico de alteracoes

### 2026-04-25 - Criacao do contexto do projeto

- Pedido: criar um arquivo de contexto que tambem funcione como historico vivo das alteracoes.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: documentado o objetivo do app, stack, mapa de arquivos, pontos de cuidado e regra para manter historico a cada mudanca futura.
- Validacao: arquivo criado; nenhuma alteracao no codigo do app.
- Observacao/feedback do usuario: usuario quer que edicoes aceitas, edicoes recusadas e ajustes posteriores fiquem registrados aqui.

### 2026-04-25 - Regra para nao subir o contexto

- Pedido: quando o usuario pedir para subir para o git, nao deixar `CONTEXTO.md` subir e nao adicionar esse arquivo ao `.gitignore`.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: adicionada regra nos pontos de cuidado e registrado este pedido no historico.
- Validacao: alteracao documental apenas.
- Observacao/feedback do usuario: `CONTEXTO.md` deve ficar local mesmo quando houver commit/push do restante do projeto.

### 2026-04-25 - Regra de compactacao do contexto

- Pedido: deixar o `CONTEXTO.md` na melhor forma para nao ficar pesado quando crescer.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: adicionada regra de manutencao para manter contexto fixo curto, historico recente detalhado e historico antigo consolidado por periodo ou tema.
- Validacao: alteracao documental apenas.
- Observacao/feedback do usuario: usuario quer que o arquivo continue util mesmo com muitas alteracoes futuras.

### 2026-04-25 - Limite pratico de linhas no contexto

- Pedido: definir um limite de linhas para facilitar a leitura e manutencao do contexto.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: definido limite pratico recomendado de 250 linhas; se passar disso, o historico antigo deve ser revisado e compactado.
- Validacao: alteracao documental apenas.
- Observacao/feedback do usuario: limite nao precisa ser rigido linha por linha, mas deve orientar a compactacao.

### 2026-04-26 - Sistema de estoque com cancelamento e troca

- Pedido: implementar sistema de estoque em que venda baixa estoque, cancelamento por item devolve e troca devolve o item antigo e baixa o novo.
- Arquivos alterados: `lib/inventory.js`, `components/admin-page.js`, `components/menu-page.js`, `components/cash-page.js`, `firestore.rules`, `app/globals.css`, `CONTEXTO.md`.
- Feito: criado modulo transacional de estoque; admin ganhou campos de controle de estoque, quantidade e alerta baixo; cardapio e caixa bloqueiam venda acima do estoque; pedidos online e vendas presenciais baixam estoque; caixa permite cancelar/trocar item por item em pedidos e vendas da sessao; movimentos ficam em `stockMovements`; rules foram ajustadas para novos campos e movimentos.
- Validacao: `npm run build` executado com sucesso.
- Observacao/feedback do usuario: estoque deve ser reversivel por item, inclusive em troca.

### 2026-04-26 - Cancelamento e troca parcial de item

- Pedido: permitir cancelar ou trocar apenas parte de uma linha com varias unidades, exemplo `3x item 1` cancelar/trocar somente 1.
- Arquivos alterados: `components/cash-page.js`, `CONTEXTO.md`.
- Feito: ao cancelar/trocar uma linha com quantidade maior que 1, o caixa pergunta a quantidade; cancelamento parcial divide a linha em quantidade restante ativa e quantidade cancelada; troca parcial divide a linha em quantidade restante ativa, quantidade antiga trocada e novo item ativo.
- Validacao: `npm run build` executado com sucesso.
- Observacao/feedback do usuario: ajuste feito para nao obrigar cancelar/trocar a linha inteira quando houver multiplas unidades.

### 2026-04-26 - Contexto para reimpressao futura

- Pedido: salvar para amanha o plano de impressao manual/reimpressao de pedidos online e vendas feitas no caixa.
- Arquivos alterados: `CONTEXTO-REIMPRESSAO.md`, `CONTEXTO.md`.
- Feito: criado contexto separado com entendimento, plano tecnico, checklist, pontos de cuidado e arquivos provaveis; contexto principal atualizado para apontar para o novo arquivo e lembrar que ele tambem nao deve subir no git salvo pedido explicito.
- Validacao: alteracao documental apenas; build nao executado.
- Observacao/feedback do usuario: implementar depois botao de imprimir/reimprimir criando fila `printRequests`, com `teste.mjs` ouvindo a fila e filtrando itens ativos.

### 2026-04-27 - Commit local do estoque na main

- Pedido: antes de implementar impressao/reimpressao, verificar estoque, levar alteracoes para a branch `main`, publicar/deployar e apagar `Feature/estoque` se possivel.
- Arquivos alterados: `CONTEXTO.md`; commit local `28c94a2` inclui `lib/inventory.js`, `components/admin-page.js`, `components/menu-page.js`, `components/cash-page.js`, `firestore.rules`, `app/globals.css`.
- Feito: `npm run build` confirmou a implementacao de estoque; criada branch local `main` a partir de `master`; commit local `28c94a2 Add inventory stock controls`; branch local `Feature/estoque` apagada.
- Validacao: `npm run build` executado com sucesso; `git diff --check` sem erros.
- Observacao/feedback do usuario: push/deploy remoto nao foi concluido porque `git push -u origin main` falhou sem credencial GitHub no terminal (`could not read Username for 'https://github.com'`). O deploy de `firestore.rules` tambem foi tentado com `npx firebase-tools deploy --only firestore:rules --project bolodemaejp`, mas falhou por falta de login no Firebase CLI (`Failed to authenticate, have you run firebase login?`). A implementacao de impressao/reimpressao ainda nao foi iniciada porque o usuario pediu para fazer isso somente depois de publicar a `main`.

### 2026-04-27 - Impressao manual e reimpressao

- Pedido: implementar a parte possivel de impressao/reimpressao sem testar impressora fisica e sem commit; deixar registrado que o teste fisico deve ser feito depois.
- Arquivos alterados: `components/cash-page.js`, `teste.mjs`, `firestore.rules`, `app/globals.css`, `CONTEXTO.md`, `CONTEXTO-REIMPRESSAO.md`.
- Feito: caixa ganhou botao para `Reimprimir pedido` em pedidos online e `Imprimir comprovante` em vendas do caixa; clique cria documento `printRequests`; payload de impressao leva somente itens ativos; `teste.mjs` continua imprimindo pedidos online automaticamente e tambem escuta `printRequests`; comprovante de venda do caixa nao imprime endereco e usa dados de `cashSales`; request e marcado como `printed` ou `failed`; rules ganharam validacao/criacao de `printRequests`.
- Validacao: `node --check teste.mjs`, `git diff --check` e `npm run build` executados com sucesso.
- Observacao/feedback do usuario: nao foi feito teste fisico porque o usuario nao esta com a impressora no momento; testar assim que possivel. Nao fazer commit sem permissao explicita do usuario. Rules ainda precisam ser publicadas no Firebase quando houver login no Firebase CLI.

### 2026-04-27 - Commit temporario dos contextos e atualizacao do PM2

- Pedido: autorizar commit de tudo, incluindo `CONTEXTO.md` e `CONTEXTO-REIMPRESSAO.md`, temporariamente; registrar que a instalacao da impressora na empresa precisa atualizar PM2/dados da impressao.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: registrado que os dois arquivos de contexto podem subir neste commit por autorizacao explicita do usuario, apesar da regra anterior de manter contextos locais; registrado que, como `teste.mjs` mudou para escutar `printRequests`, a maquina da impressora precisa puxar a versao nova e reiniciar o PM2.
- Validacao: `node --check teste.mjs`, `git diff --check` e `npm run build` executados com sucesso antes do commit.
- Observacao/feedback do usuario: na empresa, depois de atualizar o codigo e envs, rodar `pm2 startOrRestart ecosystem.config.json --update-env` ou usar os `.bat` atualizados para garantir que `only-impressora` carregue o `teste.mjs` novo e as variaveis como `FIREBASE_SERVICE_ACCOUNT_KEY_PATH`. Commit local criado em `main`; push remoto via `git push origin main` falhou por falta de credencial GitHub no terminal (`could not read Username for 'https://github.com'`).

### 2026-04-27 - PM2 atualizado e impressora testada

- Pedido: ler o contexto, atualizar o PM2 e testar a impressora.
- Arquivos alterados: `CONTEXTO.md`.
- Feito: processos `only-impressora` e `only-painel-impressora` reiniciados com `pm2 startOrRestart ecosystem.config.json --update-env`; estado salvo com `pm2 save`; impressora `elgin-i7` confirmada no Windows em `USB001` com status `Normal`; criado teste real em `printRequests` e o listener do PM2 imprimiu/marcou como `printed`.
- Validacao: `pm2 status`, `pm2 logs only-impressora --lines 20 --nostream`, `node --check teste.mjs`, `Get-Printer -Name "elgin-i7"` e consulta da fila de impressao sem jobs pendentes.
- Observacao/feedback do usuario: teste usado no Firestore: `TESTE-IMPRESSORA-20260427182431`.
