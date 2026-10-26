import { mediaTypes } from '../models/media.model.js'
import type { LabelItem } from '../models/property.model.js'
import { Icon } from './../models/blocks.model.js'
import {
  BLOCK_PROPERTY_ID,
  CTypes,
  ENTITY_PROPERTY_ID,
  WHITEBOARD_CANVAS_PROPERTY_ID,
  WHITEBOARD_NOTES_PROPERTY_ID,
} from './../models/component.model.js'
import { StructureDefinition } from './basicEntitiesBackbone.js'
import { generateGenericStructureHeuristicConfig, getStructureOrderBackbone } from './structureHeuristicsBackbone.js'

function withLabelLocalizationKeys<T extends string>(
  set: LabelItem<T>[],
  structureId: string,
  propertyDefinitionId: string
): LabelItem<T>[] {
  return set.map((label) => ({
    ...label,
    localizationKey: `components.${structureId}.propertyDefinitions.${propertyDefinitionId}.set.${label.id}`,
  }))
}

// !! should not be changed -> makes export invalid!
export const basicStructureIdentifiers: { [x in CTypes]: { singular: string; plural: string } } = {
  RootSpace: { singular: 'Space', plural: 'Spaces' },
  User: { singular: 'User', plural: 'Users' },
  UserPersonal: { singular: 'UserPersonal', plural: 'UserPersonals' },
  RootDatabase: { singular: 'Collection', plural: 'Collections' },
  RootQuery: { singular: 'Query', plural: 'Queries' },
  RootPage: { singular: 'Page', plural: 'Pages' },
  RootStructure: { singular: 'Structure', plural: 'Structures' },
  RootEntity: { singular: 'Object', plural: 'Objects' },
  RootBlocksTemplate: { singular: 'Template', plural: 'Templates' },
  MediaImage: { singular: 'Image', plural: 'Images' },
  MediaPDF: { singular: 'PDF', plural: 'PDFs' },
  MediaAudio: { singular: 'Audio', plural: 'Audios' },
  MediaVideo: { singular: 'Video', plural: 'Videos' },
  MediaWebResource: { singular: 'Weblink', plural: 'Weblinks' },
  MediaFile: { singular: 'File', plural: 'Files' },
  MediaTweet: { singular: 'Tweet', plural: 'Tweets' },
  RootAIChat: { singular: 'AIChat', plural: 'AIChats' },
  RootSimpleTable: { singular: 'Table', plural: 'Tables' },
  RootDailyNote: { singular: 'DailyNote', plural: 'DailyNotes' },
  RootTag: { singular: 'Tag', plural: 'Tags' },
  RootWhiteboard: { singular: 'Whiteboard', plural: 'Whiteboards' },
  UtilDate: { singular: 'Date', plural: 'Dates' },
  RootTask: { singular: 'Task', plural: 'Tasks' },
} as const

export const IMAGE_CATEGORY_KEYS = [
  // Documents & Text
  'document',
  'handwritten-note',
  'receipt',
  'book-page',
  'cover',
  'business-card',
  // Screenshots & Digital
  'screenshot',
  'ui-mockup',
  'code',
  // Visual Information
  'diagram',
  'infographic',
  'map',
  'whiteboard',
  // Photography
  'photo-people',
  'photo-animal',
  'photo-nature',
  'photo-object',
  'photo-food',
  'photo-architecture',
  'photo-event',
  // Art & Creative
  'illustration',
  'painting',
  'meme',
  'logo-icon',
  // Other
  'medical',
  'scientific',
  'other',
] as const

export type ImageCategory = (typeof IMAGE_CATEGORY_KEYS)[number]

const BASIC_IMAGE_CATEGORIES: LabelItem<(typeof IMAGE_CATEGORY_KEYS)[number]>[] = [
  { id: 'document', text: 'Document', color: 'blue' },
  { id: 'handwritten-note', text: 'Handwritten Note', color: 'amber' },
  { id: 'receipt', text: 'Receipt', color: 'gray' },
  { id: 'book-page', text: 'Book Page', color: 'orange' },
  { id: 'cover', text: 'Cover', color: 'purple' },
  { id: 'business-card', text: 'Business Card', color: 'indigo' },
  { id: 'screenshot', text: 'Screenshot', color: 'violet' },
  { id: 'ui-mockup', text: 'UI Mockup', color: 'pink' },
  { id: 'code', text: 'Code', color: 'emerald' },
  { id: 'diagram', text: 'Diagram', color: 'cyan' },
  { id: 'infographic', text: 'Infographic', color: 'rose' },
  { id: 'map', text: 'Map', color: 'teal' },
  { id: 'whiteboard', text: 'Whiteboard', color: 'gray' },
  { id: 'photo-people', text: 'Photo (People)', color: 'rose' },
  { id: 'photo-animal', text: 'Photo (Animal)', color: 'lime' },
  { id: 'photo-nature', text: 'Photo (Nature)', color: 'green' },
  { id: 'photo-object', text: 'Photo (Object)', color: 'amber' },
  { id: 'photo-food', text: 'Photo (Food)', color: 'orange' },
  { id: 'photo-architecture', text: 'Photo (Architecture)', color: 'blue' },
  { id: 'photo-event', text: 'Photo (Event)', color: 'purple' },
  { id: 'illustration', text: 'Illustration', color: 'violet' },
  { id: 'painting', text: 'Painting', color: 'fuchsia' },
  { id: 'meme', text: 'Meme', color: 'lime' },
  { id: 'logo-icon', text: 'Logo/Icon', color: 'indigo' },
  { id: 'medical', text: 'Medical', color: 'red' },
  { id: 'scientific', text: 'Scientific', color: 'emerald' },
  { id: 'other', text: 'Other', color: 'gray' },
] as const

export const AUDIO_CATEGORY_KEYS = [
  'voice-memo',
  'meeting',
  'interview',
  'lecture',
  'podcast',
  'phone-call',
  'dictation',
  'music',
  'ambient',
  'other',
] as const

export type AudioCategory = (typeof AUDIO_CATEGORY_KEYS)[number]

const BASIC_AUDIO_CATEGORIES: LabelItem<(typeof AUDIO_CATEGORY_KEYS)[number]>[] = [
  { id: 'voice-memo', text: 'Voice Memo', color: 'blue' },
  { id: 'meeting', text: 'Meeting', color: 'purple' },
  { id: 'interview', text: 'Interview', color: 'indigo' },
  { id: 'lecture', text: 'Lecture', color: 'emerald' },
  { id: 'podcast', text: 'Podcast', color: 'rose' },
  { id: 'phone-call', text: 'Phone Call', color: 'amber' },
  { id: 'dictation', text: 'Dictation', color: 'cyan' },
  { id: 'music', text: 'Music', color: 'fuchsia' },
  { id: 'ambient', text: 'Ambient', color: 'teal' },
  { id: 'other', text: 'Other', color: 'gray' },
] as const

