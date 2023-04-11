import dotenv from 'dotenv'
dotenv.config()
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters'
import { InworldClient, InworldConnectionService, InworldPacket } from '@inworld/nodejs-sdk';

if (!process.env.TG_BOT_TOKEN) {
  throw new Error("TG_BOT_TOKEN is not defined")
}

const bot = new Telegraf(process.env.TG_BOT_TOKEN);

const conversations = new Map<number, InworldConnectionService>()
  

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
  client.setOnMessage((packet: InworldPacket) => {
    if (!packet.text) {
      return
    }
    console.log(`Sended reply to chatId ${ chatId }`)
    bot.telegram.sendMessage(chatId, packet.text.text.trim())
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
  bot.start((ctx) => {
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
    console.log(`Receive message from chatId ${ ctx.chat.id }`)
    conversation.sendText(ctx.message.text)
    ctx.sendChatAction("typing")
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