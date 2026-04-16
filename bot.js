const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ==============================
// CONFIGURATION - REMPLACE ICI
// ==============================
const TELEGRAM_TOKEN = '8709105623:AAGvuHsf7ef3msG7r-9IDZA2gdyuaouLarQ';
const PORT = process.env.PORT || 3000;

// ==============================
// INITIALISATION
// ==============================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const app = express();
app.use(express.json());

// ==============================
// BASE DE DONNÉES EN MÉMOIRE
// File d'attente des agents disponibles
// ==============================
const agents = {
  agent1: { nom: 'Agent 1', numero: null, statut: 'off', chat_id: null },
  agent2: { nom: 'Agent 2', numero: null, statut: 'off', chat_id: null },
  agent3: { nom: 'Agent 3', numero: null, statut: 'off', chat_id: null },
};

// File d'attente FIFO des agents ON
let fileAttente = [];

// ==============================
// FONCTIONS UTILITAIRES
// ==============================

function validerNumero(numero) {
  // Accepte formats: +33612345678, 0612345678, 33612345678
  const clean = numero.replace(/\s/g, '');
  return /^(\+?\d{10,15})$/.test(clean);
}

function normaliserNumero(numero) {
  const clean = numero.replace(/\s/g, '');
  if (clean.startsWith('0')) return '+32' + clean.slice(1);
  if (!clean.startsWith('+')) return '+' + clean;
  return clean;
}

function trouverAgentParChatId(chatId) {
  return Object.entries(agents).find(([, a]) => a.chat_id === chatId);
}

function mettreAgentOff(agentKey) {
  agents[agentKey].statut = 'off';
  fileAttente = fileAttente.filter(k => k !== agentKey);
}

// ==============================
// COMMANDES TELEGRAM
// ==============================

// /start - Message de bienvenue
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `👋 Bienvenue sur *Cally365Bot*\n\n` +
    `Commandes disponibles :\n\n` +
    `▶️ */on +33612345678* — Se mettre disponible avec ton numéro\n` +
    `⏹ */off* — Se mettre indisponible\n` +
    `📊 */status* — Voir qui est disponible\n` +
    `❓ */aide* — Afficher ce message`,
    { parse_mode: 'Markdown' }
  );
});

// /aide
bot.onText(/\/aide/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📖 *Guide Cally365Bot*\n\n` +
    `1️⃣ Pour recevoir des appels :\n` +
    `   → Envoie */on +32612345678*\n` +
    `   → Remplace par ton vrai numéro\n\n` +
    `2️⃣ Dès qu'un prospect est intéressé :\n` +
    `   → Tu reçois l'appel automatiquement\n` +
    `   → Tu passes en OFF automatiquement\n\n` +
    `3️⃣ Pour recevoir un autre appel :\n` +
    `   → Renvoie */on +32612345678*\n\n` +
    `⚠️ Tu peux changer de numéro à chaque /on`,
    { parse_mode: 'Markdown' }
  );
});

