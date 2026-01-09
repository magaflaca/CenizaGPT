const { PermissionsBitField } = require('discord.js');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // 28 días (límite Discord)

function has(member, perm) {
  return Boolean(member?.permissions?.has?.(perm));
}

function ensure({ condition, message }) {
  return condition ? { ok: true } : { ok: false, reason: message };
}

function canManageTarget({ requester, botMember, target, requirePerm }) {
  // Permisos base
  if (!has(requester, PermissionsBitField.Flags.Administrator) && requirePerm && !has(requester, requirePerm)) {
    return { ok: false, reason: 'No tienes permisos suficientes para esta acción.' };
  }
  if (!has(botMember, PermissionsBitField.Flags.Administrator) && requirePerm && !has(botMember, requirePerm)) {
    return { ok: false, reason: 'Yo no tengo permisos suficientes en el servidor para ejecutar esa acción.' };
  }
  if (target && requester && requester.id === target.id) {
    return { ok: false, reason: 'No voy a aplicar esa acción sobre ti mismo.' };
  }
  // Jerarquía
  if (target && botMember) {
    const botPos = botMember.roles.highest?.position || 0;
    const targetPos = target.roles.highest?.position || 0;
    if (targetPos >= botPos) {
      return { ok: false, reason: 'No puedo gestionar a ese usuario: su rol está por encima o igual al mío.' };
    }
  }
  if (target && requester) {
    const requesterPos = requester.roles.highest?.position || 0;
    const targetPos = target.roles.highest?.position || 0;
    if (targetPos >= requesterPos && !has(requester, PermissionsBitField.Flags.Administrator)) {
      return { ok: false, reason: 'No puedes gestionar a ese usuario: su rol está por encima o igual al tuyo.' };
    }
  }
  return { ok: true };
}

async function kickMember({ guild, requesterMember, targetMember, reason }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.KickMembers,
  });
  if (!check.ok) return check;

  if (!targetMember.kickable) {
    return { ok: false, reason: 'Discord marca a este miembro como no expulsable (jerarquía/permisos).' };
  }

  await targetMember.kick(reason || undefined);
  return { ok: true };
}

async function banMember({ guild, requesterMember, targetMember, reason, deleteMessageSeconds = 0 }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.BanMembers,
  });
  if (!check.ok) return check;

  if (!targetMember.bannable) {
    return { ok: false, reason: 'Discord marca a este miembro como no baneable (jerarquía/permisos).' };
  }

  await targetMember.ban({ reason: reason || undefined, deleteMessageSeconds });
  return { ok: true };
}

async function setNickname({ guild, requesterMember, targetMember, newNickname, reason }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.ManageNicknames,
  });
  if (!check.ok) return check;

  await targetMember.setNickname(newNickname, reason || undefined);
  return { ok: true };
}

async function addRole({ guild, requesterMember, targetMember, role, reason }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.ManageRoles,
  });
  if (!check.ok) return check;

  const botPos = botMember.roles.highest?.position || 0;
  if ((role.position || 0) >= botPos) {
    return { ok: false, reason: 'No puedo asignar ese rol porque está por encima o igual al mío.' };
  }

  await targetMember.roles.add(role, reason || undefined);
  return { ok: true };
}

async function removeRole({ guild, requesterMember, targetMember, role, reason }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.ManageRoles,
  });
  if (!check.ok) return check;

  const botPos = botMember.roles.highest?.position || 0;
  if ((role.position || 0) >= botPos) {
    return { ok: false, reason: 'No puedo quitar ese rol porque está por encima o igual al mío.' };
  }

  await targetMember.roles.remove(role, reason || undefined);
  return { ok: true };
}

async function timeoutMember({ guild, requesterMember, targetMember, durationMs, reason }) {
  const botMember = await guild.members.fetchMe();
  const check = canManageTarget({
    requester: requesterMember,
    botMember,
    target: targetMember,
    requirePerm: PermissionsBitField.Flags.ModerateMembers,
  });
  if (!check.ok) return check;

  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) {
    return { ok: false, reason: 'Duración inválida para timeout.' };
  }

  if (ms > MAX_TIMEOUT_MS) {
    return { ok: false, reason: 'La duración máxima de timeout es 28 días.' };
  }

  // Discord.js: duration null = remover timeout
  const duration = ms === 0 ? null : ms;

  // Algunas versiones exponen moderatable; si existe, lo respetamos.
  if (typeof targetMember.moderatable === 'boolean' && !targetMember.moderatable) {
    return { ok: false, reason: 'Discord marca a este miembro como no moderable (timeout) por jerarquía/permisos.' };
  }

  await targetMember.timeout(duration, reason || undefined);
  return { ok: true };
}

module.exports = {
  kickMember,
  banMember,
  setNickname,
  addRole,
  removeRole,
  timeoutMember,
};
