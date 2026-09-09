import type { Context } from '@deepseek-ai/cordis'
import type { NookDshService } from '@nook-dsh/dsh-adapter'
import type { ProjectFeatureService } from '@nook-dsh/feature-project'
import type { PreviewFeatureService } from '@nook-dsh/feature-preview'
import { registerSyncTools } from './sync-tools.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookDsh: NookDshService
    nookProjectFeature: ProjectFeatureService
    nookPreview: PreviewFeatureService
  }
}

export const inject = ['nookDsh', 'nookProjectFeature', 'nookPreview']

function requiredString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('tool output is not an object')
  return value as Record<string, unknown>
}

const PROJECT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

export function apply(ctx: Context): void {
  ctx.inject(['nookSync'], registerSyncTools)
  ctx.effect(
    () =>
      ctx.nookDsh.registerTool({
        name: 'nook_project_list',
        description: 'List the projects managed by Nook.',
        parameters: {},
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projects: { type: 'array', required: true, items: PROJECT_VALUE_SCHEMA },
          },
        },
        render(value) {
          const projects = record(value).projects
          if (!Array.isArray(projects) || projects.length === 0) return 'Nook has no projects.'
          return `Nook projects: ${projects.map(project => String(record(project).name)).join(', ')}`
        },
        async execute() {
          return { projects: [...(await ctx.nookProjectFeature.listProjects())] }
        },
      }),
    'nook-agent: project list tool',
  )

  ctx.effect(
    () =>
      ctx.nookDsh.registerTool({
        name: 'nook_project_create',
        description: 'Create a project in Nook.',
        parameters: {
          name: { type: 'string', required: true, description: 'Short project name.' },
          description: { type: 'string', description: 'Optional project description.' },
        },
        outputSchema: PROJECT_VALUE_SCHEMA,
        render(value) {
          const project = record(value)
          return `Created Nook project ${String(project.name)} (${String(project.id)}).`
        },
        async execute(args) {
          const description = optionalString(args, 'description')
          return ctx.nookProjectFeature.createProject({
            name: requiredString(args, 'name'),
            ...(description === undefined ? {} : { description }),
          })
        },
      }),
    'nook-agent: project create tool',
  )

  ctx.effect(
    () =>
      ctx.nookDsh.registerTool({
        name: 'nook_preview_capture',
        description: 'Open a URL through the Nook browser capability and save a PNG preview artifact for a project.',
        parameters: {
          project_id: { type: 'string', required: true, description: 'Nook project id.' },
          url: { type: 'string', required: true, description: 'Absolute HTTP or HTTPS URL.' },
          full_page: { type: 'boolean', description: 'Capture the full page. Defaults to true.' },
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', required: true },
            url: { type: 'string', required: true },
            title: { type: 'string', required: true },
            artifactId: { type: 'string', required: true },
            artifactName: { type: 'string', required: true },
            byteLength: { type: 'integer', required: true },
          },
        },
        render(value) {
          const result = record(value)
          return `Captured ${String(result.title || result.url)} as ${String(result.artifactName)} (${String(result.byteLength)} bytes).`
        },
        timeoutMs: 45_000,
        async execute(args, signal) {
          const fullPage = args.full_page
          if (fullPage !== undefined && typeof fullPage !== 'boolean') throw new Error('full_page must be a boolean')
          const result = await ctx.nookPreview.capture(
            requiredString(args, 'project_id'),
            requiredString(args, 'url'),
            fullPage ?? true,
            signal,
          )
          return {
            projectId: result.projectId,
            url: result.url,
            title: result.title,
            artifactId: result.screenshot.id,
            artifactName: result.screenshot.name,
            byteLength: result.screenshot.byteLength,
          }
        },
      }),
    'nook-agent: preview capture tool',
  )
}
