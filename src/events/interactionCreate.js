const { resolveMember, resolveRole } = require('../services/discordResolvers');
const { kickMember, banMember, setNickname, addRole, removeRole, timeoutMember } = require('../services/discordActions');
const { handleItemAutocomplete } = require('../services/itemAutocomplete');

async function handleConfirm(interaction, ctx, actionId, isConfirm) {
  const pending = isConfirm ? ctx.confirmStore.consume(actionId) : ctx.confirmStore.consume(actionId);
  if (!pending) {
    return interaction.reply({ ephemeral: true, content: '⏳ Esta confirmación ya expiró o no existe.' });
  }
  if (interaction.user.id !== pending.requesterId) {
    return interaction.reply({ ephemeral: true, content: '❌ Solo quien solicitó la acción puede confirmarla.' });
  }

  if (!isConfirm) {
    // Cancelado
    return interaction.update({ content: '🚫 Acción cancelada.', embeds: [], components: [] });
  }

  // Confirmado
  await interaction.update({ content: '✅ Confirmado. Ejecutando...', embeds: [], components: [] });

  const { action } = pending;
  const guild = interaction.guild;
  const requesterMember = await guild.members.fetch(interaction.user.id);

  try {
    if (action.type === 'kick') {
      const targetMember = await resolveMember(guild, action.targetUser);
      if (!targetMember) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar al usuario objetivo.' });
      const res = await kickMember({ guild, requesterMember, targetMember, reason: action.reason });
      if (!res.ok) return interaction.followUp({ ephemeral: true, content: `❌ ${res.reason}` });
      return interaction.followUp({ ephemeral: true, content: `👢 Expulsado: <@${targetMember.id}>` });
    }

    if (action.type === 'ban') {
      const targetMember = await resolveMember(guild, action.targetUser);
      if (!targetMember) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar al usuario objetivo.' });
      const res = await banMember({
        guild,
        requesterMember,
        targetMember,
        reason: action.reason,
        deleteMessageSeconds: action.deleteMessageSeconds || 0,
      });
      if (!res.ok) return interaction.followUp({ ephemeral: true, content: `❌ ${res.reason}` });
      return interaction.followUp({ ephemeral: true, content: `🔨 Baneado: <@${targetMember.id}>` });
    }

    if (action.type === 'nickname_set') {
      const targetMember = await resolveMember(guild, action.targetUser);
      if (!targetMember) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar al usuario objetivo.' });
      const res = await setNickname({
        guild,
        requesterMember,
        targetMember,
        newNickname: action.newNickname,
        reason: action.reason,
      });
      if (!res.ok) return interaction.followUp({ ephemeral: true, content: `❌ ${res.reason}` });
      return interaction.followUp({ ephemeral: true, content: `🏷️ Apodo actualizado para <@${targetMember.id}>` });
    }

    if (action.type === 'role_add' || action.type === 'role_remove') {
      const targetMember = await resolveMember(guild, action.targetUser);
      if (!targetMember) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar al usuario objetivo.' });
      const role = await resolveRole(guild, action.role);
      if (!role) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar el rol.' });

      const res = action.type === 'role_add'
        ? await addRole({ guild, requesterMember, targetMember, role, reason: action.reason })
        : await removeRole({ guild, requesterMember, targetMember, role, reason: action.reason });

      if (!res.ok) return interaction.followUp({ ephemeral: true, content: `❌ ${res.reason}` });

      const verb = action.type === 'role_add' ? 'Asignado' : 'Quitado';
      return interaction.followUp({ ephemeral: true, content: `✅ ${verb} <@&${role.id}> a <@${targetMember.id}>` });
    }

    if (action.type === 'timeout') {
      const targetMember = await resolveMember(guild, action.targetUser);
      if (!targetMember) return interaction.followUp({ ephemeral: true, content: 'No pude encontrar al usuario objetivo.' });
      const res = await timeoutMember({
        guild,
        requesterMember,
        targetMember,
        durationMs: action.durationMs ?? 0,
        reason: action.reason,
      });
      if (!res.ok) return interaction.followUp({ ephemeral: true, content: `❌ ${res.reason}` });
      if (Number(action.durationMs) === 0) {
        return interaction.followUp({ ephemeral: true, content: `🔊 Timeout removido para <@${targetMember.id}>` });
      }
      const mins = Math.round(Number(action.durationMs) / 60000);
      return interaction.followUp({ ephemeral: true, content: `🔇 Timeout aplicado a <@${targetMember.id}> por ~${mins} min` });
    }

    return interaction.followUp({ ephemeral: true, content: 'Acción no soportada.' });
  } catch (e) {
    console.error('[Confirm] Error ejecutando acción:', e);
    return interaction.followUp({ ephemeral: true, content: `⚠️ Error ejecutando acción: ${e.message || e}` });
  }
}

async function interactionCreate(interaction, ctx) {
  try {

    if (interaction.isAutocomplete()) {
  const handled = await handleItemAutocomplete(interaction, ctx);
  if (handled) return;
}

    if (interaction.isChatInputCommand()) {
      const cmd = ctx.commands.get(interaction.commandName);
      if (!cmd) return;
      return cmd.execute(interaction, ctx);
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('confirm:')) {
        return handleConfirm(interaction, ctx, id.split(':')[1], true);
      }
      if (id.startsWith('cancel:')) {
        return handleConfirm(interaction, ctx, id.split(':')[1], false);
      }
    }
  } catch (err) {
    console.error('[interactionCreate] Error:', err);
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ ephemeral: true, content: `⚠️ ${err.message || err}` });
    }
    return interaction.reply({ ephemeral: true, content: `⚠️ ${err.message || err}` });
  }
}

module.exports = { interactionCreate };