// /on +33612345678 - Agent se met disponible
bot.onText(/\/on (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const numeroBrut = match[1].trim();

  // Identifier l'agent
  let agentKey = null;
  let agentEntry = trouverAgentParChatId(chatId);

  if (agentEntry) {
    agentKey = agentEntry[0];
  } else {
    // Première fois : assigner un slot libre
    const slotLibre = Object.entries(agents).find(([, a]) => a.chat_id === null);
    if (!slotLibre) {
      bot.sendMessage(chatId, '❌ Tous les slots agents sont occupés. Contacte l\'administrateur.');
      return;
    }
    agentKey = slotLibre[0];
    agents[agentKey].chat_id = chatId;
  }

  // Valider le numéro
  if (!validerNumero(numeroBrut)) {
    bot.sendMessage(chatId,
      `❌ Numéro invalide : *${numeroBrut}*\n\n` +
      `Format accepté : */on +32612345678*`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const numero = normaliserNumero(numeroBrut);

  // Mettre à jour l'agent
  agents[agentKey].numero = numero;
  agents[agentKey].statut = 'on';
  agents[agentKey].chat_id = chatId;

  // Ajouter en file d'attente si pas déjà dedans
  if (!fileAttente.includes(agentKey)) {
    fileAttente.push(agentKey);
  }

  const position = fileAttente.indexOf(agentKey) + 1;

  bot.sendMessage(chatId,
    `✅ *${agents[agentKey].nom}* est maintenant *EN LIGNE*\n\n` +
    `📞 Numéro enregistré : ${numero}\n` +
    `📋 Position dans la file : ${position}/${fileAttente.length}\n\n` +
    `_Tu recevras le prochain appel disponible._`,
    { parse_mode: 'Markdown' }
  );
});

// /off - Agent se met indisponible
bot.onText(/\/off/, (msg) => {
  const chatId = msg.chat.id;
  const agentEntry = trouverAgentParChatId(chatId);

  if (!agentEntry) {
    bot.sendMessage(chatId, '❌ Tu n\'es pas encore enregistré. Utilise */on +33XXXXXXXXX* d\'abord.', { parse_mode: 'Markdown' });
    return;
  }

  const [agentKey] = agentEntry;
  mettreAgentOff(agentKey);

  bot.sendMessage(chatId,
    `⏹ *${agents[agentKey].nom}* est maintenant *HORS LIGNE*\n\n` +
    `_Envoie /on pour recevoir des appels._`,
    { parse_mode: 'Markdown' }
  );
});

// /status - Voir tous les agents (admin)
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;

  let message = `📊 *Statut des agents*\n\n`;

  Object.entries(agents).forEach(([key, agent]) => {
    const emoji = agent.statut === 'on' ? '🟢' : '🔴';
    const position = fileAttente.indexOf(key);
    const posText = position >= 0 ? ` (file: #${position + 1})` : '';
    const numero = agent.numero || 'non défini';
    message += `${emoji} *${agent.nom}*${posText}\n   📞 ${numero}\n\n`;
  });

  message += `\n📋 File d'attente : ${fileAttente.length} agent(s)`;

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ==============================
// API POUR VAPI
// ==============================

// GET /prochain-agent - Vapi appelle cet endpoint
// Retourne le premier agent disponible et le passe OFF
app.get('/prochain-agent', (req, res) => {
  if (fileAttente.length === 0) {
    return res.json({
      disponible: false,
      message: 'Aucun agent disponible',
      numero: null
    });
  }

  // Prendre le premier agent de la file
  const agentKey = fileAttente[0];
  const agent = agents[agentKey];
  const numero = agent.numero;

  // Passer l'agent OFF immédiatement
  mettreAgentOff(agentKey);

  // Notifier l'agent sur Telegram
  if (agent.chat_id) {
    bot.sendMessage(agent.chat_id,
      `📲 *Appel entrant !*\n\n` +
      `Un prospect intéressé va t'appeler maintenant.\n\n` +
      `_Tu es passé HORS LIGNE automatiquement._\n` +
      `_Renvoie /on quand tu es prêt pour le prochain._`,
      { parse_mode: 'Markdown' }
    );
  }

  return res.json({
    disponible: true,
    agent: agent.nom,
    numero: numero
  });
});

// GET /statut - Vérifier l'état général
app.get('/statut', (req, res) => {
  const agentsDisponibles = fileAttente.map(key => ({
    nom: agents[key].nom,
    numero: agents[key].numero
  }));

  res.json({
    agents_disponibles: agentsDisponibles.length,
    file: agentsDisponibles
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Cally365Bot en ligne ✅' });
});

// ==============================
// DÉMARRAGE
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Serveur API démarré sur le port ${PORT}`);
  console.log(`📡 Endpoint Vapi : GET /prochain-agent`);
});

console.log('🤖 Cally365Bot Telegram démarré...');
