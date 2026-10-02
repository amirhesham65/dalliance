import { ArrowLeft, ArrowRight, Check, FilePlus, FolderOpen, FolderPlus, NotebookText } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ago } from '@/lib/notebook/text'
import { STARTERS, sampleNotebook } from '@/lib/notebook/samples'
import { cn } from '@/lib/utils'
import type { RecentNotebook } from '@dalliance/shared/ipc'
import { newPromptCell } from '@dalliance/shared/notebook'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'
import { signedIn } from '@/lib/cloud'
import { Onboarding } from './Onboarding'
import { Kbd } from '@/components/ui/kbd'
import { Wordmark } from './parts'
import { folderName, fresh, modKey, pythonReady, startWith } from './start'

/** What the window shows with no notebook open: the first-run setup the first time, the start page after that. */
export function WelcomeScreen() {
  const settings = useNotebook((s) => s.settings)
  const [setupStep, setSetupStep] = useState<number | null>(null)
  if (!settings) return <div className="flex-1" />
  if (!settings.onboarded || setupStep != null)
    return <Onboarding initialStep={setupStep ?? 0} onClose={() => setSetupStep(null)} />
  return <StartPage onSetup={setSetupStep} />
}

function StartPage({ onSetup }: { onSetup: (step: number) => void }) {
  const account = useNotebook((s) => s.account)
  const python = useNotebook((s) => s.python)
  const canReturn = useNotebook((s) => s.canReturn)
  const path = useNotebook((s) => s.path)
  const [recent, setRecent] = useState<RecentNotebook[] | null>(null)
  const api = getApi()
  const mod = modKey()

  useEffect(() => {
    void api?.recentNotebooks().then(setRecent)
  }, [api])

  const cwd = useNotebook((s) => s.kernel.cwd)
  const hasAccount = signedIn(account)
  const hasPython = pythonReady(python)
  const name = path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.ipynb$/, '') : 'Untitled'

  const tryPrompt = async (prompt: string) => {
    const cell = newPromptCell(prompt)
    if (await startWith(fresh({ cells: [cell] }))) actions.run(cell.id)
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 justify-center overflow-y-auto px-2 pb-2">
      <div className="my-auto flex w-full max-w-[940px] flex-col gap-2 pt-6 pb-[8vh] md:flex-row">
        <section aria-label="Start" className="flex min-w-0 flex-[1.25] flex-col rounded-xl border bg-background px-8 pt-9 pb-6 shadow-pane">
          {canReturn && (
            <button
              type="button"
              onClick={() => actions.closeWelcome()}
              className="-mt-3 mb-6 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 -ml-1.5 text-[13px] text-faint hover:bg-hover hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to {name}
            </button>
          )}
          <Wordmark size="lg" />
          <p className="mt-3 max-w-[40ch] text-[14px] leading-[1.6] text-muted-foreground">A notebook where each cell is written in plain language and turned into working Python.</p>

          <div className="mt-7 -mx-2 flex flex-col">
            <Row icon={<FilePlus />} label="New notebook" shortcut={`${mod}N`} onClick={() => void startWith(fresh(welcomeNotebook()))} />
            <Row icon={<FolderOpen />} label="Open…" shortcut={`${mod}O`} onClick={() => void startWith(() => api!.openNotebook())} />
            <Row icon={<FolderPlus />} label="Open folder…" shortcut={`⇧${mod}O`} onClick={() => void startWith(() => api!.openFolder(welcomeNotebook()))} />
            <Row icon={<NotebookText />} label="Sample notebook" onClick={() => void startWith(fresh(sampleNotebook()))} />
          </div>
          <p className="mt-2 text-xs text-faint" title={cwd}>
            New notebooks are saved in <span className="text-muted-foreground">{folderName(null, cwd)}</span>.
          </p>

          <p className="eyebrow mt-7 mb-1.5">Recent</p>
          {recent == null ? (
            <div className="h-16" />
          ) : recent.length ? (
            <ul className="-mx-2 flex flex-col">
              {recent.map((r) => (
                <li key={r.path}>
                  <button
                    type="button"
                    onClick={() => void startWith(() => api!.openRecent(r.path))}
                    className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover"
                    title={r.path}
                  >
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="truncate text-xs text-faint">{r.folder}</span>
                    <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">{ago(r.openedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1.5 text-[13px] text-faint">Notebooks you open or save show up here.</p>
          )}
        </section>

        <section aria-label={hasAccount && hasPython ? 'Try a prompt' : 'Setup'} className="flex min-w-0 flex-1 flex-col rounded-xl border bg-background shadow-pane">
          {hasAccount && hasPython ? (
            <>
              <header className="px-6 pt-6 pb-3">
                <h2 className="font-serif text-[19px] font-medium">Try a prompt</h2>
                <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">Each one opens a new notebook and runs. None of them need data.</p>
              </header>
              <ul aria-label="Example prompts" className="flex flex-col px-3 pb-3">
                {STARTERS.map((s) => (
                  <li key={s.prompt}>
                    <button
                      type="button"
                      onClick={() => void tryPrompt(s.prompt)}
                      className="group/sug flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="eyebrow block">{s.hint}</span>
                        <span className="mt-0.5 block font-serif text-[15px] leading-[1.5]">{s.prompt}</span>
                      </span>
                      <ArrowRight className="mt-5 size-3.5 shrink-0 text-faint transition-transform group-hover/sug:translate-x-0.5 group-hover/sug:text-ink" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <header className="px-6 pt-6 pb-3">
                <h2 className="font-serif text-[19px] font-medium">Before your first run</h2>
                <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">Two things turn prompts into results. You can add them now or from Settings.</p>
              </header>
              <ul className="flex flex-col gap-1 px-3 pb-3">
                <SetupItem
                  done={hasAccount}
                  title="A Dalliance account"
                  detail={account?.user ? `Signed in as ${account.user.name || account.user.email}` : 'Runs prompts on your plan'}
                  onClick={() => onSetup(1)}
                />
                <SetupItem
                  done={hasPython}
                  title="Python"
                  detail={hasPython ? `Python ${python?.version?.split('.').slice(0, 2).join('.')} is ready` : python?.python ? `Missing ${python.missingPackages.join(', ')}` : 'Runs the code'}
                  onClick={() => onSetup(2)}
                />
              </ul>
              <div className="px-6 pb-6">
                <Button className="w-full" onClick={() => onSetup(hasAccount ? 2 : 1)}>
                  Finish setting up
                </Button>
              </div>
            </>
          )}
          <footer className="mt-auto border-t px-6 py-3 text-xs leading-[1.6] text-faint">
            <Kbd>Shift+Enter</Kbd> runs a cell. <Kbd>{mod}B</Kbd> hides the overview. <Kbd>{mod}1</Kbd> to <Kbd>{mod}6</Kbd> open the side panes.
          </footer>
        </section>
      </div>
    </div>
  )
}

function Row({ icon, label, shortcut, onClick }: { icon: ReactNode; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-hover [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  )
}

function SetupItem({ done, title, detail, onClick }: { done: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover">
        <span
          className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full border', done ? 'border-go bg-go text-background' : 'hatch border-ring')}
          aria-label={done ? 'Done' : 'Not done'}
        >
          {done && <Check className="size-3" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13.5px] font-medium', done && 'text-muted-foreground')}>{title}</span>
          <span className="block truncate text-[12.5px] text-faint">{detail}</span>
        </span>
        {!done && <ArrowRight className="size-3.5 shrink-0 text-faint" />}
      </button>
    </li>
  )
}
