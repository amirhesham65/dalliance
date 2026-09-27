import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText'

describe('MarkdownText', () => {
  it('renders bold, italic, code, links and @references', () => {
    const { container } = render(
      <p>
        <MarkdownText text="Use **family size** from `SibSp`, *roughly*, per [the docs](https://seaborn.pydata.org) and @orders, but keep 2*3*4 and snake_case_name." />
      </p>,
    )
    expect(container.querySelector('strong')).toHaveTextContent('family size')
    expect(container.querySelector('code')).toHaveTextContent('SibSp')
    expect(container.querySelector('em')).toHaveTextContent('roughly')
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://seaborn.pydata.org')
    expect(screen.getByText('@orders')).toHaveClass('text-ref')
    // Stars in arithmetic and underscores inside names are not emphasis
    expect(container.querySelectorAll('em')).toHaveLength(1)
    expect(container).toHaveTextContent('2*3*4 and snake_case_name.')
  })

  it('leaves links that are not web addresses as text', () => {
    render(<MarkdownText text="[run it](javascript:alert(1))" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
