// src/vision/imageSource.js

function isLikelyImageUrl(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  return (
    u.startsWith('http://') ||
    u.startsWith('https://')
  );
}

function pickImageFromMessage(msg) {
  if (!msg) return null;

  // 1) attachments
  const att = msg.attachments?.find?.((a) => {
    const ct = a.contentType || '';
    return ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.url || '');
  });
  if (att?.url) return att.url;

  // 2) embeds (si alguien pegó link)
  const emb = msg.embeds?.find?.((e) => e?.image?.url || e?.thumbnail?.url);
  if (emb?.image?.url) return emb.image.url;
  if (emb?.thumbnail?.url) return emb.thumbnail.url;

  return null;
}

function extractFirstUrlFromText(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>()"]+/i);
  return m ? m[0] : null;
}

module.exports = {
  isLikelyImageUrl,
  pickImageFromMessage,
  extractFirstUrlFromText,
};
