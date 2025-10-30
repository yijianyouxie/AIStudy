import { Readable } from 'stream'
import { EdgeTTS } from '../../lib/node-edge-tts/edge-tts-fixed'
import { TTSEngine, TtsOptions } from '../types'
import path from 'path'

export class EdgeTtsEngine implements TTSEngine {
  name = 'edge-tts'

  async synthesize(text: string, options: TtsOptions): Promise<Buffer | Readable> {
    const {
      speed = 1.0,
      voice = 'en-US-AriaNeural',
      pitch,
      rate,
      volume,
      stream,
      outputType,
      saveSubtitles,
      output,
    } = options
    let finaleType = outputType ? outputType : stream ? 'stream' : 'buffer'
    const lang = /([a-zA-Z]{2,5}-[a-zA-Z]{2,5}\b)/.exec(voice)?.[1]
    const tts = new EdgeTTS({
      voice,
      lang,
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      saveSubtitles,
      timeout: 30_000,
    })
    console.log(`run with nodejs edge-tts service...`)
    const bufferOrStream = await tts.ttsPromise(text, {
      outputType: finaleType as any,
      audioPath: output,
    })
    return bufferOrStream instanceof Buffer ? bufferOrStream : (bufferOrStream as Readable)
  }

  async getSupportedLanguages(): Promise<string[]> {
    return ['en-US', 'zh-CN', 'fr-FR', 'de-DE']
  }

  async getVoiceOptions(): Promise<string[]> {
    return [
      'en-AU-NatashaNeural',
      'en-AU-WilliamNeural',
      'en-CA-ClaraNeural',
      'en-CA-LiamNeural',
      'en-GB-LibbyNeural',
      'en-GB-MaisieNeural',
      'en-GB-RyanNeural',
      'en-GB-SoniaNeural',
      'en-GB-ThomasNeural',
      'en-HK-SamNeural',
      'en-HK-YanNeural',
      'en-IE-ConnorNeural',
      'en-IE-EmilyNeural',
      'en-IN-NeerjaExpressiveNeural',
      'en-IN-NeerjaNeural',
      'en-IN-PrabhatNeural',
      'en-KE-AsiliaNeural',
      'en-KE-ChilembaNeural',
      'en-NG-AbeoNeural',
      'en-NG-EzinneNeural',
      'en-NZ-MitchellNeural',
      'en-NZ-MollyNeural',
      'en-PH-JamesNeural',
      'en-PH-RosaNeural',
      'en-SG-LunaNeural',
      'en-SG-WayneNeural',
      'en-TZ-ElimuNeural',
      'en-TZ-ImaniNeural',
      'en-US-AnaNeural',
      'en-US-AndrewMultilingualNeural',
      'en-US-AndrewNeural',
      'en-US-AriaNeural',
      'en-US-AvaMultilingualNeural',
      'en-US-AvaNeural',
      'en-US-BrianMultilingualNeural',
      'en-US-BrianNeural',
      'en-US-ChristopherNeural',
      'en-US-EmmaMultilingualNeural',
      'en-US-EmmaNeural',
      'en-US-EricNeural',
      'en-US-GuyNeural',
      'en-US-JennyNeural',
      'en-US-MichelleNeural',
      'en-US-RogerNeural',
      'en-US-SteffanNeural',
      'en-ZA-LeahNeural',
      'en-ZA-LukeNeural',
      'zh-CN-XiaoxiaoNeural',
      'zh-CN-XiaoyiNeural',
      'zh-CN-YunjianNeural',
      'zh-CN-YunxiNeural',
      'zh-CN-YunxiaNeural',
      'zh-CN-YunyangNeural',
      'zh-CN-liaoning-XiaobeiNeural',
      'zh-CN-shaanxi-XiaoniNeural',
      'zh-HK-HiuGaaiNeural',
      'zh-HK-HiuMaanNeural',
      'zh-HK-WanLungNeural',
      'zh-TW-HsiaoChenNeural',
      'zh-TW-HsiaoYuNeural',
      'zh-TW-YunJheNeural',
    ]
  }

  // 可以直接运行这个文件来测试
  /* if (typeof module !== 'undefined' && require.main === module) {
    ;(async function test() {
      const ttsEngine = new EdgeTtsEngine()
      const voices = await ttsEngine.getVoiceOptions()
      console.log('Available voices:', voices)

      const text = `
The Lantern in the Woods
In a small village nestled between rolling hills and a dense forest, there lived an old woman named Elara. She was known for her peculiar habit of wandering into the woods every night, carrying a glowing lantern. The villagers whispered about her—some said she was a witch, others believed she was searching for a lost treasure. But no one dared to follow her.
`

      const buffer = await ttsEngine.generateAudio(text, {
        voice: 'en-US-JennyNeural',
        rate: '+0%',
        volume: '+0%',
        pitch: '+0Hz',
      })

      console.log('Generated audio buffer length:', buffer.length)
    })()
  } */
}
// 注意：我们已经使用 export class EdgeTtsEngine 导出了类，所以不需要再使用 export { EdgeTtsEngine }