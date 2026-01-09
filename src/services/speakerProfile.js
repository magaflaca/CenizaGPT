const { PermissionsBitField } = require('discord.js');

function getSpeakerProfile(member) {
  if (!member) return null;

  const displayName = member.displayName || member.nickname || member.user?.username || 'Usuario';
  const topRoleName = member.roles?.highest?.name || 'sin-rol';

  const isAdmin = Boolean(member.permissions?.has?.(PermissionsBitField.Flags.Administrator));

  return {
    id: member.id || member.user?.id,
    displayName,
    topRoleName,
    isAdmin,
  };
}

module.exports = { getSpeakerProfile };