export const WEBLINK_CONTENT_TYPE_KEYS = [
  'article',
  'blog-post',
  'news',
  'documentation',
  'tutorial',
  // Media
  'guide',
  'video',
  'podcast',
  'audio',
  // Tools & Services
  'tool',
  'app',
  'service',
  // Social & Community
  'social-post',
  'forum-thread',
  'q-and-a',
  // Commerce
  'product',
  'shop',
  'marketplace',
  // Instructional
  'recipe',
  'how-to',
  // Events & Learning
  'event',
  'course',
  'webinar',
  // Personal & Company
  'portfolio',
  'profile',
  'about',
  // Code
  'repository',
  'code',
  // Visual
  'image-gallery',
  'infographic',
  // Fallback
  'other',
] as const

export type WeblinkContentType = (typeof WEBLINK_CONTENT_TYPE_KEYS)[number]

const BASIC_WEBLINK_CONTENT_TYPES: LabelItem<(typeof WEBLINK_CONTENT_TYPE_KEYS)[number]>[] = [
  // Written Content
  { id: 'article', text: 'Article', color: 'blue' },
  { id: 'blog-post', text: 'Blog Post', color: 'purple' },
  { id: 'news', text: 'News', color: 'red' },
  { id: 'documentation', text: 'Documentation', color: 'indigo' },
  { id: 'tutorial', text: 'Tutorial', color: 'emerald' },
  // Media
  { id: 'guide', text: 'Guide', color: 'emerald' },
  { id: 'video', text: 'Video', color: 'pink' },
  { id: 'podcast', text: 'Podcast', color: 'amber' },
  { id: 'audio', text: 'Audio', color: 'teal' },
  // Tools & Services
  { id: 'tool', text: 'Tool', color: 'green' },
  { id: 'app', text: 'App', color: 'sky' },
  { id: 'service', text: 'Service', color: 'cyan' },
  // Social & Community
  { id: 'social-post', text: 'Social Post', color: 'rose' },
  { id: 'forum-thread', text: 'Forum Thread', color: 'orange' },
  { id: 'q-and-a', text: 'Q&A', color: 'yellow' },
  // Commerce
  { id: 'product', text: 'Product', color: 'lime' },
  { id: 'shop', text: 'Shop', color: 'fuchsia' },
  { id: 'marketplace', text: 'Marketplace', color: 'violet' },
  // Instructional
  { id: 'recipe', text: 'Recipe', color: 'orange' },
  { id: 'how-to', text: 'How-To', color: 'emerald' },
  // Events & Learning
  { id: 'event', text: 'Event', color: 'rose' },
  { id: 'course', text: 'Course', color: 'indigo' },
  { id: 'webinar', text: 'Webinar', color: 'purple' },
  // Personal & Company
  { id: 'portfolio', text: 'Portfolio', color: 'pink' },
  { id: 'profile', text: 'Profile', color: 'sky' },
  { id: 'about', text: 'About', color: 'blue' },
  // Code
  { id: 'repository', text: 'Repository', color: 'lime' },
  { id: 'code', text: 'Code', color: 'purple' },
  // Visual
  { id: 'image-gallery', text: 'Image Gallery', color: 'fuchsia' },
  { id: 'infographic', text: 'Infographic', color: 'cyan' },
  // Fallback
  { id: 'other', text: 'Other', color: 'gray' },
] as const

export const WEBLINK_TOPIC_KEYS = [
  'technology',
  'programming',
  'ai-ml',
  'business',
  'finance',
  'marketing',
  'science',
  'research',
  'academic',
  'health',
  'fitness',
  'wellness',
  'entertainment',
  'gaming',
  'media',
  'education',
  'learning',
  'news',
  'politics',
  'current-events',
  'lifestyle',
  'travel',
  'food',
  'design',
  'art',
  'creative',
  'productivity',
  'tools',
  'other',
] as const

export type WeblinkTopic = (typeof WEBLINK_TOPIC_KEYS)[number]

const BASIC_WEBLINK_TOPICS: LabelItem<(typeof WEBLINK_TOPIC_KEYS)[number]>[] = [
  // Tech
  { id: 'technology', text: 'Technology', color: 'blue' },
  { id: 'programming', text: 'Programming', color: 'purple' },
  { id: 'ai-ml', text: 'AI/ML', color: 'pink' },
  // Business
  { id: 'business', text: 'Business', color: 'emerald' },
  { id: 'finance', text: 'Finance', color: 'green' },
  { id: 'marketing', text: 'Marketing', color: 'amber' },
  // Academic
  { id: 'science', text: 'Science', color: 'indigo' },
  { id: 'research', text: 'Research', color: 'violet' },
  { id: 'academic', text: 'Academic', color: 'purple' },
  // Health
  { id: 'health', text: 'Health', color: 'red' },
  { id: 'fitness', text: 'Fitness', color: 'orange' },
  { id: 'wellness', text: 'Wellness', color: 'teal' },
  // Entertainment
  { id: 'entertainment', text: 'Entertainment', color: 'pink' },
  { id: 'gaming', text: 'Gaming', color: 'fuchsia' },
  { id: 'media', text: 'Media', color: 'rose' },
  // Learning
  { id: 'education', text: 'Education', color: 'cyan' },
  { id: 'learning', text: 'Learning', color: 'cyan' },
  // Current Events
  { id: 'news', text: 'News', color: 'red' },
  { id: 'politics', text: 'Politics', color: 'blue' },
  { id: 'current-events', text: 'Current Events', color: 'amber' },
  // Lifestyle
  { id: 'lifestyle', text: 'Lifestyle', color: 'rose' },
  { id: 'travel', text: 'Travel', color: 'sky' },
  { id: 'food', text: 'Food', color: 'orange' },
  // Creative
  { id: 'design', text: 'Design', color: 'rose' },
  { id: 'art', text: 'Art', color: 'fuchsia' },
  { id: 'creative', text: 'Creative', color: 'purple' },
  // Tools
  { id: 'productivity', text: 'Productivity', color: 'lime' },
  { id: 'tools', text: 'Tools', color: 'lime' },
  // Fallback
  { id: 'other', text: 'Other', color: 'gray' },
] as const

// ============================================================================
// PDF document type categories - what the document IS (medium-broad taxonomy)
// ============================================================================
export const PDF_DOCUMENT_TYPE_KEYS = [
  'article',
  'academic-paper',
  'report',
  'book',
  'manual',
  'presentation',
  'form',
  'letter',
  'legal-document',
  'financial-document',
  'policy-document',
  'educational-material',
  'marketing-material',
  'scanned-document',
  'other',
] as const

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPE_KEYS)[number]

