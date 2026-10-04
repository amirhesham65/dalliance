import { File, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { actions } from '@/store/notebook-store'

const SHEETS = /\.(csv|tsv|xlsx?|parquet|feather|json|sav|dta|sas7bdat)$/i
const IMAGES = /\.(png|jpe?g|gif|webp|tiff?|svg)$/i
const TEXTS = /\.(txt|md|pdf|docx?)$/i

function FileIcon({ name }: { name: string }) {
  if (SHEETS.test(name)) return <FileSpreadsheet />
  if (IMAGES.test(name)) return <FileImage />
  if (TEXTS.test(name)) return <FileText />
  return <File />
}

/** The files attached to a prompt cell, as chips. The cross takes one off the cell and leaves the file in the folder. */
export function AttachmentChips({ cellId, files }: { cellId: string; files: string[] }) {
  if (!files.length) return null
  return (
    <ul aria-label="Attached files" className="mt-2 flex flex-wrap gap-1.5">
      {files.map((file) => {
        const name = file.split('/').pop() ?? file
        return (
          <li key={file}>
            <Badge variant="secondary" title={file} className="h-6 max-w-[260px] gap-1.5 rounded-md pr-1 pl-2 font-normal text-muted-foreground [&>svg]:text-faint">
              <FileIcon name={name} />
              <span className="truncate text-foreground">{name}</span>
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => actions.detachFile(cellId, file)}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}
