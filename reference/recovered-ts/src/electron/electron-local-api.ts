import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { Schema } from 'zod'
import type { ElectronCommunicationRendererToMainRequest } from '../electron-shared/electron-communication.model.js'
import { localApiDto } from '../shared-logic/models/api/public-api-beta.api.js'
import { localApiRouteDefinitions, localApiRouteKeys } from '../electron-shared/localApiDefinition.js'
import expressAsyncHandler from 'express-async-handler'
import { rendererRequest } from './electron-communication.js'
import { mainWindow } from './electron.js'

let serverAlreadyStarted = false

export function validateInputZod<T>(schema: Schema<T>, data: any, ignoreStrict = false): T {
  try {
    if (!ignoreStrict && 'strict' in schema && schema.strict) {
      // @ts-ignore
      return schema.strict().parse(data) as T
    } else {
      return schema.parse(data)
    }
  } catch (e) {
    throw new Error('Input validation failed', { cause: e })
  }
}

function inputValidationZod(type: Schema<any>) {
  return function (request: Request, _response: Response, next: NextFunction) {
    request.body = validateInputZod(type, request.body)
    next()
  }
}

function validateResponseZod<T>(schema: Schema<T>, data: T): T {
  try {
    if (process.env.NODE_ENV === 'development') {
      schema.parse(data)
      return data
    } else {
      schema.parse(data)
      return data
    }
  } catch (e) {
    console.error('Response validation failed', e)
    return data
  }
}

function isInputError(error: Error) {
  return error.message.startsWith('Unexpected token') || error.message.startsWith('Unexpected end of JSON input')
}

function customErrorHandler(err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) {
  if (isInputError(err)) {
    res.status(400).send('400 Bad Request')
    return
  } else if (err.message.includes('Input validation failed')) {
    res.status(400).send('400 Bad Request - Input validation failed')
    return
  } else {
    res.status(500).json({ error: err.message })
    return
  }
}

// Set up Express server
export function startLocalApi({ token }: ElectronCommunicationRendererToMainRequest['startLocalApi']['inData']) {
  if (serverAlreadyStarted) return
  serverAlreadyStarted = true

  const app = express()
  const PORT = 10334

  // Middleware
  app.use(cors())
  app.use(express.json())

  // auth middleware
  app.use((req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  })

  for (const routeKey of localApiRouteKeys) {
    const routeDefinition = localApiRouteDefinitions[routeKey]
    if (!routeDefinition) continue

    const requestBodySchema = localApiDto[routeKey].requestBody
    const validationMiddleware = requestBodySchema ? inputValidationZod(requestBodySchema) : undefined

    app[routeDefinition.method](
      routeDefinition.path,
      ...(validationMiddleware ? [validationMiddleware] : []),
      expressAsyncHandler(async (request: Request, response: Response) => {
        if (!mainWindow) throw new Error('App not ready')
        const resp = await rendererRequest(mainWindow, 'localApiRequest', {
          routeKey,
          data: {
            params: localApiDto[routeKey].requestParams
              ? validateInputZod(localApiDto[routeKey].requestParams, request.query)
              : undefined,
            body: request.body,
            userIdentity: undefined,
          },
        })

        if (localApiDto[routeKey].responseBody) {
          response.status(200).send(validateResponseZod(localApiDto[routeKey].responseBody, resp))
        } else {
          response.status(200).send()
        }
      })
    )
  }

  // error handling middleware
  app.use(customErrorHandler)

  const server = app.listen(PORT, 'localhost', () => {
    console.info(`REST API server running on http://localhost:${PORT}`)
  })

  server.on('error', (err) => {
    console.error('Server error:', err)
  })
}
