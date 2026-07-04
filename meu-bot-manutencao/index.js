// ============================================================
//  BOT DE MANUTENÇÃO — WhatsApp + IA (Claude)
//  Edite apenas as partes marcadas com: ✏️ EDITE AQUI
// ============================================================

if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config();
}
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Histórico de conversa por cliente (armazenado em memória)
const historicos = {};

// ✏️ EDITE AQUI — Informações da sua empresa
const INFO_EMPRESA = `
Você é o assistente virtual da empresa "TechFrio Assistência Técnica", especializada em manutenção e reparo de eletrodomésticos.

Serviços que atendemos:
- Refrigeração: geladeira, freezer, frigobar
- Ar-condicionado: split, janela, portátil
- Lavanderia: máquina de lavar, secadora, lava e seca
- Cozinha: fogão, microondas, lava-louças

Localização: Salvador, Bahia
Horário de atendimento: Segunda a Sábado, 8h às 18h
Telefone para emergências: (71) 9 9999-9999

Orçamentos estimados (valores aproximados, sujeitos a vistoria):
- Troca de compressor de geladeira: R$ 350 a R$ 600
- Limpeza de ar-condicionado: R$ 120 a R$ 200
- Reparo de máquina de lavar (rolamento): R$ 250 a R$ 450
- Conserto de fogão (válvula/queimador): R$ 80 a R$ 180
- Revisão de microondas: R$ 100 a R$ 200
- Conserto de lava-louças: R$ 150 a R$ 300

Regras importantes:
1. Seja sempre simpático, objetivo e profissional.
2. Quando o cliente quiser AGENDAR uma visita técnica, colete: nome completo, endereço completo e data/horário preferido. Confirme tudo ao final.
3. Quando o cliente quiser falar com um ATENDENTE HUMANO, diga que vai transferir e use exatamente a frase: [TRANSFERIR_ATENDENTE]
4. Nunca invente preços ou prazos que não estão acima.
5. Se não souber responder algo, ofereça falar com um atendente humano.
6. Responda sempre em português do Brasil, de forma curta e direta (máximo 3 parágrafos).
`;

// ============================================================
//  VERIFICAÇÃO DO WEBHOOK (obrigatório pelo Meta)
// ============================================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================================
//  RECEBE MENSAGENS DO WHATSAPP
// ============================================================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    const msg = messages[0];
    const telefoneCliente = msg.from;
    const textoRecebido = msg.text?.body;

    if (!textoRecebido) return res.sendStatus(200);

    console.log(`📩 Mensagem de ${telefoneCliente}: ${textoRecebido}`);

    // Inicializa histórico se for o primeiro contato
    if (!historicos[telefoneCliente]) {
      historicos[telefoneCliente] = [];
    }

    // Adiciona mensagem do cliente ao histórico
    historicos[telefoneCliente].push({
      role: "user",
      content: textoRecebido,
    });

    // Gera resposta com IA
    const respostaIA = await gerarRespostaIA(
      historicos[telefoneCliente],
      telefoneCliente
    );

    // Verifica se precisa transferir para atendente
    if (respostaIA.includes("[TRANSFERIR_ATENDENTE]")) {
      const textoLimpo = respostaIA.replace("[TRANSFERIR_ATENDENTE]", "").trim();
      await enviarMensagem(telefoneCliente, textoLimpo || "Aguarde, vou te transferir para um de nossos atendentes! 😊");
      await notificarAtendente(telefoneCliente, textoRecebido);
    } else {
      await enviarMensagem(telefoneCliente, respostaIA);
    }

    // Salva resposta da IA no histórico
    historicos[telefoneCliente].push({
      role: "assistant",
      content: respostaIA,
    });

    // Limpa histórico se ficar muito longo (mantém últimas 20 mensagens)
    if (historicos[telefoneCliente].length > 20) {
      historicos[telefoneCliente] = historicos[telefoneCliente].slice(-20);
    }

  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error.message);
  }

  res.sendStatus(200);
});

// ============================================================
//  FUNÇÃO: Chamar a IA (Claude da Anthropic)
// ============================================================
async function gerarRespostaIA(historico, telefone) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: INFO_EMPRESA,
        messages: historico,
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    return response.data.content[0].text;
  } catch (error) {
    console.error("❌ Erro na IA:", error.response?.data || error.message);
    return "Desculpe, tive um problema técnico. Por favor, tente novamente em instantes! 😊";
  }
}

// ============================================================
//  FUNÇÃO: Enviar mensagem pelo WhatsApp
// ============================================================
async function enviarMensagem(telefone, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefone,
        type: "text",
        text: { body: texto },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Mensagem enviada para ${telefone}`);
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.response?.data || error.message);
  }
}

// ============================================================
//  FUNÇÃO: Notificar atendente humano
// ============================================================
async function notificarAtendente(telefoneCliente, ultimaMensagem) {
  const numeroAtendente = process.env.ATENDENTE_NUMERO;
  if (!numeroAtendente) return;

  const aviso = `🔔 *NOVO ATENDIMENTO*\n\nCliente: ${telefoneCliente}\nÚltima mensagem: "${ultimaMensagem}"\n\nO cliente solicitou atendimento humano. Por favor, entre em contato!`;

  await enviarMensagem(numeroAtendente, aviso);
}

// ============================================================
//  INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot rodando na porta ${PORT}`);
  console.log(`🌐 Webhook URL: http://localhost:${PORT}/webhook`);
});