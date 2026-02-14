require('dotenv').config();
const { randomBytes } = require('crypto');
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  Events,
  MessageFlags,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
});

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const parties = new Map();
const creationCache = new Map();
const threadsToDelete = new Map();

// --- KONFIGURACJA ---
const WARN_MINUTES = 25;      
const EXPIRE_MINUTES = 30;    
const THREAD_EXPIRY_DAYS = 1; 

const modeColors = {
  'Ranked': 0x00FF00,
  'Normal': 0x00FFFF,
  'Battlecup': 0xFFD700,
  'Inhouse': 0x808080
};

const modeEmojis = {
  'Ranked': '⚔️',
  'Normal': '🤙',
  'Battlecup': '🏆',
  'Inhouse': '🏠'
};

const rankEmojis = {
  'Dowolna': '❓',
  'Herald': '985542468093214761',
  'Guardian': '985542497650491392',
  'Crusader': '985542375847919676',
  'Archon': '985542342188617748',
  'Legend': '985542440133992459',
  'Ancient': '985538142436220958',
  'Divine': '985542414955593798',
  'Immortal': '969396388280545320'
};

const rankDisplay = {
  'Dowolna': '❓ Dowolna',
  'Herald': '<:BBherald:985542468093214761> Herald,',
  'Guardian': '<:BBuardian:985542497650491392> Guardian,',
  'Crusader': '<:BCrusader:985542375847919676> Crusader,',
  'Archon': '<:BDarchon:985542342188617748> Archon,',
  'Legend': '<:BLegend:985542440133992459> Legend,',
  'Ancient': '<:BMAncient:985538142436220958> Ancient,',
  'Divine': '<:BMdivine:985542414955593798> Divine,',
  'Immortal': '<:BNimmortal:969396388280545320> Immortal',
};

async function clearThread(threadId) {
  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (thread && thread.isThread()) {
      const messages = await thread.messages.fetch({ limit: 100 });
      if (messages.size > 0) {
        await thread.bulkDelete(messages).catch(() => {
          messages.forEach(msg => msg.delete().catch(() => {}));
        });
      }
      await thread.send("🔒 *To ogłoszenie zostało zakończone. Wątek zostanie wkrótce usunięty.*");
    }
  } catch (e) { console.error("Błąd czyszczenia wątku:", e); }
}

const commands = [{ name: 'party', description: 'Wysyła panel party maker' }];
const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- ZMODYFIKOWANA FUNKCJA PANELU ---
function createSetupPanel(interaction, mode) {
  const userId = interaction.user.id;
  const data = creationCache.get(userId) || { count: '1', ranks: [], vc: null };
  
  // Pobieramy kanały głosowe z serwera
  const guild = interaction.guild;
  const voiceChannels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildVoice)
    // FILTR: Pokazuj tylko kanały, które @everyone może widzieć (nie są prywatne)
    .filter(c => c.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel))
    .first(25); // Limit Discorda dla select menu to 25 opcji

  const countMenu = new StringSelectMenuBuilder()
    .setCustomId(`setcount_${mode}`)
    .setPlaceholder(`Szukam: ${data.count === 'Obojętnie' ? 'Obojętnie' : '+' + data.count}`)
    .addOptions([
      { label: 'Obojętnie', value: 'Obojętnie', default: data.count === 'Obojętnie' },
      ...Array.from({ length: 9 }, (_, i) => ({
        label: `Szukam +${i + 1}`,
        value: `${i + 1}`,
        default: data.count === `${i + 1}`
      }))
    ]);

  const rankMenu = new StringSelectMenuBuilder()
    .setCustomId(`setranks_${mode}`)
    .setPlaceholder('Wybierz rangi (możesz wybrać kilka)')
    .setMinValues(1).setMaxValues(5)
    .addOptions(Object.keys(rankEmojis).map(r => ({
      label: r,
      value: r,
      emoji: rankEmojis[r],
      default: data.ranks.includes(r)
    })));

  // Zamiana ChannelSelectMenu na StringSelectMenu z filtrem
  const vcMenu = new StringSelectMenuBuilder()
    .setCustomId(`setvc_${mode}`)
    .setPlaceholder('Wybierz kanał głosowy (opcjonalnie)');

  const vcOptions = voiceChannels.map(vc => ({
    label: vc.name,
    value: vc.id,
    default: data.vc === vc.id
  }));

  if (vcOptions.length > 0) {
    vcMenu.addOptions(vcOptions);
  } else {
    vcMenu.addOptions([{ label: 'Brak dostępnych kanałów', value: 'none', disabled: true }]);
  }

  const publishBtn = new ButtonBuilder()
    .setCustomId(`publish_${mode}`)
    .setLabel('Opublikuj Ogłoszenie')
    .setStyle(ButtonStyle.Success);

  const ranksText = data.ranks.length > 0 ? data.ranks.join(', ') : '*Nie wybrano*';

  return {
    content: `### 🛠️ Konfiguracja: **${mode}**\n➡️ Graczy: **${data.count === 'Obojętnie' ? 'Obojętnie' : '+' + data.count}**\n🔰 Rangi: **${ranksText}**\n🔊 Kanał: ${data.vc ? `<#${data.vc}>` : '*Nie wybrano*'}`,
    components: [
      new ActionRowBuilder().addComponents(countMenu),
      new ActionRowBuilder().addComponents(rankMenu),
      new ActionRowBuilder().addComponents(vcMenu),
      new ActionRowBuilder().addComponents(publishBtn)
    ]
  };
}

