import { ttsPluginManager } from '../pluginManager.js'
import { EdgeTtsEngine } from './edgeTts.js'
import { OpenAITtsEngine } from './openaiTts.js'
import { KokoroTtsEngine } from './kokoroTts.js'
import { REGISTER_KOKORO, REGISTER_OPENAI_TTS, TTS_KOKORO_URL } from '../../config/index.js'

export function registerEngines() {
  ttsPluginManager.registerEngine(new EdgeTtsEngine())
  if (REGISTER_OPENAI_TTS) {
    ttsPluginManager.registerEngine(new OpenAITtsEngine(process.env.OPENAI_API_KEY!))
  }
  if (REGISTER_KOKORO) {
    ttsPluginManager.registerEngine(new KokoroTtsEngine(TTS_KOKORO_URL))
  }
}
