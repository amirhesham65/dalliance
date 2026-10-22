import { MODELS, providerOf } from '@dalliance/shared/models'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotebook } from '@/store/notebook-store'

/** Every connected provider contributes its models to the same list. */
export function ModelSelect({ value, onValueChange }: { value: string; onValueChange: (model: string) => void }) {
  const keys = useNotebook((s) => s.providerKeys)
  const models = MODELS.filter((model) => {
    const provider = providerOf(model.id)
    return provider != null && keys?.configured[provider] === true
  })
  const provider = providerOf(value)
  if (provider && keys?.configured[provider] && !models.some((model) => model.id === value)) {
    models.push({ id: value, name: value, maker: '' })
  }
  return (
    <Select value={models.some((model) => model.id === value) ? value : ''} onValueChange={onValueChange} disabled={!models.length}>
      <SelectTrigger aria-label="Suggested model" className="mb-2 w-full"><SelectValue placeholder={models.length ? 'Choose a model' : 'Add a provider key to see models'} /></SelectTrigger>
      <SelectContent>{models.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
    </Select>
  )
}
