const { terrariaSummarize, terrariaAsk } = require('../terraria/terrariaBridge');
const { pickWikiLink, pickDisplayName, linkifyTextWithItem } = require('../terraria/linkify');
const { normalize } = require('../utils/text');

function looksLikeQuestion(text) {
  const t = normalize(text);
  if (!t) return false;
  const starters = ['que ', 'como ', 'cuanto ', 'donde ', 'cuando ', 'por que ', 'porque ', 'para que '];
  return text.includes('?') || starters.some((s) => t.startsWith(s)) || t.includes('como se') || t.includes('como consigo');
}

function looksLikeSummaryRequest(text) {
  const t = normalize(text);
  if (!t) return false;
  const signals = ['resumen', 'resumeme', 'resúmeme', 'resume', 'info', 'informacion', 'información', 'explicame', 'explícame', 'que es', 'qué es', 'descripcion', 'descripción'];
  return signals.some((s) => t.includes(normalize(s)));
}

function looksLikeTerrariaFollowup(text) {
  const t = normalize(text);
  if (!t) return false;
  const signals = [
    'crafteo', 'craftear', 'receta', 'ingredientes',
    'drop', 'suelt', 'probabilidad',
    'daño', 'damage', 'stats', 'estadisticas', 'estadísticas',
    'sirve', 'para que', 'para qué', 'que hace', 'qué hace',
    'como consigo', 'cómo consigo', 'como se obtiene', 'cómo se obtiene',
    'precio', 'vende', 'comprar',
    'mejor', 'peor',
    'y su', 'y sus', 'y el', 'y la', 'y los', 'y las',
  ];
  return signals.some((s) => t.includes(normalize(s))) || looksLikeQuestion(text);
}

function getNow() {
  return Date.now();
}

function ensureItemCaches(state) {
  return {
    itemSummaries: state.itemSummaries || {},
    itemQA: state.itemQA || {},
  };
}

function isBadTerrariaAnswer(text) {
  const t = normalize(text || '');
  if (!t) return true;
  const bad = [
    'no hay informacion proporcionada',
    'no hay información proporcionada',
    'falta --question',
    'falta --question',
    'falta groq_terraria_api_key',
  ];
  return bad.some((b) => t.includes(normalize(b))) || t.length < 40;
}

async function answerAboutItem({
  memoryStore,
  guildId,
  userId,
  item,
  userText,
  preferSpanish = true,
  includeTip = false,
}) {
  const url = pickWikiLink(item, { preferSpanish });
  const display = pickDisplayName(item, { preferSpanish });

  if (!url) {
    return `No tengo enlace de wiki para **${display}** en items.json.`;
  }

  const state = memoryStore.getUserState({ guildId, userId });
  const { itemSummaries, itemQA } = ensureItemCaches(state);

  // Mantener contexto del item activo (con timestamp)
  memoryStore.setUserState({
    guildId,
    userId,
    patch: {
      activeItem: {
        name: display,
        url,
        ts: getNow(),
        itemRef: {
          id: item.id ?? null,
          name: item.name || null,
          name_es: item.name_es || null,
          internal_name: item.internal_name || null,
          wiki_link: item.wiki_link || null,
          wiki_link_es: item.wiki_link_es || null,
        },
      },
    },
  });

  const normQ = normalize(userText);
  const isSummary = looksLikeSummaryRequest(userText) || (!looksLikeQuestion(userText));

  // Cache summary (24h)
  const summaryCache = itemSummaries[url];
  const summaryFresh = summaryCache && (getNow() - (summaryCache.ts || 0) < 24 * 60 * 60 * 1000);

  let answer = '';

  try {
    if (isSummary) {
      if (summaryFresh && summaryCache.text) {
        answer = summaryCache.text;
      } else {
        answer = await terrariaSummarize(url);
        if (!isBadTerrariaAnswer(answer)) {
          itemSummaries[url] = { ts: getNow(), text: answer };
          memoryStore.setUserState({ guildId, userId, patch: { itemSummaries } });
        }
      }
    } else {
      const qaForUrl = itemQA[url] || {};
      const cached = qaForUrl[normQ];
      if (cached && (getNow() - (cached.ts || 0) < 6 * 60 * 60 * 1000) && cached.text) {
        answer = cached.text;
      } else {
        answer = await terrariaAsk(url, userText);
        if (!isBadTerrariaAnswer(answer)) {
          qaForUrl[normQ] = { ts: getNow(), text: answer };
          itemQA[url] = qaForUrl;
          memoryStore.setUserState({ guildId, userId, patch: { itemQA } });
        }
      }
    }
  } catch (e) {
    answer = '';
  }

  // Si la respuesta es mala/vacía, devolvemos un fallback seguro
  if (isBadTerrariaAnswer(answer)) {
    const header = `[${display}](<${url}>)`;
    let msg = `${header}

⚠️ Ahora mismo no pude obtener información suficiente de la wiki para este item.`;
    msg += `\n\nProbá esto:`;
    msg += `\n- Usá **/item info ${display}** (resumen)`;
    msg += `\n- O probá **/item ask** para hacer una pregunta.\n- También podés pegar el link exacto de la wiki y usar **/wiki summarize**.`;
    return msg.trim();
  }

  // Linkify menciones del item
  let finalText = String(answer || '');
  finalText = linkifyTextWithItem(finalText, item, { preferSpanish });

  // Garantizar que salga el link al inicio (aunque la respuesta no repita el nombre)
  const header = `[${display}](<${url}>)`;
  if (!finalText.includes(url)) {
    finalText = `${header}\n\n${finalText}`.trim();
  }

  if (includeTip) {
    finalText += `\n\n_(Tip: puedes usar **/item info** para ver la ficha rápido, y **/item clear** para olvidar el item activo.)_`;
  }

  return finalText.trim();
}

module.exports = {
  answerAboutItem,
  looksLikeQuestion,
  looksLikeSummaryRequest,
  looksLikeTerrariaFollowup,
};
