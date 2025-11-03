import path from 'path'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import taskManager from '../utils/taskManager.js'
import { EdgeSchema } from '../schema/generate.js'
import { generateTTSStream, generateTTSStreamJson } from '../services/tts.stream.service.js'
import { generateId, streamWithLimit } from '../utils/index.js'

function formatBody({ text, pitch, voice, volume, rate, useLLM, format }: any) {
  const positivePercent = (value: string | undefined) => {
    if (value === '0%' || value === '0' || value === undefined || value === '') return '+0%'
    return value
  }
  const positiveHz = (value: string | undefined) => {
    if (value === '0Hz' || value === '0' || value === undefined || value === '') return '+0Hz'
    return value
  }
  return {
    text: text.trim(),
    pitch: positiveHz(pitch),
    voice: positivePercent(voice),
    rate: positivePercent(rate),
    volume: positivePercent(volume),
    useLLM,
    format: format || 'wav' // 默认使用WAV格式
  }
}
/**
 * @description 流式返回音频, 支持长文本
 * @param req
 * @param res
 * @param next
 * @returns ReadableStream
 */
export async function createTaskStream(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.query?.mock) {
      logger.info('Mocking audio stream...')
      streamWithLimit(res, path.join(__dirname, '../../mock/flying.mp3'), 1280) // Mock stream with limit
      return
    }
    logger.debug('Generating audio with body:', req.body)
    const formattedBody = formatBody(req.body)
    const taskId = taskManager.generateTaskId(formattedBody)
    
    // Check if task already exists
    const existingTask = taskManager.getTask(taskId)
    if (existingTask) {
      if (existingTask.status === 'completed') {
        // Reuse the existing completed task result
        logger.info(`Reusing completed task: ${taskId}`)
        const result = existingTask.context?.result
        if (result) {
          res.setHeader('x-generate-tts-type', 'application/json')
          res.setHeader('Access-Control-Expose-Headers', 'x-generate-tts-type')
          res.json({ code: 200, data: result, success: true })
          return
        }
      } else if (existingTask.status === 'pending') {
        // Task is still processing, wait for it to complete
        logger.info(`Task ${taskId} is still processing, waiting for completion`)
        // We can't properly wait for the existing task to complete in this simple implementation
        // So we'll return an error indicating the task is already in progress
        res.status(409).json({ 
          code: 409, 
          message: `Task ${taskId} is already in progress`, 
          success: false 
        })
        return
      }
    }
    
    // Create new task if it doesn't exist
    const task = taskManager.createTask(formattedBody)
    task.context = { req, res, body: req.body }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStream(formattedBody, task)
  } catch (error) {
    console.log(`createTaskStream error:`, error)
    next(error)
  }
}
export async function generateJson(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body?.data
    logger.debug('generateJson with body:', data)
    const formatedBody = data.map((item: any) => formatBody(item))
    const text = data.map((item: any) => item.text).join('')
    const taskParams = {
      ...formatedBody[0],
      text,
    }
    const task = taskManager.createTask(taskParams)
    const voice = formatedBody[0].voice

    const segment: Segment = { id: generateId(voice, text), text }
    task.context = { req, res, segment, body: req.body }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStreamJson(formatedBody, task)
  } catch (error) {
    console.log(`createTaskStream error:`, error)
    next(error)
  }
}
