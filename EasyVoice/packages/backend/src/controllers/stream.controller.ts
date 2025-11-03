import path from 'path'
import fs from 'fs/promises'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'
import taskManager from '../utils/taskManager.js'
import { EdgeSchema } from '../schema/generate.js'
import { generateTTSStream, generateTTSStreamJson } from '../services/tts.stream.service.js'
import { generateId, streamWithLimit } from '../utils/index.js'
import audioCacheInstance from '../services/audioCache.service.js'

function formatBody(body: any): Required<EdgeSchema> & { format?: string } {
  const { text, voice, rate, pitch, volume, format = 'wav', useLLM = false } = body
  return {
    text: text?.trim(),
    voice: voice?.trim() || 'zh-CN-XiaoxiaoNeural',
    rate: rate?.trim() || '+0%',
    pitch: pitch?.trim() || '+0Hz',
    volume: volume?.trim() || '+0%',
    format,
    useLLM,
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
        // For streaming requests, we should check if we have cached audio files
        // and stream them directly instead of re-processing
        const cacheKey = taskId; // Use taskId as cache key
        const cachedAudio = await audioCacheInstance.getAudio(cacheKey);
        
        if (cachedAudio) {
          // Stream cached audio directly
          logger.info(`Streaming cached audio for task: ${taskId}`)
          const audioPath = cachedAudio.audio;
          
          try {
            // Check if file exists
            await fs.access(audioPath);
            
            // Set appropriate content type based on format
            const format = formattedBody.format || 'wav';
            if (format === 'wav') {
              res.setHeader('Content-Type', 'audio/wav');
            } else {
              res.setHeader('Content-Type', 'audio/mpeg');
            }
            
            // Stream the file
            const fileBuffer = await fs.readFile(audioPath);
            res.write(fileBuffer);
            res.end();
            
            return;
          } catch (fileError) {
            logger.warn(`Cached audio file not found, re-processing: ${audioPath}`, fileError);
            // Continue with normal processing if file not found
          }
        }
        
        // If no cache or cache invalid, process again but with a new task
        const task = taskManager.createTask(formattedBody)
        task.context = { req, res, body: req.body }
        logger.info(`Generated stream task ID: ${task.id}`)
        generateTTSStream(formattedBody, task)
        return
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
      } else if (existingTask.status === 'failed') {
        // Remove failed task and create a new one
        taskManager.tasks.delete(taskId);
      }
    }
    
    // Create new task if it doesn't exist or is failed
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