const BASIC_PDF_DOCUMENT_TYPES: LabelItem<(typeof PDF_DOCUMENT_TYPE_KEYS)[number]>[] = [
  { id: 'article', text: 'Article', color: 'blue' },
  { id: 'academic-paper', text: 'Academic paper', color: 'indigo' },
  { id: 'report', text: 'Report', color: 'emerald' },
  { id: 'book', text: 'Book', color: 'purple' },
  { id: 'manual', text: 'Manual', color: 'cyan' },
  { id: 'presentation', text: 'Presentation', color: 'amber' },
  { id: 'form', text: 'Form', color: 'lime' },
  { id: 'letter', text: 'Letter', color: 'sky' },
  { id: 'legal-document', text: 'Legal document', color: 'red' },
  { id: 'financial-document', text: 'Financial document', color: 'green' },
  { id: 'policy-document', text: 'Policy document', color: 'orange' },
  { id: 'educational-material', text: 'Educational material', color: 'teal' },
  { id: 'marketing-material', text: 'Marketing material', color: 'pink' },
  { id: 'scanned-document', text: 'Scanned document', color: 'gray' },
  { id: 'other', text: 'Other', color: 'gray' },
] as const

// ============================================================================
// PDF topic domain categories - what the document is ABOUT (dedicated taxonomy)
// ============================================================================
export const PDF_TOPIC_KEYS = [
  'technology',
  'programming',
  'ai-ml',
  'business',
  'finance',
  'legal',
  'science',
  'medicine',
  'education',
  'research',
  'design',
  'product',
  'marketing',
  'operations',
  'policy',
  'government',
  'history',
  'arts-culture',
  'personal',
  'other',
] as const

export type PdfTopic = (typeof PDF_TOPIC_KEYS)[number]

const BASIC_PDF_TOPICS: LabelItem<(typeof PDF_TOPIC_KEYS)[number]>[] = [
  { id: 'technology', text: 'Technology', color: 'blue' },
  { id: 'programming', text: 'Programming', color: 'purple' },
  { id: 'ai-ml', text: 'AI/ML', color: 'pink' },
  { id: 'business', text: 'Business', color: 'emerald' },
  { id: 'finance', text: 'Finance', color: 'green' },
  { id: 'legal', text: 'Legal', color: 'red' },
  { id: 'science', text: 'Science', color: 'indigo' },
  { id: 'medicine', text: 'Medicine', color: 'rose' },
  { id: 'education', text: 'Education', color: 'cyan' },
  { id: 'research', text: 'Research', color: 'violet' },
  { id: 'design', text: 'Design', color: 'fuchsia' },
  { id: 'product', text: 'Product', color: 'sky' },
  { id: 'marketing', text: 'Marketing', color: 'amber' },
  { id: 'operations', text: 'Operations', color: 'lime' },
  { id: 'policy', text: 'Policy', color: 'orange' },
  { id: 'government', text: 'Government', color: 'teal' },
  { id: 'history', text: 'History', color: 'amber' },
  { id: 'arts-culture', text: 'Arts & culture', color: 'fuchsia' },
  { id: 'personal', text: 'Personal', color: 'gray' },
  { id: 'other', text: 'Other', color: 'gray' },
] as const

// !! IF YOU UPDATE HERE ALSO UPDATE IN GRAPHVIEW
export const basicStructureIcons: { [x in CTypes]: Icon } = {
  RootSpace: {
    type: 'iconify',
    val: 'ph-monitor',
  },
  User: {
    type: 'iconify',
    val: 'ph-user',
  },
  UserPersonal: {
    type: 'iconify',
    val: 'ph-user-gear',
  },
  RootDatabase: {
    type: 'iconify',
    val: 'ph-cards-three',
  },
  RootQuery: {
    type: 'iconify',
    val: 'ph-list-magnifying-glass',
  },
  RootPage: {
    type: 'iconify',
    val: 'ph-file-text',
  },
  RootStructure: {
    type: 'iconify',
    val: 'ph-notebook',
  },
  RootEntity: {
    type: 'iconify',
    val: '',
  },
  RootBlocksTemplate: {
    type: 'iconify',
    val: 'ph-layout',
  },
  MediaImage: {
    type: 'iconify',
    val: 'ph-image',
  },
  MediaPDF: {
    type: 'iconify',
    val: 'ph-file-pdf',
  },
  MediaAudio: {
    type: 'iconify',
    val: 'ph-waveform',
  },
  MediaVideo: {
    type: 'iconify',
    val: 'ph-video',
  },
  MediaWebResource: {
    type: 'iconify',
    val: 'ph-globe-hemisphere-west',
  },
  MediaFile: {
    type: 'iconify',
    val: 'ph-file',
  },
  MediaTweet: {
    type: 'iconify',
    val: 'ph-twitter-logo',
  },
  RootAIChat: {
    type: 'iconify',
    val: 'ph-chats',
  },
  RootSimpleTable: {
    type: 'iconify',
    val: 'ph-table',
  },
  RootDailyNote: {
    type: 'iconify',
    val: 'ph-calendar-check',
  },
  RootTag: {
    type: 'iconify',
    val: 'ph-tag',
  },
  RootWhiteboard: {
    type: 'iconify',
    val: 'ph-presentation',
  },
  UtilDate: {
    type: 'iconify',
    val: 'ph-calendar',
  },
  RootTask: {
    type: 'iconify',
    val: 'ph-check-circle',
  },
} as const

