require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  Events,
  MessageFlags,
  REST,
  Routes
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const parties = new Map();
const creationCache = new Map();
const threadsToDelete = new Map();

// --- KONFIGURACJA WYGLĄDU ---
const modeColors = {
  'Ranked': 0x00FF00,    // Zielony
  'Normal': 0x00FFFF,    // Jasny niebieski
  'Battlecup': 0x808080, // Szary
  'Inhouse': 0x808080    // Szary
};

const modeEmojis = {
  'Ranked': '⚔️',
  'Normal': '🤙',
  'Battlecup': '🏆',
  'Inhouse': '🏠'
};

const commands = [{ name: 'party', description: 'Wysyła panel party maker' }];
const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- PANEL KONFIGURACJI ---
function createSetupPanel(userId, mode) {
  const data = creationCache.get(userId) || { count: '1', ranks: ['Dowolna'], vc: null };
  
  const countMenu = new StringSelectMenuBuilder()
    .setCustomId(`setcount_${mode}`)
    .setPlaceholder(`Ilość graczy: ${data.count}`)
    .addOptions(Array.from({ length: 9 }, (_, i) => ({
      label: `Szukam +${i + 1}`,
      value: `${i + 1}`,
      default: data.count === `${i + 1}`
    })));

  const rankMenu = new StringSelectMenuBuilder()
    .setCustomId(`setranks_${mode}`)
    .setPlaceholder('Wybierz rangi')
    .setMinValues(1).setMaxValues(5)
    .addOptions(['Dowolna', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'].map(r => ({ label: r, value: r })));

  const vcMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`setvc_${mode}`)
    .setPlaceholder('Wybierz kanał głosowy')
    .setChannelTypes(ChannelType.GuildVoice);

  const publishBtn = new ButtonBuilder()
    .setCustomId(`publish_${mode}`)
    .setLabel('Opublikuj Ogłoszenie')
    .setStyle(ButtonStyle.Success);

  return {
    content: `### 🛠️ Konfiguracja: **${mode}**\n➡️ Graczy: **+${data.count}**\n🔰 Rangi: **${data.ranks.join(', ')}**\n🔊 Kanał: ${data.vc ? `<#${data.vc}>` : '*Nie wybrano*'}`,
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
    console.log('✅ Komenda /party zarejestrowana!');
  } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const userId = interaction.user.id;

  // 1. KOMENDA /PARTY
  if (interaction.isChatInputCommand() && interaction.commandName === 'party') {
    const embed = new EmbedBuilder()
      .setTitle('Jak to działa?')
      .setDescription(
        '1️⃣ Wybierz tryb gry poniżej.\n' +
        '2️⃣ Podaj liczbę graczy, rangi oraz kanał głosowy.\n' +
        '3️⃣ Gotowe! Twoje ogłoszenie będzie widoczne.\n\n' +
        'Po **15 min** dostaniesz zapytanie o aktualność, po **20 min** ogłoszenie wygaśnie.'
      )
      .setColor(0xFF0000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_Ranked').setLabel('Ranked').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('start_Normal').setLabel('Normal').setEmoji('🤙').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('start_Battlecup').setLabel('Battlecup').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('start_Inhouse').setLabel('Inhouse').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: 'Panel wysłany!', flags: [MessageFlags.Ephemeral] });
  }

  // 2. PRZYCISKI
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_');

    if (action === 'start') {
      creationCache.set(userId, { count: '1', ranks: ['Dowolna'], vc: null });
      return await interaction.reply({ ...createSetupPanel(userId, id), flags: [MessageFlags.Ephemeral] });
    }

    if (action === 'publish') {
      const data = creationCache.get(userId);
      if (!data) return;

      const partyId = Date.now().toString();
      const emoji = modeEmojis[id] || '📢';

      const embed = new EmbedBuilder()
        .setTitle(`${emoji} Szukamy do gry: ${id}`)
        .setColor(modeColors[id] || 0x2b2d31)
        .setDescription(
            `👤 **Lider:** <@${userId}>\n` +
            `➡️ **Potrzeba:** ${data.count}\n` +
            `🔰 **Rangi:** ${data.ranks.join(', ')}\n` +
            `⏰ **Start:** <t:${Math.floor(Date.now() / 1000)}:R>\n` +
            (data.vc ? `🔊 **Kanał:** <#${data.vc}>` : '')
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('Dołącz').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`stop_${partyId}`).setLabel('Zakończ').setEmoji('🛑').setStyle(ButtonStyle.Danger)
      );

      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
      const thread = await msg.startThread({ name: `${id} - ${interaction.user.username}`, autoArchiveDuration: 60 });
      
      parties.set(partyId, { id: partyId, leaderId: userId, start: Date.now(), message: msg, threadId: thread.id, channelId: interaction.channelId, warned: false, warnMessageId: null });
      
      await interaction.update({ content: '✅ Opublikowano! To okno zniknie za 10s.', components: [] });
      setTimeout(() => { interaction.deleteReply().catch(() => {}); }, 10000);
    }

    if (action === 'join') {
        const p = parties.get(id);
        if (!p) return interaction.reply({ content: 'Ogłoszenie wygasło.', flags: [MessageFlags.Ephemeral] });
        try {
            const thread = await interaction.channel.threads.fetch(p.threadId);
            if (thread) {
                await thread.members.add(userId);
                await thread.send(`👋 <@${userId}> dołączył do zainteresowanych!`);
            }
        } catch (e) {}
        const reply = await interaction.reply({ content: 'Dodano do wątku!', flags: [MessageFlags.Ephemeral] });
        setTimeout(() => { interaction.deleteReply().catch(() => {}); }, 10000);
    }

    if (action === 'extend') {
        const p = parties.get(id);
        if (!p || p.leaderId !== userId) return;
        
        p.start = Date.now();
        p.warned = false;
        
        if (p.warnMessageId) {
            try {
                const wm = await interaction.channel.messages.fetch(p.warnMessageId);
                await wm.delete();
            } catch (e) {}
            p.warnMessageId = null;
        }
        
        await interaction.reply({ content: '✅ Przedłużono ogłoszenie! To okno zniknie za 10s.', flags: [MessageFlags.Ephemeral] });
        setTimeout(() => { interaction.deleteReply().catch(() => {}); }, 10000);
    }
    
    if (action === 'stop') {
        const p = parties.get(id);
        if (p && p.leaderId === userId) {
            // Dodaj wątek do kolejki usuwania za 5 dni
            threadsToDelete.set(p.threadId, { deleteAt: Date.now() + (5 * 24 * 60 * 60 * 1000), channelId: p.channelId });

            await p.message.delete().catch(() => {});
            if (p.warnMessageId) {
                try {
                    const wm = await interaction.channel.messages.fetch(p.warnMessageId);
                    await wm.delete();
                } catch (e) {}
            }
            parties.delete(id);

            await interaction.reply({ content: '🛑 Ogłoszenie usunięte. Wątek ogłoszenia zniknie za 5 dni, a ta wiadomość zniknie za chwilę...', flags: [MessageFlags.Ephemeral] });
            setTimeout(() => { interaction.deleteReply().catch(() => {}); }, 10000);
        }
    }
  }

  // Obsługa menu wyboru
  if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
    const [action, mode] = interaction.customId.split('_');
    const data = creationCache.get(userId);
    if (!data) return;
    if (action === 'setcount') data.count = interaction.values[0];
    if (action === 'setranks') data.ranks = interaction.values;
    if (action === 'setvc') data.vc = interaction.values[0];
    return await interaction.update(createSetupPanel(userId, mode));
  }
});

