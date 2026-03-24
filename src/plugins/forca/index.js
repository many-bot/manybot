/**
 * plugins/forca/index.js
 *
 * Estado dos jogos de forca fica aqui dentro — isolado no plugin.
 * Múltiplos grupos jogam simultaneamente sem conflito.
 */

import { CMD_PREFIX } from "../../config.js";

// Estados dos jogos
const jogosAtivos = new Map();         // chatId -> { palavra, tema, vidas, progresso }
const participantesAtivos = new Map(); // chatId -> Set de usuários que reagiram
export let forcaAtiva = false;


// Palavras de exemplo
const PALAVRAS = [
    { palavra: "python", tema: "Linguagem de programação" },
    { palavra: "javascript", tema: "Linguagem de programação" },
    { palavra: "java", tema: "Linguagem de programação" },
    { palavra: "cachorro", tema: "Animal" },
    { palavra: "gato", tema: "Animal" },
    { palavra: "elefante", tema: "Animal" },
    { palavra: "girafa", tema: "Animal" },
    { palavra: "guitarra", tema: "Instrumento musical" },
    { palavra: "piano", tema: "Instrumento musical" },
    { palavra: "bateria", tema: "Instrumento musical" },
    { palavra: "violino", tema: "Instrumento musical" },
    { palavra: "futebol", tema: "Esporte" },
    { palavra: "basquete", tema: "Esporte" },
    { palavra: "natação", tema: "Esporte" },
    { palavra: "tênis", tema: "Esporte" },
    { palavra: "brasil", tema: "País" },
    { palavra: "japão", tema: "País" },
    { palavra: "canadá", tema: "País" },
    { palavra: "frança", tema: "País" },
    { palavra: "marte", tema: "Planeta" },
    { palavra: "vênus", tema: "Planeta" },
    { palavra: "júpiter", tema: "Planeta" },
    { palavra: "saturno", tema: "Planeta" },
    { palavra: "minecraft", tema: "Jogo" },
    { palavra: "fortnite", tema: "Jogo" },
    { palavra: "roblox", tema: "Jogo" },
    { palavra: "amongus", tema: "Jogo" },
    { palavra: "rosa", tema: "Flor" },
    { palavra: "girassol", tema: "Flor" },
    { palavra: "tulipa", tema: "Flor" },
    { palavra: "orquídea", tema: "Flor" },
    { palavra: "tesoura", tema: "Objeto" },
    { palavra: "caderno", tema: "Objeto" },
    { palavra: "computador", tema: "Objeto" },
    { palavra: "telefone", tema: "Objeto" },
    { palavra: "lua", tema: "Corpo celeste" },
    { palavra: "sol", tema: "Corpo celeste" },
    { palavra: "estrela", tema: "Corpo celeste" },
    { palavra: "cometa", tema: "Corpo celeste" },
    { palavra: "oceano", tema: "Natureza" },
    { palavra: "montanha", tema: "Natureza" },
];

// Função para gerar a palavra com underscores
const gerarProgresso = palavra =>
    palavra.replace(/[a-zA-Z]/g, "_");

export default async function ({ msg, api }) {
    const chatId = api.chat.id;
    const sub = msg.args[1];

    // ── Comando principal do jogo
    if (msg.is(CMD_PREFIX + "forca")) {
        if (!sub) {
            await api.send(
                `🎮 *Jogo da Forca*\n\n` +
                `\`${CMD_PREFIX}forca começar\` — inicia o jogo\n` +
                `\`${CMD_PREFIX}forca parar\` — encerra o jogo`
            );
            return;
        }

        if (sub === "começar") {
            forcaAtiva = true;
            // Pega uma palavra aleatória
            const sorteio = PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)];
            
            // Inicializa o jogo
            jogosAtivos.set(chatId, {
                palavra: sorteio.palavra.toLowerCase(),
                tema: sorteio.tema,
                vidas: 6,
                progresso: gerarProgresso(sorteio.palavra)
            });

            participantesAtivos.set(chatId, new Set()); // reset participantes

            await api.send(
                `🎮 *Jogo da Forca iniciado!*\n\n` +
                `Tema: *${sorteio.tema}*\n` +
                `Palavra: \`${gerarProgresso(sorteio.palavra)}\`\n` +
                `Vidas: 6\n\n` +
                `Digite uma letra para adivinhar!`
            );
            return;
        }

        if (sub === "parar") {
            jogosAtivos.delete(chatId);
            participantesAtivos.delete(chatId);
            await api.send("🛑 Jogo da Forca encerrado.");
            return;
        }

        await api.send(
            `❌ Subcomando *${sub}* não existe.\n` +
            `Use ${CMD_PREFIX} + \`forca começar\` ou ${CMD_PREFIX} + \`forca parar\`.`
        );
        return;
    }

    // ── Tentativas durante o jogo
    const jogo = jogosAtivos.get(chatId);
    if (!jogo) return; // Nenhum jogo ativo

    const tentativa = msg.body.trim().toLowerCase();
    if (!/^[a-z]$/.test(tentativa)) return; // apenas letras simples

    // Se a letra está na palavra
    let acerto = false;
    let novoProgresso = jogo.progresso.split("");
    for (let i = 0; i < jogo.palavra.length; i++) {
        if (jogo.palavra[i] === tentativa) {
            novoProgresso[i] = tentativa;
            acerto = true;
        }
    }
    jogo.progresso = novoProgresso.join("");

    if (!acerto) jogo.vidas--;

    // Feedback para o grupo
    if (jogo.progresso === jogo.palavra) {
        await msg.reply(`🎉 Parabéns! Palavra completa: \`${jogo.palavra}\``);
        jogosAtivos.delete(chatId);
        participantesAtivos.delete(chatId);
        return;
    }

    if (jogo.vidas <= 0) {
        await msg.reply(`💀 Fim de jogo! Palavra era: \`${jogo.palavra}\``);
        jogosAtivos.delete(chatId);
        participantesAtivos.delete(chatId);
        return;
    }

    await msg.reply(
        `Palavra: \`${jogo.progresso}\`\n` +
        `Vidas: ${jogo.vidas}\n` +
        (acerto ? "✅ Acertou a letra!" : "❌ Errou a letra!")
    );
}