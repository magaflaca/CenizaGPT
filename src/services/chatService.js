const { buildSystemPrompt } = require('./promptBuilder');
const { chatCompletion } = require('./groqClients');
const { sanitizeBotResponse } = require('./responseSanitizer');

function formatUserMessageForLLM({ speaker, text }) {
  const header = speaker
    ? `[Usuario id=${speaker.id} apodo="${speaker.displayName}" rol_mas_alto="${speaker.topRoleName}" admin=${speaker.isAdmin ? 'si' : 'no'}]`
    : '[Usuario]';

  return `${header}\n${text}`.trim();
}

async function generateChatReply({ groqClient, model, config, guild, speaker, memoryHistory, text }) {
  const systemPrompt = buildSystemPrompt({ config, speaker, guild });

  const messages = [{ role: 'system', content: systemPrompt }];

  // Historial (ya viene estructurado)
  for (const h of (memoryHistory || [])) {
    if (!h || !h.role || !h.content) continue;
    // Solo roles permitidos
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content: h.content });
  }

  messages.push({
    role: 'user',
    content: formatUserMessageForLLM({ speaker, text }),
  });

  const raw = await chatCompletion({
    client: groqClient,
    model,
    messages,
    temperature: config.llm?.temperature ?? 0.7,
    // Respuestas más breves por defecto (sube esto en serverConfig.json si quieres respuestas largas)
    maxTokens: config.llm?.maxTokens ?? 450,
  });

  return sanitizeBotResponse(raw);
}

module.exports = {
  generateChatReply,
  formatUserMessageForLLM,
};