client.once(Events.ClientReady, async () => {
  console.log(`🚀 Bot aktywny: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const userId = interaction.user.id;

  if (interaction.isChatInputCommand() && interaction.commandName === 'party') {
    const embed = new EmbedBuilder()
      .setTitle('Jak to działa?')
      .setDescription(
        `1️⃣ Wybierz tryb gry poniżej.\n` +
        `2️⃣ Podaj liczbę graczy, rangi oraz kanał głosowy.\n` +
        `3️⃣ Gotowe! Twoje ogłoszenie będzie widoczne.\n\n` +
        `Po **${WARN_MINUTES} min** otrzymasz przypomnienie, a po **${EXPIRE_MINUTES} min** ogłoszenie wygaśnie automatycznie.`
      )
      .setColor(0xFF0000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_Ranked').setLabel('Ranked').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('start_Normal').setLabel('Normal').setEmoji('🤙').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('start_Battlecup').setLabel('Battlecup').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('start_Inhouse').setLabel('Inhouse').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Panel wysłany!', flags: [MessageFlags.Ephemeral] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
    return;
  }

  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_');

    if (action === 'start') {
      const hasActive = Array.from(parties.values()).some(p => p.leaderId === userId);
      if (hasActive) {
        await interaction.reply({ content: '❌ Masz już aktywne ogłoszenie!', flags: [MessageFlags.Ephemeral] });
        return setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
      }
      creationCache.set(userId, { count: '1', ranks: [], vc: null });
      return await interaction.reply({ ...createSetupPanel(interaction, id), flags: [MessageFlags.Ephemeral] });
    }

    if (action === 'publish') {
      const data = creationCache.get(userId);
      if (!data) return;

      const partyId = randomBytes(4).toString('hex'); 
      const emoji = modeEmojis[id] || '📢';
      const countDisplay = data.count === 'Obojętnie' ? 'Obojętnie' : `+${data.count}`;
      const finalRanks = data.ranks.length > 0 ? data.ranks : ['Dowolna'];
      const formattedRanks = finalRanks.map(r => rankDisplay[r] || r).join(' ');

      const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${id}`)
        .setColor(modeColors[id] || 0x2b2d31)
        .setDescription(
            `👤 **Lider:** <@${userId}>\n` +
            `➡️ **Potrzeba:** ${countDisplay}\n` +
            `🔰 **Rangi:** ${formattedRanks}\n` +
            `⏰ **Start:** <t:${Math.floor(Date.now() / 1000)}:R>\n` +
            (data.vc ? `🔊 **Kanał:** <#${data.vc}>` : '')
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('Dołącz').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`stop_${partyId}`).setLabel('Zakończ').setEmoji('🛑').setStyle(ButtonStyle.Danger)
      );

      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
      const thread = await msg.startThread({ name: `${id} - ${interaction.user.username}`, autoArchiveDuration: 1440 });
      
      parties.set(partyId, { 
        id: partyId, leaderId: userId, members: [userId], start: Date.now(), 
        message: msg, threadId: thread.id, channelId: interaction.channelId, 
        warned: false, warnMessageId: null 
      });

      creationCache.delete(userId);
      await interaction.update({ content: '✅ Opublikowano!', components: [] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
    }

    if (action === 'join') {
        const p = parties.get(id);
        if (!p) {
            await interaction.reply({ content: 'To ogłoszenie już wygasło.', flags: [MessageFlags.Ephemeral] });
            return setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
        }
        if (p.leaderId === userId) {
            await interaction.reply({ content: '❌ To Twoje ogłoszenie!', flags: [MessageFlags.Ephemeral] });
            return setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
        }
        if (p.members.includes(userId)) {
            await interaction.reply({ content: 'ℹ️ Już dołączyłeś.', flags: [MessageFlags.Ephemeral] });
            return setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
        }

        try {
            const thread = await client.channels.fetch(p.threadId);
            if (thread) {
                await thread.members.add(userId);
                await thread.send(`👋 <@${userId}> dołączył!`);
                p.members.push(userId);
            }
        } catch (e) {
            await interaction.reply({ content: 'Błąd wątku.', flags: [MessageFlags.Ephemeral] });
            return setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
        }
        await interaction.reply({ content: '✅ Dołączono!', flags: [MessageFlags.Ephemeral] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
    }

    if (action === 'extend') {
        const p = parties.get(id);
        if (!p || p.leaderId !== userId) return;
        p.start = Date.now();
        p.warned = false;
        if (p.warnMessageId) {
            try {
                const thread = await client.channels.fetch(p.threadId).catch(() => null);
                if (thread) {
                    const wm = await thread.messages.fetch(p.warnMessageId).catch(() => null);
                    if (wm) await wm.delete().catch(() => {});
                }
            } catch (e) {}
            p.warnMessageId = null;
        }
        await interaction.reply({ content: '✅ Przedłużono ogłoszenie!', flags: [MessageFlags.Ephemeral] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
    }
    
    if (action === 'stop') {
        const p = parties.get(id);
        if (p && p.leaderId === userId) {
            await clearThread(p.threadId);

            if (THREAD_EXPIRY_DAYS === 0) {
                const thread = await client.channels.fetch(p.threadId).catch(() => null);
                if (thread) await thread.delete().catch(() => {});
            } else {
                threadsToDelete.set(p.threadId, { deleteAt: Date.now() + (THREAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000), channelId: p.channelId });
            }
            await p.message.delete().catch(() => {});
            
            parties.delete(id);
            await interaction.reply({ content: '🛑 Ogłoszenie zamknięte i wątek wyczyszczony.', flags: [MessageFlags.Ephemeral] });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 1000);
        }
    }
  }

  if (interaction.isStringSelectMenu()) {
    const [action, mode] = interaction.customId.split('_');
    const data = creationCache.get(userId);
    if (!data) return;
    if (action === 'setcount') data.count = interaction.values[0];
    if (action === 'setranks') data.ranks = interaction.values;
    if (action === 'setvc') data.vc = interaction.values[0];
    return await interaction.update(createSetupPanel(interaction, mode));
  }
});

// PĘTLA SPRZĄTAJĄCA
setInterval(async () => {
  const now = Date.now();
  for (const [id, party] of parties.entries()) {
    const diff = (now - party.start) / 60000;

    if (diff >= WARN_MINUTES && !party.warned) { 
      party.warned = true;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`extend_${party.id}`).setLabel('Nadal szukam').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`stop_${party.id}`).setLabel('Zakończ').setStyle(ButtonStyle.Danger)
      );
      const thread = await client.channels.fetch(party.threadId).catch(() => null);
      if (thread) {
        const wm = await thread.send({ content: `⚠️ <@${party.leaderId}> czy nadal szukasz graczy?`, components: [row] }); 
        party.warnMessageId = wm.id;
      }
    }

    if (diff >= EXPIRE_MINUTES) { 
      await clearThread(party.threadId);
      threadsToDelete.set(party.threadId, { deleteAt: now + (THREAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000), channelId: party.channelId });
      await party.message.delete().catch(() => {});
      parties.delete(id);
    }
  }
}, 30000);

setInterval(async () => {
  const now = Date.now();
  for (const [threadId, data] of threadsToDelete.entries()) {
    if (now >= data.deleteAt) {
      const channel = await client.channels.fetch(data.channelId).catch(() => null);
      if (channel) {
        const thread = await channel.threads.fetch(threadId).catch(() => null);
        if (thread) await thread.delete().catch(() => {});
      }
      threadsToDelete.delete(threadId);
    }
  }
}, 600000);

client.login(TOKEN);