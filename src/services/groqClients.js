const Groq = require('groq-sdk');

function createGroqClient(apiKey) {
  if (!apiKey) throw new Error('Falta GROQ API key');
  return new Groq({ apiKey });
}

async function chatCompletion({ client, model, messages, temperature = 0.5, maxTokens = 500 }) {
  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return resp.choices[0]?.message?.content || '';
}

module.exports = {
  createGroqClient,
  chatCompletion,
};
