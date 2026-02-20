async function executeCommandSafely({
  interaction,
  command,
  errorMessage = 'There was an error while executing this command!',
  onSuccess = null,
  onFailure = null,
}) {
  try {
    await command.execute(interaction);
    if (typeof onSuccess === 'function') {
      await onSuccess();
    }
    return true;
  } catch (error) {
    let skipUserReply = false;
    if (typeof onFailure === 'function') {
      const shouldReply = await onFailure(error);
      if (shouldReply === false) skipUserReply = true;
    }

    if (!skipUserReply) {
      try {
        if (interaction.replied) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply({ content: errorMessage });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      } catch (replyError) {
        const rcode = replyError?.code;
        console.warn('Failed to send error via interaction API:', rcode, replyError?.message);
      }
    }
    return false;
  }
}

module.exports = {
  executeCommandSafely,
};
