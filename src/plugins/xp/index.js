/**
 * Ideia:
 * 
 * Quando esse plugin for chamado, vai salvar o id de quem mandou no banco de dados.
 * Quando esse id mandar mensagem de novo, o plugin vai "se lembrar" dessa pessoa e contar xp com:
 * 
 * - Número de mensagens a cada 30s > conta 1 ponto cada mensagem sendo de texto ou de audio. Durante o intervalo de 30s ele não conta nada.
 * - Tipo da mensagem:
 *      - Texto/Audio: multiplicar por 1
 *      - Vídeo/Foto: multiplcar por 2
 * 
 * - Aculma karma dependendo da mensagem. Se suas mensagens conterem palavrões frequentes ou muito spam (ex. 5 mensagens/s), seu karma diminui:
 *      - Karma negativo (abaixo de 0): divide pontos de xp por 2
 *      - Karma baixo (10-20): multplica pontos por 1
 *      - Karma médio (30-40): multiplica pontos por 2
 *      - Karma alto (50-80): multiplca pontos por 3
 * 
 * No final de cada mês, esse plugin organiza uma lista com o ranking dos top 10 com maiores XP do mês e manda em ID (chat).
 * 
 * Esse plugin é a base para fazer um sistema de economia daqui um tempo.
*/