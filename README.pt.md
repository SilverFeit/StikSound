<div align="center">

<img src="docs/assets/app-icon.svg" alt="StikSound App Icon" width="120" height="120" />

# StikSound

**Crie vídeos curtos com som de até 5 ou 10 segundos (com seletor na tela) a partir de PNG, JPG, WebP ou GIF animado: cole seu sticker, escolha um áudio local ou um link do MyInstants, recorte o trecho exato e exporte tudo 100% localmente.**

[![Usar na Web](https://img.shields.io/badge/Usar%20na%20Web-GitHub%20Pages-0ea5e9?style=for-the-badge&logo=githubpages&logoColor=white)](https://silverfeit.github.io/StikSound/)
[![Baixar](https://img.shields.io/github/v/release/SilverFeit/StikSound?style=for-the-badge&label=Baixar&color=25D366)](https://github.com/SilverFeit/StikSound/releases/latest)

[![Platforms](https://img.shields.io/badge/Platforms-Web%20%7C%20Windows%20%7C%20macOS%20%7C%20Chrome%20%7C%20CLI%20%26%20MCP-25D366?style=flat-square)](#versão-web-vs-instalar)
[![Local Processing](https://img.shields.io/badge/Processamento-100%25%20local-10b981?style=flat-square)](#privacidade-e-segurança)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-6366f1?style=flat-square)](LICENSE-MIT)

[**Usar na Web**](https://silverfeit.github.io/StikSound/) · [**Baixar**](https://github.com/SilverFeit/StikSound/releases/latest) · [**CLI e MCP com IA**](#-cli-headless-e-servidor-mcp-local-figurinhas-com-ia) · [**Guia Passo a Passo**](#guia-passo-a-passo) · [**Como Funciona**](#como-funciona-internamente) · [**Desenvolvimento**](#desenvolvimento)

**🌐 Idioma / Language / Idioma:** [**🇪🇸 Español (Principal)**](README.md) · [**🇺🇸 English**](README.en.md) · **🇧🇷 Português**

</div>

---

## 🌐 Versão Web vs. Instalar

Você pode usar o **StikSound diretamente no navegador** sem instalar nada (funciona no PC, Android e iPhone como PWA), observando a diferença em relação ao **MyInstants**:

> [!IMPORTANT]
> **Versão Web ([silverfeit.github.io/StikSound](https://silverfeit.github.io/StikSound/)):** funciona **apenas com áudios já baixados** no seu aparelho (`MP3`, `WAV`, `M4A`, `OGG`, `AAC`) ou o áudio de um vídeo curto.
>
> **Quer colar links diretos do MyInstants?** Por regras de segurança dos navegadores (CORS), o MyInstants bloqueia downloads diretos a partir de páginas web estáticas. Para usar links do MyInstants diretamente, **instale** o [App de Desktop (Windows/macOS) ou a Extensão do Chrome](https://github.com/SilverFeit/StikSound/releases/latest) — ou baixe o MP3 do MyInstants antes e selecione-o na versão web.

| Recurso | 🌐 Versão Web (GitHub Pages) | 💻 App Desktop / 🧩 Extensão Chrome | ⌨️ CLI / 🤖 MCP Local |
| --- | :---: | :---: | :---: |
| **Instalação necessária** | ❌ Nenhuma ([abrir agora](https://silverfeit.github.io/StikSound/)) | ✅ [Baixar release](https://github.com/SilverFeit/StikSound/releases/latest) | ✅ `StikSound-*-cli.zip` + Node 22 e FFmpeg |
| **Processamento 100% local** | ✅ | ✅ | ✅ |
| **Stickers PNG / JPG / WebP / GIF** | ✅ | ✅ | ✅ |
| **Vídeos curtos (`MP4`, `MOV`, `WebM`) como sticker** | ✅ | — | ✅ |
| **Stickers gerados a partir de texto (`--text`)** | — | — | ✅ |
| **Seletor de duração `5s \| 10s`** | ✅ | ✅ | ✅ |
| **Áudios locais baixados** | ✅ | ✅ | ✅ |
| **Colar links diretos do MyInstants** | ❌ *(baixe o MP3 antes)* | ✅ | ✅ |
| **Buscar sons no MyInstants (`search`)** | — | — | ✅ |
| **WebM com transparência** | ❌ *(apenas MP4 na web/celular)* | ✅ | ✅ |
| **Integração com assistentes de IA (MCP)** | — | — | ✅ *(Claude, Gemini, Codex, Cursor, VS Code)* |

---

## O que o StikSound faz

O StikSound combina **uma imagem quadrada** e **um trecho de áudio** em um arquivo para baixar ou copiar. A duração máxima é escolhida pelo botão `5s | 10s` (10 segundos por padrão). Tudo é processado localmente no seu dispositivo, sem enviar arquivos para servidores externos.

- Aceita **PNG, JPG/JPEG, WebP e GIF** (além de vídeos curtos `MP4`, `MOV`, `WebM` na versão Web).
- Decodifica **GIFs animados** quadro a quadro e os repete em loop durante o vídeo exportado.
- Aceita áudios locais **MP3, WAV, OGG, M4A ou AAC**, ou links validados do **MyInstants** (Desktop e Extensão Chrome).
- Suporta **9 idiomas integrados na interface** (`ES`, `EN`, `PT`, `FR`, `DE`, `IT`, `RU`, `ZH`, `AR`) no menu `⋯`.
- Exporta **MP4** compatível, **WebM com transparência**, pacotes/projetos **`.stiksound.zip`** ou **WebP estático** (`<= 100 KB`).

> [!WARNING]
> **Compatibilidade atual com o WhatsApp (onde e como enviar):**
> - **Atualmente, enviar o MP4 como figurinha com som só funciona diretamente no Android com WhatsApp Beta**, e **não funciona em nenhum outro dispositivo ou plataforma** (não funciona no **WhatsApp Desktop para Windows/macOS** —nem normal nem beta—, nem no **WhatsApp Web**, nem no **iPhone / iOS**).
> - Mesmo sendo *Beta tester* no Android, a Meta libera esse recurso de forma **gradual por conta no servidor**: se sua conta ainda não recebeu a ativação, o WhatsApp não permitirá criar figurinhas com áudio a partir de vídeo.
> - **Como testar no Android Beta:** salve o MP4 na galeria → abra uma conversa no WhatsApp Android Beta → ícone de figurinhas → **Criar** (`+`) → escolha o vídeo MP4 na galeria. Colar ou compartilhar o MP4 direto no chat sempre o envia como um vídeo curto normal.
> - O perfil `native-sound-sticker` segue desabilitado pois o WhatsApp ainda não oferece API pública para figurinhas com som.

---

## Guia passo a passo

1. **Carregue o sticker:** Cole com `Ctrl + V` / `Cmd + V`, arraste ou clique na área central (`PNG`, `JPG`, `WebP`, `GIF`; na Web também aceita vídeos curtos).
2. **Enquadre em 1:1:** Imagens não quadradas são centralizadas automaticamente; mova o mouse (ou arraste com o dedo no celular) para ajustar o recorte `1:1` até `512 × 512 px` sem aumentar artificialmente.
3. **Adicione o áudio:** Arraste um arquivo de áudio, clique em **Áudio** ou cole uma URL válida do MyInstants (Desktop/Extensão). Limites: até `25 MB` e `3 minutos`; seleção entre `0,1 s` e `5 s` ou `10 s` (em GIFs animados, a duração mínima é de 1 ciclo do GIF até o limite ativo).
4. **Ajuste o trecho e o fundo:** Clique na forma de onda ou mova o controle deslizante, ouça a prévia e escolha **Transparente** (WebM) ou **Branco / Preto / Cor** (MP4) quando houver transparência.
5. **Pré-visualize, copie ou baixe:** Use `➔` para gerar e copiar/compartilhar, `⬇` para escolher o formato exato, `⋯` para abrir/salvar projetos, trocar o idioma e ver Sobre/licenças, e `✕` para reiniciar.

---

## 🤖 CLI Headless e Servidor MCP Local (Figurinhas com IA)

O StikSound inclui uma **CLI multiplataforma** (`macOS`, `Windows`, `Linux`) com um **servidor MCP (Model Context Protocol) local integrado** (`stiksound mcp`) para criar figurinhas pelo terminal ou conversando com seu assistente de IA, mantendo todo o processamento local.

> [!NOTE]
> Desktop, Extensão Chrome e Web **não incluem nem exigem FFmpeg**. A CLI é distribuída em separado (`StikSound-*-cli.zip`) e requer **Node.js 22+** e **FFmpeg**. Veja detalhes completos em [apps/cli/README.md](apps/cli/README.md).

### Tools disponíveis no servidor MCP local

| Tool MCP | Tipo | O que faz |
| --- | :---: | --- |
| `search_sounds` | Leitura | Busca sons no `myinstants.com` por palavras-chave ou descrição (`query`, `limit`, `locale`) sob a lista estrita HTTPS/SSRF e retorna títulos e `page_url`. |
| `create_sound_sticker` | Escrita | Combina um arquivo visual (`image_path`) **ou texto renderizado localmente** (`text`, `text_style`: `meme` \| `card` \| `minimal`, `text_color`, `background_color`, `transparent_background`) com `audio_path` ou `myinstants_url`, `trim: "loudest"`, `max_duration_s: 5 \| 10`, perfis `video-mp4`, `video-webm-alpha`, `sound-bundle`, `standard-webp`, `save_project` e cópia para a área de transferência. |
| `probe_media` | Leitura | Inspeciona imagem, GIF, vídeo, áudio ou `.stiksound.zip` (dimensões, recorte `1:1`, trechos mais altos de `5s`/`10s` e prévia WebP). |
| `export_project` | Escrita | Reabre um projeto `.stiksound.zip` e reexporta com outro perfil ou duração. |
| `check_environment` | Leitura | Executa o diagnóstico (`doctor`) de FFmpeg, encoders, WebP WASM e renderizador de texto. |

### ✨ Como criar stickers com IA usando apenas um prompt

- **Descrevendo o emote/personagem + som:**
  > `"usa @Stiksound quiero un stiker en mp4 de 10 segundos de dio brando con el sonido de omae-wa-mo-shinderu"`
  >
  > Como você apenas descreveu o personagem (sem enviar imagem nem pedir busca na web), o assistente **cria a imagem usando o modelo de geração de imagens** da sua IA (ou usa `text` para figurinhas de texto), encontra o som via `search_sounds` e chama `create_sound_sticker` (`profile: "video-mp4"`, `max_duration_s: 10`, `trim: "loudest"`).
- **Pedindo explicitamente um GIF ou imagem da web (ou enviando um arquivo seu):**
  > `"Stiksound ahora hazlo pero con un gif de dio brando que encuentres en web"`
  >
  > Ao especificar um GIF da web (ou informar o caminho do seu arquivo), o assistente não gera imagem por IA: passa o caminho absoluto do GIF em `image_path` e o StikSound faz o loop quadro a quadro sincronizado com os 10 segundos de áudio.

### 🔌 Como conectar o servidor MCP aos apps mais populares

Todos os blocos abaixo possuem o **botão nativo de copiar** do GitHub no canto superior direito *(o GitHub remove botões HTML/JS customizados por segurança)*. Você também pode rodar `stiksound mcp --print-config` para gerar os templates com seu caminho real.

```json
{
  "mcpServers": {
    "stiksound": {
      "command": "node",
      "args": [
        "/CAMINHO/ABSOLUTO/stiksound-cli/cli.mjs",
        "mcp"
      ]
    }
  }
}
```

- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows) · **Claude Code:** `claude mcp add stiksound --scope user -- node "/CAMINHO/ABSOLUTO/stiksound-cli/cli.mjs" mcp`
- **Gemini CLI:** `~/.gemini/settings.json` ou `gemini mcp add stiksound node "/CAMINHO/ABSOLUTO/stiksound-cli/cli.mjs" mcp` · **Antigravity:** `~/.gemini/antigravity/mcp_config.json`
- **OpenAI Codex CLI:** `codex mcp add stiksound -- node "/CAMINHO/ABSOLUTO/stiksound-cli/cli.mjs" mcp` (ou `[mcp_servers.stiksound]` em `~/.codex/config.toml`). *(Observação: conectores do ChatGPT na nuvem ainda não executam servidores `stdio` locais; use Codex CLI, VS Code / GitHub Copilot ou Cursor para modelos GPT com MCP local.)*
- **VS Code / GitHub Copilot (`.vscode/mcp.json`):** use `"servers"` com `"type": "stdio"`, `"command": "node"` e `"args": ["/CAMINHO/ABSOLUTO/stiksound-cli/cli.mjs", "mcp"]`.

---

## Como funciona internamente

- **Pipeline de imagem e GIF:** Verifica os bytes reais do arquivo, aplica limites contra decompression bombs e consumo excessivo em GIFs (`300` quadros, `64 MiB` canvas, `256 MiB` RGBA acumulado), calcula o recorte 1:1 e agenda o loop dos quadros compatível com a prévia do navegador.
- **Pipeline de áudio:** Decodifica, mistura para mono, calcula 1024 picos para a forma de onda, recorta `start_ms`–`end_ms` inteiros e reamostra para **48 kHz mono**.
- **Codificação de vídeo:** Usa **WebCodecs (`VideoEncoder` + `AudioEncoder`) + `mp4-muxer` / `webm-muxer` em TypeScript** quando disponível, ou **Canvas + `MediaRecorder`** como alternativa universal.

---

## Estrutura do repositório

```text
apps/
  cli/           CLI headless (Node 22 + FFmpeg) e servidor MCP local (`stiksound mcp`)
  desktop/       App Tauri para Windows/macOS
  extension/     Extensão Chrome Manifest V3
  web/           App Web / PWA publicado no GitHub Pages
packages/
  core/          Modelo de projeto, invariantes, validação e casos de uso
  ui/            Editor React compartilhado, barra de recorte e i18n (9 idiomas)
  media-web/     Sniffing, decodificação, trim, waveform, mux e ZIP em TypeScript
  providers/     Extração e política de URLs do MyInstants
crates/
  audio-engine/  Probe/decodificação/trim de áudio em Rust
  image-engine/  Probe e utilidades de imagem/GIF em Rust
  video-engine/  Validação e utilidades de mux em Rust
  project-store/ Escrita atômica e pacotes em Rust
docs/            Requisitos, arquitetura, especificações e decisões
```

---

## Instalação

### Windows e macOS
1. Acesse [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest).
2. Baixe o instalador ou executável da sua plataforma (`windows-x64` ou `macos-universal`).
3. Abra o StikSound — não requer FFmpeg nem ferramentas externas. *(No macOS, clique com o botão direito → **Abrir** se aparecer o aviso de desenvolvedor não verificado).*

### Extensão Chrome / Edge / Brave
1. Baixe `StikSound-*-chrome-extension.zip` em [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest) e extraia o arquivo.
2. Abra `chrome://extensions/`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta extraída.

### CLI e Servidor MCP Local (macOS, Windows e Linux)
1. Instale **Node.js 22+** e **FFmpeg** (`brew install ffmpeg`, `sudo apt install ffmpeg` ou `winget install Gyan.FFmpeg`).
2. Baixe `StikSound-*-cli.zip` em [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest) e extraia em uma pasta fixa.
3. Execute `bin/stiksound doctor` (macOS/Linux) ou `bin\stiksound.cmd doctor` (Windows), ou `bin/stiksound mcp --print-config` para gerar os templates MCP.

---

## Privacidade e segurança

- Nenhum servidor recebe suas imagens, vídeos ou áudios.
- Todo o processamento de mídia ocorre localmente no dispositivo.
- A única requisição de rede é a resolução de links do MyInstants (apenas Desktop e Extensão Chrome), protegida por lista estrita HTTPS, limite de redirecionamentos, bloqueio de IPs privados/reservados em Rust e limite de 25 MB / 20 s.

---

## Desenvolvimento

```bash
git clone https://github.com/SilverFeit/StikSound.git
cd StikSound
npm install
npm run typecheck
npm test
npm run build
cargo test --workspace --exclude stiksound-desktop
```

## Licença

Licença dupla sob **MIT License** ([LICENSE-MIT](LICENSE-MIT)) ou **Apache License, Version 2.0** ([LICENSE-APACHE](LICENSE-APACHE)), à sua escolha (`MIT OR Apache-2.0`).
