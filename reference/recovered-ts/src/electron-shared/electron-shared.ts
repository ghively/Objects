import { v4 as uuid } from 'uuid'
import type { ActionFromXCallback } from './electron-communication.model.js'
import { actionFromXCallbackSchema } from './electron-communication.model.js'

export function getXCallbackErrorUrl(
  errorCode: string,
  errorMessage: string,
  errorUrl: string | undefined,
  searchParamsObj: any | undefined
) {
  if (!errorUrl) return undefined
  const errorUrlObj = new URL(errorUrl)
  errorUrlObj.searchParams.set('error-code', errorCode)
  if (errorMessage) errorUrlObj.searchParams.set('error-message', errorMessage)
  if (searchParamsObj) {
    for (const key in searchParamsObj) {
      errorUrlObj.searchParams.set(key, searchParamsObj[key])
    }
  }
  return errorUrlObj.toString()
}

export function extractXCallbackData(path: string):
  | {
      error: {
        errorCode: string
        errorMessage: string
        errorUrl: string | undefined
        searchParamsObj: { [key: string]: string }
      }
    }
  | {
      data: ActionFromXCallback
    } {
  try {
    const urlObj = new URL(path, 'https://app.capacities.io')
    const inErrorUrl = urlObj.searchParams.get('x-error')
    const inSuccessUrl = urlObj.searchParams.get('x-success')

    const searchParams = new URLSearchParams(urlObj.search)
    searchParams.delete('x-error')
    searchParams.delete('x-success')
    searchParams.delete('x-source')

    const searchParamsObj: { [key: string]: string } = {}
    searchParams.forEach((value, key) => {
      searchParamsObj[key] = decodeURIComponent(value)
    })

    const errorUrlObj = inErrorUrl ? new URL(inErrorUrl) : undefined
    errorUrlObj?.searchParams.set('x-source', 'Capacities')

    const callbackPath = urlObj.pathname

    const successUrlObj = inSuccessUrl ? new URL(inSuccessUrl) : undefined
    successUrlObj?.searchParams.set('x-source', 'Capacities')

    const successUrl = successUrlObj?.toString()
    const errorUrl = errorUrlObj?.toString()
    const processId = uuid()

    let actionData: any

    if (callbackPath === '/createNewObject') {
      actionData = {
        type: 'createNewObject',
        searchParamsObj: {
          ...searchParamsObj,
          title: searchParamsObj.name?.length ? searchParamsObj.name : searchParamsObj.title, // name is legacy
        },
      }
    } else if (callbackPath === '/appendToDailyNote' || callbackPath === '/getCurrentObject') {
      actionData = {
        type: callbackPath.slice(1),
        searchParamsObj,
      }
    } else {
      return {
        error: {
          errorCode: '404',
          errorMessage: 'not found',
          errorUrl: errorUrlObj?.toString(),
          searchParamsObj,
        },
      }
    }

    const validationResult = actionFromXCallbackSchema.strip().safeParse({
      processId,
      successUrl,
      errorUrl,
      data: actionData,
    })

    if (!validationResult.success) {
      return {
        error: {
          errorCode: '400',
          errorMessage: `Invalid data: ${validationResult.error.message}`,
          errorUrl: errorUrlObj?.toString(),
          searchParamsObj,
        },
      }
    }

    return {
      data: validationResult.data,
    }
  } catch (error) {
    return {
      error: {
        errorCode: '500',
        errorMessage: `internal server error: ${error instanceof Error ? error.message : 'unknown error'}`,
        errorUrl: undefined,
        searchParamsObj: {},
      },
    }
  }
}
