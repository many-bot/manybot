/**
 * scheduler.js
 *
 * Permite que plugins registrem tarefas agendadas via cron.
 * Usa node-cron por baixo, mas plugins nunca importam node-cron diretamente —
 * eles chamam apenas api.schedule(cron, fn).
 *
 * Uso no plugin:
 *   import { schedule } from "many";
 *   schedule("0 9 * * 1", async () => { await api.send("Bom dia!"); });
 */

import cron   from "node-cron";
import { logger } from "../logger/logger.js";

/** Lista de tasks ativas (para eventual teardown) */
const tasks = [];

/**
 * Registra uma tarefa cron.
 * @param {string}   expression  — expressão cron ex: "0 9 * * 1"
 * @param {Function} fn          — função async a executar
 * @param {string}   pluginName  — nome do plugin (para log)
 */
export function schedule(expression, fn, pluginName = "unknown") {
  if (!cron.validate(expression)) {
    logger.warn(`Plugin "${pluginName}" registrou expressão cron inválida: "${expression}"`);
    return;
  }

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`Erro no agendamento do plugin "${pluginName}": ${err.message}`);
    }
  });

  tasks.push({ pluginName, expression, task });
  logger.info(`Agendamento registrado — plugin "${pluginName}" → "${expression}"`);
}

/** Para todos os agendamentos (útil no shutdown) */
export function stopAll() {
  tasks.forEach(({ task }) => task.stop());
  tasks.length = 0;
}