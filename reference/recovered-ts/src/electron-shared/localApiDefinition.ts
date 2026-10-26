import type { PublicApiRouteDefinitionsObject } from '~/shared-logic/util/publicApi.base.js'

type LocalApiTag = 'General' | 'Content'

export const localApiRouteKeys = [
  'get/spaces',
  'get/space-info',
  'post/search',
  'post/save-weblink',
  'post/save-to-daily-note',
  'post/save-task',
] as const
export type LocalApiRouteKey = (typeof localApiRouteKeys)[number]

const LOCAL_API_RATE_LIMIT_WINDOW_SECONDS = 60
const LOCAL_API_RATE_LIMIT_MAX_REQUESTS = 100

export const localApiRouteDefinitions: PublicApiRouteDefinitionsObject<LocalApiRouteKey, LocalApiTag> = {
  'get/spaces': {
    path: '/spaces',
    method: 'get',
    summary: 'Get your spaces',
    description: `Returns information about your personal spaces.`,
    tag: 'General',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
  'get/space-info': {
    path: '/space-info',
    method: 'get',
    summary: 'Get structures and collections of a space',
    description: `Returns all structures (object types) with property definitions and collections of a space.`,
    tag: 'General',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
  'post/search': {
    path: '/search',
    method: 'post',
    summary: 'Search for content',
    description: `Returns content based on a search term in a set of spaces.`,
    tag: 'Content',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
  'post/save-weblink': {
    path: '/save-weblink',
    method: 'post',
    summary: 'Save a weblink to a space',
    description: `Object type of weblink will be analyzed and saved as an object to your space.`,
    tag: 'Content',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
  'post/save-to-daily-note': {
    path: '/save-to-daily-note',
    method: 'post',
    summary: "Save text to today's daily note",
    description: `Saves a text to today's daily note in a space. The text can be formatted in markdown. Do not use this to import large amounts of content as this could break the daily note. Use the import system of Capacities instead.`,
    tag: 'Content',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
  'post/save-task': {
    path: '/save-task',
    method: 'post',
    summary: 'Save a task to a space',
    description: `Object type of task will be analyzed and saved as an object to your space.`,
    tag: 'Content',
    rateLimitWindowSeconds: LOCAL_API_RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMaxRequests: LOCAL_API_RATE_LIMIT_MAX_REQUESTS,
  },
}
