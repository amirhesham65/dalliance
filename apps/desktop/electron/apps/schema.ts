import { z } from 'zod'
import { isPackageSpec } from '../kernel/python-env'

export const appIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export const exportSchema = z.object({
  variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(100).describe('Existing notebook variable name, without @'),
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.(csv|json)$/).describe('Filename within data/, such as orders.csv. No directory.'),
})
export const checkSchema = z.object({
  widget: z.enum(['checkbox', 'toggle', 'selectbox', 'radio', 'slider', 'number_input', 'text_input', 'text_area', 'multiselect', 'date_input', 'button']).describe('The main Streamlit widget to exercise'),
  label: z.string().min(1).max(200).describe('Exact widget label'),
  value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.union([z.string().max(1000), z.number().finite()])).max(100)]).optional().describe('Value to select or enter. Omit for a button click.'),
  expectText: z.string().min(1).max(1000).describe('Expected visible result AFTER the interaction. Use a result, not a static heading.'),
})
export const appDraftSchema = z.object({
  id: appIdSchema.optional().describe('Existing app id when updating. Omit for a new app.'),
  title: z.string().trim().min(1).max(100).describe('App title shown in Apps'),
  description: z.string().max(1000).describe('One sentence about what the app does'),
  code: z.string().min(1).max(200_000).describe('Complete Streamlit app.py source. Paths are relative to its app folder.'),
  requirements: z.array(z.string().max(100).refine(isPackageSpec)).max(30).describe('All dependencies. Dalliance installs them in an isolated project environment after approval.'),
  snapshots: z.array(exportSchema).max(20).describe('Notebook variables to export to data/. Existing snapshots remain unless refreshed.'),
  checks: z.array(checkSchema).max(5).optional().describe('At least one meaningful interaction check for an interactive app. No checks needed for a static report.'),
  design: z.enum(['dalliance', 'custom']).optional().describe('Default dalliance follows Dalliance typography, colours and appearance. Use custom only when the user explicitly requests a different design.'),
}).refine((d) => new Set(d.snapshots.map((s) => s.file)).size === d.snapshots.length, 'Snapshot filenames must be unique.')
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const manifestSchema = z.object({
  version: z.literal(1), id: appIdSchema, title: z.string().min(1).max(100), description: z.string().max(1000), entry: z.literal('app.py'),
  sourceCellId: z.string().max(200), sourceNotebook: z.string().max(300).nullable(),
  requirements: z.array(z.string().max(100).refine(isPackageSpec)).max(32),
  snapshots: z.array(z.object({ variable: exportSchema.shape.variable, file: z.string().regex(/^data\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.(csv|json)$/), exportedAt: z.string().max(50), hash: hash.optional(), sourceHash: hash.optional() })).max(20),
  updatedAt: z.string().max(50), verifiedAt: z.string().max(50).optional(),
  environment: z.object({ pythonVersion: z.string().max(100), packages: z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(100), version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.!+_-]*$/).max(100) })).max(1000) }).optional(),
  checks: z.array(checkSchema).max(5).optional(), design: z.enum(['dalliance', 'custom']).optional(),
})
