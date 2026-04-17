const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ==============================
// CONFIGURATION - REMPLACE ICI
// ==============================
const TELEGRAM_TOKEN = '8709105623:AAGvuHsf7ef3msG7r-9IDZA2gdyuaouLarQ';
const PORT = process.env.PORT || 3000;

// ==============================
// ADMIN - TON TELEGRAM ID
// ==============================
const ADMIN_ID = 6439479365;

// ==============================
// INITIALISATION
// ==============================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const app = express();
app.use(express.json());

// ==============================
// BASE DE DONNÉES EN MÉMOIRE
// ==============================

// Agents autorisés { telegramId: { nom, numero, statut, chat_id } }
let agentsAutorises = {};
agentsAutorises[ADMIN_ID] = { nom: "Admin", numero: null, statut: "off", chat_id: ADMIN_ID };

// File d'attente FIFO des agents ON
let fileAttente = [];

// Système ON ou OFF (contrôlé par admin)
let systemeActif = true;

// ==============================
// FONCTIONS UTILITAIRES
// ==============================

function estAdmin(chatId) {
  return chatId === ADMIN_ID;
}

function estAgentAutorise(chatId) {
  return estAdmin(chatId) || agentsAutorises.hasOwnProperty(chatId);
}

function validerNumero(numero) {
  const clean = numero.replace(/\s/g, '');
  return /^(\+?\d{10,15})$/.test(clean);
}

function normaliserNumero(numero) {
  const clean = numero.replace(/\s/g, '');
  if (clean.startsWith('0')) return '+33' + clean.slice(1);
  if (!clean.startsWith('+')) return '+' + clean;
  return clean;
}

function mettreAgentOff(chatId) {
  if (agentsAutorises[chatId]) {
    agentsAutorises[chatId].statut = 'off';
  }
  fileAttente = fileAttente.filter(id => id !== chatId);
}

function tousAgentsOff() {
  Object.keys(agentsAutorises).forEach(id => {
    agentsAutorises[id].statut = 'off';
  });
  fileAttente = [];
}

// ==============================
// MIDDLEWARE SÉCURITÉ
// ==============================

function verifierAcces(msg, requireAdmin = false) {
  const chatId = msg.chat.id;

  if (requireAdmin && !estAdmin(chatId)) {
    bot.sendMessage(chatId, '⛔ *Accès refusé.* Commande réservée à l\'administrateur.', { parse_mode: 'Markdown' });
    return false;
  }

  if (!requireAdmin && !estAgentAutorise(chatId)) {
    bot.sendMessage(chatId,
      '⛔ *Accès non autorisé.*\n\nTu n\'es pas encore enregistré dans le système.\nContacte l\'administrateur pour obtenir l\'accès.',
      { parse_mode: 'Markdown' }
    );
    return false;
  }

  return true;
}

// ==============================
// COMMANDES TELEGRAM - GÉNÉRAL
// ==============================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (estAdmin(chatId)) {
    bot.sendMessage(chatId,
      `👑 *Bienvenue Admin sur Cally365Bot*\n\n` +
      `*Commandes Admin :*\n` +
      `➕ */ajouter [ID]* — Ajouter un agent\n` +
      `➖ */retirer [ID]* — Retirer un agent\n` +
      `⏸ */pause* — Mettre le système OFF\n` +
      `▶️ */reprendre* — Mettre le système ON\n` +
      `👥 */agents* — Voir tous les agents\n` +
      `📊 */status* — Voir la file d'attente\n\n` +
      `*Statut système :* ${systemeActif ? '🟢 EN LIGNE' : '🔴 EN PAUSE'}`,
      { parse_mode: 'Markdown' }
    );
  } else if (estAgentAutorise(chatId)) {
    bot.sendMessage(chatId,
      `👋 *Bienvenue sur Cally365Bot*\n\n` +
      `*Tes commandes :*\n` +
      `▶️ */on +32612345678* — Te mettre disponible\n` +
      `⏹ */off* — Te mettre indisponible\n` +
      `📊 */status* — Voir qui est disponible\n\n` +
      `*Statut système :* ${systemeActif ? '🟢 EN LIGNE' : '🔴 EN PAUSE'}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(chatId,
      `⛔ *Accès non autorisé.*\n\nContacte l\'administrateur pour obtenir l\'accès.\n\n` +
      `🪪 Ton Telegram ID : \`${chatId}\``,
      { parse_mode: 'Markdown' }
    );
  }
});

// ==============================
// COMMANDES ADMIN
// ==============================

