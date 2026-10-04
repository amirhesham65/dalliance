import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import { CodeBlock } from '@/components/CodeBlock'
import { Figure } from '@/components/Figure'

// How Markdown renders in a blog post, in the site's type: Source Serif for headings, Inter for prose,
// JetBrains Mono for code. Spacing hangs off each element's top so a post's first element sits flush.
const components = {
  h2: (props) => <h2 className="mt-12 scroll-mt-18 font-serif text-[26px] leading-[1.25] font-medium tracking-[-0.01em] text-balance text-ink first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-9 scroll-mt-18 font-serif text-[20px] leading-[1.3] font-medium tracking-[-0.01em] text-ink first:mt-0" {...props} />,
  h4: (props) => <h4 className="mt-7 scroll-mt-18 font-semibold text-ink first:mt-0" {...props} />,
  p: (props) => <p className="mt-4 text-pretty first:mt-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  a: ({ href = '', ...props }) => (href.startsWith('/') || href.startsWith('#') ? <Link href={href} {...props} /> : <a href={href} rel="noopener" {...props} />),
  ul: (props) => <ul className="mt-4 list-disc space-y-1.5 pl-5 marker:text-ink-faint first:mt-0" {...props} />,
  ol: (props) => <ol className="mt-4 list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[13px] marker:text-ink-faint first:mt-0" {...props} />,
  li: (props) => <li className="scroll-mt-18 pl-1 [&>ol]:mt-1.5 [&>ul]:mt-1.5" {...props} />,
  blockquote: (props) => <blockquote className="mt-6 border-l-2 pl-5 font-serif text-[17px] leading-[1.55] text-ink first:mt-0 [&>p]:mt-3 [&>p]:first:mt-0" {...props} />,
  // A footnote call, [^1]. The Sources list they link to is styled in globals.css
  sup: (props) => <sup className="ml-px text-[0.72em] [&>a]:scroll-mt-18 [&>a]:px-px [&>a]:text-ink-subtle [&>a]:no-underline [&>a:hover]:text-ink" {...props} />,
  hr: () => <hr className="my-10 border-t" />,
  code: (props) => <code className="rounded-[5px] border bg-cell px-[0.3em] py-[0.05em] font-mono text-[0.88em] text-ink" {...props} />,
  pre: CodeBlock,
  table: (props) => (
    <div className="mt-6 overflow-x-auto first:mt-0">
      <table className="w-full border-collapse text-[14px] tabular-nums" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b py-2 pr-4 text-left font-medium text-ink" {...props} />,
  td: (props) => <td className="border-b py-2 pr-4 align-top" {...props} />,
  // Markdown wraps an image in a paragraph, which spaces it. It has no size, so it loads as a plain image; for a screenshot, use <Figure>
  img: ({ alt = '', ...props }) => (
    <img className="block h-auto max-w-full rounded-lg shadow-frame" alt={alt} loading="lazy" decoding="async" {...props} />
  ),
  Figure,
} satisfies MDXComponents

export function useMDXComponents(): MDXComponents {
  return components
}
