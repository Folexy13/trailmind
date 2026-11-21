import { z } from 'zod';

export const PageTypeSchema = z.enum([
  'article',
  'docs',
  'product',
  'thread',
  'video',
  'search_results',
  'tool',
  'other',
]);

export const EntityKindSchema = z.enum([
  'person',
  'org',
  'product',
  'place',
  'tech',
  'other',
]);

export const PageExtractionSchema = z.object({
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(360),
  type: PageTypeSchema,
  topics: z.array(z.string().min(1).max(60)).min(1).max(5),
  english_topics: z.array(z.string().min(1).max(60)).min(1).max(5).optional(),
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        kind: EntityKindSchema,
      }),
    )
    .max(20)
    .default([]),
  facts: z.array(z.string().min(1).max(260)).max(8).default([]),
  price: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().min(1).max(10),
      raw: z.string().min(1).max(40),
    })
    .nullable()
    .optional(),
  language: z.string().min(2).max(16).default('en'),
});

export type PageExtractionOutput = z.infer<typeof PageExtractionSchema>;

export const SensitiveDetectionSchema = z.object({
  sensitive: z.boolean(),
  category: z.enum(['none', 'login', 'medical', 'payment', 'adult', 'banking']),
  reason: z.string().max(160),
});

export type SensitiveDetectionOutput = z.infer<typeof SensitiveDetectionSchema>;

export const ClusterNamingSchema = z.object({
  name: z.string().min(1).max(60),
  summary: z.string().min(1).max(200),
});

export type ClusterNamingOutput = z.infer<typeof ClusterNamingSchema>;

export const AskMemorySchema = z.object({
  answer: z.string().min(1).max(2000),
  citations: z
    .array(
      z.object({
        page_id: z.string().min(1),
        passage_id: z.string().optional(),
        excerpt: z.string().max(260).optional(),
      }),
    )
    .default([]),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  has_answer: z.boolean(),
});

export type AskMemoryOutput = z.infer<typeof AskMemorySchema>;

export const JourneySummarySchema = z.object({
  name: z.string().min(1).max(80),
  outcome: z.string().min(1).max(320),
});

export type JourneySummaryOutput = z.infer<typeof JourneySummarySchema>;

export const ChangeWatchDiffSchema = z.object({
  changed: z.boolean(),
  summary: z.string().max(240),
  kind: z.enum(['price', 'content', 'availability', 'removed']),
  old_value: z.string().max(120).nullable().optional(),
  new_value: z.string().max(120).nullable().optional(),
});

export type ChangeWatchDiffOutput = z.infer<typeof ChangeWatchDiffSchema>;

export const ImageDescriptionSchema = z.object({
  description: z.string().min(1).max(240),
  extracted_text: z.string().max(300).optional(),
});

export type ImageDescriptionOutput = z.infer<typeof ImageDescriptionSchema>;

export const WeeklyRecapSchema = z.object({
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(1600),
  highlights: z.array(z.string().min(1).max(200)).max(6),
});

export type WeeklyRecapOutput = z.infer<typeof WeeklyRecapSchema>;

export const DeepSummarySchema = z.object({
  title: z.string().min(1).max(120),
  synthesis: z.string().min(1).max(3000),
  key_themes: z.array(z.string().min(1).max(160)).max(8),
  open_questions: z.array(z.string().min(1).max(160)).max(5),
});

export type DeepSummaryOutput = z.infer<typeof DeepSummarySchema>;

export const MemoryRadarSchema = z.object({
  has_alert: z.boolean(),
  kind: z.enum(['none', 'conflict', 'price_better', 'update']),
  headline: z.string().max(110),
  detail: z.string().max(260),
  source_page_id: z.string().optional(),
});

export type MemoryRadarOutput = z.infer<typeof MemoryRadarSchema>;

export const DecisionMatrixSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  recommended_option: z.string().min(1).max(200),
  options: z
    .array(
      z.object({
        option: z.string().min(1).max(100),
        price_or_cost: z.string().max(60).default('—'),
        pros: z.array(z.string().min(1).max(160)).max(5).default([]),
        cons: z.array(z.string().min(1).max(160)).max(5).default([]),
        verdict: z.string().max(160).default(''),
        source_page_ids: z.array(z.string().min(1)).max(5).default([]),
      }),
    )
    .min(1)
    .max(10),
  open_questions: z.array(z.string().min(1).max(160)).max(5).default([]),
});