// /ajouter [telegramId] - Ajouter un agent autorisé
bot.onText(/\/ajouter (.+)/, (msg, match) => {
  if (!verifierAcces(msg, true)) return;

  const chatId = msg.chat.id;
  const agentId = parseInt(match[1].trim());

  if (isNaN(agentId)) {
    bot.sendMessage(chatId, '❌ ID invalide. Exemple : */ajouter 123456789*', { parse_mode: 'Markdown' });
    return;
  }

  if (agentsAutorises[agentId]) {
    bot.sendMessage(chatId, `⚠️ Cet agent est déjà autorisé.`);
    return;
  }

  const numeroAgent = Object.keys(agentsAutorises).length + 1;
  agentsAutorises[agentId] = {
    nom: `Agent ${numeroAgent}`,
    numero: null,
    statut: 'off',
    chat_id: agentId
  };

  bot.sendMessage(chatId,
    `✅ *Agent ajouté avec succès*\n\n` +
    `🪪 ID : \`${agentId}\`\n` +
    `👤 Nom : Agent ${numeroAgent}\n\n` +
    `_L'agent peut maintenant utiliser le bot._`,
    { parse_mode: 'Markdown' }
  );

  // Notifier l'agent
  bot.sendMessage(agentId,
    `✅ *Tu as été ajouté au système Cally365*\n\n` +
    `Tu peux maintenant recevoir des appels.\n\n` +
    `Envoie */on +32XXXXXXXXX* pour te mettre disponible.`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// /retirer [telegramId] - Retirer un agent
bot.onText(/\/retirer (.+)/, (msg, match) => {
  if (!verifierAcces(msg, true)) return;

  const chatId = msg.chat.id;
  const agentId = parseInt(match[1].trim());

  if (!agentsAutorises[agentId]) {
    bot.sendMessage(chatId, '❌ Cet agent n\'est pas dans la liste.');
    return;
  }

  const nomAgent = agentsAutorises[agentId].nom;
  mettreAgentOff(agentId);
  delete agentsAutorises[agentId];

  bot.sendMessage(chatId,
    `✅ *${nomAgent}* a été retiré du système.`,
    { parse_mode: 'Markdown' }
  );

  bot.sendMessage(agentId,
    `⛔ Tu as été retiré du système Cally365.\nContacte l\'administrateur pour plus d\'informations.`
  ).catch(() => {});
});

// /pause - Mettre le système OFF
bot.onText(/\/pause/, (msg) => {
  if (!verifierAcces(msg, true)) return;

  systemeActif = false;
  tousAgentsOff();

  bot.sendMessage(msg.chat.id,
    `⏸ *Système mis en PAUSE*\n\n` +
    `✅ Tous les agents passés OFF\n` +
    `✅ Vapi recevra "disponible: false"\n\n` +
    `_N'oublie pas de stopper Vapi depuis son dashboard._`,
    { parse_mode: 'Markdown' }
  );

  // Notifier tous les agents
  Object.keys(agentsAutorises).forEach(agentId => {
    bot.sendMessage(parseInt(agentId),
      `⏸ *Le système est en pause.*\n\nTu ne recevras plus d\'appels jusqu\'à la reprise.`
    ).catch(() => {});
  });
});

// /reprendre - Remettre le système ON
bot.onText(/\/reprendre/, (msg) => {
  if (!verifierAcces(msg, true)) return;

  systemeActif = true;

  bot.sendMessage(msg.chat.id,
    `▶️ *Système remis en ligne !*\n\n` +
    `Les agents peuvent maintenant envoyer /on pour recevoir des appels.`,
    { parse_mode: 'Markdown' }
  );

  // Notifier tous les agents
  Object.keys(agentsAutorises).forEach(agentId => {
    bot.sendMessage(parseInt(agentId),
      `▶️ *Le système est de nouveau actif !*\n\nEnvoie */on +32XXXXXXXXX* pour recevoir des appels.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });
});

// /agents - Voir tous les agents autorisés
bot.onText(/\/agents/, (msg) => {
  if (!verifierAcces(msg, true)) return;

  const liste = Object.entries(agentsAutorises);

  if (liste.length === 0) {
    bot.sendMessage(msg.chat.id, '👥 Aucun agent autorisé pour le moment.\n\nUtilise */ajouter [ID]* pour en ajouter.', { parse_mode: 'Markdown' });
    return;
  }

  let message = `👥 *Agents autorisés (${liste.length})*\n\n`;
  liste.forEach(([id, agent]) => {
    const emoji = agent.statut === 'on' ? '🟢' : '🔴';
    message += `${emoji} *${agent.nom}*\n`;
    message += `   🪪 ID: \`${id}\`\n`;
    message += `   📞 ${agent.numero || 'numéro non défini'}\n\n`;
  });

  message += `\n*Statut système :* ${systemeActif ? '🟢 EN LIGNE' : '🔴 EN PAUSE'}`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ==============================
// COMMANDES AGENTS
// ==============================

// /on +32612345678
bot.onText(/\/on (.+)/, (msg, match) => {
  if (!verifierAcces(msg)) return;

  const chatId = msg.chat.id;

  if (!systemeActif) {
    bot.sendMessage(chatId, '⏸ *Le système est en pause.*\nAttends que l\'administrateur relance le système.', { parse_mode: 'Markdown' });
    return;
  }

  const numeroBrut = match[1].trim();

  if (!validerNumero(numeroBrut)) {
    bot.sendMessage(chatId,
      `❌ Numéro invalide : *${numeroBrut}*\n\nFormat accepté : */on +32612345678*`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const numero = normaliserNumero(numeroBrut);

  if (agentsAutorises[chatId]) {
    agentsAutorises[chatId].numero = numero;
    agentsAutorises[chatId].statut = 'on';
  }

  if (!fileAttente.includes(chatId)) {
    fileAttente.push(chatId);
  }

  const position = fileAttente.indexOf(chatId) + 1;
  const nom = agentsAutorises[chatId]?.nom || 'Agent';

  bot.sendMessage(chatId,
    `✅ *${nom}* est maintenant *EN LIGNE*\n\n` +
    `📞 Numéro : ${numero}\n` +
    `📋 Position dans la file : ${position}/${fileAttente.length}\n\n` +
    `_Tu recevras le prochain appel disponible._`,
    { parse_mode: 'Markdown' }
  );
});

// /off
bot.onText(/\/off/, (msg) => {
  if (!verifierAcces(msg)) return;

  const chatId = msg.chat.id;
  mettreAgentOff(chatId);
  const nom = agentsAutorises[chatId]?.nom || 'Agent';

  bot.sendMessage(chatId,
    `⏹ *${nom}* est maintenant *HORS LIGNE*\n\n_Envoie /on pour recevoir des appels._`,
    { parse_mode: 'Markdown' }
  );
});

// /status
bot.onText(/\/status/, (msg) => {
  if (!verifierAcces(msg)) return;

  let message = `📊 *Statut du système*\n`;
  message += `${systemeActif ? '🟢 EN LIGNE' : '🔴 EN PAUSE'}\n\n`;
  message += `*File d'attente (${fileAttente.length} agent(s)) :*\n\n`;

  if (fileAttente.length === 0) {
    message += `_Aucun agent disponible_\n`;
  } else {
    fileAttente.forEach((id, index) => {
      const agent = agentsAutorises[id];
      message += `${index + 1}. *${agent?.nom}* — ${agent?.numero}\n`;
    });
  }

  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ==============================
// API POUR VAPI
// ==============================

// Vapi appelle cet endpoint en POST avec { message: { toolCallList: [{ id, name }] } }
app.post('/prochain-agent', (req, res) => {
  // Récupérer le toolCallId envoyé par Vapi
  const toolCallList = req.body?.message?.toolCallList || [];
  const toolCallId = toolCallList[0]?.id || 'unknown';

  if (!systemeActif) {
    return res.json({
      results: [{
        toolCallId: toolCallId,
        result: 'Aucun agent disponible. Le système est en pause. Informe le prospect qu\'un conseiller le rappellera dès que possible.'
      }]
    });
  }

  if (fileAttente.length === 0) {
    return res.json({
      results: [{
        toolCallId: toolCallId,
        result: 'Aucun agent disponible pour le moment. Informe le prospect qu\'un conseiller le rappellera dès que possible.'
      }]
    });
  }

  const agentId = fileAttente[0];
  const agent = agentsAutorises[agentId];
  const numero = agent.numero;

  mettreAgentOff(agentId);

  // Notifier l'agent sur Telegram
  bot.sendMessage(agentId,
    `📲 *Appel entrant !*\n\n` +
    `Un prospect intéressé va t'appeler maintenant.\n\n` +
    `_Tu es passé HORS LIGNE automatiquement._\n` +
    `_Renvoie /on quand tu es prêt pour le prochain._`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  // Retourner le numéro au format Vapi
  return res.json({
    results: [{
      toolCallId: toolCallId,
      result: numero
    }]
  });
});

app.get('/statut', (req, res) => {
  res.json({
    systeme: systemeActif ? 'actif' : 'pause',
    agents_disponibles: fileAttente.length,
    file: fileAttente.map(id => ({
      nom: agentsAutorises[id]?.nom,
      numero: agentsAutorises[id]?.numero
    }))
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'Cally365Bot en ligne ✅' });
});

// ==============================
// DÉMARRAGE
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Serveur API démarré sur le port ${PORT}`);
});

console.log('🤖 Cally365Bot démarré...');
