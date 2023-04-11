import dotenv from 'dotenv'
dotenv.config()
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters'
import { InworldClient, InworldConnectionService, InworldPacket, SessionToken } from '@inworld/nodejs-sdk';
import { detectLocale, translate, initTranslate } from './translate';

if (!process.env.TG_BOT_TOKEN) {
  throw new Error("TG_BOT_TOKEN is not defined")
}

const bot = new Telegraf(process.env.TG_BOT_TOKEN);

const conversations = new Map<number, InworldConnectionService>()
const sessionIds = new Map<number, string>()
const locales = new Map<number, string>()

const generateSessionToken = (chatId: number) => {
  return async () => {

    const client = new InworldClient().setApiKey({
      key: process.env.INWORLD_KEY!,
      secret: process.env.INWORLD_SECRET!,
    });

    const token = await client.generateSessionToken()

    let sessionId = sessionIds.get(chatId)
    if (!sessionId) {
      sessionId = token.getSessionId()
      sessionIds.set(chatId, sessionId)
    } 
    const actualToken = new SessionToken({
      expirationTime: token.getExpirationTime(),
      token: token.getToken(),
      type: token.getType(),
      sessionId
    })

    return actualToken
  };
};

const createConversation = (ctx: Context) => {
  const client = new InworldClient()
  client.setApiKey({
    key: process.env.INWORLD_KEY!,
    secret: process.env.INWORLD_SECRET!
  })
  client.setConfiguration({
    capabilities: { audio: false, emotions: false }
  })
  const name = ctx.from?.first_name || ctx.from?.last_name || ctx.from?.username
  if (name) {
    client.setUser({ fullName: name })
  }
  client.setScene(process.env.INWORLD_SCENE!)

  const chatId = ctx.chat!.id
  client.setOnError((err: Error) => {
    console.log(`Close conversation with chatId ${ chatId }. Reason: ${ err.message }`)
    conversations.delete(chatId)
  })

  client.setGenerateSessionToken(generateSessionToken(chatId))

  let lastTimeAction = 0
  let message = ""

  const sendMessage = async () => {
    let text = message.trim()
    message = ""

    const lang = locales.get(chatId) || "ru"
    if (lang !== "en") {
      text = await translate(text, "en", lang)
    }

    console.log(`Sended reply to chatId ${ chatId }. Lang is ${lang}`)
    bot.telegram.sendMessage(chatId, text)
  }

  client.setOnMessage((packet: InworldPacket) => {
    if (packet.control?.type === "INTERACTION_END") {
      sendMessage()
      return
    }
    message += packet.text.text
    if (Date.now() > lastTimeAction + 1000) {
      bot.telegram.sendChatAction( chatId, "typing")
      lastTimeAction = Date.now()
    }
  })
  const connection = client.build()
  conversations.set(chatId, connection)
  console.log(`Create conversation with chatId ${ chatId }`)

  return connection
}

const stop = () => {
  bot.stop('SIGTERM')
  for (let connection of conversations.values()) {
    if (connection.isActive()) {
      connection.close()
    }
  }
}

const init = async () => {

  await initTranslate()

  bot.start(async (ctx) => {
    let conversation = conversations.get(ctx.chat.id)
    if (!conversation) {
      conversation = createConversation(ctx)
    }
    conversation.sendText("Hello! Please introduce yourself")
    ctx.sendChatAction("typing")
  });

  bot.on(message("text"), async (ctx) => {
    if (ctx.message.chat.type !== "private") return
    let conversation = conversations.get(ctx.chat.id)
    if (!conversation) {
      conversation = createConversation(ctx)
    }
    const lang = detectLocale(ctx.message.text)
    if (lang !== null) {
      locales.set(ctx.chat.id, lang)
    }

    console.log(`Receive message from chatId ${ ctx.chat.id }. Lang is ${lang}`)

    let text = ctx.message.text
    if (lang !== "en") {
      text = await translate(ctx.message.text, lang || "ru", "en")
    }
    conversation.sendText(text)
  })

  bot.launch();

  console.log("Bot launched!")

  // Enable graceful stop
  process.once('SIGINT', () => {
    stop()
  });
  process.once('SIGTERM', () => {
    stop()
  });
}

init()