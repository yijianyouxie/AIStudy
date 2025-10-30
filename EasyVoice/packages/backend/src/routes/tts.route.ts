import { Router } from 'express'
import {
  generateAudio,
  downloadAudio,
  getVoiceList,
  createTask,
  getTask,
  getTaskStats,
} from '../controllers/tts.controller.js'
import { pickSchema } from '../controllers/pick.controller.js'
import { ttsPluginManager } from '../tts/pluginManager.js'
import { createTaskStream, generateJson } from '../controllers/stream.controller.js'
import { validateJson } from '../schema/generate.js'

const router = Router()

router.get('/engines', (req, res) => {
  const engines = ttsPluginManager.getAllEngines().map((engine) => ({
    name: engine.name,
    languages: engine.getSupportedLanguages(),
    voices: engine.getVoiceOptions?.() || [],
  }))
  res.json(engines)
})

router.get('/voiceList', getVoiceList)
router.get('/task/stats', getTaskStats)
router.get('/task/:id', getTask)
router.get('/download/:file', downloadAudio)

router.post('/create', pickSchema, createTask)
router.post('/createStream', pickSchema, createTaskStream)
router.post('/generate', pickSchema, generateAudio)
router.post('/generateJson', validateJson, generateJson)

export default router
