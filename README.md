![ManyBot Logo](logo.png)

Criei esse bot para servir um grupo de amigos. Meu foco não é fazer ele funcionar para todo mundo.

Ele é 100% local e gratuito, sem necessidade de APIs burocraticas. Usufrui da biblioteca `whatsapp-web.js`, que permite bastante coisa mesmo sem a API oficial.

Você consegue totalmente clonar esse repoistório e rodar seu próprio ManyBot. A licenca GPLv3 permite que você modifique o que quiser e faça seu próprio bot, mas se for publicar, deve ser open source assim como o ManyBot original.

Algumas funcionalidades desse bot inclui:
- Funciona em multiplos chats em apenas uma única sessão 
- Comandos de jogos e download com yt-dlp
- Gerador de figurinhas
- Ferramenta para pegar IDs dos chats
- Entre outros

---

# Requisitos
- Node.js
- NPM
- Sistema Linux ou Windows

obs: Sistemas Android e iOS ainda não são 100% compatíveis. O suporte para Termux está em fases de testes e sem garantia de funcionamento correto.

# Instalação (Linux)

1. Clone o repositório e entre:
```
git clone https://github.com/synt-xerror/manybot
cd manybot
```

2. Execute o script de instalação:
```
bash setup
```

3. Rode o bot pela primeira vez:
```
node src/main.js
```
Ele vai pedir para que escaneie o QR Code com seu celular.
Vá em: WhatsApp > Trẽs pontos no canto inferior > Dispositivos conectados > Conectar um dispositivo

# Instalação (Windows)

O uso desse bot foi pensado para rodar em um terminal Linux com Bash. No entanto, você pode usar o Git Bash, que simula um terminal Linux com Bash real:

1. Para baixar o Git Bash: https://git-scm.com/install/windows
Selecione a versão que deseja (portátil ou instalador)

2. Para baixar o Node.js: https://nodejs.org/pt-br/download/current
Role a tela e selecione "binário independente (.zip)"
Ou se preferir, use um gerenciador de pacotes como mostra no conteúdo inicial

Após baixar e instalar ambos, abra o Git Bash e execute exatamente os mesmos passos do Linux