// --- PĘTLA OGŁOSZEŃ (co 30 sekund) ---
setInterval(async () => {
  const now = Date.now();
  for (const [id, party] of parties.entries()) {
    const diff = (now - party.start) / 60000;

    // --- TESTOWE CZASY (1 i 2 min) - Zmień na 15 i 20 przed publikacją! ---
    if (diff >= 1 && !party.warned) { 
      party.warned = true;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`extend_${party.id}`).setLabel('Nadal szukam').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`stop_${party.id}`).setLabel('Zakończ').setStyle(ButtonStyle.Danger)
      );
      try { 
        const wm = await party.message.channel.send({ 
          content: `⚠️ <@${party.leaderId}>, Twoje ogłoszenie wygaśnie za 5 min!`, 
          components: [row] 
        }); 
        party.warnMessageId = wm.id;
      } catch (e) {}
    }

    if (diff >= 2) { 
      threadsToDelete.set(party.threadId, { deleteAt: now + (5 * 24 * 60 * 60 * 1000), channelId: party.channelId });
      await party.message.delete().catch(() => {});
      if (party.warnMessageId) {
        try {
            const wm = await party.message.channel.messages.fetch(party.warnMessageId);
            await wm.delete();
        } catch (e) {}
      }
      parties.delete(id);
    }
  }
}, 30000);

// --- PĘTLA WĄTKÓW (co 1 godzinę) ---
setInterval(async () => {
  const now = Date.now();
  if (threadsToDelete.size > 0) {
    for (const [threadId, data] of threadsToDelete.entries()) {
        if (now >= data.deleteAt) {
            try {
                const channel = await client.channels.fetch(data.channelId);
                const thread = await channel.threads.fetch(threadId);
                if (thread) await thread.delete();
            } catch (e) {}
            threadsToDelete.delete(threadId);
        }
    }
  }
}, 3600000);

client.login(TOKEN);