export const basicStructureDefinitions: StructureDefinition[] = [
  {
    id: 'MediaFile',
    authorKey: 'capacities',
    docLink: '/reference/basic-types/files',
    labelColor: 'red',
    defaultPageViewId: 'MediaFile_page_main',
    defaultViewIds: {
      embed: 'MediaFile_embed_main',
      inline: 'MediaFile_inline_main',
      page: 'MediaFile_page_main',
      smallCard: 'MediaFile_smallCard_main',
      wideCard: 'MediaFile_wideCard_main',
    },
    defaultViewType: 'wideCard',
    propertyDefinitions: [
      {
        dataType: 'icon',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'fileResource',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file',
        },
        id: 'media_fileFileResource',

        name: {
          val: 'media_fileFileResource',
        },
        readOnly: true,
        type: 'media_fileFileResource',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-clock-clockwise',
        },
        id: 'lastUpdated',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_lastUpdated',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-floppy-disk',
        },
        id: 'media_MIMEType',

        name: {
          val: 'MIME type',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-hash',
        },
        id: 'media_fileSize',

        name: {
          val: 'File size',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
    ],
    structureViews: {
      embed: ['MediaFile_embed_main'],
      inline: ['MediaFile_inline_main'],
      page: ['MediaFile_page_main'],
      smallCard: ['MediaFile_smallCard_main'],
      wideCard: ['MediaFile_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootStructure',
    authorKey: 'capacities',
    defaultPageViewId: 'RootStructure_page_main',
    defaultViewIds: {
      embed: 'RootStructure_embed_main',
      inline: 'RootStructure_inline_main',
      page: 'RootStructure_page_main',
      smallCard: 'RootStructure_smallCard_main',
      wideCard: 'RootStructure_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'pluralName',

        name: {
          val: 'Plural of title',
        },
        readOnly: false,
        type: 'text',
        isNotSearchable: true,
      },
    ],
    structureViews: {
      embed: ['RootStructure_embed_main'],
      inline: ['RootStructure_inline_main'],
      page: ['RootStructure_page_main'],
      smallCard: ['RootStructure_smallCard_main'],
      wideCard: ['RootStructure_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'MediaVideo',
    authorKey: 'capacities',
    defaultPageViewId: 'MediaVideo_page_main',
    defaultViewIds: {
      embed: 'MediaVideo_embed_main',
      inline: 'MediaVideo_inline_main',
      page: 'MediaVideo_page_main',
      smallCard: 'MediaVideo_smallCard_main',
      wideCard: 'MediaVideo_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'fileResource',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file',
        },
        id: 'media_videoFileResource',

        name: {
          val: 'media_videoFileResource',
        },
        readOnly: true,
        type: 'media_videoFileResource',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-clock-clockwise',
        },
        id: 'lastUpdated',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_lastUpdated',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-timer',
        },
        id: 'media_duration',

        name: {
          val: 'Duration',
        },
        isNotSearchable: true,
        readOnly: true,
        type: 'number',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-floppy-disk',
        },
        id: 'media_MIMEType',

        name: {
          val: 'MIME type',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-hash',
        },
        id: 'media_fileSize',

        name: {
          val: 'File size',
        },
        isNotSearchable: true,
        readOnly: true,
        type: 'number',
      },
    ],
    structureViews: {
      embed: ['MediaVideo_embed_main'],
      inline: ['MediaVideo_inline_main'],
      page: ['MediaVideo_page_main'],
      smallCard: ['MediaVideo_smallCard_main'],
      wideCard: ['MediaVideo_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'MediaAudio',
    authorKey: 'capacities',
    docLink: '/reference/basic-types/audio',
    labelColor: 'red',
    defaultPageViewId: 'MediaAudio_page_main',
    defaultViewIds: {
      embed: 'MediaAudio_embed_main',
      inline: 'MediaAudio_inline_main',
      page: 'MediaAudio_page_main',
      smallCard: 'MediaAudio_smallCard_main',
      wideCard: 'MediaAudio_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'icon',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'fileResource',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file',
        },
        id: 'media_audioFileResource',

        name: {
          val: 'media_audioFileResource',
        },
        readOnly: true,
        type: 'media_audioFileResource',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'Capture thoughts and ideas about this content',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-timer',
        },
        id: 'media_duration',

        name: {
          val: 'Duration',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-floppy-disk',
        },
        id: 'media_MIMEType',

        name: {
          val: 'MIME type',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-disc',
        },
        id: 'media_fileSize',

        name: {
          val: 'File size',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'media_URLReference',

        name: {
          val: 'URL',
        },
        readOnly: true,
        type: 'url',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-align-left',
        },
        id: 'media_audioSource',

        name: {
          val: 'Origin',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        id: 'media_audioCategory',
        type: 'label',
        dataType: 'label',
        name: { val: 'Category' },
        description: { val: '' },
        icon: { type: 'iconify', val: 'ph-microphone' },
        readOnly: false,
        isArray: true,
        isNotSearchable: false,
        set: withLabelLocalizationKeys(BASIC_AUDIO_CATEGORIES, 'MediaAudio', 'media_audioCategory'),
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: 'Neues Merkmal',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
    ],
    structureViews: {
      embed: ['MediaAudio_embed_main'],
      inline: ['MediaAudio_inline_main'],
      page: ['MediaAudio_page_main'],
      smallCard: ['MediaAudio_smallCard_main'],
      wideCard: ['MediaAudio_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'MediaPDF',
    authorKey: 'capacities',
    docLink: '/reference/basic-types/pdfs',
    labelColor: 'red',
    defaultPageViewId: 'MediaPDF_page_main',
    defaultViewIds: {
      embed: 'MediaPDF_embed_main',
      inline: 'MediaPDF_inline_main',
      page: 'MediaPDF_page_main',
      smallCard: 'MediaPDF_smallCard_main',
      wideCard: 'MediaPDF_wideCard_main',
    },
    defaultViewType: 'wideCard',
    propertyDefinitions: [
      {
        dataType: 'icon',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        allowedStructures: ['MediaImage'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-image',
        },
        id: 'media_previewImage',

        name: {
          val: 'Preview image',
        },
        isArray: false,
        readOnly: false,
        type: 'entity',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-align-left',
        },
        id: 'media_pdfSource',

        name: {
          val: 'Origin',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'media_URLReference',

        name: {
          val: 'URL',
        },
        readOnly: true,
        type: 'url',
      },
      {
        dataType: 'fileResource',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file',
        },
        id: 'media_pdfFileResource',

        name: {
          val: 'media_pdfFileResource',
        },
        readOnly: true,
        type: 'media_pdfFileResource',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-clock-clockwise',
        },
        id: 'lastUpdated',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_lastUpdated',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-book-open',
        },
        id: 'media_pdfNumberOfPages',

        name: {
          val: 'Number of pages',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-disc',
        },
        id: 'media_fileSize',

        name: {
          val: 'File size',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'boolean',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-check-square',
        },
        id: 'media_pdfHasTOC',

        name: {
          val: 'Table of content',
        },
        readOnly: true,
        type: 'boolean',
      },
      {
        id: 'media_pdfDocumentType',
        type: 'label',
        dataType: 'label',
        name: { val: 'Document type' },
        description: { val: '' },
        icon: { type: 'iconify', val: 'ph-tag' },
        readOnly: false,
        isArray: true,
        isNotSearchable: false,
        set: withLabelLocalizationKeys(BASIC_PDF_DOCUMENT_TYPES, 'MediaPDF', 'media_pdfDocumentType'),
      },
      {
        id: 'media_pdfTopic',
        type: 'label',
        dataType: 'label',
        name: { val: 'Topic' },
        description: { val: '' },
        icon: { type: 'iconify', val: 'ph-bookmark' },
        readOnly: false,
        isArray: true,
        isNotSearchable: false,
        set: withLabelLocalizationKeys(BASIC_PDF_TOPICS, 'MediaPDF', 'media_pdfTopic'),
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-floppy-disk',
        },
        id: 'media_MIMEType',

        name: {
          val: 'MIME type',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'Capture thoughts and ideas about this content',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
    ],
    structureViews: {
      embed: ['MediaPDF_embed_main'],
      inline: ['MediaPDF_inline_main'],
      page: ['MediaPDF_page_main'],
      smallCard: ['MediaPDF_smallCard_main'],
      wideCard: ['MediaPDF_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'UserPersonal',
    authorKey: 'capacities',
    defaultPageViewId: 'UserPersonal_page_main',
    defaultViewIds: {
      embed: 'UserPersonal_embed_main',
      inline: 'UserPersonal_inline_main',
      page: 'UserPersonal_page_main',
      smallCard: 'UserPersonal_smallCard_main',
      wideCard: 'UserPersonal_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        allowedStructures: ['RootSpace'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-bank',
        },
        id: 'spaces',
        isArray: true,
        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-user',
        },
        id: 'firstName',

        name: {
          val: 'First Name',
        },
        readOnly: false,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-user',
        },
        id: 'lastName',

        name: {
          val: 'Last Name',
        },
        readOnly: false,
        isNotSearchable: true,
        type: 'text',
      },
    ],
    structureViews: {
      embed: ['UserPersonal_embed_main'],
      inline: ['UserPersonal_inline_main'],
      page: ['UserPersonal_page_main'],
      smallCard: ['UserPersonal_smallCard_main'],
      wideCard: ['UserPersonal_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'User',
    authorKey: 'capacities',
    icon: {
      type: 'iconify',
      val: 'ph-user',
    },
    defaultPageViewId: 'User_page_main',
    defaultViewIds: {
      embed: 'User_embed_main',
      inline: 'User_inline_main',
      page: 'User_page_main',
      smallCard: 'User_smallCard_main',
      wideCard: 'User_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-align-left',
        },
        id: 'firstName',

        name: {
          val: 'First Name',
        },
        readOnly: false,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-align-left',
        },
        id: 'lastName',

        name: {
          val: 'Last Name',
        },
        readOnly: false,
        isNotSearchable: true,
        type: 'text',
      },
    ],
    structureViews: {
      embed: ['User_embed_main'],
      inline: ['User_inline_main'],
      page: ['User_page_main'],
      smallCard: ['User_smallCard_main'],
      wideCard: ['User_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootSpace',
    authorKey: 'capacities',

    defaultPageViewId: 'RootSpace_page_main',
    defaultViewIds: {
      embed: 'RootSpace_embed_main',
      inline: 'RootSpace_inline_main',
      page: 'RootSpace_page_main',
      smallCard: 'RootSpace_smallCard_main',
      wideCard: 'RootSpace_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        allowedStructures: ['RootPage'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file-text',
        },
        id: 'pages',
        isArray: true,
        name: {
          val: 'Pages',
        },
        readOnly: false,
        type: 'entity',
      },
      {
        allowedStructures: ['RootDatabase'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-notebook',
        },
        id: 'databases',
        isArray: true,
        name: {
          val: 'Databases',
        },
        readOnly: false,
        type: 'entity',
      },
      {
        allowedStructures: [
          'RootPage',
          'MediaImage',
          'MediaWebResource',
          'RootTag',
          'RootEntity',
          'MediaFile',
          'MediaPDF',
          'MediaAudio',
          'MediaTweet',
          'RootDatabase',
          'RootAIChat',
          'RootSimpleTable',
        ],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file-text',
        },
        id: 'workspace_pages',
        isArray: true,
        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity',
      },
    ],
    structureViews: {
      embed: ['RootSpace_embed_main'],
      inline: ['RootSpace_inline_main'],
      page: ['RootSpace_page_main'],
      smallCard: ['RootSpace_smallCard_main'],
      wideCard: ['RootSpace_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootDatabase',
    authorKey: 'capacities',
    labelColor: 'neutral',
    defaultPageViewId: 'RootDatabase_page_main',
    defaultViewIds: {
      embed: 'RootDatabase_embed_main',
      inline: 'RootDatabase_inline_main',
      page: 'RootDatabase_page_main',
      smallCard: 'RootDatabase_smallCard_main',
      wideCard: 'RootDatabase_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        allowedStructures: ['RootStructure'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-layout',
        },
        id: 'structures',

        name: {
          val: 'Structure',
        },
        readOnly: true,
        isArray: false,
        type: 'entity',
        isHidden: true,
      },
      {
        dataType: 'boolean',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-notebook',
        },
        id: 'isDefaultDatabase',

        name: {
          val: 'Default Database',
        },
        readOnly: true,
        type: 'boolean',
        isHidden: true,
      },
      {
        allowedStructures: ['RootDailyNote'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-copy',
        },
        id: 'entityTemplates',
        isArray: true,
        name: {
          val: 'Templates',
        },
        readOnly: true,
        type: 'entity',
        isHidden: true,
      },
    ],
    structureViews: {
      embed: ['RootDatabase_embed_main'],
      inline: ['RootDatabase_inline_main'],
      page: ['RootDatabase_page_main'],
      smallCard: ['RootDatabase_smallCard_main'],
      wideCard: ['RootDatabase_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootQuery',
    authorKey: 'capacities',
    labelColor: 'neutral',
    docLink: '/reference/queries',
    defaultPageViewId: 'RootQuery_page_main',
    defaultViewIds: {
      embed: 'RootQuery_embed_main',
      inline: 'RootQuery_inline_main',
      page: 'RootQuery_page_main',
      smallCard: 'RootQuery_smallCard_main',
      wideCard: 'RootQuery_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
    ],
    structureViews: {
      embed: ['RootQuery_embed_main'],
      inline: ['RootQuery_inline_main'],
      page: ['RootQuery_page_main'],
      smallCard: ['RootQuery_smallCard_main'],
      wideCard: ['RootQuery_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootPage',
    authorKey: 'capacities',
    labelColor: 'neutral',
    docLink: '/reference/basic-types/pages',
    defaultPageViewId: 'RootPage_page_main',
    defaultViewIds: {
      embed: 'RootPage_embed_main',
      inline: 'RootPage_inline_main',
      page: 'RootPage_page_main',
      smallCard: 'RootPage_smallCard_main',
      wideCard: 'RootPage_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'aliases',
        name: {
          val: 'Aliases',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-cards',
        },
        readOnly: false,
        type: 'entity_aliases',
        dataType: 'system',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        allowedStructures: ['MediaImage'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-image',
        },
        id: ENTITY_PROPERTY_ID,

        name: {
          val: 'Cover image',
        },
        isArray: false,
        readOnly: false,
        type: 'entity',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets-bold',
        },
        id: BLOCK_PROPERTY_ID,

        name: {
          val: 'Content',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-clock-clockwise',
        },
        id: 'lastUpdated',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_lastUpdated',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
    ],
    structureViews: {
      embed: ['RootPage_embed_main'],
      inline: ['RootPage_inline_main'],
      page: ['RootPage_page_main'],
      smallCard: ['RootPage_smallCard_main'],
      wideCard: ['RootPage_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootTag',
    authorKey: 'capacities',
    docLink: '/tutorials/tags',
    labelColor: 'neutral',
    defaultPageViewId: 'RootTag_page_main',
    defaultViewIds: {
      embed: 'RootTag_embed_main',
      inline: 'RootTag_inline_main',
      page: 'RootTag_page_main',
      smallCard: 'RootTag_smallCard_main',
      wideCard: 'RootTag_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'aliases',
        name: {
          val: 'Aliases',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-cards',
        },
        readOnly: false,
        type: 'entity_aliases',
        dataType: 'system',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-palette',
        },
        id: 'tag_colorTheme',

        name: {
          val: '',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
    ],
    structureViews: {
      embed: ['RootTag_embed_main'],
      inline: ['RootTag_inline_main'],
      page: ['RootTag_page_main'],
      smallCard: ['RootTag_smallCard_main'],
      wideCard: ['RootTag_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'MediaImage',
    authorKey: 'capacities',
    docLink: '/reference/basic-types/images',
    labelColor: 'red',
    defaultPageViewId: 'MediaImage_page_main',
    defaultViewIds: {
      embed: 'MediaImage_embed_main',
      inline: 'MediaImage_inline_main',
      page: 'MediaImage_page_main',
      smallCard: 'MediaImage_smallCard_main',
      wideCard: 'MediaImage_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'fileResource',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-file',
        },
        id: 'media_imageFileResource',

        name: {
          val: 'media_imageFileResource',
        },
        readOnly: true,
        type: 'media_imageFileResource',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'Capture thoughts and ideas about this content',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-arrow-circle-up-right',
        },
        id: 'media_imageSource',

        name: {
          val: 'Source',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'media_URLReference',

        name: {
          val: 'URL',
        },
        readOnly: true,
        type: 'url',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-floppy-disk',
        },
        id: 'media_MIMEType',

        name: {
          val: 'MIME type',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-disc',
        },
        id: 'media_fileSize',

        name: {
          val: 'File size',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-arrows-horizontal',
        },
        id: 'media_imageWidth',

        name: {
          val: 'Width',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'number',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-arrows-vertical',
        },
        id: 'media_imageHeight',

        name: {
          val: 'Height',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'number',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: 'Neues Merkmal',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      // AI Analysis properties
      {
        id: 'media_imageCategory',
        dataType: 'label',
        name: {
          val: 'Category',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-squares-four',
        },
        readOnly: false,
        type: 'label',
        isArray: true,
        set: withLabelLocalizationKeys(BASIC_IMAGE_CATEGORIES, 'MediaImage', 'media_imageCategory'),
      },
      {
        id: 'media_imageColors',
        dataType: 'label',
        name: {
          val: 'Colors',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-palette',
        },
        readOnly: false,
        type: 'label',
        isArray: true,
        set: withLabelLocalizationKeys(
          [
            { id: 'black', text: 'Black', color: 'gray' },
            { id: 'blue', text: 'Blue', color: 'blue' },
            { id: 'cyan', text: 'Cyan', color: 'cyan' },
            { id: 'green', text: 'Green', color: 'green' },
            { id: 'teal', text: 'Teal', color: 'teal' },
            { id: 'turquoise', text: 'Turquoise', color: 'cyan' },
            { id: 'indigo', text: 'Indigo', color: 'indigo' },
            { id: 'gray', text: 'Gray', color: 'gray' },
            { id: 'purple', text: 'Purple', color: 'purple' },
            { id: 'brown', text: 'Brown', color: 'amber' },
            { id: 'tan', text: 'Tan', color: 'amber' },
            { id: 'violet', text: 'Violet', color: 'violet' },
            { id: 'beige', text: 'Beige', color: 'amber' },
            { id: 'fuchsia', text: 'Fuchsia', color: 'fuchsia' },
            { id: 'gold', text: 'Gold', color: 'yellow' },
            { id: 'magenta', text: 'Magenta', color: 'fuchsia' },
            { id: 'orange', text: 'Orange', color: 'orange' },
            { id: 'pink', text: 'Pink', color: 'pink' },
            { id: 'red', text: 'Red', color: 'red' },
            { id: 'white', text: 'White', color: 'gray' },
            { id: 'yellow', text: 'Yellow', color: 'yellow' },
          ],
          'MediaImage',
          'media_imageColors'
        ),
      },
    ],
    structureViews: {
      embed: ['MediaImage_embed_main', 'MediaImage_embed_fullWidthCappedHeight', 'MediaImage_embed_square'],
      inline: ['MediaImage_inline_main'],
      page: ['MediaImage_page_main'],
      smallCard: ['MediaImage_smallCard_main', 'MediaImage_smallCard_square'],
      wideCard: ['MediaImage_wideCard_main'],
    },
    customStructureViewTitles: true,
  },
  {
    id: 'MediaWebResource',
    authorKey: 'capacities',
    docLink: '/reference/basic-types/weblinks',
    labelColor: 'blue',
    defaultPageViewId: 'MediaWebResource_page_main',
    defaultViewIds: {
      embed: 'MediaWebResource_embed_main',
      inline: 'MediaWebResource_inline_main',
      page: 'MediaWebResource_page_main',
      smallCard: 'MediaWebResource_smallCard_main',
      wideCard: 'MediaWebResource_wideCard_main',
    },
    defaultViewType: 'wideCard',
    propertyDefinitions: [
      {
        allowedStructures: ['MediaImage'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-image',
        },
        id: 'media_previewImage',

        name: {
          val: 'Preview Image',
        },
        isArray: false,
        readOnly: false,
        type: 'entity',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'Capture thoughts and ideas about this content',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'media_URLReference',

        name: {
          val: 'URL',
        },
        readOnly: true,
        type: 'url',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-brackets-angle',
        },
        id: 'media_iframeReference',

        name: {
          val: 'Iframe url',
        },
        readOnly: false,
        type: 'url',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-computer-tower',
        },
        id: 'media_host',

        name: {
          val: 'Domain',
        },
        readOnly: true,
        type: 'text',
      },
      {
        id: 'media_weblinkCategory',
        type: 'label',
        dataType: 'label',
        name: { val: 'Category' },
        description: { val: '' },
        icon: { type: 'iconify', val: 'ph-tag' },
        readOnly: false,
        isArray: true,
        isNotSearchable: false,
        set: withLabelLocalizationKeys(BASIC_WEBLINK_CONTENT_TYPES, 'MediaWebResource', 'media_weblinkCategory'),
      },
      {
        id: 'media_weblinkTopic',
        type: 'label',
        dataType: 'label',
        name: { val: 'Topic' },
        description: { val: '' },
        icon: { type: 'iconify', val: 'ph-bookmark' },
        readOnly: false,
        isArray: true,
        isNotSearchable: false,
        set: withLabelLocalizationKeys(BASIC_WEBLINK_TOPICS, 'MediaWebResource', 'media_weblinkTopic'),
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: 'Neues Merkmal',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
    ],
    structureViews: {
      embed: ['MediaWebResource_embed_main', 'MediaWebResource_embed_wide'],
      inline: ['MediaWebResource_inline_main'],
      page: ['MediaWebResource_page_main'],
      smallCard: ['MediaWebResource_smallCard_main'],
      wideCard: ['MediaWebResource_wideCard_main'],
    },
    customStructureViewTitles: true,
  },
  {
    id: 'MediaTweet',
    authorKey: 'capacities',
    docLink: '/reference/integrations/twitter',
    labelColor: 'blue',
    defaultPageViewId: 'MediaTweet_page_main',
    defaultViewIds: {
      embed: 'MediaTweet_embed_main',
      inline: 'MediaTweet_inline_main',
      page: 'MediaTweet_page_main',
      smallCard: 'MediaTweet_smallCard_main',
      wideCard: 'MediaTweet_wideCard_main',
    },
    defaultViewType: 'wideCard',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'Capture thoughts and ideas about this content',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'media_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'url',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'media_URLReference',

        name: {
          val: 'URL',
        },
        readOnly: true,
        type: 'url',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-user',
        },
        id: 'twitter_userName',

        name: {
          val: '',
        },
        readOnly: true,
        type: 'text',
      },
      {
        dataType: 'boolean',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets',
        },
        id: 'is_thread',

        name: {
          val: '',
        },
        readOnly: true,
        type: 'boolean',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-translate',
        },
        id: 'tweet_language',

        name: {
          val: '',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'text',
      },
      {
        allowedStructures: [...mediaTypes],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link-simple',
        },
        id: 'tweet_attachments',
        isArray: true,
        name: {
          val: '',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'entity',
      },
      {
        dataType: 'system',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-twitter-logo',
        },
        id: 'media_tweets',

        name: {
          val: '',
        },
        readOnly: true,
        type: 'media_tweets',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
    ],
    structureViews: {
      embed: ['MediaTweet_embed_main'],
      inline: ['MediaTweet_inline_main'],
      page: ['MediaTweet_page_main'],
      smallCard: ['MediaTweet_smallCard_main'],
      wideCard: ['MediaTweet_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootAIChat',
    authorKey: 'capacities',
    labelColor: 'purple',
    docLink: '/reference/ai-assistant#saving-ai-chats-as-objects',
    defaultPageViewId: 'RootAIChat_page_main',
    defaultViewIds: {
      embed: 'RootAIChat_embed_main',
      inline: 'RootAIChat_inline_main',
      page: 'RootAIChat_page_main',
      smallCard: 'RootAIChat_smallCard_main',
      wideCard: 'RootAIChat_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        allowedStructures: getStructureOrderBackbone('canBeAIChatContext', {
          ...generateGenericStructureHeuristicConfig(true),
          whiteboardAccess: false,
        }),
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link-simple',
        },
        id: 'chat_context',
        isArray: true,
        name: {
          val: '',
        },
        pageViewSettings: {
          visibility: 'hidden',
        },
        readOnly: true,
        isNotSearchable: true,
        type: 'entity',
      },
      {
        dataType: 'system',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-chats',
        },
        id: 'util_aiChat',

        name: {
          val: '',
        },
        pageViewSettings: {
          visibility: 'hidden',
        },
        readOnly: true,
        type: 'util_aiChat',
      },
    ],
    structureViews: {
      embed: ['RootAIChat_embed_main'],
      inline: ['RootAIChat_inline_main'],
      page: ['RootAIChat_page_main'],
      smallCard: ['RootAIChat_smallCard_main'],
      wideCard: ['RootAIChat_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootSimpleTable',
    authorKey: 'capacities',
    labelColor: 'blue',
    docLink: '/reference/basic-types/table-object',
    defaultPageViewId: 'RootSimpleTable_page_main',
    defaultViewIds: {
      embed: 'RootSimpleTable_embed_main',
      inline: 'RootSimpleTable_inline_main',
      page: 'RootSimpleTable_page_main',
      smallCard: 'RootSimpleTable_smallCard_main',
      wideCard: 'RootSimpleTable_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        allowedStructures: ['MediaImage'],
        dataType: 'entity',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-image',
        },
        id: 'RootSimpleTable_coverImage',

        name: {
          val: 'Cover image',
        },
        isArray: false,
        readOnly: false,
        type: 'entity',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,
        allowedStructures: ['RootTag'],
      },
      // blocks
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets-bold',
        },
        id: 'RootSimpleTable_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-table-bold',
        },
        id: 'RootSimpleTable_simpleTableBlock',

        name: {
          val: 'Table',
        },
        readOnly: false,
        type: 'simpleTableBlock',
      },
    ],
    structureViews: {
      embed: ['RootSimpleTable_embed_main'],
      inline: ['RootSimpleTable_inline_main'],
      page: ['RootSimpleTable_page_main'],
      smallCard: ['RootSimpleTable_smallCard_main'],
      wideCard: ['RootSimpleTable_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootWhiteboard',
    authorKey: 'capacities',
    labelColor: 'neutral',
    defaultPageViewId: 'RootWhiteboard_page_main',
    defaultViewIds: {
      embed: 'RootWhiteboard_embed_main',
      inline: 'RootWhiteboard_inline_main',
      page: 'RootWhiteboard_page_main',
      smallCard: 'RootWhiteboard_smallCard_main',
      wideCard: 'RootWhiteboard_wideCard_main',
    },
    defaultViewType: 'embed',
    // The canvas owns the page, so it always renders full width.
    dataOverwrite: {
      wideLayoutMode: true,
    },
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: 'entity_description_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: 'entity_description_name',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: 'entity_icon_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: 'entity_icon_name',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,
        allowedStructures: ['RootTag'],
      },
      // Everything placed on the canvas. Positions live in `entity.data.whiteboard`.
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-presentation',
        },
        id: WHITEBOARD_CANVAS_PROPERTY_ID,

        name: {
          val: 'Canvas',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets-bold',
        },
        id: WHITEBOARD_NOTES_PROPERTY_ID,

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-clock-clockwise',
        },
        id: 'lastUpdated',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_lastUpdated',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
    ],
    structureViews: {
      embed: ['RootWhiteboard_embed_main'],
      inline: ['RootWhiteboard_inline_main'],
      page: ['RootWhiteboard_page_main'],
      smallCard: ['RootWhiteboard_smallCard_main'],
      wideCard: ['RootWhiteboard_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootBlocksTemplate',
    authorKey: 'steffen',
    defaultPageViewId: 'RootBlocksTemplate_page_main',
    defaultViewIds: {
      embed: 'RootBlocksTemplate_embed_main',
      inline: 'RootBlocksTemplate_inline_main',
      page: 'RootBlocksTemplate_page_main',
      smallCard: 'RootBlocksTemplate_smallCard_main',
      wideCard: 'RootBlocksTemplate_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_title',
      },
      {
        dataType: 'string',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-info',
        },
        id: 'description',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_description',
      },
      {
        dataType: 'icon',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-smiley',
        },
        id: 'icon',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_icon',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'createdAt',

        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'entity_createdAt',
      },
      {
        dataType: 'blocks',
        description: {
          val: 'All blocks in here will be duplicated when activating template',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-dashes',
        },
        id: 'template_blocks',

        name: {
          val: '',
        },
        readOnly: false,
        type: 'blocks',
      },
    ],
    structureViews: {
      embed: ['RootBlocksTemplate_embed_main'],
      inline: ['RootBlocksTemplate_inline_main'],
      page: ['RootBlocksTemplate_page_main'],
      smallCard: ['RootBlocksTemplate_smallCard_main'],
      wideCard: ['RootBlocksTemplate_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootDailyNote',
    authorKey: 'capacities',
    docLink: '/reference/dates-and-daily-notes',
    defaultPageViewId: 'RootDailyNote_page_main',
    defaultViewIds: {
      embed: 'RootDailyNote_embed_main',
      inline: 'RootDailyNote_inline_main',
      page: 'RootDailyNote_page_main',
      smallCard: 'RootDailyNote_smallCard_main',
      wideCard: 'RootDailyNote_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: true,
        type: 'entity_title',
        isHidden: false,
      },
      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,
        allowedStructures: ['RootTag'],
      },
      {
        dataType: 'boolean',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-check-square',
        },
        id: 'RootDailyNote_reviewed',
        name: {
          val: 'Reviewed',
        },
        readOnly: false,
        type: 'boolean',
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets-bold',
        },
        id: 'RootDailyNote_notes',

        name: {
          val: 'Content',
        },
        readOnly: false,
        type: 'blocks',
      },
    ],
    structureViews: {
      embed: ['RootDailyNote_embed_main'],
      inline: ['RootDailyNote_inline_main'],
      page: ['RootDailyNote_page_main'],
      smallCard: ['RootDailyNote_smallCard_main'],
      wideCard: ['RootDailyNote_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'UtilDate',
    authorKey: 'capacities',
    labelColor: 'blue',
    defaultPageViewId: 'UtilDate_page_main',
    defaultViewIds: {
      embed: 'UtilDate_embed_main',
      inline: 'UtilDate_inline_main',
      page: 'UtilDate_page_main',
      smallCard: 'UtilDate_smallCard_main',
      wideCard: 'UtilDate_wideCard_main',
    },
    defaultViewType: 'inline',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        isHidden: true,
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: true,
        type: 'entity_title',
      },
      {
        dataType: 'system',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'date',

        name: {
          val: '',
        },
        readOnly: true,
        type: 'util_dateObject',
      },
      {
        dataType: 'system',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-blank',
        },
        id: 'event',

        name: {
          val: '',
        },
        readOnly: true,
        type: 'util_dateEvent',
      },
    ],
    structureViews: {
      embed: ['UtilDate_embed_main'],
      inline: ['UtilDate_inline_main'],
      page: ['UtilDate_page_main'],
      smallCard: ['UtilDate_smallCard_main'],
      wideCard: ['UtilDate_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
  {
    id: 'RootTask',
    authorKey: 'capacities',
    labelColor: 'orange',
    docLink: '/reference/task-management',
    defaultPageViewId: 'RootTask_page_main',
    defaultViewIds: {
      embed: 'RootTask_embed_main',
      inline: 'RootTask_inline_main',
      page: 'RootTask_page_main',
      smallCard: 'RootTask_smallCard_main',
      wideCard: 'RootTask_wideCard_main',
    },
    defaultViewType: 'embed',
    propertyDefinitions: [
      {
        dataType: 'string',
        description: {
          val: 'entity_title_description',
        },
        icon: {
          type: 'iconify',
          val: 'ph-text-t',
        },
        id: 'title',

        name: {
          val: 'entity_title_name',
        },
        readOnly: false,
        type: 'entity_title',
      },

      {
        id: 'tags',
        dataType: 'entity',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-tag',
        },
        readOnly: false,
        type: 'entity_tags',
        isArray: true,

        allowedStructures: ['RootTag'],
      },
      {
        id: 'status',
        dataType: 'label',
        isStatus: true,
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-trend-up',
        },
        readOnly: false,
        type: 'label',
        isArray: false,
        set: withLabelLocalizationKeys(
          [
            {
              id: 'not-started',
              text: 'Not Started',
              color: 'red',
              statusCategory: 'not-started',
            },
            {
              id: 'next-up',
              text: 'Next Up',
              color: 'yellow',
              statusCategory: 'not-started',
            },
            {
              id: 'in-progress',
              text: 'In Progress',
              color: 'blue',
              statusCategory: 'in-progress',
            },
            {
              id: 'on-hold',
              text: 'On Hold',
              color: 'pink',
              statusCategory: 'blocked',
            },
            {
              id: 'done',
              text: 'Done',
              color: 'green',
              statusCategory: 'done',
            },
          ],
          'RootTask',
          'status'
        ),
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar',
        },
        id: 'date',
        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: false,
        type: 'datetimeSimple',
        constraints: {
          resolutionPreference: 'day',
          endTimeSettings: 'notAllowed',
          supportsReminders: true,
        },
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-hourglass-medium',
        },
        id: 'deadline',
        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: false,
        type: 'datetimeSimple',
        constraints: {
          resolutionPreference: 'day',
          endTimeSettings: 'notAllowed',
        },
      },
      {
        id: 'priority',
        dataType: 'label',
        name: {
          val: '',
        },
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-flag',
        },
        readOnly: false,
        type: 'label',
        isArray: false,
        set: withLabelLocalizationKeys(
          [
            {
              id: 'low',
              text: 'Low',
              color: 'amber',
            },
            {
              id: 'medium',
              text: 'Medium',
              color: 'orange',
            },
            {
              id: 'high',
              text: 'High',
              color: 'red',
            },
          ],
          'RootTask',
          'priority'
        ),
      },

      {
        dataType: 'system',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-link',
        },
        id: 'backlinks',
        name: {
          val: '',
        },
        readOnly: false,
        type: 'entity_backlinks',
      },
      {
        dataType: 'datetime',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-calendar-check',
        },
        id: 'completed',
        mode: 'datetime',
        name: {
          val: '',
        },
        readOnly: true,
        type: 'datetimeSimple',
        constraints: {
          resolutionPreference: 'time',
          endTimeSettings: 'notAllowed',
        },
        pageViewSettings: {
          visibility: 'hidden',
        },
      },
      {
        dataType: 'blocks',
        description: {
          val: '',
        },
        icon: {
          type: 'iconify',
          val: 'ph-list-bullets-bold',
        },
        id: 'RootTask_notes',

        name: {
          val: 'Notes',
        },
        readOnly: false,
        type: 'blocks',
      },
    ],
    structureViews: {
      embed: ['RootTask_embed_main'],
      inline: ['RootTask_inline_main'],
      page: ['RootTask_page_main'],
      smallCard: ['RootTask_smallCard_main'],
      wideCard: ['RootTask_wideCard_main'],
    },
    customStructureViewTitles: false,
  },
]