export type DecisionMatrixOutput = z.infer<typeof DecisionMatrixSchema>;

/**
 * Plain JSON Schema definitions passed to Gemini Nano (`responseConstraint`)
 * and Cloud Gemini (`responseSchema`) so both backends return strict structured JSON.
 */
export const JSON_SCHEMAS = {
  page_extraction: {
    type: 'object',
    required: ['title', 'summary', 'type', 'topics', 'entities', 'facts', 'language'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      type: {
        type: 'string',
        enum: ['article', 'docs', 'product', 'thread', 'video', 'search_results', 'tool', 'other'],
      },
      topics: { type: 'array', items: { type: 'string' } },
      english_topics: { type: 'array', items: { type: 'string' } },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'kind'],
          properties: {
            name: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['person', 'org', 'product', 'place', 'tech', 'other'],
            },
          },
        },
      },
      facts: { type: 'array', items: { type: 'string' } },
      price: {
        type: 'object',
        nullable: true,
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          raw: { type: 'string' },
        },
      },
      language: { type: 'string' },
    },
  },
  sensitive_detection: {
    type: 'object',
    required: ['sensitive', 'category', 'reason'],
    properties: {
      sensitive: { type: 'boolean' },
      category: {
        type: 'string',
        enum: ['none', 'login', 'medical', 'payment', 'adult', 'banking'],
      },
      reason: { type: 'string' },
    },
  },
  cluster_naming: {
    type: 'object',
    required: ['name', 'summary'],
    properties: {
      name: { type: 'string' },
      summary: { type: 'string' },
    },
  },
  ask_memory: {
    type: 'object',
    required: ['answer', 'citations', 'confidence', 'has_answer'],
    properties: {
      answer: { type: 'string' },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['page_id'],
          properties: {
            page_id: { type: 'string' },
            passage_id: { type: 'string' },
            excerpt: { type: 'string' },
          },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
      has_answer: { type: 'boolean' },
    },
  },
  loop_journey_summary: {
    type: 'object',
    required: ['name', 'outcome'],
    properties: {
      name: { type: 'string' },
      outcome: { type: 'string' },
    },
  },
  change_watch_diff: {
    type: 'object',
    required: ['changed', 'summary', 'kind'],
    properties: {
      changed: { type: 'boolean' },
      summary: { type: 'string' },
      kind: { type: 'string', enum: ['price', 'content', 'availability', 'removed'] },
      old_value: { type: 'string', nullable: true },
      new_value: { type: 'string', nullable: true },
    },
  },
  image_understanding: {
    type: 'object',
    required: ['description'],
    properties: {
      description: { type: 'string' },
      extracted_text: { type: 'string' },
    },
  },
  weekly_recap: {
    type: 'object',
    required: ['headline', 'narrative', 'highlights'],
    properties: {
      headline: { type: 'string' },
      narrative: { type: 'string' },
      highlights: { type: 'array', items: { type: 'string' } },
    },
  },
  deep_summary: {
    type: 'object',
    required: ['title', 'synthesis', 'key_themes', 'open_questions'],
    properties: {
      title: { type: 'string' },
      synthesis: { type: 'string' },
      key_themes: { type: 'array', items: { type: 'string' } },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
  },
  memory_radar: {
    type: 'object',
    required: ['has_alert', 'kind', 'headline', 'detail'],
    properties: {
      has_alert: { type: 'boolean' },
      kind: { type: 'string', enum: ['none', 'conflict', 'price_better', 'update'] },
      headline: { type: 'string' },
      detail: { type: 'string' },
      source_page_id: { type: 'string' },
    },
  },
  decision_matrix: {
    type: 'object',
    required: ['title', 'summary', 'recommended_option', 'options', 'open_questions'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      recommended_option: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          required: ['option', 'price_or_cost', 'pros', 'cons', 'verdict', 'source_page_ids'],
          properties: {
            option: { type: 'string' },
            price_or_cost: { type: 'string' },
            pros: { type: 'array', items: { type: 'string' } },
            cons: { type: 'array', items: { type: 'string' } },
            verdict: { type: 'string' },
            source_page_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;
