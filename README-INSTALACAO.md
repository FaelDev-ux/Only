# Instalacao Da Impressora Only

Este projeto pode rodar a impressora e o painel 24 horas usando `pm2` no Windows.

## O que precisa antes

Antes de executar a instalacao na outra maquina, confirme estes itens:

1. Instale o `Node.js`.
2. Instale a impressora no Windows.
3. Confira se o nome da impressora em `teste.mjs` bate com o nome instalado no Windows.
4. Coloque o arquivo da conta de servico do Firebase dentro desta pasta.
5. Crie o arquivo `.env.local`.

## Arquivos locais obrigatorios

O arquivo `.env.local` precisa ter algo assim:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=seu_valor
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=seu_valor
NEXT_PUBLIC_FIREBASE_PROJECT_ID=seu_valor
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=seu_valor
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=seu_valor
NEXT_PUBLIC_FIREBASE_APP_ID=seu_valor
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=nome-do-arquivo.json
```

Exemplo:

```env
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=bolodemaejp-firebase-adminsdk-fbsvc-716f3e8198.json
```

## Como instalar

1. Baixe o projeto do GitHub na outra maquina.
2. Coloque nesta pasta:
   - o arquivo `.env.local`
   - o arquivo `.json` da conta de servico
3. Clique duas vezes em `instalar-impressora-only.bat`
4. Espere terminar.

## O que o BAT faz

O arquivo `instalar-impressora-only.bat` faz isto:

1. Instala as dependencias do projeto com `npm install`
2. Instala `pm2`
3. Instala `pm2-windows-startup`
4. Ativa o inicio automatico no Windows
5. Sobe:
   - `only-impressora`
   - `only-painel-impressora`
6. Salva os processos no `pm2`

## Como verificar

Abra o terminal e rode:

```powershell
pm2 status
```

Se estiver tudo certo, abra:

```text
http://localhost:3211
```

## Comandos uteis

```powershell
pm2 status
pm2 logs only-impressora
pm2 restart only-impressora
pm2 restart only-painel-impressora
pm2 stop only-impressora
pm2 stop only-painel-impressora
pm2 save
```

## Se quiser desligar tudo

```powershell
pm2 stop all
pm2 delete all
pm2 save --force
pm2-startup uninstall
```

## Observacao importante

O arquivo da conta de servico do Firebase e o `.env.local` devem ficar somente na maquina local. Eles nao devem ser enviados para o GitHub.
