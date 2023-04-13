import jose from 'node-jose'
import fs from 'fs'
import axios from 'axios'
import LanguageDetect from 'languagedetect'

let iamToken: string
let glossary: { [key: string]: string } = {}

export const initTranslate = async () => {

  if (fs.existsSync(process.cwd() + "/glossary.json")) {
    glossary = JSON.parse(fs.readFileSync(process.cwd() + "/glossary.json", "utf-8"))
    console.log("Glossary loaded!", glossary)
  }

  const { id, private_key, service_account_id  } = JSON.parse(fs.readFileSync(process.cwd() + "/authorized_key.json", "utf-8"))
  const now = Math.floor(new Date().getTime() / 1000)

  const payload = {
    aud: "https://iam.api.cloud.yandex.net/iam/v1/tokens",
    iss: service_account_id,
    iat: now,
    exp: now + 3600
  }

  const result = await jose.JWK.asKey(private_key, 'pem', { kid: id, alg: 'PS256' })
  
  const jwt = await jose.JWS.createSign({ format: 'compact' }, result)
    .update(JSON.stringify(payload))
    .final()

  const updateIamToken = async () => {
    const resp = await axios.post("https://iam.api.cloud.yandex.net/iam/v1/tokens", { jwt })
    iamToken = resp.data.iamToken
    console.log("Yandex translator jwt token updated")
  }
  await updateIamToken()
  setInterval(updateIamToken, 6 * 60 * 60 * 1000)
}

const lngDetector = new LanguageDetect();
lngDetector.setLanguageType("iso2")
const slavLanguages = [ "bg", "mk", "sr", "mn", "uz", "uk", "kk" ]

const basicLanguage = [ "en", "fr", "de", "ru" ]

export const detectLocale = (str: string) => {
  const resp = lngDetector.detect(str, 4)
  if (resp.length === 0) return null
  const locale = resp[0][0]
  if (slavLanguages.includes(locale)) {
    return "ru"
  }
  if (!basicLanguage.includes(locale)) return "en"
  return locale
}

export const translate = async (str: string, sourceLanguageCode = "en", targetLanguageCode = "ru") => {
  try {
    const result = await axios.post("https://translate.api.cloud.yandex.net/translate/v2/translate", {
      sourceLanguageCode,
      targetLanguageCode,
      texts: [
        str
      ],
      glossaryConfig: Object.keys(glossary).length === 0? undefined: {
        glossaryData: {
          glossaryPairs: Object.entries(glossary).map(item => ({
            sourceText: item[0],
            translatedText: item[1]
          }))
        }
      }
    }, {
      headers: { Authorization: `Bearer ${iamToken}` }
    })
    return result.data.translations[0].text
  } catch(e) {
    console.log(e)
    return str
  }
}